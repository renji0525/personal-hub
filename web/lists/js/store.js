// 保存先ごとに未同期操作を保持し、再送時は同じ送信内容を使う
var ListsLocal = (() => {
    const merge = typeof HubMerge !== 'undefined' ? HubMerge : require('../../shared/js/sync-merge.js');
    const views = new WeakMap();
    const key = scope => 'personal_hub_lists_v1:' + scope;
    function create(state) {
        if (!Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.items)) throw new Error('リストの保存内容を確認してください。');
        return { version: 1, base: { revision: state.revision, items: state.items.map(ListsModel.item), ...(Array.isArray(state.assignees) ? { assignees: state.assignees.filter(user => typeof user === 'string' && /^[a-z0-9_-]{3,32}$/.test(user)) } : {}) }, pending: [], flight: null };
    }
    function view(local) {
        if (!views.has(local)) views.set(local, local.pending.reduce((state, operation) => ListsModel.apply(state, operation), local.base));
        return views.get(local);
    }
    function read(storage, scope) {
        const raw = storage.getItem(key(scope)); if (raw === null) return null;
        const value = JSON.parse(raw);
        if (value.version !== 1 || !Array.isArray(value.pending)) throw new Error('端末データを確認してください。自動上書きは行いません。');
        value.base = create(value.base).base;
        if (value.flight) {
            ListsModel.id(value.flight.id);
            if (!Number.isInteger(value.flight.count) || value.flight.count < 1 || value.flight.count > Math.min(20, value.pending.length)) throw new Error('再送データを確認してください。');
        }
        // 旧キャッシュの送信済み本文は固定し、未送信分に比較元を補う
        if (value.flight && !value.flight.operations) value.flight.operations = value.pending.slice(0, value.flight.count);
        value.pending = merge.prepare(value.base, value.pending, ListsModel.apply);
        view(value); return value;
    }
    function write(storage, scope, value) { const raw = JSON.stringify(value); storage.setItem(key(scope), raw); return raw; }
    function edit(local, operation) {
        operation = { ...operation, before: merge.target(view(local), operation) };
        const pending = [...local.pending], previous = pending.at(-1), nextView = ListsModel.apply(view(local), operation);
        if (pending.length > (local.flight?.count || 0) && previous?.type === operation.type && ['itemSave', 'itemDone'].includes(operation.type) && (previous.id || previous.value.id) === (operation.id || operation.value.id)) pending[pending.length - 1] = { ...operation, ...(Object.prototype.hasOwnProperty.call(previous, 'before') ? { before: previous.before } : {}) };
        else pending.push(operation);
        const next = { ...local, pending }; views.set(next, nextView); return next;
    }
    function packet(local) {
        let flight = local.flight;
        if (!flight) {
            let count = Math.min(20, local.pending.length);
            let operations = merge.prepare(local.base, local.pending.slice(0, count), ListsModel.apply);
            while (count > 1 && JSON.stringify(operations).length > 16000) operations = merge.prepare(local.base, local.pending.slice(0, --count), ListsModel.apply);
            if (JSON.stringify(operations).length > 18000) throw new Error('同期データが大きすぎます。内容を確認してください。');
            flight = { id: crypto.randomUUID(), count, operations };
        }
        const next = { ...local, flight }; views.set(next, view(local));
        return { local: next, request: { revision: local.base.revision, syncId: flight.id, operations: flight.operations || local.pending.slice(0, flight.count) } };
    }
    function ack(local, result, count) { return { ...create(result), pending: local.pending.slice(count) }; }
    function withAssignees(local, assignees) {
        const next = { ...local, base: create({ ...local.base, assignees }).base };
        views.set(next, view(local)); return next;
    }
    return { key, create, view, read, write, edit, packet, ack, withAssignees };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ListsLocal;
