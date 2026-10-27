const test = require('node:test');
const assert = require('node:assert/strict');
const merge = require('../web/shared/js/sync-merge.js');
global.ListsModel = require('../web/lists/js/model.js');
const local = require('../web/lists/js/store.js');
const item = { id: 'todo_merge1', kind: 'todo', title: '共有', note: '', done: false, dueDate: '', url: '', assignee: '' };
const base = () => local.create({ revision: 0, items: [item] });

test('同じ項目の別フィールドは統合し、同じフィールドの衝突と削除は拒否する', () => {
    const op = local.packet(local.edit(base(), { type: 'itemSave', value: { ...item, title: '自分' } })).request.operations[0];
    const state = { items: [{ ...item, note: '相手' }] };
    const result = ListsModel.apply(state, merge.merge(state, op, 'LISTS_CONFLICT'));
    assert.equal(result.items[0].title, '自分'); assert.equal(result.items[0].note, '相手');
    for (const current of [{ ...item, title: '相手' }, null]) assert.throws(() => merge.merge({ items: current ? [current] : [] }, op, 'LISTS_CONFLICT'), { code: 'LISTS_CONFLICT' });
    assert.throws(() => merge.merge(state, { type: 'itemDelete', id: item.id, before: item }, 'LISTS_CONFLICT'), { code: 'LISTS_CONFLICT' });
});

test('連続編集の集約と分割同期後も元の比較対象を維持する', () => {
    let state = local.edit(base(), { type: 'itemSave', value: { ...item, title: '一回目' } });
    state = local.edit(state, { type: 'itemSave', value: { ...item, title: '二回目' } });
    assert.equal(state.pending.length, 1); assert.deepEqual(state.pending[0].before, item);
    const first = local.packet(state);
    state = local.edit(first.local, { type: 'itemSave', value: { ...item, title: '三回目' } });
    const acknowledged = local.ack(state, { revision: 1, items: [{ ...item, title: '二回目', note: '相手' }] }, 1);
    const next = local.packet(acknowledged);
    const merged = merge.merge(acknowledged.base, next.request.operations[0], 'LISTS_CONFLICT');
    assert.equal(merged.value.note, '相手'); assert.equal(merged.value.title, '三回目');
    assert.deepEqual(local.packet(first.local).request, first.request);
});

test('完了操作と本文編集を統合し、保存元を変更しない', () => {
    const state = { items: [{ ...item, title: '相手' }] };
    const operation = { type: 'itemDone', id: item.id, done: true, before: item };
    const next = ListsModel.apply(state, merge.merge(state, operation, 'LISTS_CONFLICT'));
    assert.equal(next.items[0].done, true); assert.equal(next.items[0].title, '相手');
    assert.equal(state.items[0].done, false);
});

test('旧キャッシュの送信中本文は変えず、残りの編集元は移行時に保持する', () => {
    const pending = [
        { type: 'itemSave', value: { ...item, title: '送信中' } },
        { type: 'itemSave', value: { ...item, title: '次の編集' } }
    ];
    const raw = JSON.stringify({ ...base(), pending, flight: { id: 'old_sync1', count: 1 } });
    const loaded = local.read({ getItem: () => raw }, 'alice');
    assert.deepEqual(local.packet(loaded).request.operations, pending.slice(0, 1));
    assert.equal(loaded.pending[1].before.title, '送信中');
    const ack = local.ack(loaded, { revision: 1, items: [{ ...item, title: '送信中', note: '相手' }] }, 1);
    assert.equal(merge.merge(ack.base, local.packet(ack).request.operations[0], 'LISTS_CONFLICT').value.note, '相手');
});
