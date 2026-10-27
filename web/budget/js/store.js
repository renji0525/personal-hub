// 未同期操作と同期元をユーザー別に保持し、再送でも同じ送信IDを使う
var BudgetLocal = (() => {
    const merge = typeof HubMerge !== 'undefined' ? HubMerge : require('../../shared/js/sync-merge.js');
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
        // 旧キャッシュの送信済み本文は固定し、未送信分に比較元を補う
        if (local.flight && !local.flight.operations) local.flight.operations = local.pending.slice(0, local.flight.count);
        local.pending = merge.prepare(local.base, local.pending, BudgetModel.apply);
        view(local); return local;
    }
    function write(storage, userId, local) {
        const raw = JSON.stringify(local);
        storage.setItem(key(userId), raw);
        return raw;
    }
    function edit(local, operation) {
        operation = { ...operation, before: merge.target(view(local), operation) };
        const pending = [...local.pending];
        const previous = pending.at(-1);
        // 送信済み部分は固定し、隣接する同じ記録の保存だけを最終値へまとめる
        const editable = pending.length > (local.flight?.count || 0);
        if (editable && previous?.type === operation.type && operation.type.endsWith('Save') && previous.value.id === operation.value.id) pending[pending.length - 1] = { ...operation, ...(Object.prototype.hasOwnProperty.call(previous, 'before') ? { before: previous.before } : {}) };
        else pending.push(operation);
        const next = { ...local, pending };
        views.set(next, { ...BudgetModel.apply(view(local), operation), revision: local.base.revision });
        return next;
    }
    function packet(local) {
        let flight = local.flight;
        if (!flight) {
            let count = Math.min(20, local.pending.length);
            let operations = merge.prepare(local.base, local.pending.slice(0, count), BudgetModel.apply);
            while (count > 1 && JSON.stringify(operations).length > 16000) operations = merge.prepare(local.base, local.pending.slice(0, --count), BudgetModel.apply);
            if (JSON.stringify(operations).length > 18000) throw new Error('同期データが大きすぎます。内容を確認してください。');
            flight = { id: crypto.randomUUID(), count, operations };
        }
        const next = { ...local, flight };
        views.set(next, view(local));
        return { local: next, request: { revision: local.base.revision, syncId: flight.id, operations: flight.operations || local.pending.slice(0, flight.count) } };
    }
    function ack(local, result, count) {
        return { ...create(result), pending: local.pending.slice(count) };
    }
    return { key, create, view, read, write, edit, packet, ack };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = BudgetLocal;
