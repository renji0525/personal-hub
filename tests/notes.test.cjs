const test = require('node:test');
const assert = require('node:assert/strict');
global.ListsModel = require('../web/lists/js/model.js');
const local = require('../web/lists/js/store.js');
const note = (patch = {}) => ({ id: 'memo_item1', kind: 'note', title: '', note: '買い物のメモ\n牛乳と卵', done: false, dueDate: '', url: '', assignee: '', ...patch });
test('本文だけのメモからタイトルを作り、改行・5000文字の本文を保持する', () => {
    const value = ListsModel.item(note()); assert.equal(value.title, '買い物のメモ'); assert.equal(value.note, '買い物のメモ\n牛乳と卵');
    assert.equal(ListsModel.item(note({ title: '長文', note: 'あ'.repeat(5000) })).note.length, 5000);
    assert.equal(ListsModel.item(note({ title: 'タイトルだけ', note: '' })).title, 'タイトルだけ');
    assert.throws(() => ListsModel.item(note({ title: ' ', note: '\n ' })));
    assert.throws(() => ListsModel.item(note({ note: 'あ'.repeat(5001) })));
});
test('メモの編集と削除が既存TODO・買いたいものに影響しない', () => {
    const todo = ListsModel.item(note({ id: 'todo_item1', kind: 'todo', title: '予定', note: '' }));
    const wish = ListsModel.item(note({ id: 'wish_item1', kind: 'wish', title: '商品', note: '' }));
    const state = ListsModel.apply({ items: [todo, wish] }, { type: 'itemSave', value: note() });
    const edited = ListsModel.apply(state, { type: 'itemSave', value: note({ title: '編集後', note: '変更した本文' }) });
    const deleted = ListsModel.apply(edited, { type: 'itemDelete', id: 'memo_item1' });
    assert.deepEqual(deleted.items, [todo, wish]); assert.equal(state.items[2].note, '買い物のメモ\n牛乳と卵');
});
test('メモを再読込・再送しても本文を保持し、長文の同期を上限内に分割する', () => {
    let state = local.create({ revision: 0, items: [] });
    for (let i = 0; i < 5; i++) state = local.edit(state, { type: 'itemSave', value: note({ id: 'memo_item' + i, note: '文'.repeat(5000) }) });
    const packet = local.packet(state); assert.ok(JSON.stringify(packet.request).length < 20000); assert.ok(packet.request.operations.length < 5);
    const raw = JSON.stringify(packet.local), restored = local.read({ getItem: () => raw }, 'alice');
    assert.deepEqual(local.packet(restored).request, packet.request); assert.equal(local.view(restored).items[0].note.length, 5000);
});
