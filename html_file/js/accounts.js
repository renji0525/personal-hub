const ACCOUNT_API_URL = 'https://script.google.com/macros/s/AKfycbyXRNKLdzWdJAc5iJEfp1hAEbScOERyGboIJZD8hZFprfPo7g57Ip3BjddtiHRdWwyB/exec';
let authSession = null;

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
            if (result.code === 'AUTH_EXPIRED') {
                sessionStorage.removeItem('yt_rss_session');
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
        const library = await accountApi('library', {}, session);
        const saved = localStorage.getItem('yt_rss_user:' + session.userId);
        const previous = saved ? validateState(JSON.parse(saved)) : null;
        const watched = new Map(previous ? previous.videos.map(v => [v.id, v.watched]) : []);
        const state = validateState({ channels: library.channels, videos: library.videos.map(v => ({ ...v, watched: watched.get(v.id) || false })),
            darkMode: appState.darkMode, selectedChannel: 'all', unreadOnly: appState.unreadOnly });
        sessionStorage.setItem('yt_rss_session', JSON.stringify(session));
        authSession = session;
        appState = state;
        save();
        document.body.setAttribute('data-theme', appState.darkMode ? 'dark' : 'light');
        renderChannels(); renderVideos(); renderAccount();
    } catch (error) { renderAccount(error.message); }
    finally { passwordInput.value = ''; busy = false; }
}

async function signOut() {
    if (busy) return;
    busy = true;
    try {
        await accountApi('logout');
        sessionStorage.removeItem('yt_rss_session');
        authSession = null;
        appState = { channels: [], videos: [], darkMode: appState.darkMode, selectedChannel: 'all', unreadOnly: false };
        load(); renderAccount();
    } catch (error) { renderAccount(error.message); }
    finally { busy = false; }
}
