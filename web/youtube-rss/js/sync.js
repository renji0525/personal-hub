let authSession = null;
const libraryPager = { limit: 50, loading: false, generation: 0, observer: null };
let librarySync = null;
const rssAutoPush = window.HubSync?.autoPush(() => reloadLibrary(false), () => !busy && !librarySync && !!authSession &&
    (Object.keys(pendingChannels()).length > 0 || Object.keys(pendingWatched()).length > 0));

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

async function reloadLibrary(read = true) {
    if (!authSession) return;
    if (librarySync && librarySync.session === authSession) return librarySync.promise;
    rssAutoPush?.start();
    const session = authSession, generation = libraryPager.generation, syncStartedAt = Date.now();
    const sync = { session, generation };
    sync.promise = (async () => {
        libraryPager.loading = true;
        const button = document.getElementById('syncButton');
        if (button) button.disabled = true;
        setSyncStatus('同期中…');
        try {
            const watchedAtStart = Object.values(pendingWatched(session));
            const channelChanges = Object.values(pendingChannels(session));
            if (read) await migrateLocalWatched(session);
            const hasChannels = channelChanges.length > 0;
            if (!read && !hasChannels) {
                await flushWatched(session, false, watchedAtStart);
                if (session === authSession) updateRssSyncStatus();
                return true;
            }
            const changes = await flushWatched(session, true, watchedAtStart);
            const channelResult = hasChannels ? await flushChannels(session, channelChanges, changes) : null;
            const allChannelsSaved = channelResult?.complete ?? true;
            const data = channelResult ? channelResult.library : await accountApi('syncLibrary', changes.length ? { watched: changes } : {}, session);
            if (data.watchedSaved) acknowledgeWatched(session, changes);
            if (session !== authSession || generation !== libraryPager.generation) return false;
            const pending = pendingWatched(session);
            const state = validateState({ ...appState, channels: data.channels, videos: data.videos.map(v => ({
                ...v, watched: Object.hasOwn(pending, v.id) ? pending[v.id].watched : v.watched
            })) });
            appState = applyPendingChannels(state, session);
            libraryPager.limit = 50;
            save(); renderChannels(); renderVideos();
            if (allChannelsSaved) updateRssSyncStatus();
            else setSyncStatus('一部のチャンネルを同期できませんでした。変更は端末に残っています。');
            if (read) window.HubSync?.mark(session.userId, 'rss', syncStartedAt);
            return allChannelsSaved;
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
                rssAutoPush?.finish();
            }
        }
    })();
    librarySync = sync;
    return sync.promise;
}

function pendingChannels(session = authSession) {
    return session ? JSON.parse(localStorage.getItem('yt_rss_pending_channels:' + session.userId) || '{}') : {};
}

function queueChannel(channelId, subscribed) {
    const pending = pendingChannels();
    pending[channelId] = { channelId, subscribed, id: crypto.randomUUID() };
    localStorage.setItem('yt_rss_pending_channels:' + authSession.userId, JSON.stringify(pending));
    updateRssSyncStatus();
    rssAutoPush?.schedule();
}

function applyPendingChannels(state, session = authSession) {
    const pending = pendingChannels(session);
    const channels = state.channels.filter(channel => pending[channel.id]?.subscribed !== false);
    for (const change of Object.values(pending)) {
        if (change.subscribed && !channels.some(channel => channel.id === change.channelId))
            channels.push({ id: change.channelId, title: 'Channel(' + change.channelId.slice(0, 6) + ')' });
    }
    return { ...state, channels, videos: state.videos.filter(video => pending[video.channelId]?.subscribed !== false) };
}

function updateRssSyncStatus() {
    const pending = Object.keys(pendingChannels()).length + Object.keys(pendingWatched()).length;
    setSyncStatus(pending ? '端末に保存済み・未同期 ' + pending + '件' : '同期済み');
}

async function flushChannels(session, changes, watchedChanges) {
    const key = 'yt_rss_pending_channels:' + session.userId;
    let complete = true, library;
    for (let start = 0; start < changes.length; start += 10) {
        if (session !== authSession) throw new Error('アカウントが切り替わりました。');
        const batch = changes.slice(start, start + 10);
        const last = start + batch.length === changes.length;
        const result = await accountApi('rssChannelsSync', {
            channels: batch.map(({ channelId, subscribed }) => ({ channelId, subscribed })),
            ...(last ? { includeLibrary: true, watched: watchedChanges } : {})
        }, session);
        if (!Array.isArray(result.saved)) throw new Error('チャンネルの同期結果を確認できませんでした。');
        const saved = new Set(result.saved), remaining = pendingChannels(session);
        const watched = pendingWatched(session);
        for (const change of batch) {
            if (!saved.has(change.channelId)) { complete = false; continue; }
            if (remaining[change.channelId]?.id !== change.id) continue;
            delete remaining[change.channelId];
            if (!change.subscribed) {
                for (const id of Object.keys(watched)) if (watched[id].channelId === change.channelId) delete watched[id];
            }
        }
        localStorage.setItem('yt_rss_pending_watched:' + session.userId, JSON.stringify(watched));
        localStorage.setItem(key, JSON.stringify(remaining));
        if (last) library = result;
    }
    return { complete, library };
}

function setSyncStatus(message) {
    const status = document.getElementById('syncStatus');
    if (status) {
        status.textContent = message;
            if (status.dataset) status.dataset.state = message.includes('できません') ? 'error' : message === '同期中…' ? 'syncing' : message.includes('未同期') ? 'pending' : 'ready';
    }
}

function pendingWatched(session = authSession) {
    if (!session) return {};
    return JSON.parse(localStorage.getItem('yt_rss_pending_watched:' + session.userId) || '{}');
}

function acknowledgeWatched(session, batch) {
    const remaining = pendingWatched(session);
    batch.forEach(v => {
        if (remaining[v.id]?.watched === v.watched && remaining[v.id]?.operationId === v.operationId) delete remaining[v.id];
    });
    localStorage.setItem('yt_rss_pending_watched:' + session.userId, JSON.stringify(remaining));
}

async function flushWatched(session, keepLastBatch = false, changes = Object.values(pendingWatched(session))) {
    for (let start = 0; start < changes.length; start += 100) {
        const batch = changes.slice(start, start + 100);
        // 最後の100件以下は一覧取得と同時に送信する
        if (keepLastBatch && start + 100 >= changes.length) return batch;
        await accountApi('setWatchedBatch', { videos: batch }, session);
        acknowledgeWatched(session, batch);
    }
    return [];
}

async function restoreAccount(state, report) {
    const session = authSession;
    if (librarySync) await librarySync.promise;
    if (session !== authSession) throw new Error('アカウントが切り替わりました。');
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

async function loadLibraryPage(first = false) {
    libraryPager.limit = first ? 50 : libraryPager.limit + 50;
    renderVideos(!first);
}

function renderLibrarySentinel(container, total = getDisplayVideos().length) {
    if (libraryPager.observer) libraryPager.observer.disconnect();
    if (total <= libraryPager.limit) return;
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
        pending[video.id] = { id: video.id, channelId: video.channelId, watched: video.watched, operationId: crypto.randomUUID() };
        localStorage.setItem('yt_rss_pending_watched:' + authSession.userId, JSON.stringify(pending));
        updateRssSyncStatus();
        rssAutoPush?.schedule();
    } catch (error) {
        video.watched = previous;
        showNotification('既読状態をローカルに保存できませんでした。', 'error');
    }
}

// 端末の認証期限を確認後に表示し、同期APIでサーバー認証する
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
        // 未送信既読は端末に保持し、次回ログイン後の同期で送る
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
