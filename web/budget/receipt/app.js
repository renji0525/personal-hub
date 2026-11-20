// 専用ダイアログで確認した候補だけを、家計簿へ引き渡す
window.BudgetReceipt = (() => {
    function mount({ button, context, apply }) {
        const dialog = document.createElement('dialog');
        dialog.id = 'receiptDialog';
        dialog.setAttribute('aria-labelledby', 'receiptHeading');
        dialog.innerHTML = `
            <div class="receipt-heading"><h2 id="receiptHeading">レシートから入力</h2><button type="button" class="quiet" id="receiptClose">閉じる</button></div>
            <p class="muted">レシート1枚を1件の支出として入力します。明るい場所で、文字がまっすぐ写るように撮影してください。</p>
            <div class="receipt-actions"><button type="button" id="receiptCamera" class="quiet">写真を撮る</button><button type="button" id="receiptChoose" class="quiet">画像を選ぶ</button></div>
            <input id="receiptCameraFile" type="file" accept="image/*" capture="environment" hidden>
            <input id="receiptImageFile" type="file" accept="image/*" hidden>
            <p class="muted">文字の読み取りは端末内で行います。初回は読み取りデータをダウンロードします。</p>
            <img id="receiptPreview" alt="選択したレシート" hidden>
            <p id="receiptProgress" role="status" aria-live="polite"></p>
            <button type="button" id="receiptCancel" class="quiet" hidden>読み取りを中止</button>
            <details id="receiptTextDetails"><summary>読み取った文字を確認・修正</summary><label for="receiptText">レシートの文字</label><textarea id="receiptText" rows="7" maxlength="20000"></textarea><button type="button" id="receiptParse" class="quiet">文字から候補を作る</button></details>
            <form id="receiptReview" novalidate hidden>
                <h3>反映する項目</h3>
                <p class="muted">チェックした項目を記録フォームに入れます。金額・日付を確認してください。</p>
                <div id="receiptFields"></div>
                <label class="receipt-check"><input type="checkbox" id="receiptCategoryCheck"><span id="receiptCategoryLabel"></span></label>
                <p id="receiptReviewHint" class="muted"></p>
                <button type="submit" id="receiptApply">記録フォームに反映</button>
            </form>
            <p id="receiptError" class="error" role="alert"></p>`;
        document.body.append(dialog);
        const get = id => dialog.querySelector('#' + id);
        let controller = null, generation = 0, preview = null, category = ['', '', ''];
        let origin = null;
        const fields = [
            ['date', '日付', 'date', ''],
            ['amount', '金額（円）', 'number', ''],
            ['shop', '店舗名', 'text', 80],
            ['productName', '商品名', 'text', 80],
            ['memo', 'メモ', 'text', 200]
        ];
        for (const [key, label, type, max] of fields) {
            const row = document.createElement('div'); row.className = 'receipt-field';
            const check = document.createElement('input'); check.type = 'checkbox'; check.id = 'receiptCheck-' + key;
            check.setAttribute('aria-label', label + 'を反映');
            const group = document.createElement('label'); group.textContent = label; group.htmlFor = 'receiptValue-' + key;
            const input = document.createElement('input'); input.id = group.htmlFor; input.type = type;
            if (max) input.maxLength = max;
            if (type === 'number') { input.min = '1'; input.max = '999999999999'; input.step = '1'; input.inputMode = 'numeric'; }
            if (type === 'date') { input.min = '0001-01-01'; input.max = '9999-12-31'; }
            input.addEventListener('input', () => { check.checked = Boolean(input.value); });
            group.append(input); row.append(check, group); get('receiptFields').append(row);
        }
        function stop() {
            generation++;
            controller?.abort(); controller = null;
            get('receiptCancel').hidden = true;
            get('receiptCamera').disabled = get('receiptChoose').disabled = false;
        }
        function cleanup() {
            stop();
            if (preview) URL.revokeObjectURL(preview);
            preview = null; get('receiptPreview').removeAttribute('src');
            get('receiptPreview').hidden = true;
            get('receiptText').value = '';
            get('receiptFields').querySelectorAll('input').forEach(input => { input.value = ''; });
            origin = null;
        }
        dialog.addEventListener('close', cleanup);
        get('receiptClose').addEventListener('click', () => dialog.close());
        get('receiptCancel').addEventListener('click', () => { stop(); get('receiptProgress').textContent = '読み取りを中止しました。'; });
        get('receiptCamera').addEventListener('click', () => get('receiptCameraFile').click());
        get('receiptChoose').addEventListener('click', () => get('receiptImageFile').click());
        button.addEventListener('click', () => {
            stop(); origin = context();
            get('receiptReview').hidden = true; get('receiptError').textContent = '';
            get('receiptProgress').textContent = ''; get('receiptTextDetails').open = false;
            dialog.showModal();
        });
        function parse() {
            get('receiptError').textContent = '';
            const text = get('receiptText').value;
            if (!text.trim()) { get('receiptError').textContent = '読み取る文字がありません。撮り直すか、文字を入力してください。'; return; }
            const parsed = BudgetReceiptParser.parse(text);
            for (const [key] of fields) {
                get('receiptValue-' + key).value = parsed[key] ?? '';
                get('receiptCheck-' + key).checked = parsed[key] !== null && Boolean(parsed[key]);
            }
            category = BudgetReceiptParser.category(parsed, origin.entries, origin.categories);
            const names = category.filter(Boolean).map(id => origin.categories.find(item => item.id === id)?.name);
            get('receiptCategoryCheck').checked = Boolean(category[0]);
            get('receiptCategoryCheck').disabled = !category[0];
            get('receiptCategoryLabel').textContent = names.length ? '過去の記録からのカテゴリ候補 ' + names.join(' / ') : 'カテゴリは記録フォームで選択してください';
            get('receiptReviewHint').textContent = [
                !parsed.amount && '合計金額を特定できませんでした。金額を確認してください。',
                !parsed.date && '日付が読めなかったため、記録フォームの日付を使います。',
                '使用者は記録フォームで選択します。'
            ].filter(Boolean).join(' ');
            get('receiptReview').hidden = false;
        }
        get('receiptParse').addEventListener('click', parse);
        async function read(file) {
            if (!file) return;
            stop(); const current = generation; controller = new AbortController();
            get('receiptReview').hidden = true; get('receiptText').value = ''; get('receiptError').textContent = '';
            get('receiptCamera').disabled = get('receiptChoose').disabled = true;
            get('receiptCancel').hidden = false; get('receiptProgress').textContent = '画像を読み込み中…';
            if (preview) URL.revokeObjectURL(preview);
            preview = URL.createObjectURL(file); get('receiptPreview').src = preview; get('receiptPreview').hidden = false;
            try {
                const text = await BudgetReceiptScanner.read(file, { signal: controller.signal, progress: value => {
                    if (current === generation) get('receiptProgress').textContent = value;
                } });
                if (current !== generation || !dialog.open) return;
                get('receiptText').value = text.slice(0, 20000);
                get('receiptProgress').textContent = '読み取りが完了しました。候補を確認してください。';
                parse();
            } catch (error) {
                if (current !== generation) return;
                get('receiptProgress').textContent = '';
                get('receiptError').textContent = error.name === 'AbortError' ? '読み取りがタイムアウトしました。小さな画像で再度お試しください。' :
                    '読み取れませんでした。JPEG・PNG画像で撮り直すか、通信を確認して再度お試しください。';
            } finally {
                if (current === generation) {
                    controller = null; get('receiptCancel').hidden = true;
                    get('receiptCamera').disabled = get('receiptChoose').disabled = false;
                }
            }
        }
        for (const id of ['receiptCameraFile', 'receiptImageFile']) get(id).addEventListener('change', event => {
            const file = event.target.files[0]; event.target.value = ''; read(file);
        });
        get('receiptReview').addEventListener('submit', event => {
            event.preventDefault();
            const value = {};
            for (const [key] of fields) {
                if (!get('receiptCheck-' + key).checked) continue;
                const input = get('receiptValue-' + key);
                if (!input.value || !input.checkValidity()) { input.reportValidity(); get('receiptError').textContent = '反映する項目の値を確認してください。'; return; }
                value[key] = key === 'amount' ? Number(input.value) : input.value.trim();
            }
            if (get('receiptCategoryCheck').checked) value.categories = category;
            if (!Object.keys(value).length) { get('receiptError').textContent = '反映する項目を選んでください。'; return; }
            try { apply(value, origin); dialog.close(); }
            catch (error) { get('receiptError').textContent = error.message; }
        });
    }
    return { mount };
})();
