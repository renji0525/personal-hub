// 編集は端末へ保存し、起動時と明示的な同期時だけ通信する
const byId = id => document.getElementById(id);
let budgetSession = null;
let budgetState = { revision: 0, categories: [], entries: [] };
let budgetBusy = false, budgetLoaded = false, budgetSyncMode = null;
let recordLimit = 50, recordFilter = null, summaryMonth = null;
let localBudget = null, savedRaw = null;
let categoryIndex = new Map(), indexedState = null, months = new Map();
const yenFormatter = new Intl.NumberFormat('ja-JP');
const yen = value => yenFormatter.format(value) + '円';
const today = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };
function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
}
function setBusy(value) {
    budgetBusy = value;
    const locked = value && budgetSyncMode !== 'read';
    byId('entryFields').disabled = locked || !budgetLoaded;
    byId('categoryFields').disabled = locked || !budgetLoaded;
    document.querySelectorAll('.requires-data').forEach(el => { el.disabled = locked || !budgetLoaded; });
    byId('refreshButton').disabled = value;
    byId('logoutButton').disabled = locked;
    byId('refreshButton').setAttribute('aria-busy', String(value));
}
function sameAccount() { return HubAuth.read()?.token === budgetSession?.token; }
function categoryInfo(id) { return categoryIndex.get(id) || { name: '未分類', color: '#9eacb9' }; }
function categoryLabel(id) {
    const c = categoryInfo(id), label = node('span', 'category-name');
    const dot = node('span', 'swatch'); dot.style.backgroundColor = c.color; dot.setAttribute('aria-hidden', 'true');
    label.append(dot, node('span', '', c.name)); return label;
}
function fillCategories(select, filter = false) {
    const selected = select.options.length ? select.value : (filter ? 'all' : '');
    select.replaceChildren();
    if (filter) select.append(new Option('すべてのカテゴリ', 'all'));
    select.append(new Option('未分類', ''));
    budgetState.categories.forEach(c => select.append(new Option(c.name, c.id)));
    if ([...select.options].some(o => o.value === selected)) select.value = selected;
}
function render(append = false) {
    append = append === true;
    if (!budgetLoaded) return;
    const dataChanged = indexedState !== budgetState;
    if (dataChanged) {
        indexedState = budgetState;
        categoryIndex = new Map(budgetState.categories.map(c => [c.id, c]));
        months = new Map();
        for (const entry of budgetState.entries) {
            const month = entry.date.slice(0, 7);
            if (!months.has(month)) months.set(month, []);
            months.get(month).push(entry);
        }
        for (const entries of months.values()) entries.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
        fillCategories(byId('entryCategory'));
        fillCategories(byId('categoryFilter'), true);
    }
    const month = byId('monthInput').value;
    const entries = months.get(month) || [];
    if (dataChanged || summaryMonth !== month) {
        const summary = BudgetModel.summarize(entries);
        byId('incomeTotal').textContent = yen(summary.income);
        byId('expenseTotal').textContent = yen(summary.expense);
        byId('balanceTotal').textContent = yen(summary.balance);
        const bars = byId('categorySummary'); bars.replaceChildren();
        const groups = [...summary.categories].sort((a, b) => b[1] - a[1]);
        if (!groups.length) bars.append(node('p', 'empty', '今月の支出はまだありません。'));
        groups.forEach(([id, amount]) => {
            const row = node('div', 'bar-row'), heading = node('div', 'bar-heading');
            heading.append(categoryLabel(id), node('span', '', yen(amount)));
            const track = node('div', 'bar-track'), fill = node('div', 'bar-fill');
            fill.style.width = (amount / summary.expense * 100) + '%'; fill.style.backgroundColor = categoryInfo(id).color;
            track.append(fill); row.append(heading, track); bars.append(row);
        });
        summaryMonth = month;
    }
    const filtered = entries.filter(e => (byId('typeFilter').value === 'all' || e.type === byId('typeFilter').value) &&
        (byId('categoryFilter').value === 'all' || e.categoryId === byId('categoryFilter').value));
    const filter = [month, byId('typeFilter').value, byId('categoryFilter').value].join(':');
    if (dataChanged || recordFilter !== filter) { recordLimit = 50; append = false; recordFilter = filter; }
    byId('entryCount').textContent = filtered.length + '件';
    const list = byId('entries'), start = append ? list.childElementCount : 0;
    if (!append) list.replaceChildren();
    byId('moreEntries').hidden = filtered.length <= recordLimit;
    if (!filtered.length) list.append(node('p', 'empty', entries.length ? '条件に合う記録がありません。' : 'この月の記録はまだありません。入力フォームから記録しましょう。'));
    filtered.slice(start, recordLimit).forEach(entry => {
        const row = node('article', 'record'), left = node('div'), meta = node('div', 'record-meta');
        meta.append(node('time', '', entry.date), categoryLabel(entry.categoryId));
        left.append(meta, node('p', 'record-memo', entry.memo || (entry.type === 'income' ? '収入' : '支出')));
        const right = node('div', 'record-right');
        right.append(node('strong', 'record-amount ' + entry.type, (entry.type === 'income' ? '+' : '−') + yen(entry.amount)));
        const actions = node('div', 'record-actions');
        const edit = node('button', 'requires-data', '編集'), remove = node('button', 'requires-data', '削除');
        edit.type = remove.type = 'button';
        edit.setAttribute('aria-label', entry.date + 'の記録を編集'); remove.setAttribute('aria-label', entry.date + 'の記録を削除');
        edit.addEventListener('click', () => editEntry(entry));
        remove.addEventListener('click', async () => {
            if (confirm(entry.date + 'の' + yen(entry.amount) + 'の記録を削除しますか？')) {
                if (await mutate({ type: 'entryDelete', id: entry.id })) { if (byId('entryId').value === entry.id) resetEntry(); }
            }
        });
        actions.append(edit, remove); right.append(actions); row.append(left, right); list.append(row);
    });
    if (dataChanged && byId('categoryDialog').open) renderCategoryList();
    setBusy(budgetBusy);
}
function renderCategoryList() {
    const list = byId('categories'); list.replaceChildren();
    budgetState.categories.forEach(c => {
        const row = node('div', 'category-row'), actions = node('div', 'category-actions');
        row.append(categoryLabel(c.id));
        const edit = node('button', 'requires-data', '編集'), remove = node('button', 'requires-data', '削除');
        edit.type = remove.type = 'button';
        edit.setAttribute('aria-label', c.name + 'を編集'); remove.setAttribute('aria-label', c.name + 'を削除');
        edit.addEventListener('click', () => {
            byId('categoryId').value = c.id; byId('categoryName').value = c.name; byId('categoryColor').value = c.color;
            byId('saveCategory').textContent = '変更を保存'; byId('cancelCategory').hidden = false; byId('categoryName').focus();
        });
        remove.addEventListener('click', async () => {
            if (budgetState.entries.some(e => e.categoryId === c.id)) { byId('categoryStatus').textContent = '使用中のカテゴリです。記録のカテゴリを変更してから削除してください。'; return; }
            if (confirm('「' + c.name + '」を削除しますか？') && await mutate({ type: 'categoryDelete', id: c.id })) resetCategory();
        });
        actions.append(edit, remove); row.append(actions); list.append(row);
    });
    if (!budgetState.categories.length) list.append(node('p', 'empty', 'カテゴリを追加してください。カテゴリなしでも記録できます。'));
}
function resetEntry() {
    byId('entryForm').reset(); byId('entryId').value = ''; byId('entryDate').value = today();
    byId('entryHeading').textContent = '収支を記録'; byId('saveEntry').textContent = '記録する'; byId('cancelEntry').hidden = true;
}
function editEntry(entry) {
    byId('entryId').value = entry.id; byId('entryType').value = entry.type; byId('entryDate').value = entry.date;
    byId('entryAmount').value = entry.amount; byId('entryCategory').value = entry.categoryId; byId('entryMemo').value = entry.memo;
    byId('entryHeading').textContent = '記録を編集'; byId('saveEntry').textContent = '変更を保存'; byId('cancelEntry').hidden = false;
    byId('entryHeading').scrollIntoView({ behavior: 'smooth', block: 'center' }); byId('entryAmount').focus();
}
function resetCategory() {
    byId('categoryForm').reset(); byId('categoryId').value = ''; byId('saveCategory').textContent = '追加する'; byId('cancelCategory').hidden = true;
}
function localStatus() {
    byId('status').dataset.state = localBudget.pending.length ? 'pending' : 'ready';
    byId('status').textContent = localBudget.pending.length ? '端末に保存済み・未同期 ' + localBudget.pending.length + '件' : '同期済み';
}
function saveLocal(value) {
    if (localStorage.getItem(BudgetLocal.key(budgetSession.userId)) !== savedRaw) {
        throw new Error('別タブで変更されました。この画面を開き直してください。');
    }
    savedRaw = BudgetLocal.write(localStorage, budgetSession.userId, value);
    localBudget = value; budgetState = BudgetLocal.view(value); budgetLoaded = true;
}
async function loadBudget() {
    if (budgetBusy || !budgetSession || !sameAccount()) return;
    budgetSyncMode = localBudget?.pending.length ? 'write' : 'read';
    setBusy(true); byId('status').dataset.state = 'syncing'; byId('status').textContent = '同期中…';
    try {
        if (localBudget?.pending.length) {
            while (localBudget.pending.length) {
                const packet = BudgetLocal.packet(localBudget);
                // 送信IDを先に保存し、応答喪失時も同じ内容で再試行する
                saveLocal(packet.local);
                const result = await HubAuth.api('budgetSync', packet.request, budgetSession);
                if (!sameAccount()) return;
                saveLocal(BudgetLocal.ack(localBudget, result, packet.request.operations.length));
            }
        } else {
            const before = localBudget;
            const result = await HubAuth.api('budgetLoad', before ? { knownRevision: before.base.revision } : {}, budgetSession);
            if (!sameAccount()) return;
            // 読込中の端末編集を応答で上書きしない
            if (localBudget !== before && localBudget?.pending.length) {
                if (result.revision !== localBudget.base.revision) {
                    const error = new Error('別の端末でも変更されています。端末の編集をバックアップして確認してください。');
                    error.code = 'BUDGET_CONFLICT'; throw error;
                }
            } else if (!result.unchanged) saveLocal(BudgetLocal.create(result));
        }
        byId('discardButton').hidden = true; render(); localStatus();
    } catch (error) {
        byId('status').dataset.state = 'error';
        byId('status').textContent = '同期できませんでした。端末の変更は保持しています。' + error.message;
        byId('discardButton').hidden = error.code !== 'BUDGET_CONFLICT';
    } finally { budgetSyncMode = null; setBusy(false); }
}
async function mutate(operation, refresh = true) {
    if (budgetBusy && budgetSyncMode !== 'read' || !budgetLoaded || !sameAccount()) return false;
    try {
        saveLocal(BudgetLocal.edit(localBudget, operation));
        if (refresh) render();
        localStatus(); byId('categoryStatus').textContent = ''; return true;
    } catch (error) {
        byId('status').textContent = byId('categoryStatus').textContent = '端末に保存できませんでした。' + error.message;
        return false;
    }
}
byId('discardButton').addEventListener('click', async () => {
    if (budgetBusy || !confirm('未同期の変更を破棄します。必要なら先にバックアップしてください。続けますか？')) return;
    try { saveLocal(BudgetLocal.create(localBudget.base)); await loadBudget(); }
    catch (error) { byId('status').textContent = error.message; }
});
window.addEventListener('storage', event => {
    if (budgetSession && (event.key === BudgetLocal.key(budgetSession.userId) || event.key === null)) location.reload();
});
byId('entryForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!byId('entryId').value) byId('entryId').value = crypto.randomUUID();
    byId('cancelEntry').hidden = false;
    const value = { id: byId('entryId').value, type: byId('entryType').value, date: byId('entryDate').value,
        amount: Number(byId('entryAmount').value), categoryId: byId('entryCategory').value, memo: byId('entryMemo').value };
    if (await mutate({ type: 'entrySave', value }, false)) {
        byId('monthInput').value = value.date.slice(0, 7); byId('typeFilter').value = 'all'; byId('categoryFilter').value = 'all'; resetEntry(); render();
    }
});
byId('categoryForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!byId('categoryId').value) byId('categoryId').value = crypto.randomUUID();
    byId('cancelCategory').hidden = false;
    const value = { id: byId('categoryId').value, name: byId('categoryName').value, color: byId('categoryColor').value };
    if (await mutate({ type: 'categorySave', value })) resetCategory();
});
byId('categoryButton').addEventListener('click', () => { byId('categoryStatus').textContent = ''; renderCategoryList(); byId('categoryDialog').showModal(); });
byId('closeCategories').addEventListener('click', () => byId('categoryDialog').close());
byId('cancelEntry').addEventListener('click', resetEntry); byId('cancelCategory').addEventListener('click', resetCategory);
['monthInput', 'typeFilter', 'categoryFilter'].forEach(id => byId(id).addEventListener('change', render));
function moveMonth(offset) {
    const [year, month] = byId('monthInput').value.split('-').map(Number);
    const date = new Date(year, month - 1 + offset, 1);
    byId('monthInput').value = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0'); render();
}
byId('previousMonth').addEventListener('click', () => moveMonth(-1)); byId('nextMonth').addEventListener('click', () => moveMonth(1));
byId('refreshButton').addEventListener('click', loadBudget);
byId('moreEntries').addEventListener('click', () => { recordLimit += 50; render(true); });
byId('logoutButton').addEventListener('click', async () => { if (!budgetBusy || budgetSyncMode === 'read') { try { await HubAuth.signOut(budgetSession); } catch (error) { /* 共通認証が端末側を解除する */ } } });
byId('exportButton').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), categories: budgetState.categories, entries: budgetState.entries }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = node('a'); link.href = url; link.download = 'personal-hub-budget-' + today() + '.json';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener('hub-auth-changed', event => {
    if (budgetSession && (!event.detail || event.detail.token !== budgetSession.token)) {
        budgetState = { revision: 0, categories: [], entries: [] }; budgetLoaded = false;
        document.documentElement.setAttribute('data-auth-pending', '');
    }
});
(async () => {
    byId('monthInput').value = today().slice(0, 7); resetEntry();
    budgetSession = await HubAuth.ready;
    if (!budgetSession) return;
    byId('currentUser').textContent = budgetSession.userId;
    document.documentElement.removeAttribute('data-auth-pending');
    try {
        localBudget = BudgetLocal.read(localStorage, budgetSession.userId);
        savedRaw = localStorage.getItem(BudgetLocal.key(budgetSession.userId));
        if (localBudget) { budgetState = BudgetLocal.view(localBudget); budgetLoaded = true; render(); localStatus(); }
    } catch (error) { byId('status').textContent = error.message; setBusy(false); return; }
    await loadBudget();
})();
