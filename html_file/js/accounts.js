const ACCOUNT_API_URL = 'https://script.google.com/macros/s/AKfycbyXRNKLdzWdJAc5iJEfp1hAEbScOERyGboIJZD8hZFprfPo7g57Ip3BjddtiHRdWwyB/exec';
let authSession = null;
const libraryPager = { limit: 50, loading: false, generation: 0, observer: null };
let librarySync = null;

function resetLibraryPager() {
    libraryPager.generation++;
    libraryPager.limit = 50;
    libraryPager.loading = false;
    if (libraryPager.observer) libraryPager.observer.disconnect();
}

function resetLocalView() {
    libraryPager.limit = 50;
    document.getElementById('video-container').scrollTop = 0;
}

async function reloadLibrary() {
    if (!authSession) return;
    if (librarySync && librarySync.session === authSession && librarySync.generation === libraryPager.generation) return librarySync.promise;
    const session = authSession, generation = libraryPager.generation;
    const sync = { session, generation };
    sync.promise = (async () => {
        libraryPager.loading = true;
        setSyncStatus('同期中…');
        try {
            await migrateLocalWatched(session);
            await flushWatched(session);
            const data = await accountApi('syncLibrary', {}, session);
            if (session !== authSession || generation !== libraryPager.generation) return false;
            const pending = pendingWatched(session);
            const state = validateState({ ...appState, channels: data.channels, videos: data.videos.map(v => ({
                ...v, watched: Object.hasOwn(pending, v.id) ? pending[v.id].watched : v.watched
            })) });
            appState = state;
            libraryPager.limit = 50;
            save(); renderChannels(); renderVideos();
            setSyncStatus(Object.keys(pending).length ? 'ローカルに保存済み・次回同期時に送信' : '同期済み');
            return true;
        } catch (error) {
            if (session === authSession && generation === libraryPager.generation) {
                setSyncStatus('同期できませんでした。ローカルの情報を表示しています。');
                showNotification(error.message, 'error');
            }
            return false;
        } finally {
            if (librarySync === sync) { libraryPager.loading = false; librarySync = null; }
        }
    })();
    librarySync = sync;
    return sync.promise;
}

function setSyncStatus(message) {
    const status = document.getElementById('syncStatus');
    if (status) status.textContent = message;
}

function pendingWatched(session = authSession) {
    if (!session) return {};
    return JSON.parse(localStorage.getItem('yt_rss_pending_watched:' + session.userId) || '{}');
}

async function flushWatched(session) {
    const changes = Object.values(pendingWatched(session));
    for (let start = 0; start < changes.length; start += 100) {
        const batch = changes.slice(start, start + 100);
        await accountApi('setWatchedBatch', { videos: batch }, session);
        const remaining = pendingWatched(session);
        batch.forEach(v => { if (remaining[v.id] && remaining[v.id].watched === v.watched) delete remaining[v.id]; });
        localStorage.setItem('yt_rss_pending_watched:' + session.userId, JSON.stringify(remaining));
    }
}

async function restoreAccount(state, report) {
    const session = authSession;
    await flushWatched(session);
    resetLibraryPager();
    // 件数とJSONの長さの両方で分割し、GASのリクエスト上限を超えないようにする
    for (const type of ['channels', 'videos']) {
        let batch = [], done = 0;
        const send = async () => {
            if (!batch.length) return;
            if (authSession !== session) throw new Error('アカウントが切り替わりました。');
            const payload = { channels: [], videos: [], [type]: batch };
            await accountApi('restoreBatch', payload, session);
            done += batch.length;
            report((type === 'channels' ? 'チャンネル' : '動画') + 'を保存中：' + done + ' / ' + state[type].length + '件');
            batch = [];
        };
        for (const item of state[type]) {
            if (JSON.stringify(item).length > 17000) throw new Error('1件のデータが大きすぎるため復元できません。');
            if (batch.length >= 30 || JSON.stringify([...batch, item]).length > 17500) await send();
            batch.push(item);
        }
        await send();
    }
    localStorage.setItem('yt_rss_watched_migrated:' + session.userId, '1');
}

async function migrateLocalWatched(session) {
    const marker = 'yt_rss_watched_migrated:' + session.userId;
    if (localStorage.getItem(marker)) return;
    const raw = localStorage.getItem('yt_rss_user:' + session.userId);
    if (raw) {
        let previous;
        try { previous = validateState(JSON.parse(raw)); }
        catch (error) { return; }
        for (let start = 0; start < previous.videos.length; start += 100) {
            const videos = previous.videos.slice(start, start + 100).map(v => ({ id: v.id, channelId: v.channelId, watched: v.watched }));
            await accountApi('migrateWatched', { videos }, session);
        }
    }
    localStorage.setItem(marker, '1');
}

// 全件キャッシュを使い、バックアップ時にも通信を発生させない
async function accountBackup() {
    return appState;
}

async function loadLibraryPage(first = false) {
    libraryPager.limit = first ? 50 : libraryPager.limit + 50;
    renderVideos();
}

function renderLibrarySentinel(container) {
    if (libraryPager.observer) libraryPager.observer.disconnect();
    if (getDisplayVideos().length <= libraryPager.limit) return;
    const button = document.createElement('button');
    button.className = 'load-more btn-utility';
    button.textContent = '次の50件を表示';
    button.addEventListener('click', () => loadLibraryPage());
    container.appendChild(button);
    {
        libraryPager.observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) loadLibraryPage();
        }, { root: matchMedia('(max-width: 760px)').matches ? null : container, rootMargin: '100px' });
        libraryPager.observer.observe(button);
    }
}

function syncWatched(video, previous) {
    try {
        const pending = pendingWatched();
        pending[video.id] = { id: video.id, channelId: video.channelId, watched: video.watched };
        localStorage.setItem('yt_rss_pending_watched:' + authSession.userId, JSON.stringify(pending));
        setSyncStatus('ローカルに保存済み・次回同期時に送信');
    } catch (error) {
        video.watched = previous;
        showNotification('既読状態をローカルに保存できませんでした。', 'error');
    }
}

// パスワードは保存せず、認証セッションだけをタブ内に保持する
function initAccount() {
    try {
        const saved = JSON.parse(sessionStorage.getItem('yt_rss_session') || 'null');
        if (saved && typeof saved.userId === 'string' && /^[a-f0-9]{64}$/.test(saved.token) && saved.expiresAt > Date.now()) authSession = saved;
        else sessionStorage.removeItem('yt_rss_session');
    } catch (error) { authSession = null; }
    renderAccount();
}

function accountStorageKey() {
    return authSession ? 'yt_rss_user:' + authSession.userId : 'yt_v5_final';
}

function renderAccount(message) {
    document.getElementById('accountStatus').textContent = message || (authSession ? authSession.userId + ' としてログイン中' : 'ログインしていません');
    document.getElementById('accountForm').hidden = !!authSession;
    document.getElementById('logoutButton').hidden = !authSession;
}

function randomToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function accountApi(action, params = {}, session = authSession) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
        // text/plainにしてGASが扱わないプリフライトを避ける。認証情報はURLに載せない
        const response = await fetch(ACCOUNT_API_URL, {
            method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ ...params, action, token: session ? session.token : undefined }),
            signal: controller.signal, credentials: 'omit', redirect: 'follow'
        });
        if (!response.ok) throw new Error('サーバーに接続できませんでした。');
        let result;
        try { result = await response.json(); }
        catch (error) { throw new Error('GASの更新と初期設定が必要です。'); }
        if (result.status !== 'ok') {
            if (result.code === 'AUTH_EXPIRED' && session === authSession) {
                sessionStorage.removeItem('yt_rss_session');
                resetLibraryPager();
                authSession = null;
                appState = { channels: [], videos: [], darkMode: appState.darkMode, selectedChannel: 'all', unreadOnly: false };
                load(); renderAccount('セッションが切れました。ログインし直してください。');
            }
            throw new Error(result.message || '処理に失敗しました。');
        }
        return result;
    } finally { clearTimeout(timeout); }
}

async function signIn(action) {
    if (busy) return;
    const form = document.getElementById('accountForm');
    if (!form.reportValidity()) return;
    busy = true;
    const passwordInput = document.getElementById('passwordInput');
    renderAccount('接続中…');
    try {
        const token = randomToken();
        const result = await accountApi(action, {
            userId: document.getElementById('userIdInput').value.trim(), password: passwordInput.value,
            newToken: token, salt: randomToken().slice(0, 32)
        }, null);
        const session = { userId: result.userId, token, expiresAt: result.expiresAt };
        sessionStorage.setItem('yt_rss_session', JSON.stringify(session));
        authSession = session;
        resetLibraryPager();
        appState = { channels: [], videos: [], darkMode: appState.darkMode, selectedChannel: 'all', unreadOnly: false };
        load(); renderAccount();
        await reloadLibrary();
    } catch (error) { renderAccount(error.message); }
    finally { passwordInput.value = ''; busy = false; }
}

async function signOut() {
    if (busy) return;
    busy = true;
    try {
        await flushWatched(authSession);
        await accountApi('logout');
        sessionStorage.removeItem('yt_rss_session');
        authSession = null;
        resetLibraryPager();
        appState = { channels: [], videos: [], darkMode: appState.darkMode, selectedChannel: 'all', unreadOnly: false };
        load(); renderAccount();
    } catch (error) { renderAccount(error.message); }
    finally { busy = false; }
}
