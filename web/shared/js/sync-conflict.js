// 競合解消は最新状態へ操作を組み直す。完了するまで元の端末データには触れない。
var HubConflict = (() => {
    let resolving = false;
    function localChoice(state, operation) {
        const current = HubMerge.target(state, operation), next = { ...operation, before: current };
        if (operation.value && operation.before && current) {
            next.value = { ...current };
            for (const key of Object.keys(operation.value)) {
                if (JSON.stringify(operation.value[key]) !== JSON.stringify(operation.before[key])) next.value[key] = operation.value[key];
            }
        }
        return next;
    }
    async function rebase(local, latest, apply, choose) {
        let state = latest;
        const pending = [];
        for (const original of local.pending) {
            let operation, next;
            try { operation = HubMerge.merge(state, original, 'CONFLICT'); next = apply(state, operation); }
            catch (error) {
                operation = localChoice(state, original);
                let invalid = '';
                try { next = apply(state, operation); } catch (failure) { invalid = failure.message; }
                const choice = await choose({ original, current: HubMerge.target(state, original), proposed: operation, invalid });
                if (choice === 'cancel') return null;
                if (choice === 'server') continue;
                if (choice !== 'local' || invalid) throw new Error(invalid || '選択内容を確認してください。');
            }
            operation = { ...operation, before: HubMerge.target(state, operation) };
            // 既に同じ結果なら再送しない。購入支出などの副作用も含めて比較する。
            next = { ...state, ...next };
            next = { ...state, ...next };
            if (JSON.stringify(state) !== JSON.stringify(next)) pending.push(operation);
            state = next;
        }
        return { version: 1, base: latest, pending, flight: null };
    }
    function chooseConflict(detail) {
        return new Promise(resolve => {
            const dialog = document.createElement('dialog'); dialog.className = 'sync-conflict-dialog';
            const add = (tag, text) => { const node = document.createElement(tag); node.textContent = text; dialog.append(node); return node; };
            add('h2', '競合した変更を選択');
            add('p', 'この操作だけを選択します。他の未同期変更は保持します。');
            const labels = { id: '項目ID', title: 'タイトル', name: '名前', note: '本文', memo: 'メモ', done: '完了', amount: '金額', date: '日付', purchasedAt: '購入日', categoryId: 'カテゴリ', color: '色', dueDate: '期限', assignee: '担当者', url: 'URL', kind: '種類', type: '種別', intervalDays: '購入間隔', leadDays: '通知日数' };
            const show = value => value === null ? '削除済み・項目なし' : Object.entries(value).map(([key, val]) => (labels[key] || key) + '：' + (typeof val === 'object' ? JSON.stringify(val) : String(val))).join('\n');
            add('h3', '共有先の現在の内容'); add('pre', show(detail.current));
            add('h3', '端末の変更を反映する内容');
            add('pre', detail.proposed.type.endsWith('Delete') ? 'この項目を削除する' : show(detail.proposed.value || detail.proposed));
            if (detail.invalid) add('p', '現在のデータには適用できません：' + detail.invalid + '。共有先を採用してから改めて編集してください。');
            const finish = value => { dialog.close(); dialog.remove(); resolve(value); };
            for (const [value, label] of [['local', '端末の変更を採用'], ['server', '共有先を採用'], ['cancel', '変更せず閉じる']]) {
                const button = add('button', label); button.type = 'button'; button.disabled = value === 'local' && !!detail.invalid; button.addEventListener('click', () => finish(value));
            }
            dialog.addEventListener('cancel', event => { event.preventDefault(); finish('cancel'); });
            document.body.append(dialog); dialog.showModal();
        });
    }
    function bind({ read, save, load, apply, ready, done, error }) {
        const discard = document.getElementById('discardButton'), button = document.createElement('button');
        button.type = 'button'; button.id = 'resolveConflictButton'; button.textContent = '競合内容を確認して再同期'; button.hidden = true; discard.before(button);
        const update = () => { button.hidden = discard.hidden; button.disabled = discard.disabled || resolving; };
        new MutationObserver(update).observe(discard, { attributes: true, attributeFilter: ['hidden', 'disabled'] });
        button.addEventListener('click', async () => {
            if (resolving || !ready()) return;
            resolving = true; update();
            const before = read();
            try {
                const latest = await load();
                if (!ready() || read() !== before) throw new Error('確認中に端末の状態が変わりました。もう一度確認してください。');
                const result = await rebase(before, latest, apply, chooseConflict);
                if (!result) return;
                if (!ready() || read() !== before) throw new Error('確認中に端末の状態が変わりました。もう一度確認してください。');
                save(result); discard.hidden = true;
                resolving = false; await done();
            } catch (failure) { error(failure); }
            finally { resolving = false; update(); }
        });
    }
    return { bind, rebase, localChoice, busy: () => resolving };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = HubConflict;
