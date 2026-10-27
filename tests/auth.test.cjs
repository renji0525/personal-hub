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

test('自動同期は日本時間の時間帯・日付・ユーザー・保存対象で判定する', () => {
    const s = auth(), sync = s.context.window.HubSync;
    const at = value => Date.parse('2026-10-' + value + '+09:00');
    for (const [time, expected] of [['24T00:00:00', '2026-10-24:0'], ['24T12:59:59', '2026-10-24:0'], ['24T13:00:00', '2026-10-24:1'], ['24T18:59:59', '2026-10-24:1'], ['24T19:00:00', '2026-10-24:2'], ['24T23:59:59', '2026-10-24:2'], ['25T00:00:00', '2026-10-25:0']]) assert.equal(sync.slot(at(time)), expected);
    s.clock.now = at('24T12:00:00');
    assert.equal(sync.needed('alice', 'budget', true), true);
    sync.mark('alice', 'budget', s.clock.now);
    assert.equal(sync.needed('alice', 'budget', true), false);
    assert.equal(sync.needed('alice', 'budget', false), true);
    assert.equal(sync.needed('bob', 'budget', true), true);
    assert.equal(sync.needed('alice', 'rss', true), true);
    s.clock.now = at('24T13:00:00');
    assert.equal(sync.needed('alice', 'budget', true), true);
    sync.mark('alice', 'budget', at('24T12:59:59'));
    assert.equal(sync.needed('alice', 'budget', true), true);
    sync.mark('alice', 'budget', s.clock.now);
    assert.equal(sync.needed('alice', 'budget', true), false);
    s.clock.now = at('25T13:00:00');
    assert.equal(sync.needed('alice', 'budget', true), true);
});

test('同期履歴の保存失敗でも次回の自動同期を許可する', () => {
    const s = auth(), sync = s.context.window.HubSync;
    s.context.localStorage.setItem = () => { throw new Error('容量不足'); };
    assert.doesNotThrow(() => sync.mark('alice', 'budget', Date.now()));
    assert.equal(sync.needed('alice', 'budget', true), true);
});

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

test('同時の認証確認だけを1回へ集約し、完了後はサーバーで再確認する', async () => {
    const s = auth();
    s.storage.set('personal_hub_session', JSON.stringify(session()));
    let calls = 0, complete;
    s.context.fetch = async () => {
        calls++;
        return new Promise(resolve => { complete = () => resolve({ ok: true, json: async () => ({ status: 'ok', userId: 'alice' }) }); });
    };
    const first = s.api.verify(), second = s.api.verify(), third = s.api.verify();
    assert.equal(calls, 1);
    complete();
    const results = await Promise.all([first, second, third]);
    assert.ok(results.every(value => value.userId === 'alice'));
    const next = s.api.verify();
    assert.equal(calls, 2);
    complete();
    await next;
});

test('家計簿のローカル認証確認では通信せず、期限とログアウトを監視する', async () => {
    const s = auth(), value = session();
    s.storage.set('personal_hub_session', JSON.stringify(value));
    let calls = 0;
    s.context.fetch = async () => { calls++; throw new Error('通信不要'); };
    s.context.document = { documentElement: { setAttribute() {} } };
    s.context.location = { replace() {} };
    const verified = await s.api.protect({ local: true });
    assert.equal(verified.userId, 'alice'); assert.equal(calls, 0);
    assert.ok(s.timers.length > 0);
    s.clock.now = value.expiresAt + 1;
    s.timers.at(-1).callback();
    assert.equal(s.api.read(), null);
});

test('ログアウトはサーバー応答を待たず端末を解除し、通信は6分上限を使う', async () => {
    const s = auth();
    s.storage.set('personal_hub_session', JSON.stringify(session()));
    let finish, options;
    s.context.fetch = async (_, args) => { options = args; await new Promise(resolve => { finish = resolve; }); return { ok: true, json: async () => ({ status: 'ok' }) }; };
    const pending = s.api.signOut();
    assert.equal(s.api.read(), null);
    assert.equal(options.keepalive, true);
    assert.ok(s.timers.some(timer => timer.delay === 360000));
    finish(); await pending;
});

test('同期は6分で中断し、送信した問い合わせIDをタイムアウト表示へ引き継ぐ', async () => {
    const s = auth(); let request;
    s.context.fetch = (_, options) => {
        request = JSON.parse(options.body);
        return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
            const error = new Error('中断'); error.name = 'AbortError'; reject(error);
        }));
    };
    const pending = s.api.api('listsSync', {}, session());
    assert.equal(s.timers.at(-1).delay, 360000);
    s.timers.at(-1).callback();
    await assert.rejects(pending, error => error.code === 'REQUEST_TIMEOUT' && error.requestId === request.requestId && error.message.includes(request.requestId));
});

test('通信切断とサーバー競合でも問い合わせIDを返し、競合では認証を消さない', async () => {
    const s = auth(); const user = session(); s.storage.set('personal_hub_session', JSON.stringify(user));
    s.context.fetch = async () => { throw new TypeError('Failed to fetch'); };
    await assert.rejects(s.api.api('budgetLoad', {}, user), error => !!error.requestId && error.message.includes(error.requestId));
    s.context.fetch = async () => ({ ok: true, json: async () => ({ status: 'error', code: 'BUDGET_CONFLICT', message: '同時編集' }) });
    await assert.rejects(s.api.api('budgetSync', {}, user), error => error.code === 'BUDGET_CONFLICT' && !!error.requestId);
    assert.equal(s.api.read().userId, user.userId);
});

test('ロック待ちだけ同じ本文で最大2回再試行し、通信切断は自動再送しない', async () => {
    const s = auth(), user = session(), calls = []; s.storage.set('personal_hub_session', JSON.stringify(user));
    s.context.fetch = async (_, options) => { calls.push(options.body); return { ok: true, json: async () => ({ status: 'error', code: 'LOCK_TIMEOUT', message: '混雑' }) }; };
    await assert.rejects(s.api.api('listsSync', { syncId: 'sync_repeat1' }, user), { code: 'LOCK_TIMEOUT' });
    assert.equal(calls.length, 3); assert.equal(new Set(calls).size, 1); assert.equal(s.timers.filter(timer => timer.delay === 360000).length, 1);
    calls.length = 0;
    s.context.fetch = async (_, options) => { calls.push(options.body); throw new TypeError('Failed to fetch'); };
    await assert.rejects(s.api.api('listsSync', {}, user)); assert.equal(calls.length, 1);
});
