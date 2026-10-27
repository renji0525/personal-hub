// Personal Hub全体で認証セッションとGAS通信を共有する
window.HubAuth = (() => {
	const API_URL = 'https://script.google.com/macros/s/AKfycbx33oLMfb7HEsyi4uCHIm4N3Y53l2sBEasBnKpagNU8lAMwzSUiyg0sfes9niiLuSOC/exec';
    const KEY = 'personal_hub_session';
    let expiryTimer;
    const verifications = new Map();

    function valid(session) {
        return session && typeof session.userId === 'string' && /^[a-zA-Z0-9_-]{3,32}$/.test(session.userId) &&
            typeof session.token === 'string' && /^[a-f0-9]{64}$/.test(session.token) &&
            Number.isFinite(session.expiresAt) && session.expiresAt > Date.now();
    }

    const MIGRATED_KEY = 'personal_hub_auth_migrated';

    function removeLegacy() {
        sessionStorage.removeItem(KEY);
        sessionStorage.removeItem('yt_rss_session');
    }

    function read() {
        try {
            const raw = localStorage.getItem(KEY);
            if (raw !== null) {
                const session = JSON.parse(raw);
                return valid(session) ? session : null;
            }
            // 一度移行・ログアウトした端末では古いタブのセッションを復活させない
            if (localStorage.getItem(MIGRATED_KEY)) return null;
            const previous = JSON.parse(sessionStorage.getItem(KEY) || sessionStorage.getItem('yt_rss_session') || 'null');
            if (!valid(previous)) return null;
            localStorage.setItem(KEY, JSON.stringify(previous));
            localStorage.setItem(MIGRATED_KEY, '1');
            removeLegacy();
            return previous;
        } catch (error) { return null; }
    }

    function scheduleExpiry(session) {
        clearTimeout(expiryTimer);
        if (!session) return;
        // 30日はタイマー上限を超えるため、短い区間で期限を再確認する
        expiryTimer = setTimeout(() => {
            if (session.expiresAt <= Date.now()) clear(session);
            else scheduleExpiry(session);
        }, Math.min(Math.max(0, session.expiresAt - Date.now()), 24 * 60 * 60 * 1000));
    }

    function notify(session) {
        scheduleExpiry(session);
        window.dispatchEvent(new CustomEvent('hub-auth-changed', { detail: session }));
    }

    function clear(expected) {
        const current = read();
        if (expected && current && current.token !== expected.token) return;
        localStorage.setItem(MIGRATED_KEY, '1');
        localStorage.removeItem(KEY);
        removeLegacy();
        notify(null);
    }

    window.addEventListener('storage', event => {
        if (event.storageArea === localStorage && (event.key === KEY || event.key === null)) {
            removeLegacy();
            notify(read());
        }
    });

    function randomToken() {
        return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    }

    async function api(action, params = {}, session = read()) {
        const controller = new AbortController();
        // GASの1実行の上限（6分）に合わせる
        const wait = 360000;
        const requestId = crypto.randomUUID();
        const timeout = setTimeout(() => controller.abort(), wait);
        try {
            // ロック未取得は保存処理が始まっていないため、同じ本文で最大2回だけ再試行する
            const retryable = ['budgetLoad', 'budgetSync', 'listsLoad', 'listsSync', 'listsMembers'].includes(action);
            for (let attempt = 0; ; attempt++) {
                // GASへのプリフライトを避け、認証情報をURLに含めない
                const response = await fetch(API_URL, {
                    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({ ...params, action, requestId, token: session ? session.token : undefined }),
                    keepalive: action === 'logout', credentials: 'omit', redirect: 'follow', signal: controller.signal
                });
                if (!response.ok) throw new Error('サーバーに接続できませんでした。');
                const result = await response.json();
                if (result.status !== 'ok') {
                    if (result.code === 'LOCK_TIMEOUT' && retryable && attempt < 2 && !controller.signal.aborted && (!session || read()?.token === session.token)) continue;
                    if (result.code === 'AUTH_EXPIRED' && session) clear(session);
                    const error = new Error((result.message || '処理に失敗しました。') + '（問い合わせID: ' + requestId + '）');
                    error.requestId = requestId;
                    error.code = result.code;
                    throw error;
                }
                return result;
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                const timeoutError = new Error('6分以内に応答を受信できませんでした。サーバーでは保存済みの場合があります。未同期内容を消さずに同期を再実行してください。（問い合わせID: ' + requestId + '）');
                timeoutError.code = 'REQUEST_TIMEOUT';
                timeoutError.requestId = requestId;
                throw timeoutError;
            }
            if (!error.requestId) {
                error.requestId = requestId;
                error.message += '（問い合わせID: ' + requestId + '）';
            }
            throw error;
        } finally { clearTimeout(timeout); }
    }

    function verify(session = read()) {
        if (!session) return Promise.resolve(null);
        const key = session.userId + ':' + session.token;
        if (verifications.has(key)) return verifications.get(key);
        // 同時確認だけを集約し、確認済み認証を時間キャッシュしない
        const promise = (async () => {
            const result = await api('session', {}, session);
            if (result.userId !== session.userId) {
                clear(session);
                throw new Error('ログイン情報を確認できませんでした。');
            }
            const current = read();
            if (!current || current.token !== session.token) return null;
            scheduleExpiry(current);
            return current;
        })().finally(() => verifications.delete(key));
        verifications.set(key, promise);
        return promise;
    }

    async function signIn(action, userId, password) {
        const token = randomToken();
        const result = await api(action, { userId, password, newToken: token, salt: randomToken().slice(0, 32) }, null);
        const session = { userId: result.userId, token, expiresAt: result.expiresAt };
        if (!valid(session)) throw new Error('ログイン情報が正しくありません。');
        localStorage.setItem(KEY, JSON.stringify(session));
        localStorage.setItem(MIGRATED_KEY, '1');
        removeLegacy();
        notify(session);
        return session;
    }

    async function signOut(session = read()) {
        // 端末を先に解除し、ページ遷移後もサーバー無効化の送信を継続する
        const pending = session ? api('logout', {}, session) : Promise.resolve();
        clear(session);
        await pending;
    }

    function toTop(reason = 'login') {
        document.documentElement.setAttribute('data-auth-pending', '');
        location.replace('../top/index.html?reason=' + encodeURIComponent(reason));
    }

    function protect(options = {}) {
        let protectedToken = null;
        const check = async () => {
            document.documentElement.setAttribute('data-auth-pending', '');
            if (!read()) { toTop(); return null; }
            try {
                const session = options.local ? read() : await verify();
                if (!session) { toTop(); return null; }
                protectedToken = session.token;
                notify(session);
                return session;
            } catch (error) { toTop(error.code === 'AUTH_EXPIRED' ? 'expired' : 'connection'); return null; }
        };
        window.addEventListener('hub-auth-changed', event => {
            if (!event.detail || protectedToken && event.detail.token !== protectedToken) toTop('expired');
        });
        window.addEventListener('pageshow', async event => {
            if (event.persisted && await check()) document.documentElement.removeAttribute('data-auth-pending');
        });
        return check();
    }

    function resume() {
        const session = read();
        scheduleExpiry(session);
        return session;
    }
    return { read, resume, api, verify, signIn, signOut, protect };
})();

// 日本時間の日付・時間帯ごとに、ユーザー別の同期成功を端末に記録する
window.HubSync = (() => {
    function slot(now = Date.now()) {
        const date = new Date(now + 9 * 60 * 60 * 1000);
        const hour = date.getUTCHours();
        return date.toISOString().slice(0, 10) + ':' + (hour < 13 ? 0 : hour < 19 ? 1 : 2);
    }
    function key(userId, resource) { return 'personal_hub_sync_slot:' + resource + ':' + userId; }
    function needed(userId, resource, hasCache) {
        try { return !hasCache || localStorage.getItem(key(userId, resource)) !== slot(); }
        catch (error) { return true; }
    }
    function mark(userId, resource, startedAt) {
        try { localStorage.setItem(key(userId, resource), slot(startedAt)); }
        catch (error) { /* 保存できない場合は次回も同期する */ }
    }
    return { slot, needed, mark };
})();
