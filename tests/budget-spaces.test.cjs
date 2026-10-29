const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function spaces() {
    const storage = new Map(), calls = [];
    const context = vm.createContext({
        window: {}, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,value) },
        HubAuth: { api: async (...args) => { calls.push(args); return { status: 'ok' }; } }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/shared/js/budget-spaces.js'), 'utf8'), context);
    return { api: context.window.BudgetSpaces, storage, calls };
}
test('個人用の保存キーとAPIを維持し、共有用はユーザーとスペースごとに分離する', async () => {
    const s = spaces(), alice = { userId: 'alice', token: 'a' }, bob = { userId: 'bob', token: 'b' };
    s.api.bind(alice);
    assert.equal(s.api.storageUser('alice'), 'alice');
    await s.api.api('budgetLoad', {}, alice);
    assert.equal(s.calls[0][1].spaceId, undefined);
    s.storage.set('personal_hub_budget_space:alice:budget', JSON.stringify({ id: 'family_space1', name: '家族' }));
    s.api.bind(alice);
    assert.equal(s.api.storageUser('alice'), 'alice:space:family_space1');
    assert.equal(s.api.storageUser('bob'), 'bob');
    await s.api.api('budgetSync', { revision: 2, spaceId: 'wrong_space1' }, alice);
    assert.equal(s.calls[1][1].spaceId, 'family_space1');
    assert.equal(s.calls[1][1].revision, 2);
    assert.equal(s.calls[1][2], alice);
    s.storage.set('personal_hub_budget_space:bob:budget', JSON.stringify({ id: 'family_space1', name: '家族' }));
    s.api.bind(bob);
    assert.equal(s.api.storageUser('bob'), 'bob:space:family_space1');
});

test('解除を検出済みの共有先は再表示でも利用を再開しない', () => {
    const s = spaces();
    s.storage.set('personal_hub_budget_space:alice:budget', JSON.stringify({ id: 'family_space1', name: '家族', denied: true }));
    s.api.bind({ userId: 'alice' });
    assert.equal(s.api.allowed(), false);
    s.storage.set('personal_hub_budget_space:alice:budget', JSON.stringify({ id: 'family_space1', name: '家族' }));
    s.api.bind({ userId: 'alice' });
    assert.equal(s.api.allowed(), true);
});
test('別タブで共有先が変わっても表示中ページの通信先と保存先は変えない', async () => {
    const s = spaces(), session = { userId: 'alice' };
    s.storage.set('personal_hub_budget_space:alice:budget', JSON.stringify({ id: 'family_space1', name: '家族' }));
    s.api.bind(session);
    s.storage.set('personal_hub_budget_space:alice:budget', JSON.stringify({ id: 'other_space1', name: '別の共有' }));
    assert.equal(s.api.storageUser('alice'), 'alice:space:family_space1');
    await s.api.api('budgetLoad', {}, session);
    assert.equal(s.calls[0][1].spaceId, 'family_space1');
});
test('破損した共有先や個人用IDと衝突する形式は使用しない', () => {
    const s = spaces();
    for (const value of ['{', 'null', JSON.stringify({ id: 'space:bad', name: '不正' }), JSON.stringify({ name: '識別情報なし' }), JSON.stringify({ id: 12345678, name: '数値の識別情報' }), JSON.stringify({ id: 'family_space1' })]) {
        s.storage.set('personal_hub_budget_space:alice:budget', value);
        s.api.bind({ userId: 'alice' });
        assert.equal(s.api.storageUser('alice'), 'alice');
    }
});

test('家計簿・在庫・リスト・メモの選択先を別々に読み込み、通信先を固定する', async () => {
    const s = spaces(), session = { userId: 'alice', token: 'a' };
    s.storage.set('personal_hub_budget_space:alice:budget', JSON.stringify({ id: 'family_space1', name: '家族' }));
    s.storage.set('personal_hub_budget_space:alice:inventory', JSON.stringify({ id: 'hobby_space1', name: '趣味' }));
    s.storage.set('personal_hub_budget_space:alice:lists', 'null');
    s.storage.set('personal_hub_budget_space:alice:notes', JSON.stringify({ id: 'notes_space1', name: 'メモ' }));
    for (const [page, expected] of [['budget','family_space1'],['inventory','hobby_space1'],['lists',undefined],['notes','notes_space1']]) {
        s.api.bind(session, page); await s.api.api('listsLoad', {}, session);
        assert.equal(s.calls.at(-1)[1].spaceId, expected);
        assert.equal(s.api.storageUser('alice'), 'alice' + (expected ? ':space:' + expected : ''));
    }
    s.api.bind(session, 'budget');
    assert.equal(s.api.storageUser('alice', 'inventory'), 'alice:space:hobby_space1');
});

test('旧共通選択は各ページの初回に移行し、移行後の個人用を旧値で戻さない', () => {
    const s = spaces();
    s.storage.set('personal_hub_budget_space:alice', JSON.stringify({ id: 'family_space1', name: '家族' }));
    s.api.bind({ userId: 'alice' }, 'budget'); assert.equal(s.api.selected('alice').id, 'family_space1');
    s.storage.set('personal_hub_budget_space:alice:budget', 'null');
    s.api.bind({ userId: 'alice' }, 'notes'); assert.equal(s.api.selected('alice').id, 'family_space1');
    assert.equal(s.api.selected('alice', 'budget'), null);
    s.storage.set('personal_hub_budget_space:alice', JSON.stringify({ id: 'other_space1', name: '別の共有' }));
    assert.equal(s.api.selected('alice', 'notes').id, 'family_space1');
    assert.equal(s.api.selected('alice', 'budget'), null);
});
