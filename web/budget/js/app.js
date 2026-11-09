// 編集は端末へ保存し、3秒後の自動送信・時間帯の初回表示・手動同期で通信する
const byId = id => document.getElementById(id);
const budgetStorageUser = () => window.BudgetSpaces ? BudgetSpaces.storageUser(budgetSession.userId) : budgetSession.userId;
const budgetApi = (action, params) => window.BudgetSpaces ? BudgetSpaces.api(action, params, budgetSession) : HubAuth.api(action, params, budgetSession);
let budgetSession = null;
let budgetState = { revision: 0, categories: [], entries: [] };
const autoPush = HubSync.autoPush(loadBudget, () => !budgetBusy && !!localBudget?.pending.length && sameAccount());
let budgetBusy = false, budgetLoaded = false;
let recordLimit = 50, recordFilter = null, summaryPeriod = null;
let periodView = 'month', selectedDay = '';
let quickCategory = false;
let calendarState = null, calendarMonth = '', calendarDate = '';
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
    const locked = !sameAccount();
    byId('entryFields').disabled = locked || !budgetLoaded;
    byId('categoryFields').disabled = locked || !budgetLoaded;
    document.querySelectorAll('.requires-data').forEach(el => { el.disabled = locked || !budgetLoaded; });
    byId('refreshButton').disabled = value;
    byId('logoutButton').disabled = locked;
    byId('refreshButton').setAttribute('aria-busy', String(value));
}
function sameAccount() { return HubAuth.read()?.token === budgetSession?.token && (!window.BudgetSpaces || BudgetSpaces.allowed()); }
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
const weekdays = ['月', '火', '水', '木', '金', '土', '日'];
function dayLabel(date) {
    const [month, day] = date.split('-').slice(-2).map(Number);
    return month + '月' + day + '日';
}
function shiftDay(date, offset) {
    const day = new Date(date + 'T00:00:00Z');
    day.setUTCDate(day.getUTCDate() + offset);
    return day.toISOString().split('T')[0];
}
function weekday(date) { return (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7; }
function styleDay(element, date, index) {
    const [year, month, day] = date.split('-');
    const holiday = budgetHolidays[year]?.includes(month + day);
    if (holiday || index === 6) element.classList.add('day-off');
    else if (index === 5) element.classList.add('day-saturday');
    return holiday;
}
function fillSuggestions(id, values) {
    const unique = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
    byId(id).replaceChildren(...unique.map(value => new Option(value, value)));
}
function renderCalendar(month, entries) {
    const first = month + '-01', start = weekday(first), currentDate = today();
    const calendar = byId('calendarDays');
    // データ・表示月・当日が同じなら日別集計とボタンを再生成しない
    if (calendarState === budgetState && calendarMonth === month && calendarDate === currentDate) {
        for (const cell of calendar.querySelectorAll('button')) {
            const pressed = String(cell.dataset.date === selectedDay);
            if (cell.getAttribute('aria-pressed') !== pressed) cell.setAttribute('aria-pressed', pressed);
        }
        return;
    }
    const totals = new Map();
    for (const entry of entries) {
        if (!totals.has(entry.date)) totals.set(entry.date, { expense: 0, income: 0 });
        totals.get(entry.date)[entry.type] += entry.amount;
    }
    calendar.replaceChildren();
    for (let i = 0; i < start; i++) calendar.append(node('span', 'calendar-blank'));
    for (let date = first; date.startsWith(month + '-'); date = shiftDay(date, 1)) {
        const current = date;
        const total = totals.get(date);
        const cell = node('button', 'calendar-day requires-data');
        cell.type = 'button';
        cell.dataset.date = date;
        const index = weekday(date), holiday = styleDay(cell, date, index);
        const label = [dayLabel(date), weekdays[index] + '曜日'];
        if (holiday) label.push('祝日');
        cell.append(node('strong', 'day-number', String(Number(date.slice(8)))));
        if (total?.expense) {
            cell.append(node('span', 'expense', '−' + yenFormatter.format(total.expense)));
            label.push('支出' + yen(total.expense));
        }
        if (total?.income) {
            cell.append(node('span', 'income', '+' + yenFormatter.format(total.income)));
            label.push('収入' + yen(total.income));
        }
        cell.setAttribute('aria-label', label.join('、'));
        cell.setAttribute('aria-pressed', String(date === selectedDay));
        if (date === currentDate) cell.setAttribute('aria-current', 'date');
        cell.addEventListener('click', () => {
            selectedDay = current;
            render();
            openDayRecords(current);
        });
        calendar.append(cell);
    }
    while (calendar.childElementCount % 7) calendar.append(node('span', 'calendar-blank'));
    calendarState = budgetState; calendarMonth = month; calendarDate = currentDate;
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
        fillSuggestions('shopSuggestions', budgetState.entries.map(entry => entry.shop));
        fillSuggestions('personSuggestions', budgetState.entries.map(entry => entry.attribution?.name));
    }
    const month = byId('monthInput').value || today().slice(0, 7);
    const weekly = periodView === 'week';
    const anchor = byId('weekDate').value || today();
    const monday = weekly ? shiftDay(anchor, -weekday(anchor)) : '';
    const days = weekly ? weekdays.map((_, index) => shiftDay(monday, index)) : [];
    const period = weekly ? monday : month;
    const entries = weekly ? [...new Set(days.map(date => date.slice(0, 7)))]
        .flatMap(key => months.get(key) || []).filter(entry => days.includes(entry.date)) : months.get(month) || [];
    byId('monthCalendar').hidden = weekly;
    if (!weekly && !append) renderCalendar(month, entries);
    if (dataChanged || summaryPeriod !== period) {
        const summary = BudgetModel.summarize(entries);
        byId('incomeTotal').textContent = yen(summary.income);
        byId('expenseTotal').textContent = yen(summary.expense);
        byId('balanceTotal').textContent = yen(summary.balance);
        const bars = byId('categorySummary'); bars.replaceChildren();
        const groups = [...summary.categories].sort((a, b) => b[1] - a[1]);
        if (!groups.length) bars.append(node('p', 'empty', 'この期間の支出はまだありません。'));
        groups.forEach(([id, amount]) => {
            const row = node('div', 'bar-row'), heading = node('div', 'bar-heading');
            heading.append(categoryLabel(id), node('span', '', yen(amount)));
            const track = node('div', 'bar-track'), fill = node('div', 'bar-fill');
            fill.style.width = (amount / summary.expense * 100) + '%'; fill.style.backgroundColor = categoryInfo(id).color;
            track.append(fill); row.append(heading, track); bars.append(row);
        });
        summaryPeriod = period;
    }
    const typeFilter = byId('typeFilter').value, categoryFilter = byId('categoryFilter').value;
    const filtered = entries.filter(e => (weekly || !selectedDay || e.date === selectedDay) &&
        (typeFilter === 'all' || e.type === typeFilter) && (categoryFilter === 'all' || e.categoryId === categoryFilter));
    const filter = [period, selectedDay, typeFilter, categoryFilter].join(':');
    if (dataChanged || recordFilter !== filter) { recordLimit = 50; recordFilter = filter; append = false; }
    byId('recordsTitle').textContent = weekly ? dayLabel(days[0]) + '〜' + dayLabel(days[6]) + 'の記録' :
        selectedDay ? dayLabel(selectedDay) + 'の記録' : '記録一覧';
    byId('clearDay').hidden = weekly || !selectedDay;
    byId('entryCount').textContent = filtered.length + '件';
    const list = byId('entries');
    if (!append) list.replaceChildren();
    byId('moreEntries').hidden = filtered.length <= recordLimit;
    if (weekly) {
        let remaining = recordLimit;
        days.forEach((date, index) => {
            const day = append ? list.children[index] : node('section', 'week-day');
            if (!append) {
                const holiday = styleDay(day, date, index);
                const heading = node('h3');
                const button = node('button', 'week-date quiet requires-data', dayLabel(date) + '（' + weekdays[index] + (holiday ? '・祝' : '') + '）');
                button.type = 'button';
                button.addEventListener('click', () => openDayRecords(date));
                heading.append(button); day.append(heading);
            }
            const records = filtered.filter(entry => entry.date === date);
            if (!records.length && !append) day.append(node('p', 'empty', '記録なし'));
            else {
                const start = append ? day.querySelectorAll('.record').length : 0;
                records.slice(start, remaining).forEach(entry => renderEntry(entry, day));
                remaining = Math.max(0, remaining - records.length);
            }
            if (!append) list.append(day);
        });
    } else {
        if (!filtered.length) list.append(node('p', 'empty', 'この期間に条件に合う記録がありません。'));
        filtered.slice(append ? list.childElementCount : 0, recordLimit).forEach(entry => renderEntry(entry, list));
    }
    if (dataChanged && byId('dayRecordsDialog').open) renderDayRecords();
    if (dataChanged && byId('categoryDialog').open && !quickCategory) renderCategoryList();
    setBusy(budgetBusy);
}
function renderEntry(entry, target, errorId = 'categoryStatus') {
    const row = node('article', 'record'), left = node('div'), meta = node('div', 'record-meta');
    meta.append(node('time', '', entry.date), categoryLabel(entry.categoryId));
    left.append(meta, node('p', 'record-memo', entry.productName || entry.memo || (entry.type === 'income' ? '収入' : '支出')));
    const details = [entry.shop, entry.attribution?.kind === 'group' ? 'グループ共通' : entry.attribution?.name,
        entry.productName && entry.memo].filter(Boolean);
    if (details.length) left.append(node('p', 'record-details', details.join(' ・ ')));
    const right = node('div', 'record-right');
    right.append(node('strong', 'record-amount ' + entry.type, (entry.type === 'income' ? '+' : '−') + yen(entry.amount)));
    const actions = node('div', 'record-actions');
    const edit = node('button', 'requires-data', '編集'), remove = node('button', 'requires-data', '削除');
    edit.type = remove.type = 'button';
    edit.setAttribute('aria-label', entry.date + 'の記録を編集'); remove.setAttribute('aria-label', entry.date + 'の記録を削除');
    edit.addEventListener('click', () => editEntry(entry));
    remove.addEventListener('click', async () => {
        if (confirm(entry.date + 'の' + yen(entry.amount) + 'の記録を削除しますか？')) {
            if (await mutate({ type: 'entryDelete', id: entry.id }, true, errorId)) { if (byId('entryId').value === entry.id) resetEntry(); }
        }
    });
    actions.append(edit, remove); right.append(actions); row.append(left, right); target.append(row);
}
function renderDayRecords() {
    const date = byId('dayRecordsDialog').dataset.date;
    const list = byId('dayRecords');
    const entries = (months.get(date.slice(0, 7)) || []).filter(entry => entry.date === date);
    list.replaceChildren();
    if (!entries.length) list.append(node('p', 'empty', 'この日の記録はありません。'));
    entries.forEach(entry => renderEntry(entry, list, 'dayRecordsStatus'));
}
function openDayRecords(date) {
    const dialog = byId('dayRecordsDialog');
    dialog.dataset.date = date;
    byId('dayRecordsHeading').textContent = dayLabel(date) + 'の記録';
    byId('dayRecordsStatus').textContent = '';
    renderDayRecords();
    setBusy(budgetBusy);
    dialog.showModal();
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
function resetEntry(date = selectedDay || (periodView === 'week' ? byId('weekDate').value : today())) {
    byId('entryForm').reset(); byId('entryId').value = '';
    byId('entryDate').value = date || today();
    setEntryAttribution();
    byId('entryHeading').textContent = '収支を記録'; byId('saveEntry').textContent = '記録する';
    byId('entryStatus').textContent = '';
}
function showEntry() {
    byId('entryDialog').showModal();
    byId('entryAmount').focus({ preventScroll: true });
}
function openEntry(date) {
    resetEntry(date);
    showEntry();
}
function showPersonField() {
    const personal = byId('entryAttribution').value === 'person';
    byId('entryPersonFields').hidden = !personal;
    byId('entryPerson').required = personal;
}
function setEntryAttribution(attribution) {
    const shared = budgetSession && window.BudgetSpaces?.selected(budgetSession.userId, 'budget')?.id;
    byId('entryAttribution').value = attribution?.kind || (shared || !budgetSession ? 'group' : 'person');
    byId('entryPerson').value = attribution?.name || (!attribution && !shared ? budgetSession?.userId || '' : '');
    showPersonField();
}
function editEntry(entry) {
    resetEntry(entry.date);
    byId('entryId').value = entry.id; byId('entryType').value = entry.type; byId('entryDate').value = entry.date;
    byId('entryAmount').value = entry.amount; byId('entryCategory').value = entry.categoryId; byId('entryMemo').value = entry.memo;
    byId('entryShop').value = entry.shop || ''; byId('entryProduct').value = entry.productName || '';
    setEntryAttribution(entry.attribution);
    byId('entryHeading').textContent = '記録を編集'; byId('saveEntry').textContent = '変更を保存';
    showEntry();
}
function resetCategory() {
    byId('categoryForm').reset(); byId('categoryId').value = ''; byId('saveCategory').textContent = '追加する'; byId('cancelCategory').hidden = true;
}
function openCategories(quick) {
    if (quick || quickCategory) resetCategory();
    quickCategory = quick;
    byId('categoryHeading').textContent = quick ? 'カテゴリを追加' : 'カテゴリを管理';
    byId('categoryHint').hidden = quick;
    byId('categories').hidden = quick;
    byId('categoryStatus').textContent = '';
    if (!quick) renderCategoryList();
    byId('categoryDialog').showModal();
    if (quick) byId('categoryName').focus();
}
function localStatus() {
    byId('status').dataset.state = localBudget.pending.length ? 'pending' : 'ready';
    byId('status').textContent = localBudget.pending.length ? '端末に保存済み・未同期 ' + localBudget.pending.length + '件' : '同期済み';
}
function saveLocal(value) {
    if (localStorage.getItem(BudgetLocal.key(budgetStorageUser())) !== savedRaw) {
        throw new Error('別タブで変更されました。この画面を開き直してください。');
    }
    savedRaw = BudgetLocal.write(localStorage, budgetStorageUser(), value);
    localBudget = value; budgetState = BudgetLocal.view(value); budgetLoaded = true;
    window.dispatchEvent(new Event('budget-local-changed'));
}
async function loadBudget() {
    if (HubConflict.busy()) return;
    if (budgetBusy || !budgetSession || !sameAccount()) return;
    autoPush.start();
    const syncStartedAt = Date.now();
    setBusy(true); byId('status').dataset.state = 'syncing'; byId('status').textContent = '同期中…';
    try {
        if (localBudget?.pending.length) {
            while (localBudget.pending.length) {
                const packet = BudgetLocal.packet(localBudget);
                // 送信IDを先に保存し、応答喪失時も同じ内容で再試行する
                saveLocal(packet.local);
                const result = await budgetApi('budgetSync', packet.request);
                if (!sameAccount()) return;
                saveLocal(BudgetLocal.ack(localBudget, result, packet.request.operations.length));
                if (autoPush.waiting()) break;
            }
        } else {
            const before = localBudget;
            const result = await budgetApi('budgetLoad', Array.isArray(before?.base.products) ? { knownRevision: before.base.revision } : {});
            if (!sameAccount()) return;
            // 読込中の端末編集を応答で上書きしない
            if (localBudget !== before && localBudget?.pending.length) {
                if (result.revision !== localBudget.base.revision) {
                    const error = new Error('別の端末でも変更されています。端末の編集をバックアップして確認してください。');
                    error.code = 'BUDGET_CONFLICT'; throw error;
                }
            } else if (!result.unchanged) saveLocal(BudgetLocal.create(result));
        }
        window.HubSync?.mark(budgetStorageUser(), 'budget', syncStartedAt);
        byId('discardButton').hidden = true; render(); localStatus();
    } catch (error) {
        window.BudgetSpaces?.handleError(error);
        byId('status').dataset.state = 'error';
        byId('status').textContent = '同期できませんでした。端末の変更は保持しています。' + error.message;
        byId('discardButton').hidden = error.code !== 'BUDGET_CONFLICT';
    } finally { setBusy(false); autoPush.finish(); }
}
async function mutate(operation, refresh = true, errorId = 'categoryStatus') {
    if (!budgetLoaded || !sameAccount()) return false;
    try {
        saveLocal(BudgetLocal.edit(localBudget, operation));
        autoPush.schedule();
        if (refresh) render();
        localStatus(); byId(errorId).textContent = ''; return true;
    } catch (error) {
        byId('status').textContent = byId(errorId).textContent = '端末に保存できませんでした。' + error.message;
        return false;
    }
}
byId('discardButton').addEventListener('click', async () => {
    if (budgetBusy || !confirm('未同期の変更を破棄します。必要なら先にバックアップしてください。続けますか？')) return;
    try { saveLocal(BudgetLocal.create(localBudget.base)); await loadBudget(); }
    catch (error) { byId('status').textContent = error.message; }
});
window.addEventListener('storage', event => {
    if (budgetSession && (event.key === BudgetLocal.key(budgetStorageUser()) || event.key === null)) location.reload();
});
byId('entryForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!byId('entryId').value) byId('entryId').value = crypto.randomUUID();
    const existing = budgetState.entries.find(entry => entry.id === byId('entryId').value);
    const value = { id: byId('entryId').value, type: byId('entryType').value, date: byId('entryDate').value,
        amount: Number(byId('entryAmount').value), categoryId: byId('entryCategory').value, memo: byId('entryMemo').value,
        attribution: byId('entryAttribution').value === 'person' ? { kind: 'person', name: byId('entryPerson').value.trim() } : { kind: 'group' } };
    const shop = byId('entryShop').value.trim(), productName = byId('entryProduct').value.trim();
    if (shop || existing?.shop) value.shop = shop;
    if (productName || existing?.productName) value.productName = productName;
    // 旧版GASでは追加項目を落として保存せず、未対応操作として同期を止める
    if (await mutate({ type: 'entryDetailsSave', value }, false, 'entryStatus')) {
        byId('monthInput').value = value.date.slice(0, 7); byId('weekDate').value = value.date;
        if (selectedDay) selectedDay = value.date;
        byId('typeFilter').value = 'all'; byId('categoryFilter').value = 'all';
        byId('entryDialog').close(); resetEntry(); render();
        if (byId('dayRecordsDialog').open) byId('addDayRecord').focus({ preventScroll: true });
        if (byId('dayRecordsDialog').open) byId('addDayRecord').focus({ preventScroll: true });
    }
});
byId('categoryForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!byId('categoryId').value) byId('categoryId').value = crypto.randomUUID();
    byId('cancelCategory').hidden = quickCategory;
    const value = { id: byId('categoryId').value, name: byId('categoryName').value, color: byId('categoryColor').value };
    if (await mutate({ type: 'categorySave', value })) {
        resetCategory();
        if (quickCategory) {
            byId('entryCategory').value = value.id;
            byId('categoryDialog').close();
            byId('entryCategory').focus();
        }
    }
});
byId('categoryButton').addEventListener('click', () => openCategories(false));
byId('addEntryCategory').addEventListener('click', () => openCategories(true));
byId('closeCategories').addEventListener('click', () => byId('categoryDialog').close());
byId('newEntry').addEventListener('click', () => openEntry());
byId('addDayRecord').addEventListener('click', () => openEntry(byId('dayRecordsDialog').dataset.date));
byId('closeDayRecords').addEventListener('click', () => byId('dayRecordsDialog').close());
for (const id of ['cancelEntry', 'closeEntry']) byId(id).addEventListener('click', () => byId('entryDialog').close());
byId('cancelCategory').addEventListener('click', resetCategory);
byId('entryAttribution').addEventListener('change', showPersonField);
byId('clearDay').addEventListener('click', () => { selectedDay = ''; render(); });
['typeFilter', 'categoryFilter'].forEach(id => byId(id).addEventListener('change', render));
byId('monthInput').addEventListener('change', () => {
    if (!/^\d{4}-\d{2}$/.test(byId('monthInput').value) || !byId('monthInput').validity.valid) byId('monthInput').value = today().slice(0, 7);
    selectedDay = ''; render();
});
byId('weekDate').addEventListener('change', () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(byId('weekDate').value) || !byId('weekDate').validity.valid) byId('weekDate').value = today();
    render();
});
function setPeriodView(view) {
    if (periodView === view) return;
    const weekly = view === 'week';
    if (weekly) {
        const month = byId('monthInput').value || today().slice(0, 7);
        byId('weekDate').value = selectedDay || (today().startsWith(month) ? today() : month + '-01');
    } else byId('monthInput').value = (byId('weekDate').value || today()).slice(0, 7);
    periodView = view; selectedDay = '';
    byId('monthInput').hidden = weekly; byId('weekDate').hidden = !weekly;
    byId('monthView').setAttribute('aria-pressed', String(!weekly));
    byId('weekView').setAttribute('aria-pressed', String(weekly));
    byId('previousMonth').setAttribute('aria-label', weekly ? '前の週' : '前の月');
    byId('nextMonth').setAttribute('aria-label', weekly ? '次の週' : '次の月');
    render();
}
function movePeriod(offset) {
    if (periodView === 'week') {
        const date = shiftDay(byId('weekDate').value || today(), offset * 7);
        if (date.length === 10 && !date.startsWith('0000')) byId('weekDate').value = date;
    } else {
        const month = byId('monthInput').value || today().slice(0, 7);
        const date = new Date(month + '-01T00:00:00Z');
        date.setUTCMonth(date.getUTCMonth() + offset);
        if (date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999) byId('monthInput').value = date.toISOString().slice(0, 7);
        selectedDay = '';
    }
    render();
}
byId('monthView').addEventListener('click', () => setPeriodView('month')); byId('weekView').addEventListener('click', () => setPeriodView('week'));
byId('previousMonth').addEventListener('click', () => movePeriod(-1)); byId('nextMonth').addEventListener('click', () => movePeriod(1));
byId('refreshButton').addEventListener('click', loadBudget);
byId('moreEntries').addEventListener('click', () => { recordLimit += 50; render(true); });
byId('logoutButton').addEventListener('click', async () => { try { await HubAuth.signOut(budgetSession); } catch (error) { /* 共通認証が端末側を解除する */ } });
byId('exportButton').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), categories: budgetState.categories, entries: budgetState.entries, products: budgetState.products || [] }, null, 2)], { type: 'application/json' });
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
    byId('monthInput').value = today().slice(0, 7); byId('weekDate').value = today(); resetEntry();
    budgetSession = await HubAuth.ready;
    if (!budgetSession) return;
    if (window.BudgetSpaces) { BudgetSpaces.bind(budgetSession, 'budget'); BudgetSpaces.mount(budgetSession); }
    setEntryAttribution();
    byId('currentUser').textContent = budgetSession.userId;
    document.documentElement.removeAttribute('data-auth-pending');
    if (window.BudgetSpaces && !BudgetSpaces.allowed()) { setBusy(false); return; }
    try {
        localBudget = BudgetLocal.read(localStorage, budgetStorageUser());
        savedRaw = localStorage.getItem(BudgetLocal.key(budgetStorageUser()));
        if (localBudget) { budgetState = BudgetLocal.view(localBudget); budgetLoaded = true; render(); localStatus(); }
    } catch (error) { byId('status').textContent = error.message; setBusy(false); return; }
    if (!window.HubSync || HubSync.needed(budgetStorageUser(), 'budget', !!localBudget)) await loadBudget();
    else { setBusy(false); autoPush.schedule(); }
})();

HubConflict.bind({ read: () => localBudget, save: saveLocal, load: async () => BudgetLocal.create(await budgetApi('budgetLoad', {})).base, apply: BudgetModel.apply, ready: () => !budgetBusy && sameAccount(), done: async () => { render(); await loadBudget(); }, error: error => { byId('status').textContent = error.message; } });
