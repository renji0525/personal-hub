// 未同期操作と同期元をユーザー別に保持し、再送でも同じ送信IDを使う
var BudgetLocal = (() => {
    const views = new WeakMap();
    const key = userId => 'personal_hub_budget_v1:' + userId;
    const create = state => ({ version: 1, base: { revision: state.revision, categories: state.categories, entries: state.entries, products: state.products || [] }, pending: [], flight: null });
    function view(local) {
        if (!views.has(local)) views.set(local, { ...local.pending.reduce((state, op) => BudgetModel.apply(state, op), local.base), revision: local.base.revision });
        return views.get(local);
    }
    function read(storage, userId) {
        const raw = storage.getItem(key(userId));
        if (raw === null) return null;
        const local = JSON.parse(raw);
        if (local.version !== 1 || !Number.isSafeInteger(local.base?.revision) || !Array.isArray(local.pending)) throw new Error('端末データを確認してください。自動上書きは行いません。');
        view(local); return local;
    }
    function write(storage, userId, local) {
        const raw = JSON.stringify(local);
        storage.setItem(key(userId), raw);
        return raw;
    }
    function edit(local, operation) {
        const pending = [...local.pending];
        const previous = pending.at(-1);
        // 送信済み部分は固定し、隣接する同じ記録の保存だけを最終値へまとめる
        const editable = pending.length > (local.flight?.count || 0);
        if (editable && previous?.type === operation.type && operation.type.endsWith('Save') && previous.value.id === operation.value.id) pending[pending.length - 1] = operation;
        else pending.push(operation);
        const next = { ...local, pending };
        views.set(next, { ...BudgetModel.apply(view(local), operation), revision: local.base.revision });
        return next;
    }
    function packet(local) {
        const flight = local.flight || { id: crypto.randomUUID(), count: Math.min(20, local.pending.length) };
        const next = { ...local, flight };
        views.set(next, view(local));
        return { local: next, request: { revision: local.base.revision, syncId: flight.id, operations: local.pending.slice(0, flight.count) } };
    }
    function ack(local, result, count) {
        return { ...create(result), pending: local.pending.slice(count) };
    }
    return { key, create, view, read, write, edit, packet, ack };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = BudgetLocal;
