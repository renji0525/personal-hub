const test = require('node:test');
const assert = require('node:assert/strict');
global.ListsModel = require('../web/lists/js/model.js');
const local = require('../web/lists/js/store.js');
const item = (id = 'todo_item1', kind = 'todo') => ({ id, kind, title: '予定を確認', note: '', done: false, dueDate: '', url: '' });
const initial = () => local.create({ revision: 0, items: [] });
test('TODOと買いたいものを独立して追加・編集・完了・削除し元の状態を保持する', () => {
    const base = { items: [] }, todo = ListsModel.apply(base, { type: 'itemSave', value: item() });
    const both = ListsModel.apply(todo, { type: 'itemSave', value: item('wish_item1', 'wish') });
    const done = ListsModel.apply(both, { type: 'itemDone', id: 'todo_item1', done: true });
    assert.equal(base.items.length, 0); assert.equal(both.items[0].done, false); assert.equal(done.items[0].done, true);
    assert.equal(ListsModel.apply(done, { type: 'itemDelete', id: 'wish_item1' }).items.length, 1);
    assert.equal(ListsModel.apply(done, { type: 'itemSave', value: { ...item(), title: '予定変更' } }).items[0].title, '予定変更');
});
test('空入力・不正日付・実行URL・上限超過を拒否し、閏日と通常URLを許可する', () => {
    for (const patch of [{ title: ' ' }, { title: 'a'.repeat(121) }, { note: 'a'.repeat(501) }, { dueDate: '2026-02-29' }, { done: 'false' }, { url: 'javascript:alert(1)' }, { url: 'https://example.com/\nfoo' }, { kind: 'unknown' }]) assert.throws(() => ListsModel.item({ ...item(), ...patch }));
    assert.equal(ListsModel.item({ ...item(), dueDate: '2028-02-29' }).dueDate, '2028-02-29');
    assert.equal(ListsModel.item({ ...item('wish_item1', 'wish'), url: 'https://example.com/?q=test' }).url, 'https://example.com/?q=test');
    assert.throws(() => ListsModel.apply({ items: Array.from({ length: 1000 }, (_, i) => item('limit_item' + i)) }, { type: 'itemSave', value: item('overflow_item1') }));
});
test('個人用と共有先とユーザーを分離して端末に保存し、保存失敗を成功扱いしない', () => {
    const data = new Map(), storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
    local.write(storage, 'alice:space:family1', local.edit(initial(), { type: 'itemSave', value: item() }));
    assert.equal(local.view(local.read(storage, 'alice:space:family1')).items.length, 1);
    assert.equal(local.read(storage, 'alice'), null); assert.equal(local.read(storage, 'bob:space:family1'), null);
    assert.throws(() => local.write({ setItem() { throw new Error('容量不足'); } }, 'alice', initial()));
});
test('応答喪失時は同じ送信IDと内容を再送し、送信後に追加した編集を残す', () => {
    let state = local.edit(initial(), { type: 'itemSave', value: item() });
    const first = local.packet(state); state = local.edit(first.local, { type: 'itemDone', id: 'todo_item1', done: true });
    assert.deepEqual(local.packet(state).request, first.request);
    const ack = local.ack(state, { revision: 1, items: [item()] }, 1);
    assert.equal(ack.pending.length, 1); assert.equal(local.view(ack).items[0].done, true);
});
test('大きなリンクとメモを含む操作はリクエスト上限内へ分割する', () => {
    let state = initial();
    for (let i = 0; i < 20; i++) state = local.edit(state, { type: 'itemSave', value: { ...item('wish_item' + i, 'wish'), note: 'メ'.repeat(500), url: 'https://example.com/' + 'x'.repeat(970) } });
    const packet = local.packet(state);
    assert.ok(packet.request.operations.length < 20); assert.ok(JSON.stringify(packet.request).length < 20000);
});
