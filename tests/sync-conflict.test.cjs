const test = require('node:test');
const assert = require('node:assert/strict');
global.HubMerge = require('../web/shared/js/sync-merge.js');
global.ListsModel = require('../web/lists/js/model.js');
const local = require('../web/lists/js/store.js');
const conflict = require('../web/shared/js/sync-conflict.js');
const item = { id: 'conflict_item1', kind: 'note', title: '元', note: '本文', done: false, dueDate: '', url: '', assignee: '' };
const base = local.create({ revision: 1, items: [item] });

test('端末側を採用しても共有先の別フィールドと競合しない追加を保持する', async () => {
    let edited = local.edit(base, { type: 'itemSave', value: { ...item, title: '端末' } });
    edited = local.edit(edited, { type: 'itemSave', value: { ...item, id: 'conflict_item2' } });
    edited = local.packet(edited).local;
    const original = JSON.stringify(edited), latest = { revision: 2, items: [{ ...item, title: '共有', note: '共有の本文' }] };
    let choices = 0;
    const result = await conflict.rebase(edited, latest, ListsModel.apply, async () => { choices++; return 'local'; });
    assert.equal(choices, 1); assert.equal(result.flight, null); assert.equal(result.base.revision, 2);
    assert.equal(local.view(result).items[0].title, '端末'); assert.equal(local.view(result).items[0].note, '共有の本文');
    assert.equal(local.view(result).items.length, 2); assert.equal(JSON.stringify(edited), original);
    assert.deepEqual(result.pending[0].before, latest.items[0]);
});

test('共有先の採用は該当操作だけを除き、キャンセルは全変更を保持する', async () => {
    let edited = local.edit(base, { type: 'itemSave', value: { ...item, title: '端末' } });
    edited = local.edit(edited, { type: 'itemSave', value: { ...item, id: 'conflict_item2' } });
    const latest = { revision: 2, items: [{ ...item, title: '共有' }] };
    const result = await conflict.rebase(edited, latest, ListsModel.apply, async () => 'server');
    assert.equal(result.pending.length, 1); assert.equal(local.view(result).items[0].title, '共有');
    assert.equal(await conflict.rebase(edited, latest, ListsModel.apply, async () => 'cancel'), null);
    assert.equal(edited.pending.length, 2);
});

test('削除対編集も選択でき、適用済み操作は再送しない', async () => {
    const edited = local.edit(base, { type: 'itemDelete', id: item.id });
    const latest = { revision: 2, items: [{ ...item, title: '共有' }] };
    const result = await conflict.rebase(edited, latest, ListsModel.apply, async () => 'local');
    assert.equal(local.view(result).items.length, 0);
    const save = local.edit(base, { type: 'itemSave', value: { ...item, title: '共有' } });
    const acknowledged = await conflict.rebase(save, latest, ListsModel.apply, async () => { throw new Error('選択不要'); });
    assert.equal(acknowledged.pending.length, 0);
});

test('購入応答喪失後は既存支出を重複させず、削除されたカテゴリへの操作を明示する', async () => {
    const model = require('../web/budget/js/model.js');
    const product = { id: 'product_test1', name: '洗剤', purchasedAt: '2026-11-01', intervalDays: 30, leadDays: 3, categoryId: '' };
    const entry = { id: 'entry_test01', date: '2026-11-09', type: 'expense', amount: 500, categoryId: '', memo: '購入' };
    const operation = { type: 'productPurchase', id: product.id, date: entry.date, entry, before: product };
    const latest = { revision: 2, products: [{ ...product, purchasedAt: entry.date }], categories: [], entries: [entry] };
    let invalid;
    const result = await conflict.rebase({ pending: [operation] }, latest, model.apply, async detail => { invalid = detail.invalid; return 'server'; });
    assert.match(invalid, /既に存在/); assert.equal(result.pending.length, 0); assert.equal(result.base.entries.length, 1);
});
