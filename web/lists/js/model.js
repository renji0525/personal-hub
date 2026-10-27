// TODOと買いたいものの入力・編集をブラウザとGASで共通化する
var ListsModel = (() => {
    function id(value) {
        if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(value)) throw new Error('項目の識別情報が正しくありません。');
        return value;
    }
    function item(value) {
        if (!value || !['todo', 'wish'].includes(value.kind) || typeof value.title !== 'string' || !value.title.trim() || value.title.trim().length > 120 ||
            typeof value.note !== 'string' || value.note.length > 500 || typeof value.done !== 'boolean') throw new Error('タイトルは1〜120文字、メモは500文字以内で入力してください。');
        if (typeof value.dueDate !== 'string' || value.dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(value.dueDate) || !Number.isFinite(Date.parse(value.dueDate + 'T00:00:00Z')) || new Date(value.dueDate + 'T00:00:00Z').toISOString().slice(0, 10) !== value.dueDate)) throw new Error('期限の日付を確認してください。');
        if (typeof value.url !== 'string' || value.url.length > 1000 || value.url && !/^https?:\/\/[^\s<>"\\]+$/i.test(value.url)) throw new Error('リンクはhttpまたはhttpsのURLを1000文字以内で入力してください。');
        return { id: id(value.id), kind: value.kind, title: value.title.trim(), note: value.note.trim(), done: value.done, dueDate: value.kind === 'todo' ? value.dueDate : '', url: value.kind === 'wish' ? value.url : '' };
    }
    function apply(state, operation) {
        const items = state.items.map(value => ({ ...value }));
        if (!operation || typeof operation !== 'object') throw new Error('操作が正しくありません。');
        if (operation.type === 'itemSave') {
            const value = item(operation.value), index = items.findIndex(old => old.id === value.id);
            if (index < 0) { if (items.length >= 1000) throw new Error('リストの合計は1000件までです。不要な項目を削除してください。'); items.push(value); }
            else items[index] = value;
        } else if (operation.type === 'itemDelete') {
            const index = items.findIndex(value => value.id === id(operation.id)); if (index >= 0) items.splice(index, 1);
        } else if (operation.type === 'itemDone') {
            const value = items.find(value => value.id === id(operation.id));
            if (!value || typeof operation.done !== 'boolean') throw new Error('対象の項目が見つかりません。');
            value.done = operation.done;
        } else throw new Error('未対応の操作です。');
        return { items };
    }
    return { id, item, apply };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ListsModel;
