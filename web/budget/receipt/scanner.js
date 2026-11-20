// OCRの依存・ワーカー・画像の寿命はレシート専用モジュールで管理する
window.BudgetReceiptScanner = (() => {
    const base = new URL('.', document.currentScript.src);
    let library = null;
    function loadLibrary() {
        if (window.Tesseract) return Promise.resolve(window.Tesseract);
        if (!library) library = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = new URL('vendor/tesseract.min.js', base).href;
            script.onload = () => resolve(window.Tesseract);
            script.onerror = () => { script.remove(); library = null; reject(new Error('読み取り機能を準備できませんでした。通信を確認して再度お試しください。')); };
            document.head.append(script);
        });
        return library;
    }
    async function image(file) {
        if (!file || !/^image\//.test(file.type) || file.size > 25 * 1024 * 1024) {
            throw new Error('25MB以下の画像を選択してください。JPEG・PNGなどを利用できます。');
        }
        const source = await createImageBitmap(file);
        try {
            const scale = Math.min(1, 2800 / Math.max(source.width, source.height), Math.sqrt(5000000 / (source.width * source.height)));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(source.width * scale));
            canvas.height = Math.max(1, Math.round(source.height * scale));
            const context = canvas.getContext('2d');
            context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
            context.filter = 'grayscale(1)';
            context.drawImage(source, 0, 0, canvas.width, canvas.height);
            return canvas;
        } finally { source.close(); }
    }
    async function read(file, { signal, progress }) {
        let worker = null, cancelled = false, rejectAbort;
        const aborted = new Promise((_, reject) => { rejectAbort = reject; });
        const cancel = () => {
            cancelled = true;
            if (worker) worker.terminate().catch(() => {});
            rejectAbort(new DOMException('読み取りを中止しました。', 'AbortError'));
        };
        if (signal.aborted) throw new DOMException('読み取りを中止しました。', 'AbortError');
        signal.addEventListener('abort', cancel, { once: true });
        let canvas = null;
        const task = (async () => {
            canvas = await image(file);
            if (cancelled) { canvas.width = 1; canvas.height = 1; return ''; }
            const engine = await loadLibrary();
            if (cancelled) return '';
            const created = await engine.createWorker(['jpn', 'eng'], 1, {
                workerPath: location.protocol === 'file:' ? 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js' : new URL('vendor/worker.min.js', base).href,
                corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',
                logger: event => {
                    if (cancelled) return;
                    if (event.status === 'recognizing text') progress('文字を読み取り中… ' + Math.round(event.progress * 100) + '%');
                    else progress('読み取りデータを準備中… 初回は時間がかかります。');
                },
                errorHandler: () => {}
            });
            if (cancelled) { await created.terminate(); return ''; }
            worker = created;
            await worker.setParameters({ preserve_interword_spaces: '1' });
            const result = await worker.recognize(canvas);
            return result.data.text;
        })();
        const timeout = setTimeout(cancel, 180000);
        try { return await Promise.race([task, aborted]); }
        finally {
            clearTimeout(timeout); signal.removeEventListener('abort', cancel);
            if (worker && !cancelled) await worker.terminate().catch(() => {});
            // 読み取り完了後は画像のピクセル領域を解放する
            if (canvas) { canvas.width = 1; canvas.height = 1; }
        }
    }
    return { read };
})();
