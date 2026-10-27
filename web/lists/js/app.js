// リストは端末へ保存し、各時間帯の初回と手動操作で共有先と同期する
const byId = id => document.getElementById(id);
let listsSession, listsLocal, listsBusy = false, listsSyncMode = null, savedRaw = null, stale = false;
const limits = { todo: 50, wish: 50 };
const scope = () => BudgetSpaces.storageUser(listsSession.userId);
const sameAccount = () => listsSession && HubAuth.read()?.token === listsSession.token && BudgetSpaces.allowed() && !stale;
const today = () => { const date = new Date(); return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'); };
function message(text, state = 'ready') { byId('status').textContent = text; byId('status').dataset.state = state; }
function controls() {
    const locked = !listsLocal || listsSyncMode === 'write' || !sameAccount();
    document.querySelectorAll('[data-edit], .list-item button, .list-item input').forEach(node => { node.disabled = locked; });
    byId('syncButton').disabled = listsBusy || !sameAccount();
    byId('syncButton').setAttribute('aria-busy', String(listsBusy));
    byId('discardButton').disabled = listsBusy || !sameAccount();
    byId('exportButton').disabled = !listsLocal;
    byId('logoutButton').disabled = listsSyncMode === 'write';
}
function localStatus() { message(listsLocal.pending.length ? '端末に保存済み・未同期 ' + listsLocal.pending.length + '件' : '同期済み', listsLocal.pending.length ? 'pending' : 'ready'); }
function save(value) {
    if (!sameAccount()) throw new Error('この画面を開き直してください。');
    if (localStorage.getItem(ListsLocal.key(scope())) !== savedRaw) throw new Error('別タブで変更されています。この画面を開き直してください。');
    savedRaw = ListsLocal.write(localStorage, scope(), value); listsLocal = value;
}
function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function mutate(operation) {
    if (!listsLocal || listsSyncMode === 'write' || !sameAccount()) throw new Error('同期が完了してから操作してください。');
    save(ListsLocal.edit(listsLocal, operation)); render(); localStatus();
}
function render() {
    if (!listsLocal) return;
    const items = ListsLocal.view(listsLocal).items, query = byId('search').value.trim().toLocaleLowerCase(), filter = byId('filter').value;
    for (const kind of ['todo', 'wish']) {
        const all = items.filter(value => value.kind === kind), visible = all.filter(value => (filter === 'all' || value.done === (filter === 'done')) && (value.title + ' ' + value.note).toLocaleLowerCase().includes(query))
            .sort((a, b) => Number(a.done) - Number(b.done) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
        byId(kind + 'Count').textContent = (kind === 'todo' ? '未完了 ' : '未購入 ') + all.filter(value => !value.done).length + ' / 全' + all.length + '件';
        const container = byId(kind + 'Items'); container.replaceChildren();
        for (const value of visible.slice(0, limits[kind])) {
            const card = element('article', undefined, 'list-item' + (value.done ? ' is-done' : '')); card.dataset.id = value.id;
            const heading = element('div', undefined, 'item-heading'), check = element('input'); check.type = 'checkbox'; check.checked = value.done;
            check.setAttribute('aria-label', value.title + (kind === 'todo' ? 'を完了にする' : 'を購入済みにする'));
            check.addEventListener('change', () => {
                try { mutate({ type: 'itemDone', id: value.id, done: check.checked }); (document.querySelector('[data-id="' + value.id + '"] input') || byId(kind + 'Add')).focus({ preventScroll: true }); }
                catch (error) { render(); message(error.message, 'error'); }
            });
            heading.append(check, element('h3', value.title)); card.append(heading);
            if (value.dueDate) card.append(element('p', '期限 ' + value.dueDate + (!value.done && value.dueDate < today() ? '・期限を過ぎています' : ''), !value.done && value.dueDate < today() ? 'overdue' : 'muted'));
            if (value.note) card.append(element('p', value.note, 'item-note'));
            if (value.url) { const link = element('a', '商品リンクを開く ↗', 'item-link'); link.href = value.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link); }
            const actions = element('div', undefined, 'actions');
            for (const [label, action] of [['編集', () => edit(value.kind, value)], ['削除', () => { if (confirm('「' + value.title + '」を削除しますか？')) mutate({ type: 'itemDelete', id: value.id }); }]]) {
                const button = element('button', label, 'quiet'); button.type = 'button'; button.addEventListener('click', () => { try { action(); } catch (error) { message(error.message, 'error'); } }); actions.append(button);
            }
            card.append(actions); container.append(card);
        }
        if (!visible.length) container.append(element('p', query || filter !== 'all' ? '条件に合う項目はありません。' : kind === 'todo' ? 'やる事を追加して、ひとつずつ進めましょう。' : '気になるものを、ここにメモしておきましょう。', 'empty'));
        byId(kind + 'More').hidden = visible.length <= limits[kind];
        byId(kind + 'Shown').textContent = visible.length ? Math.min(visible.length, limits[kind]) + ' / ' + visible.length + '件を表示' : '';
    }
    controls();
}
function kindFields() {
    const todo = byId('itemKind').value === 'todo'; byId('dueField').hidden = !todo; byId('urlField').hidden = todo;
    byId('itemDue').disabled = !todo; byId('itemUrl').disabled = todo;
}
function edit(kind, value) {
    byId('itemForm').reset(); byId('itemError').textContent = ''; byId('itemId').value = value?.id || crypto.randomUUID();
    byId('itemKind').value = kind; byId('itemTitle').value = value?.title || ''; byId('itemNote').value = value?.note || '';
    byId('itemDue').value = value?.dueDate || ''; byId('itemUrl').value = value?.url || ''; byId('itemDone').checked = value?.done || false;
    byId('itemDialogTitle').textContent = value ? '項目を編集' : kind === 'todo' ? 'やる事を追加' : '買いたいものを追加';
    kindFields(); byId('itemDialog').showModal(); byId('itemTitle').focus();
}
async function sync() {
    if (listsBusy || !sameAccount()) return;
    const startedAt = Date.now(); listsSyncMode = listsLocal?.pending.length ? 'write' : 'read'; listsBusy = true; controls(); message('同期中…', 'syncing');
    try {
        if (listsLocal?.pending.length) {
            while (listsLocal.pending.length) {
                const packet = ListsLocal.packet(listsLocal); save(packet.local);
                const result = await BudgetSpaces.api('listsSync', packet.request, listsSession);
                if (!sameAccount()) return;
                save(ListsLocal.ack(listsLocal, result, packet.request.operations.length));
            }
        } else {
            const before = listsLocal, result = await BudgetSpaces.api('listsLoad', before ? { knownRevision: before.base.revision } : {}, listsSession);
            if (!sameAccount()) return;
            if (listsLocal !== before && listsLocal?.pending.length) {
                if (result.revision !== listsLocal.base.revision) { const error = new Error('取得中に別の人が更新しました。端末の編集は保持しています。'); error.code = 'LISTS_CONFLICT'; throw error; }
            } else if (!result.unchanged) save(ListsLocal.create(result));
        }
        HubSync.mark(scope(), 'lists', startedAt); byId('discardButton').hidden = true; render(); localStatus();
    } catch (error) { BudgetSpaces.handleError(error); message('同期できませんでした。端末の変更は保持しています。' + error.message, 'error'); byId('discardButton').hidden = error.code !== 'LISTS_CONFLICT'; }
    finally { listsBusy = false; listsSyncMode = null; controls(); }
}
byId('itemKind').addEventListener('change', kindFields);
byId('itemForm').addEventListener('submit', event => {
    event.preventDefault();
    try { mutate({ type: 'itemSave', value: { id: byId('itemId').value, kind: byId('itemKind').value, title: byId('itemTitle').value, note: byId('itemNote').value, done: byId('itemDone').checked, dueDate: byId('itemDue').value, url: byId('itemUrl').value.trim() } }); byId('itemDialog').close(); byId(byId('itemKind').value + 'Add').focus({ preventScroll: true }); }
    catch (error) { byId('itemError').textContent = error.message; }
});
byId('itemCancel').addEventListener('click', () => { byId('itemDialog').close(); byId(byId('itemKind').value + 'Add').focus({ preventScroll: true }); });
for (const kind of ['todo', 'wish']) { byId(kind + 'Add').addEventListener('click', () => edit(kind)); byId(kind + 'More').addEventListener('click', () => { limits[kind] += 50; render(); }); }
for (const id of ['search', 'filter']) byId(id).addEventListener(id === 'search' ? 'input' : 'change', () => { limits.todo = limits.wish = 50; render(); });
byId('syncButton').addEventListener('click', sync);
byId('reloadButton').addEventListener('click', () => location.reload());
byId('discardButton').addEventListener('click', async () => {
    if (!listsBusy && confirm('このリストの未同期変更を破棄して再取得します。必要なら先にバックアップしてください。続けますか？')) {
        try { save(ListsLocal.create(listsLocal.base)); await sync(); } catch (error) { message(error.message, 'error'); }
    }
});
byId('exportButton').addEventListener('click', () => {
    if (!listsLocal) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), items: ListsLocal.view(listsLocal).items }, null, 2)], { type: 'application/json' }));
    const link = element('a'); link.href = url; link.download = 'personal-hub-lists-' + today() + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
byId('logoutButton').addEventListener('click', async () => { try { await HubAuth.signOut(listsSession); } catch (error) { /* 共通認証が端末側を解除する */ } });
window.addEventListener('storage', event => { if (listsSession && (event.key === ListsLocal.key(scope()) || event.key === null)) { stale = true; controls(); byId('reloadButton').hidden = false; message('別タブで変更されました。この画面を開き直してください。', 'error'); } });
window.addEventListener('hub-auth-changed', event => { if (listsSession && event.detail?.token !== listsSession.token) document.documentElement.setAttribute('data-auth-pending', ''); });
window.addEventListener('focus', render);
(async () => {
    listsSession = await HubAuth.ready; if (!listsSession) return;
    BudgetSpaces.bind(listsSession); BudgetSpaces.mount(listsSession); document.documentElement.removeAttribute('data-auth-pending');
    if (!BudgetSpaces.allowed()) { controls(); return; }
    try { listsLocal = ListsLocal.read(localStorage, scope()); savedRaw = localStorage.getItem(ListsLocal.key(scope())); if (listsLocal) { render(); localStatus(); } }
    catch (error) { stale = true; message(error.message, 'error'); controls(); return; }
    controls(); if (HubSync.needed(scope(), 'lists', !!listsLocal)) await sync();
})();
