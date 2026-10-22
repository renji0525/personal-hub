/**
 * アプリケーションの全体状態（ステート）
 * チャンネル、動画リスト、設定をまとめて管理し、LocalStorageに保存する対象となります。
 */
const publishedFormatter = new Intl.DateTimeFormat();
let appState = {
    channels: [],       // 登録されたチャンネル情報 {id, title}
    videos: [],         // 取得した動画の全リスト
    darkMode: true,     // ダークモードの設定状態
    selectedChannel: 'all', // 現在表示しているフィルタ（'all' または チャンネルID）
    unreadOnly: false      // 未読動画だけを表示するか
};

/**
 * 通知表示機能（スタック対応）
 * 画面右下にメッセージを表示します。連続して呼ばれた場合は上に積み重なります。
 * @param {string} message - 表示する文字列
 * @param {string} type - 'success'(緑), 'error'(赤), 'info'(青)
 * @param {number} waitTime - 自動で消えるまでの時間(ms)
 */
function showNotification(message, type=`info`, waitTime=3000) {
    const notify = document.createElement('div');
    notify.className = 'notification-toast'; // スタイリングと重なり判定用のクラス

    // --- スタック計算ロジック ---
    // 既存の通知を数えて、新しい通知の「底(bottom)」の位置をずらす
    const existingNotifications = document.querySelectorAll('.notification-toast');
    const offsetGap = 60; // 1つあたりの高さ＋余白
    const bottomPosition = 20 + (existingNotifications.length * offsetGap);

    const colors = {
        success: '#4caf50', // 緑
        error:   '#f04b4b', // 赤
        info:    `#2196f3`  // 青
    };
    const bgColor = colors[type] || colors.error;

    // スタイルを動的に適用
    notify.style.cssText = `
        position:fixed;
        bottom:${bottomPosition}px;
        right:20px;
        background:${bgColor};
        color:white;
        padding:12px 24px;
        border-radius:8px;
        box-shadow:0 4px 12px rgba(0,0,0,0.3);
        z-index:9999;
        font-size:14px;
        animation:slideIn 0.3s ease-out;
        transition: bottom 0.3s ease;
    `;
    notify.textContent = message;
    document.body.appendChild(notify);

    // 一定時間後にアニメーションさせてから要素を削除する
    setTimeout(() => {
        notify.style.animation = 'slideOut 0.3s ease-in forwards';
        setTimeout(() => {
            notify.remove();
            repositionNotifications(); // 消えた後に残った通知を下に詰める
        }, 300);
    }, waitTime);
}

/**
 * 通知が消えた後に、画面に残っている通知を下に詰める処理
 */
function repositionNotifications() {
    const notifications = document.querySelectorAll('.notification-toast');
    const offsetGap = 60;
    notifications.forEach((el, index) => {
        el.style.bottom = `${20 + (index * offsetGap)}px`;
    });
}

/**
 * データの永続化（保存）
 * 現在の appState を JSON文字列にして LocalStorage に書き込みます。
 */
function preferenceKey() { return (typeof accountStorageKey === 'function' ? accountStorageKey() : 'yt_v5_final') + ':preferences'; }
function savePreferences() {
    try {
        const { darkMode, selectedChannel, unreadOnly } = appState;
        localStorage.setItem(preferenceKey(), JSON.stringify({ darkMode, selectedChannel, unreadOnly }));
    } catch (error) { showNotification('表示設定を保存できませんでした。', 'error'); }
}
function save() {
    try {
        localStorage.setItem(typeof accountStorageKey === 'function' ? accountStorageKey() : 'yt_v5_final', JSON.stringify(appState));
        localStorage.removeItem(preferenceKey());
        return true;
    } catch (error) {
        showNotification('データを保存できません。JSONでバックアップしてください。', 'error');
        return false;
    }
}

function safeURL(value) {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('無効なURLです');
    return url.href;
}

function videoId(value) {
    const url = new URL(safeURL(value));
    const host = url.hostname.toLowerCase();
    if (host === 'youtu.be') return url.pathname.split('/')[1];
    if (host !== 'youtube.com' && !host.endsWith('.youtube.com')) throw new Error('YouTubeのURLではありません');
    return url.searchParams.get('v') || (/^\/(shorts|embed|live)\//.test(url.pathname) ? url.pathname.split('/')[2] : null);
}

function validateState(state) {
    const fail = () => { throw new Error('データの形式が正しくありません'); };
    if (!state || !Array.isArray(state.channels) || !Array.isArray(state.videos) ||
        typeof state.darkMode !== 'boolean' || typeof state.selectedChannel !== 'string') fail();
    if (state.unreadOnly !== undefined && typeof state.unreadOnly !== 'boolean') fail();
    const channels = state.channels.map(c => {
        if (!c || typeof c.id !== 'string' || !c.id || typeof c.title !== 'string') fail();
        return { id: c.id, title: c.title };
    });
    const channelIds = new Set(channels.map(c => c.id));
    if (channelIds.size !== channels.length) fail();
    const videos = state.videos.map(v => {
        if (!v || !['channelId', 'channelName', 'title', 'thumb', 'url', 'published'].every(k => typeof v[k] === 'string') ||
            typeof v.watched !== 'boolean' || !Number.isFinite(Date.parse(v.published)) ||
            !channelIds.has(v.channelId)) fail();
        const urlId = videoId(v.url);
        if (!urlId) fail();
        // 旧バックアップではShortsの動画IDが欠けるため、URLから補完する
        const id = v.id === undefined || v.id === null || v.id === '' ? urlId : v.id;
        if (typeof id !== 'string') fail();
        safeURL(v.thumb);
        return { id, channelId: v.channelId, channelName: v.channelName, title: v.title,
            thumb: v.thumb, url: v.url, published: v.published, watched: v.watched };
    });
    return { channels, videos, darkMode: state.darkMode, unreadOnly: state.unreadOnly ?? false,
        selectedChannel: channels.some(c => c.id === state.selectedChannel) ? state.selectedChannel : 'all' };
}

let busy = false;
async function withBusy(action) {
    if (busy) return;
    busy = true;
    try { await action(); }
    catch (error) { showNotification(error.message, 'error'); }
    finally { busy = false; }
}

/**
 * データの復元（読み込み）
 * ブラウザに保存されているデータを読み込み、UIを初期化します。
 */
function load() {
    try {
        const data = localStorage.getItem(typeof accountStorageKey === 'function' ? accountStorageKey() : 'yt_v5_final');
        if (data) appState = validateState(JSON.parse(data));
        const preferences = JSON.parse(localStorage.getItem(preferenceKey()) || 'null');
        if (preferences) {
            if (typeof preferences.darkMode === 'boolean') appState.darkMode = preferences.darkMode;
            if (typeof preferences.unreadOnly === 'boolean') appState.unreadOnly = preferences.unreadOnly;
            if (preferences.selectedChannel === 'all' || appState.channels.some(c => c.id === preferences.selectedChannel)) appState.selectedChannel = preferences.selectedChannel;
        }
    } catch (error) {
        showNotification('保存データを読み込めません。バックアップから復元してください。', 'error');
    }
    document.body.setAttribute('data-theme', appState.darkMode ? 'dark' : 'light');
    renderChannels();
    renderVideos();
}

/**
 * GAS（Google Apps Script）経由でYouTubeのフィードを取得する
 * @param {string} channelId - YouTubeのチャンネルID
 * @param {string} inChannelName - ログ表示用のチャンネル名
 * @param {string} addText - 進行状況などの追加テキスト
 */
async function fetchFeed(channelId, inChannelName="None", addText="", quiet=false, refresh=false) {
    const signedIn = typeof authSession !== 'undefined' && authSession;
    if (!signedIn) {
        if (!quiet) showNotification('トップページからログインしてください。', 'error');
        return null;
    }

    if(!quiet && addText !== '') showNotification(addText);

    try {
        const data = await accountApi('feed', { channelId, refresh });
        
        if (data.status === 'ok') {
            // 取得したデータをアプリ内の共通フォーマットに変換
            const result = {
                name: data.feed.title,
                items: data.items.map(item => ({
                    id: videoId(item.link),
                    channelId: channelId,
                    channelName: data.feed.title,
                    title: item.title,
                    thumb: item.thumbnail,
                    url: item.link,
                    published: item.pubDate,
                    watched: false // デフォルトは未読
                }))
            };
            validateState({ channels: [{ id: channelId, title: result.name }], videos: result.items,
                darkMode: true, selectedChannel: 'all' });
            if (!quiet) showNotification(`成功 [${inChannelName}]`, 'success');
            return result;
        } else {
            throw new Error(data.message || "取得失敗");
        }
    } catch (e) {
        if (!quiet) showNotification(`エラー [${channelId}]: ${e.message}`, "error");
        return null;
    }
}

/**
 * 新しいチャンネルをリストに追加する
 */
async function addNewChannel() {
    return withBusy(async () => {
    let input = document.getElementById('channelIdInput').value.trim();
    // 入力がURLの場合でもID部分(UC...)だけを抜き出す正規表現
    const idMatch = input.match(/(UC[a-zA-Z0-9_-]{22})/);
    const cid = idMatch ? idMatch[1] : input;

    // 空チェックおよび重複チェック
    if (!cid || appState.channels.some(c => c.id === cid)) return;

    const result = await fetchFeed(cid);
    // 取得失敗しても、とりあえずIDだけは登録する（あとでリトライ可能にするため）
    const channelName = result ? result.name : `Channel(${cid.substring(0,6)})`;

    appState.channels.push({ id: cid, title: channelName });
    document.getElementById('channelIdInput').value = ''; // 入力欄をクリア
    
    if (result) mergeVideos(result.items); // 動画リストを合流
    save();
    renderChannels();
    renderVideos();
    if (typeof authSession !== 'undefined' && authSession) { resetLibraryPager(); await reloadLibrary(); }
    });
}

/**
 * チャンネルの削除
 */
async function removeChannel(cid, event) {
    event.stopPropagation(); // 親要素のクリックイベント（フィルタ切り替え）を阻止
    if (busy) return showNotification('取得が終わってから削除してください。');
    if (!confirm("チャンネルと動画データを削除しますか？")) return;
    if (typeof authSession !== 'undefined' && authSession) {
        busy = true;
        try {
            await accountApi('removeChannel', { channelId: cid });
            resetLibraryPager();
            const pending = pendingWatched();
            for (const id of Object.keys(pending)) if (pending[id].channelId === cid) delete pending[id];
            localStorage.setItem('yt_rss_pending_watched:' + authSession.userId, JSON.stringify(pending));
        }
        catch (error) { showNotification(error.message, 'error'); return; }
        finally { busy = false; }
    }
    
    // チャンネルリストと動画リストの両方から削除
    appState.channels = appState.channels.filter(c => c.id !== cid);
    appState.videos = appState.videos.filter(v => v.channelId !== cid);
    
    // 削除したチャンネルを表示中だった場合は「すべて」に戻す
    if (appState.selectedChannel === cid) appState.selectedChannel = 'all';
    
    save();
    renderChannels();
    renderVideos();

}

/**
 * 全チャンネルを更新し、操作バーの下に進捗を表示する
 */
async function refreshAll() {
    return withBusy(async () => {
    const channels = [...appState.channels];
    const panel = document.getElementById('refreshProgress');
    const label = document.getElementById('refreshProgressText');
    const bar = document.getElementById('refreshProgressBar');
    const button = document.getElementById('refreshButton');
    panel.hidden = false;
    button.disabled = true;
    bar.max = Math.max(channels.length, 1);
    bar.value = 0;
    const failures = [];
    try {
        for (const [index, ch] of channels.entries()) {
            label.textContent = `${index + 1} / ${channels.length} 件を更新中：${ch.title}`;
            const result = await fetchFeed(ch.id, ch.title, '', true, true);
            if (result) {
                if (ch.title.startsWith('Channel(')) ch.title = result.name;
                mergeVideos(result.items, false);
            } else failures.push(ch.title);
            bar.value = index + 1;
        }
        appState.videos.sort((a, b) => new Date(b.published) - new Date(a.published));
        save(); renderChannels(); renderVideos();
        let synced = true;
        if (typeof authSession !== 'undefined' && authSession) {
            label.textContent = 'チャンネルの取得が終了しました。シートと同期中…';
            resetLibraryPager(); synced = await reloadLibrary();
        }
        label.textContent = channels.length ? `更新完了：${channels.length - failures.length} / ${channels.length} 件成功` : '登録チャンネルはありません。';
        if (failures.length) label.textContent += `（失敗：${failures.join('、')}。ログイン状態・チャンネルIDを確認してください）`;
        if (!synced) label.textContent += ' シートとの同期に失敗しました。ローカルの情報を表示しています。';
    } catch (error) { label.textContent = '更新を中断しました：' + error.message; }
    finally { button.disabled = false; }
    });
}

/**
 * 重複を避けて動画リストを統合する
 */
function mergeVideos(newVideos, sort = true) {
    const ids = new Set(appState.videos.map(v => v.id));
    newVideos.forEach(nv => {
        // すでに存在するID（動画）は追加しない
        if (!ids.has(nv.id)) {
            appState.videos.push(nv);
            ids.add(nv.id);
        }
    });
    if (sort) appState.videos.sort((a, b) => new Date(b.published) - new Date(a.published));
}

/**
 * サイドバーのチャンネルリストを描画する
 */
function renderChannels() {
    const list = document.getElementById('channel-list');
    list.replaceChildren();
    [{ id: 'all', title: 'すべて表示' }, ...appState.channels].forEach(ch => {
        const item = document.createElement('div');
        item.className = `channel-item-container ${ch.id === 'all' ? 'all-view' : ''} ${appState.selectedChannel === ch.id ? 'active' : ''}`;
        const link = document.createElement('button');
        link.className = 'channel-link';
        link.textContent = ch.title;
        link.addEventListener('click', () => filterChan(ch.id));
        item.appendChild(link);
        if (ch.id !== 'all') {
            const remove = document.createElement('button');
            remove.className = 'btn-delete-ch';
            remove.title = '削除';
            remove.setAttribute('aria-label', ch.title + 'を削除');
            remove.textContent = '✕';
            remove.addEventListener('click', event => removeChannel(ch.id, event));
            item.appendChild(remove);
        }
        list.appendChild(item);
    });
}

/**
 * メインエリアの動画カードリストを描画する
 */
function renderVideos(append = false) {
    const container = document.getElementById('video-container');
    const start = append ? container.querySelectorAll('.video-card').length : 0;
    if (append) container.querySelector('.load-more')?.remove();
    else container.replaceChildren();
    
    document.getElementById('unreadOnlyInput').checked = appState.unreadOnly;
    const all = getDisplayVideos();
    const count = document.getElementById('videoCount');
    if (count) count.textContent = all.length + '本';
    const displayList = all.slice(start, typeof libraryPager !== 'undefined' ? libraryPager.limit : 50);
    if (!start && displayList.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-message';
        empty.textContent = appState.unreadOnly ? '未読の動画はありません。' : '表示する動画はありません。';
        container.appendChild(empty);
    }

    displayList.forEach(v => {
        const card = document.createElement('div');
        card.dataset.videoId = v.id;
        card.className = `video-card ${v.watched ? 'watched' : ''}`; // 既読なら薄くするCSSを適用
        card.innerHTML = `
            <a target="_blank" rel="noopener noreferrer" class="thumb-wrapper">
                <img loading="lazy" decoding="async" alt="">
            </a>
            <div class="video-info">
                <div class="video-title"></div>
                <div class="channel-name"></div>
                <div class="meta-row">
                    <label style="cursor:pointer; display:flex; align-items:center; gap:6px;">
                        <input type="checkbox"> 既読
                    </label>
                    <span></span>
                </div>
            </div>`;
        const link = card.querySelector('a');
        link.href = safeURL(v.url);
        link.addEventListener('click', () => setWatched(v.id, true));
        card.querySelector('img').src = safeURL(v.thumb);
        const title = card.querySelector('.video-title');
        title.textContent = v.title;
        title.title = v.title;
        card.querySelector('.channel-name').textContent = v.channelName;
        card.querySelector('.meta-row span').textContent = publishedFormatter.format(new Date(v.published));
        const checkbox = card.querySelector('input');
        checkbox.checked = v.watched;
        checkbox.addEventListener('change', () => setWatched(v.id, checkbox.checked));
        container.appendChild(card);
    });
    if (typeof renderLibrarySentinel === 'function') renderLibrarySentinel(container, all.length);
}

/**
 * 動画の既読/未読状態を切り替える
 */
function setWatched(vid, watched) {
    const video = appState.videos.find(v => v.id === vid);
    if (video) {
        const previous = video.watched;
        if (watched === previous) return;
        // 現在の状態を反転(トグル)させる
        video.watched = watched === undefined ? !video.watched : watched;
        if (typeof authSession !== 'undefined' && authSession) syncWatched(video, previous);
        save();
        if (appState.unreadOnly) renderVideos();
        else {
            const cards = document.getElementById('video-container').querySelectorAll?.('.video-card') || [];
            for (const card of cards) if (card.dataset.videoId === vid) {
                card.classList.toggle('watched', video.watched);
                card.querySelector('input').checked = video.watched;
            }
        }
    }
}

// チャンネルと未読条件を組み合わせて表示対象を選ぶ
function getDisplayVideos() {
    return appState.videos.filter(v =>
        (appState.selectedChannel === 'all' || v.channelId === appState.selectedChannel) &&
        (!appState.unreadOnly || !v.watched));
}

function setUnreadOnly(enabled) {
    if (appState.unreadOnly === enabled) return;
    appState.unreadOnly = enabled;
    if (typeof resetLocalView === 'function') resetLocalView();
    savePreferences();
    renderVideos();
}

/**
 * サイドバーで選択したチャンネルでフィルタをかける
 */
function filterChan(id) {
    if (appState.selectedChannel === id) return;
    appState.selectedChannel = id;
    if (typeof resetLocalView === 'function') resetLocalView();
    savePreferences();
    renderChannels();
    renderVideos();
}

/**
 * ダークモードとライトモードの切り替え
 */
function toggleTheme() {
    appState.darkMode = !appState.darkMode;
    document.body.setAttribute('data-theme', appState.darkMode ? 'dark' : 'light');
    savePreferences();
}

/**
 * バックアップ：現在のデータをJSONファイルとして保存する
 */
async function exportJSON() {
    const state = appState;
    const blob = new Blob([JSON.stringify(state, null, 2)], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `yt_rss_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * 復元：選択したJSONファイルからデータを読み込む
 */
async function importJSON(e) {
    if (busy) {
        e.target.value = '';
        return showNotification('取得が終わってから復元してください。');
    }
    const file = e.target.files[0];
    if (!file) return;
    busy = true;
    const status = document.getElementById('importStatus');
    const report = message => { if (status) status.textContent = message; };
    let uploading = false;
    try {
        report('ファイルを確認中…');
        const restored = validateState(JSON.parse((await file.text()).replace(/^\uFEFF/, '')));
        if (typeof authSession !== 'undefined' && authSession) {
            uploading = true;
            await restoreAccount(restored, report);
            appState = { ...restored, videos: [] };
            savePreferences();
            document.body.setAttribute('data-theme', appState.darkMode ? 'dark' : 'light');
            const loaded = await reloadLibrary();
            report(loaded ? 'スプレッドシートへの復元が完了しました。' : 'シートへの保存は完了しました。一覧の読み込みを再試行してください。');
        } else {
            localStorage.setItem(typeof accountStorageKey === 'function' ? accountStorageKey() : 'yt_v5_final', JSON.stringify(restored));
            appState = restored;
            savePreferences();
            document.body.setAttribute('data-theme', appState.darkMode ? 'dark' : 'light');
            renderChannels(); renderVideos();
            report('このブラウザに復元しました。シートへの保存にはトップページでログインして復元してください。');
        }
    } catch (error) {
        report(uploading ? 'シートへの復元が中断しました。一部が保存済みの可能性があります。同じJSONで再実行できます。' + error.message : '復元できません。ファイルの形式・内容・保存容量を確認してください。');
    } finally { busy = false; e.target.value = ''; }
}

/**
 * 初期化（全消去）
 */
function resetAll() {
    if (busy) return showNotification('取得が終わってから初期化してください。');
    if (confirm("このブラウザに保存した設定と既読情報を削除しますか？")) {
        try {
            localStorage.removeItem('yt_rss_api_key');
            localStorage.removeItem(typeof accountStorageKey === 'function' ? accountStorageKey() : 'yt_v5_final');
            localStorage.removeItem(preferenceKey());
            location.reload();
        } catch (error) { showNotification('保存データを削除できません。', 'error'); }
    }
}

/**
 * ページ読み込み完了時の処理
 */
async function startApp() {
    if (typeof initAccount === 'function' && !(await initAccount())) return;
    // 廃止した認証キーを、このブラウザから削除する
    try { localStorage.removeItem('yt_rss_api_key'); } catch (error) { /* 保存領域が利用不可でも画面は起動する */ }
    load(); // ストレージからデータを読み込む
    document.documentElement.removeAttribute('data-auth-pending');
    if (typeof authSession !== 'undefined' && authSession) reloadLibrary();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startApp, { once: true });
else startApp();
