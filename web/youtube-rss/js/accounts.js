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

async function manualSync() {
    if (!authSession) {
        showNotification('トップページからログインしてください。', 'error');
        return;
    }
    await withBusy(() => reloadLibrary());
}

async function reloadLibrary() {
    if (!authSession) return;
    if (librarySync && librarySync.session === authSession && librarySync.generation === libraryPager.generation) return librarySync.promise;
    const session = authSession, generation = libraryPager.generation;
    const sync = { session, generation };
    sync.promise = (async () => {
        libraryPager.loading = true;
        const button = document.getElementById('syncButton');
        if (button) button.disabled = true;
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
            if (librarySync === sync) {
                libraryPager.loading = false;
                librarySync = null;
                if (button) button.disabled = false;
            }
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

// 共通認証の確認が終わるまでユーザーのデータを描画しない
async function initAccount() {
    authSession = await HubAuth.ready;
    if (!authSession) return false;
    return true;
}

function accountStorageKey() {
    return authSession ? 'yt_rss_user:' + authSession.userId : 'yt_v5_final';
}

async function accountApi(action, params = {}, session = authSession) {
    return HubAuth.api(action, params, session);
}

async function signOut() {
    if (busy || !authSession) return;
    busy = true;
    const session = authSession;
    try {
        // 未送信既読はキューに残し、同期失敗時もログアウトを優先する
        try { await flushWatched(session); }
        catch (error) { showNotification('未送信の既読は次回ログイン時に同期します。', 'error'); }
        await HubAuth.signOut(session);
    } catch (error) { showNotification(error.message, 'error'); }
    finally { busy = false; }
}

window.addEventListener('hub-auth-changed', event => {
    if (!event.detail || authSession && event.detail.token !== authSession.token) {
        authSession = null;
        resetLibraryPager();
        appState = { channels: [], videos: [], darkMode: appState.darkMode, selectedChannel: 'all', unreadOnly: false };
    }
});
