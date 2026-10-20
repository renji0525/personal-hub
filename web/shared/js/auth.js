// Personal Hub全体で認証セッションとGAS通信を共有する
window.HubAuth = (() => {
    const API_URL = 'https://script.google.com/macros/s/AKfycbyXRNKLdzWdJAc5iJEfp1hAEbScOERyGboIJZD8hZFprfPo7g57Ip3BjddtiHRdWwyB/exec';
    const KEY = 'personal_hub_session';
    let expiryTimer;

    function valid(session) {
        return session && typeof session.userId === 'string' && /^[a-zA-Z0-9_-]{3,32}$/.test(session.userId) &&
            typeof session.token === 'string' && /^[a-f0-9]{64}$/.test(session.token) &&
            Number.isFinite(session.expiresAt) && session.expiresAt > Date.now();
    }

    function read() {
        try {
            let session = JSON.parse(sessionStorage.getItem(KEY) || 'null');
            if (!session) {
                const previous = JSON.parse(sessionStorage.getItem('yt_rss_session') || 'null');
                if (valid(previous)) {
                    sessionStorage.setItem(KEY, JSON.stringify(previous));
                    session = previous;
                }
                sessionStorage.removeItem('yt_rss_session');
            }
            return valid(session) ? session : null;
        } catch (error) { return null; }
    }

    function notify(session) {
        clearTimeout(expiryTimer);
        if (session) expiryTimer = setTimeout(() => clear(session), Math.max(0, session.expiresAt - Date.now()));
        window.dispatchEvent(new CustomEvent('hub-auth-changed', { detail: session }));
    }

    function clear(expected) {
        const current = read();
        if (expected && current && current.token !== expected.token) return;
        sessionStorage.removeItem(KEY);
        sessionStorage.removeItem('yt_rss_session');
        notify(null);
    }

    function randomToken() {
        return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    }

    async function api(action, params = {}, session = read()) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 90000);
        try {
            // GASへのプリフライトを避け、認証情報をURLに含めない
            const response = await fetch(API_URL, {
                method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ ...params, action, token: session ? session.token : undefined }),
                credentials: 'omit', redirect: 'follow', signal: controller.signal
            });
            if (!response.ok) throw new Error('サーバーに接続できませんでした。');
            const result = await response.json();
            if (result.status !== 'ok') {
                if (result.code === 'AUTH_EXPIRED' && session) clear(session);
                const error = new Error(result.message || '処理に失敗しました。');
                error.code = result.code;
                throw error;
            }
            return result;
        } finally { clearTimeout(timeout); }
    }

    async function verify(session = read()) {
        if (!session) return null;
        const result = await api('session', {}, session);
        if (result.userId !== session.userId) {
            clear(session);
            throw new Error('ログイン情報を確認できませんでした。');
        }
        const current = read();
        if (!current || current.token !== session.token) return null;
        clearTimeout(expiryTimer);
        expiryTimer = setTimeout(() => clear(current), Math.max(0, current.expiresAt - Date.now()));
        return current;
    }

    async function signIn(action, userId, password) {
        const token = randomToken();
        const result = await api(action, { userId, password, newToken: token, salt: randomToken().slice(0, 32) }, null);
        const session = { userId: result.userId, token, expiresAt: result.expiresAt };
        if (!valid(session)) throw new Error('ログイン情報が正しくありません。');
        sessionStorage.setItem(KEY, JSON.stringify(session));
        sessionStorage.removeItem('yt_rss_session');
        notify(session);
        return session;
    }

    async function signOut() {
        const session = read();
        try { if (session) await api('logout', {}, session); }
        finally { clear(session); }
    }

    function toTop(reason = 'login') {
        document.documentElement.setAttribute('data-auth-pending', '');
        location.replace('../top/index.html?reason=' + encodeURIComponent(reason));
    }

    function protect() {
        const check = async () => {
            document.documentElement.setAttribute('data-auth-pending', '');
            if (!read()) { toTop(); return null; }
            try {
                const session = await verify();
                if (!session) { toTop(); return null; }
                notify(session);
                return session;
            } catch (error) { toTop(error.code === 'AUTH_EXPIRED' ? 'expired' : 'connection'); return null; }
        };
        window.addEventListener('hub-auth-changed', event => { if (!event.detail) toTop('expired'); });
        window.addEventListener('pageshow', async event => {
            if (event.persisted && await check()) document.documentElement.removeAttribute('data-auth-pending');
        });
        return check();
    }

    return { read, api, verify, signIn, signOut, protect };
})();
