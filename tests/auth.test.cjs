const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

function auth(storage = new Map()) {
    const legacy = new Map(), events = [], timers = [], handlers = {};
    const clock = { now: Date.now() };
    const context = vm.createContext({
        localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
        sessionStorage: { getItem: key => legacy.get(key) || null, setItem: (key, value) => legacy.set(key, value), removeItem: key => legacy.delete(key) },
        Date: class extends Date { static now() { return clock.now; } },
        window: { dispatchEvent: event => events.push(event), addEventListener: (type, fn) => { handlers[type] = fn; } },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        crypto: webcrypto, Uint8Array, AbortController, setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; }, clearTimeout() {}
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/shared/js/auth.js'), 'utf8'), context);
    return { api: context.window.HubAuth, context, storage, legacy, events, timers, handlers, clock };
}
const session = (userId = 'alice', token = 'a'.repeat(64)) => ({ userId, token, expiresAt: Date.now() + 60000 });

test('旧RSSセッションを共通キーへ移行し、期限切れ・破損した値を認証しない', () => {
    const s = auth(), value = session();
    s.legacy.set('yt_rss_session', JSON.stringify(value));
    assert.equal(s.api.read().userId, 'alice');
    assert.equal(s.legacy.has('yt_rss_session'), false);
    assert.ok(s.storage.has('personal_hub_session'));
    for (const invalid of [{ ...value, expiresAt: 0 }, { ...value, token: 'bad' }, { ...value, userId: '<img>' }]) {
        s.storage.set('personal_hub_session', JSON.stringify(invalid));
        assert.equal(s.api.read(), null);
    }
    s.storage.set('personal_hub_session', '{');
    assert.equal(s.api.read(), null);
});

test('共通ログインはパスワードを保存せず、検証時はsession APIを使用する', async () => {
    const s = auth(), calls = [];
    s.context.fetch = async (_, options) => {
        const body = JSON.parse(options.body); calls.push(body);
        return { ok: true, json: async () => ({ status: 'ok', userId: 'alice', expiresAt: Date.now() + 60000 }) };
    };
    await s.api.signIn('login', 'alice', 'password-123');
    assert.equal(s.api.read().userId, 'alice');
    assert.equal(JSON.stringify([...s.storage.values()]).includes('password-123'), false);
    assert.equal(calls[0].action, 'login');
    assert.equal(calls[0].newToken.length, 64);
    assert.equal((await s.api.verify()).userId, 'alice');
    assert.equal(calls[1].action, 'session');
    assert.equal(calls[1].password, undefined);
});

test('期限切れ応答は共通セッションを消し、古い応答で新しいログインを消さない', async () => {
    const s = auth(), old = session();
    s.storage.set('personal_hub_session', JSON.stringify(old));
    s.context.fetch = async () => ({ ok: true, json: async () => ({ status: 'error', code: 'AUTH_EXPIRED', message: '期限切れ' }) });
    await assert.rejects(s.api.api('session', {}, old), /期限切れ/);
    assert.equal(s.api.read(), null);
    s.storage.set('personal_hub_session', JSON.stringify(session('bob', 'b'.repeat(64))));
    await assert.rejects(s.api.api('session', {}, old));
    assert.equal(s.api.read().userId, 'bob');
});

test('通信失敗でも端末からログアウトして共通認証へ通知する', async () => {
    const s = auth();
    s.storage.set('personal_hub_session', JSON.stringify(session()));
    s.context.fetch = async () => { throw new Error('通信失敗'); };
    await assert.rejects(s.api.signOut(), /通信失敗/);
    assert.equal(s.api.read(), null);
    assert.equal(s.events.at(-1).detail, null);
});

test('ブラウザを開き直しても永続保存から認証情報を復元する', async () => {
    const s = auth();
    s.context.fetch = async () => ({ ok: true, json: async () => ({ status: 'ok', userId: 'alice', expiresAt: Date.now() + 30 * 86400000 }) });
    await s.api.signIn('login', 'alice', 'password-123');
    const reopened = auth(s.storage);
    assert.equal(reopened.api.read().userId, 'alice');
    assert.equal(reopened.legacy.size, 0);
    assert.equal(JSON.stringify([...s.storage.values()]).includes('password-123'), false);
});

test('30日のタイマーが上限を超えず、途中では解除せず期限到達で解除する', async () => {
    const s = auth(), expiry = s.clock.now + 30 * 86400000;
    s.context.fetch = async () => ({ ok: true, json: async () => ({ status: 'ok', userId: 'alice', expiresAt: expiry }) });
    await s.api.signIn('login', 'alice', 'password-123');
    assert.equal(s.timers.at(-1).delay, 86400000);
    s.clock.now += 86400000;
    s.timers.at(-1).callback();
    assert.equal(s.api.read().userId, 'alice');
    s.clock.now = expiry;
    s.timers.at(-1).callback();
    assert.equal(s.api.read(), null);
    assert.equal(s.storage.has('personal_hub_session'), false);
});

test('ログアウト後は古いタブのセッションを復活させず、別タブの解除も通知する', async () => {
    const s = auth(), value = session();
    s.storage.set('personal_hub_session', JSON.stringify(value));
    s.context.fetch = async () => ({ ok: true, json: async () => ({ status: 'ok' }) });
    await s.api.signOut();
    s.legacy.set('personal_hub_session', JSON.stringify(value));
    assert.equal(s.api.read(), null);
    s.handlers.storage({ key: 'personal_hub_session', storageArea: s.context.localStorage });
    assert.equal(s.legacy.size, 0);
    assert.equal(s.events.at(-1).detail, null);
});
