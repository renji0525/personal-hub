const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../web/budget/js/model.js');
const initial = () => ({ categories: model.defaults.map(c => ({ ...c })), entries: [] });
const entry = values => ({ id: 'entry_0001', date: '2026-10-21', type: 'expense', categoryId: 'cat_food', amount: 1200, memo: 'ランチ', ...values });

test('カテゴリの名前と色を自由に変更でき、記録への参照を維持する', () => {
    const state = model.apply(initial(), { type: 'entrySave', value: entry() });
    const updated = model.apply(state, { type: 'categorySave', value: { id: 'cat_food', name: ' 外食 ', color: '#AABBCC' } });
    assert.equal(updated.categories[0].name, '外食');
    assert.equal(updated.categories[0].color, '#aabbcc');
    assert.equal(updated.entries[0].categoryId, 'cat_food');
    assert.equal(state.categories[0].name, '食費');
    assert.throws(() => model.apply(updated, { type: 'categoryDelete', id: 'cat_food' }), /使用中/);
});

test('空カテゴリ名・重複名・不正色を拒否する', () => {
    for (const value of [{ id: 'cat_new1', name: '', color: '#ffffff' }, { id: 'cat_new1', name: '食費', color: '#ffffff' }, { id: 'cat_new1', name: 'test', color: 'red;display:none' }]) {
        assert.throws(() => model.apply(initial(), { type: 'categorySave', value }));
    }
});

test('不正な日付・負額・小数・上限超過・存在しないカテゴリを拒否する', () => {
    for (const value of [{ date: '2026-02-30' }, { date: 'bad' }, { amount: -1 }, { amount: 0 }, { amount: 1.5 }, { amount: 1000000000000 }, { categoryId: 'missing' }, { type: 'other' }, { memo: 'x'.repeat(201) }]) {
        assert.throws(() => model.entry(entry(value), model.defaults));
    }
    assert.equal(model.entry(entry({ date: '2024-02-29', categoryId: '' }), model.defaults).date, '2024-02-29');
});

test('収入支出を整数で集計し、編集・削除を反映する', () => {
    let state = model.apply(initial(), { type: 'entrySave', value: entry() });
    state = model.apply(state, { type: 'entrySave', value: entry({ id: 'entry_0002', type: 'income', amount: 200000, categoryId: 'cat_salary' }) });
    let summary = model.summarize(state.entries);
    assert.equal(summary.balance, 198800);
    assert.equal(summary.categories.get('cat_food'), 1200);
    state = model.apply(state, { type: 'entrySave', value: entry({ amount: 1500 }) });
    assert.equal(state.entries.length, 2);
    assert.equal(model.summarize(state.entries).expense, 1500);
    state = model.apply(state, { type: 'entryDelete', id: 'entry_0001' });
    assert.equal(model.summarize(state.entries).balance, 200000);
});

test('カテゴリを親ごとに管理し、記録を残して削除できる', () => {
    const add = (state, id, parentId) => model.apply(state, { type: 'categoryTreeSave', value: { id, parentId, name: 'その他', color: '#ffffff' } });
    let state = add(initial(), 'cat_mid1', 'cat_food');
    state = add(state, 'cat_mid2', 'cat_daily');
    state = add(state, 'cat_leaf', 'cat_mid1');
    assert.throws(() => add(state, 'cat_four', 'cat_leaf'), /親カテゴリ/);
    assert.throws(() => add(state, 'cat_dupe', 'cat_food'), /同じ名前/);
    const value = entry({ categoryMiddleId: 'cat_mid1', categorySmallId: 'cat_leaf' });
    assert.throws(() => model.entry({ ...value, categoryId: 'cat_daily' }, state.categories), /カテゴリ/);
    assert.throws(() => model.apply(state, { type: 'entryRecordSave', value }), /使用者/);
    const attribution = { kind: 'group' };
    state = model.apply(state, { type: 'entryRecordSave', value: { ...value, attribution } });
    state = model.apply(state, { type: 'entrySave', value: entry({ amount: 1500 }) });
    assert.equal(state.entries[0].categorySmallId, 'cat_leaf');
    state = model.apply(state, { type: 'categoryTreeDelete', id: 'cat_mid1' });
    assert.deepEqual(state.entries[0], entry({ amount: 1500, attribution }));
    assert.deepEqual(state.categories.filter(c => c.parentId).map(c => c.id), ['cat_mid2']);
    state = model.apply(state, { type: 'categoryTreeDelete', id: 'cat_food' });
    assert.equal(state.entries[0].categoryId, '');
});
