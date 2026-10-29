const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('補充表示は同じデータと日付の再計算を省き、変更と権限を反映する', () => {
    let raw = 'first', date = new Date(2026, 9, 30), checks = 0, denied = false;
    const box = { hidden: true, textContent: '' }, events = {};
    const spaces = { selected: () => ({ denied }), storageUser: user => user };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/shared/js/inventory-reminders.js'), 'utf8'), {
        Date: class extends Date { constructor() { super(date); } },
        window: { BudgetSpaces: spaces, addEventListener: (name, fn) => { events[name] = fn; } },
        document: { getElementById: () => box, addEventListener() {}, hidden: false },
        HubAuth: { read: () => ({ userId: 'alice' }) }, BudgetSpaces: spaces,
        localStorage: { getItem: () => raw },
        BudgetLocal: { key: user => user, read: () => ({}), view: () => ({ products: [{ name: raw }] }) },
        BudgetModel: { due: () => { checks++; return { soon: true }; } }, setInterval() {}
    });
    assert.equal(checks, 1);
    events.focus(); events.pageshow(); events.storage();
    assert.equal(checks, 1);
    raw = 'changed'; events['budget-local-changed']();
    assert.equal(checks, 2); assert.match(box.textContent, /changed/);
    date = new Date(2026, 9, 31); events.focus();
    assert.equal(checks, 3);
    denied = true; events.focus(); assert.equal(box.hidden, true);
    denied = false; events.focus(); assert.equal(box.hidden, false); assert.equal(checks, 3);
});
