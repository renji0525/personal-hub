const test = require('node:test');
const assert = require('node:assert/strict');
global.BudgetModel = require('../web/budget/js/model.js');
const local = require('../web/budget/js/store.js');
const initial = () => local.create({ revision: 0, categories: BudgetModel.defaults, entries: [] });
const op = amount => ({ type: 'entrySave', value: { id: 'entry_local1', date: '2026-10-22', type: 'expense', categoryId: 'cat_food', amount, memo: '端末' } });
test('端末で編集を蓄積し、再読込でもユーザー別に未同期状態を復元する', () => {
    const data = new Map(), storage = { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v) };
    const state = local.edit(initial(), op(800));
    local.write(storage, 'alice', state);
    assert.equal(local.view(local.read(storage, 'alice')).entries[0].amount, 800);
    assert.equal(local.read(storage, 'bob'), null);
    assert.equal(state.base.entries.length, 0);
    assert.equal(state.pending.length, 1);
});
test('応答喪失後も送信IDと内容を維持し、送信後の編集を残す', () => {
    const packet = local.packet(local.edit(initial(), op(800)));
    const updated = local.edit(packet.local, op(900));
    assert.deepEqual(local.packet(updated).request, packet.request);
    const ack = local.ack(updated, { revision: 1, ...BudgetModel.apply(initial().base, op(800)) }, 1);
    assert.equal(ack.pending.length, 1);
    assert.equal(local.view(ack).entries[0].amount, 900);
    assert.equal(ack.base.revision, 1);
});
test('大量の変更は20件ずつ同期し、不正入力・端末保存失敗を黙って成功扱いしない', () => {
    let state = initial();
    for (let i=0;i<25;i++) { const value = op(i+1); value.value.id = 'entry_' + String(i).padStart(5, '0'); state=local.edit(state, value); }
    assert.equal(local.packet(state).request.operations.length, 20);
    assert.throws(() => local.edit(state, op(-1)));
    assert.throws(() => local.write({setItem(){ throw new Error('容量不足'); }}, 'alice', state), /容量不足/);
    assert.throws(() => local.read({ getItem: () => '{broken' }, 'alice'));
});

test('家計簿の表示モデルは再利用し、追加編集で全未同期操作を再実行しない', () => {
    let state = initial(), calls = 0;
    const original = BudgetModel.apply;
    BudgetModel.apply = (...args) => { calls++; return original(...args); };
    try {
        for (let i = 0; i < 100; i++) state = local.edit(state, op(i + 1));
        const value = local.view(state);
        assert.equal(local.view(state), value);
        assert.equal(value.entries[0].amount, 100);
        assert.equal(calls, 100);
    } finally { BudgetModel.apply = original; }
});

test('同じ記録の連続編集をまとめ、再読込でも最終値を維持する', () => {
    let state = initial();
    for (let i=1; i<=100; i++) state=local.edit(state, op(i));
    assert.equal(state.pending.length, 1);
    assert.equal(local.view(JSON.parse(JSON.stringify(state))).entries[0].amount, 100);
    const packet=local.packet(state);
    state=local.edit(local.edit(packet.local, op(101)), op(102));
    assert.equal(state.pending.length, 2);
    assert.deepEqual(local.packet(state).request, packet.request);
    assert.equal(local.view(JSON.parse(JSON.stringify(state))).entries[0].amount, 102);
});
test('種類の異なる操作を挟んだ編集は順序を保つ', () => {
    let state=local.edit(initial(), op(1));
    state=local.edit(state, {type:'categorySave',value:{id:'cat_custom',name:'自由',color:'#123456'}});
    state=local.edit(state, op(2));
    assert.equal(state.pending.length,3);
    assert.equal(local.view(JSON.parse(JSON.stringify(state))).entries[0].amount,2);
});
