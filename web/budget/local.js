// 未同期操作と同期元をユーザー別に保持し、再送でも同じ送信IDを使う
var BudgetLocal = (() => {
    const key = userId => 'personal_hub_budget_v1:' + userId;
    const create = state => ({ version: 1, base: { revision: state.revision, categories: state.categories, entries: state.entries }, pending: [], flight: null });
    const view = local => ({ ...local.pending.reduce((state, op) => BudgetModel.apply(state, op), local.base), revision: local.base.revision });
    function read(storage, userId) {
        const raw = storage.getItem(key(userId));
        if (raw === null) return null;
        const local = JSON.parse(raw);
        if (local.version !== 1 || !Number.isSafeInteger(local.base?.revision) || !Array.isArray(local.pending)) throw new Error('端末データを確認してください。自動上書きは行いません。');
        view(local); return local;
    }
    function write(storage, userId, local) {
        storage.setItem(key(userId), JSON.stringify(local));
    }
    function edit(local, operation) {
        const next = { ...local, pending: [...local.pending, operation] };
        view(next); return next;
    }
    function packet(local) {
        const flight = local.flight || { id: crypto.randomUUID(), count: Math.min(20, local.pending.length) };
        return { local: { ...local, flight }, request: { revision: local.base.revision, syncId: flight.id, operations: local.pending.slice(0, flight.count) } };
    }
    function ack(local, result, count) {
        return { ...create(result), pending: local.pending.slice(count) };
    }
    return { key, create, view, read, write, edit, packet, ack };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = BudgetLocal;
