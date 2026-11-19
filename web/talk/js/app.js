// 送信待ち・下書き・既読は利用者とルームごとに端末へ保存する
const byId = id => document.getElementById(id);
let listsSession, listsBusy = false, local = null, raw = null, stale = false, limit = 100;
let readState = { read: [], viewed: [] };
const scope = () => BudgetSpaces.storageUser(listsSession.userId);
const key = () => 'personal_hub_talk_v1:' + scope();
const readKey = () => key() + ':read';
const draftKey = () => key() + ':draft';
const sameAccount = () => listsSession && HubAuth.read()?.token === listsSession.token && BudgetSpaces.allowed() && !stale;
const autoPush = HubSync.autoPush(sync, () => sameAccount() && !listsBusy && !!local?.pending.length);
const dateLabel = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
function status(text, state = 'ready') {
    byId('status').textContent = text; byId('status').dataset.state = state;
}
function controls() {
    const locked = !local || !sameAccount();
    byId('messageText').disabled = byId('sendButton').disabled = locked;
    byId('syncButton').disabled = listsBusy || !sameAccount();
    byId('syncButton').setAttribute('aria-busy', String(listsBusy));
}
function save(value) {
    if (!sameAccount()) throw new Error('この画面を開き直してください。');
    if (localStorage.getItem(key()) !== raw) throw new Error('別タブで変更されました。画面を開き直してください。');
    const next = JSON.stringify(value);
    localStorage.setItem(key(), next); raw = next; local = value;
}
function loadRead() {
    const value = JSON.parse(localStorage.getItem(readKey()) || '{"read":[],"viewed":[]}');
    if (!Array.isArray(value.read) || !Array.isArray(value.viewed)) throw new Error('既読情報を確認してください。');
    return value;
}
function advanceRead() {
    const value = loadRead();
    const next = { read: [...new Set([...value.read, ...value.viewed])], viewed: [] };
    localStorage.setItem(readKey(), JSON.stringify(next));
    readState = next;
}
const observer = new IntersectionObserver(entries => {
    if (!sameAccount() || document.visibilityState !== 'visible' || !document.hasFocus()) return;
    try {
        const value = loadRead(), read = new Set(value.read), viewed = new Set(value.viewed);
        for (const entry of entries) {
            if (entry.isIntersecting && !read.has(entry.target.dataset.id)) viewed.add(entry.target.dataset.id);
        }
        localStorage.setItem(readKey(), JSON.stringify({ read: value.read, viewed: [...viewed] }));
    } catch (error) { byId('sendError').textContent = '既読情報を端末に保存できませんでした。'; }
}, { threshold: 0.1, rootMargin: '-70px 0px -180px 0px' });
function element(tag, text, className) {
    const value = document.createElement(tag);
    if (text !== undefined) value.textContent = text;
    if (className) value.className = className;
    return value;
}
function atBottom() {
    return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 240;
}
function render(scroll = false) {
    if (!local || !sameAccount()) return;
    observer.disconnect();
    const container = byId('messages'), messages = TalkModel.view(local);
    const pending = new Set(local.pending.map(value => value.id)), read = new Set(readState.read);
    container.replaceChildren();
    for (const value of messages.slice(-limit)) {
        const mine = value.sender === listsSession.userId;
        const row = element('article', undefined, 'message' + (mine ? ' mine' : ''));
        row.dataset.id = value.id; row.setAttribute('role', 'listitem');
        row.append(element('span', mine ? '自分' : value.sender, 'message-author'), element('p', value.text, 'message-bubble'));
        const meta = element('div', undefined, 'message-meta');
        const time = element('time', dateLabel.format(new Date(value.sentAt)));
        time.dateTime = value.sentAt;
        meta.append(time);
        if (pending.has(value.id)) meta.append(element('span', '送信待ち'));
        else if (!mine) meta.append(element('span', read.has(value.id) ? '既読' : '未読', read.has(value.id) ? '' : 'unread'));
        row.append(meta); container.append(row);
        if (!mine && !pending.has(value.id)) observer.observe(row);
    }
    if (!messages.length) container.append(element('p', 'メッセージはまだありません。', 'empty'));
    byId('moreButton').hidden = messages.length <= limit;
    controls();
    if (scroll) {
        container.lastElementChild?.scrollIntoView({ block: 'center' });
        byId('latestButton').hidden = true;
    }
}
function localStatus() {
    status(local.pending.length ? '端末に保存済み・送信待ち ' + local.pending.length + '件' : '同期済み', local.pending.length ? 'pending' : 'ready');
}
async function sync() {
    if (listsBusy || !sameAccount()) return;
    autoPush.start(); listsBusy = true; controls();
    try {
        advanceRead(); render();
        status('同期中…', 'syncing');
        const beforeIds = new Set(local ? TalkModel.view(local).map(value => value.id) : []);
        const follow = !local || atBottom();
        // 送信中に入力したメッセージは応答後も送信待ちとして残す
        if (local?.pending.length) {
            while (local.pending.length) {
                let sent = local.pending.slice(0, 20);
                while (sent.length > 1 && JSON.stringify(sent).length > 14000) sent = sent.slice(0, -1);
                const result = await BudgetSpaces.api('talkSend', { messages: sent }, listsSession);
                if (!sameAccount()) return;
                save(TalkModel.acknowledge(local, result, sent));
                if (autoPush.waiting()) break;
            }
        } else {
            const before = local;
            const result = await BudgetSpaces.api('talkLoad', before ? { knownRevision: before.revision } : {}, listsSession);
            if (!sameAccount()) return;
            if (!result.unchanged) save({ revision: result.revision, messages: result.messages, pending: local?.pending || [] });
        }
        const incoming = local.messages.some(value => !beforeIds.has(value.id) && value.sender !== listsSession.userId);
        render(follow);
        byId('latestButton').hidden = follow || !incoming;
        HubSync.mark(scope(), 'talk', Date.now()); localStatus();
    } catch (error) {
        BudgetSpaces.handleError(error);
        status('同期できませんでした。端末の投稿は保持しています。' + error.message, 'error');
    } finally { listsBusy = false; controls(); autoPush.finish(); }
}
byId('composer').addEventListener('submit', event => {
    event.preventDefault();
    if (!local || !sameAccount()) return;
    try {
        const value = TalkModel.message({ id: crypto.randomUUID(), sender: listsSession.userId,
            text: byId('messageText').value, sentAt: new Date().toISOString() });
        save({ ...local, pending: [...local.pending, value] });
        byId('messageText').value = '';
        localStorage.removeItem(draftKey());
        byId('sendError').textContent = '';
        autoPush.schedule(); render(true); localStatus(); byId('messageText').focus({ preventScroll: true });
    } catch (error) { byId('sendError').textContent = error.message; }
});
byId('messageText').addEventListener('input', () => {
    if (!sameAccount()) return;
    try { localStorage.setItem(draftKey(), byId('messageText').value); }
    catch (error) { byId('sendError').textContent = '下書きを端末に保存できませんでした。'; }
});
byId('syncButton').addEventListener('click', sync);
byId('reloadButton').addEventListener('click', () => location.reload());
byId('moreButton').addEventListener('click', () => {
    const first = byId('messages').firstElementChild;
    const id = first?.dataset.id, top = first?.getBoundingClientRect().top || 0;
    limit += 100; render();
    const anchor = [...byId('messages').children].find(node => node.dataset.id === id);
    if (anchor) window.scrollBy(0, anchor.getBoundingClientRect().top - top);
});
byId('latestButton').addEventListener('click', () => render(true));
byId('logoutButton').addEventListener('click', async () => { try { await HubAuth.signOut(listsSession); } catch (error) { /* 共通認証が端末を解除する */ } });
window.addEventListener('storage', event => {
    if (listsSession && (event.key === key() || event.key === null)) {
        stale = true; observer.disconnect(); controls(); byId('reloadButton').hidden = false;
        status('別タブで変更されました。画面を開き直してください。', 'error');
    }
});
window.addEventListener('hub-auth-changed', event => {
    if (listsSession && event.detail?.token !== listsSession.token) {
        observer.disconnect(); document.documentElement.setAttribute('data-auth-pending', '');
    }
});
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && local && sameAccount()) sync();
});
// 表示中のトークは15秒間隔で取得し、非表示中と通信中は次回へ回す
setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine && local) sync(); }, 15000);
(async () => {
    listsSession = await HubAuth.ready;
    if (!listsSession) return;
    BudgetSpaces.bind(listsSession, 'talk'); BudgetSpaces.mount(listsSession);
    document.documentElement.removeAttribute('data-auth-pending');
    if (!BudgetSpaces.allowed()) { controls(); return; }
    try {
        advanceRead();
        raw = localStorage.getItem(key());
        local = raw ? JSON.parse(raw) : { revision: 0, messages: [], pending: [] };
        if (!Number.isSafeInteger(local.revision) || !Array.isArray(local.messages) || !Array.isArray(local.pending)) throw new Error('端末の投稿情報を確認してください。');
        local.messages.forEach(TalkModel.message); local.pending.forEach(TalkModel.message);
        byId('messageText').value = localStorage.getItem(draftKey()) || '';
        render(true); controls();
        await sync();
    } catch (error) { stale = true; controls(); status(error.message, 'error'); }
})();
