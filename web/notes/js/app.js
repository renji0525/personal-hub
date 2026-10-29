// メモはリストの保存・同期基盤を再利用し、データと同期履歴を独立させる
const byId = id => document.getElementById(id);
let listsSession, listsLocal, listsBusy = false, listsSyncMode = null, savedRaw = null, stale = false, limit = 50;
const scope = () => 'notes:' + BudgetSpaces.storageUser(listsSession.userId);
const sameAccount = () => listsSession && HubAuth.read()?.token === listsSession.token && BudgetSpaces.allowed() && !stale;
function message(text, state = 'ready') { byId('status').textContent = text; byId('status').dataset.state = state; }
function controls() {
    const locked = !listsLocal || listsSyncMode === 'write' || !sameAccount();
    document.querySelectorAll('[data-edit], .note-card button').forEach(node => { node.disabled = locked; });
    byId('syncButton').disabled = listsBusy || !sameAccount(); byId('syncButton').setAttribute('aria-busy', String(listsBusy));
    byId('discardButton').disabled = listsBusy || !sameAccount(); byId('exportButton').disabled = !listsLocal; byId('logoutButton').disabled = listsSyncMode === 'write';
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
    const all = ListsLocal.view(listsLocal).items.filter(item => item.kind === 'note'), query = byId('search').value.trim().toLocaleLowerCase();
    const notes = all.filter(item => (item.title + ' ' + item.note).toLocaleLowerCase().includes(query)).reverse();
    const container = byId('notes'); container.replaceChildren();
    byId('noteCount').textContent = query ? '検索結果 ' + notes.length + '件 / 全' + all.length + '件' : all.length + '件のメモ';
    for (const value of notes.slice(0, limit)) {
        const card = element('article', undefined, 'note-card'); card.dataset.id = value.id;
        card.append(element('h2', value.title), element('p', value.note, 'note-body'));
        const actions = element('div', undefined, 'actions');
        for (const [label, action] of [['編集', () => edit(value)], ['削除', () => { if (confirm('「' + value.title + '」を削除しますか？')) mutate({ type: 'itemDelete', id: value.id }); }]]) {
            const button = element('button', label, 'quiet'); button.type = 'button'; button.addEventListener('click', () => { try { action(); } catch (error) { message(error.message, 'error'); } }); actions.append(button);
        }
        card.append(actions); container.append(card);
    }
    if (!notes.length) container.append(element('p', query ? '条件に合うメモはありません。' : '気になったことを、ひとこと残してみましょう。', 'empty'));
    byId('moreButton').hidden = notes.length <= limit; controls();
}
function edit(value) {
    byId('noteForm').reset(); byId('noteError').textContent = ''; byId('noteId').value = value?.id || crypto.randomUUID();
    byId('noteTitle').value = value?.title || ''; byId('noteBody').value = value?.note || '';
    byId('noteDialogTitle').textContent = value ? 'メモを編集' : 'メモを書く';
    byId('noteDialog').showModal(); byId('noteBody').focus();
}
async function sync() {
    if (listsBusy || !sameAccount()) return;
    const startedAt = Date.now(); listsSyncMode = listsLocal?.pending.length ? 'write' : 'read'; listsBusy = true; controls(); message('同期中…', 'syncing');
    try {
        if (listsLocal?.pending.length) {
            while (listsLocal.pending.length) {
                const packet = ListsLocal.packet(listsLocal); save(packet.local);
                const result = await BudgetSpaces.api('notesSync', packet.request, listsSession);
                if (!sameAccount()) return;
                save(ListsLocal.ack(listsLocal, result, packet.request.operations.length));
            }
        } else {
            const before = listsLocal, result = await BudgetSpaces.api('notesLoad', before ? { knownRevision: before.base.revision } : {}, listsSession);
            if (!sameAccount()) return;
            if (listsLocal !== before && listsLocal?.pending.length) {
                if (result.revision !== listsLocal.base.revision) { const error = new Error('取得中に別の人が更新しました。端末の編集は保持しています。'); error.code = 'LISTS_CONFLICT'; throw error; }
            } else if (!result.unchanged) save(ListsLocal.create(result));
            if (Array.isArray(result.assignees)) save(ListsLocal.withAssignees(listsLocal, result.assignees));
        }
        HubSync.mark(scope(), 'notes', startedAt); byId('discardButton').hidden = true; render(); localStatus();
    } catch (error) { BudgetSpaces.handleError(error); message('同期できませんでした。端末の変更は保持しています。' + error.message, 'error'); byId('discardButton').hidden = error.code !== 'LISTS_CONFLICT'; }
    finally { listsBusy = false; listsSyncMode = null; controls(); }
}
byId('addNote').addEventListener('click', () => edit());
byId('noteCancel').addEventListener('click', () => { byId('noteDialog').close(); byId('addNote').focus({ preventScroll: true }); });
byId('noteForm').addEventListener('submit', event => {
    event.preventDefault();
    try { mutate({ type: 'itemSave', value: { id: byId('noteId').value, kind: 'note', title: byId('noteTitle').value, note: byId('noteBody').value, done: false, dueDate: '', url: '', assignee: '' } }); byId('noteDialog').close(); byId('addNote').focus({ preventScroll: true }); }
    catch (error) { byId('noteError').textContent = error.message; }
});
byId('search').addEventListener('input', () => { limit = 50; render(); });
byId('moreButton').addEventListener('click', () => { limit += 50; render(); });
byId('syncButton').addEventListener('click', sync);
byId('reloadButton').addEventListener('click', () => location.reload());
byId('discardButton').addEventListener('click', async () => {
    if (!listsBusy && confirm('この保存先のメモの未同期変更をすべて破棄して再取得します。必要なら先にバックアップしてください。続けますか？')) {
        try { save(ListsLocal.create(listsLocal.base)); await sync(); } catch (error) { message(error.message, 'error'); }
    }
});
byId('exportButton').addEventListener('click', () => {
    if (!listsLocal) return;
    // 未同期のメモもバックアップへ含める
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), items: ListsLocal.view(listsLocal).items }, null, 2)], { type: 'application/json' }));
    const link = element('a'); link.href = url; link.download = 'personal-hub-notes-' + new Date().toISOString().slice(0, 10) + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
byId('logoutButton').addEventListener('click', async () => { try { await HubAuth.signOut(listsSession); } catch (error) { /* 共通認証が端末側を解除する */ } });
window.addEventListener('storage', event => { if (listsSession && (event.key === ListsLocal.key(scope()) || event.key === null)) { stale = true; controls(); byId('reloadButton').hidden = false; message('別タブで変更されました。この画面を開き直してください。', 'error'); } });
window.addEventListener('hub-auth-changed', event => { if (listsSession && event.detail?.token !== listsSession.token) document.documentElement.setAttribute('data-auth-pending', ''); });
(async () => {
    listsSession = await HubAuth.ready; if (!listsSession) return;
    BudgetSpaces.bind(listsSession, 'notes'); BudgetSpaces.mount(listsSession); document.documentElement.removeAttribute('data-auth-pending');
    if (!BudgetSpaces.allowed()) { controls(); return; }
    try { listsLocal = ListsLocal.read(localStorage, scope()); savedRaw = localStorage.getItem(ListsLocal.key(scope())); if (listsLocal) { render(); localStatus(); } }
    catch (error) { stale = true; message(error.message, 'error'); controls(); return; }
    controls(); if (HubSync.needed(scope(), 'notes', !!listsLocal)) await sync();
})();
