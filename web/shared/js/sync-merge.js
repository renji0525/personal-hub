// 同期元・端末の変更・現在の共有データを比較し、無関係な変更を上書きしない
var HubMerge = (() => {
    const tables = { category: 'categories', entry: 'entries', product: 'products', item: 'items' };
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    function target(state, operation) {
        const prefix = Object.keys(tables).find(key => operation.type.startsWith(key));
        if (!prefix) throw new Error('未対応の同期操作です。');
        return (state[tables[prefix]] || []).find(value => value.id === (operation.value?.id || operation.id)) || null;
    }
    function prepare(base, operations, apply) {
        let state = base;
        return operations.map(operation => {
            const next = { ...operation, before: Object.prototype.hasOwnProperty.call(operation, 'before') ? operation.before : target(state, operation) };
            state = apply(state, operation);
            return next;
        });
    }
    function merge(state, operation, code) {
        if (!Object.prototype.hasOwnProperty.call(operation, 'before')) return operation;
        const before = operation.before, current = target(state, operation);
        const conflict = () => { const error = new Error('同じ項目が別の端末で変更されています。両方の変更を保持しています。バックアップ後に内容を確認してください。'); error.code = code; throw error; };
        if (equal(before, current)) return operation;
        if (operation.type.endsWith('Delete')) { if (current === null) return operation; return conflict(); }
        if (!before || !current) {
            if (operation.value && equal(operation.value, current)) return operation;
            return conflict();
        }
        const changes = operation.value || (operation.type === 'itemDone' ? { done: operation.done } : { purchasedAt: operation.date });
        const value = { ...current };
        for (const key of Object.keys(changes)) {
            if (equal(changes[key], before[key])) continue;
            if (!equal(current[key], before[key]) && !equal(current[key], changes[key])) return conflict();
            value[key] = changes[key];
        }
        if (operation.value) return { ...operation, value };
        if (operation.type === 'itemDone') return { ...operation, done: value.done };
        if (value.purchasedAt !== operation.date) return conflict();
        return operation;
    }
    return { prepare, merge, target };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = HubMerge;
