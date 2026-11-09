const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function library(count = 1) {
    const store = new Map(), calls = [];
    const pending = Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i), { id: String(i), channelId: 'channel', watched: true }]));
    store.set('yt_rss_pending_watched:alice', JSON.stringify(pending));
    const context = vm.createContext({
        localStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value) },
        document: { getElementById: () => ({}) }, window: { addEventListener() {} },
        appState: { channels: [], videos: [] }, validateState: value => value,
        save() {}, renderChannels() {}, renderVideos() {}, showNotification() {},
        HubAuth: { api: async (action, params) => { calls.push({ action, params }); return { channels: [], videos: [], watchedSaved: true }; } }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/youtube-rss/js/sync.js'), 'utf8'), context);
    vm.runInContext("authSession = { userId: 'alice', token: 'a' };", context);
    return { context, calls, store, run: source => vm.runInContext(source, context) };
}

test('既読100件以下は一覧取得1回へ統合し、201件でもAPI3回で完了する', async () => {
    for (const count of [1, 100, 101, 201]) {
        const s = library(count);
        await Promise.all([s.run('reloadLibrary()'), s.run('reloadLibrary()'), s.run('reloadLibrary()')]);
        assert.equal(s.calls.length, Math.ceil(count / 100));
        assert.equal(s.calls.at(-1).action, 'syncLibrary');
        assert.ok(s.calls.at(-1).params.watched.length <= 100);
        assert.equal(Object.keys(JSON.parse(s.store.get('yt_rss_pending_watched:alice'))).length, 0);
    }
});

test('購読の送信中に同じチャンネルを削除しても、追加の応答で削除を消さない', async () => {
    const s = library(0), id = 'UC' + 'a'.repeat(22), key = 'yt_rss_pending_channels:alice';
    s.store.set(key, JSON.stringify({ [id]: { channelId: id, subscribed: true, id: 'first' } }));
    let release, sent;
    const requestStarted = new Promise(resolve => { sent = resolve; });
    s.context.HubAuth.api = (action, params) => new Promise(resolve => { release = resolve; sent({ action, params }); });
    const syncing = s.run('reloadLibrary(false)');
    const request = await requestStarted;
    assert.equal(request.action, 'rssChannelsSync');
    assert.equal(request.params.channels.length, 1);
    s.store.set(key, JSON.stringify({ [id]: { channelId: id, subscribed: false, id: 'second' } }));
    release({ saved: [id], watchedSaved: true, channels: [{ id, title: '登録済み' }], videos: [] });
    assert.equal(await syncing, true);
    assert.equal(JSON.parse(s.store.get(key))[id].subscribed, false);
    assert.equal(s.context.appState.channels.length, 0);
});

test('統合同期の失敗・未対応応答では未送信既読を削除しない', async () => {
    for (const fails of [true, false]) {
        const s = library(1);
        s.context.HubAuth.api = async () => {
            if (fails) throw new Error('通信失敗');
            return { channels: [], videos: [] };
        };
        await s.run('reloadLibrary()');
        assert.equal(Object.keys(JSON.parse(s.store.get('yt_rss_pending_watched:alice'))).length, 1);
    }
});

test('送信中に変更された既読を保持し、一覧でも新しい操作を優先する', async () => {
    const s = library(1);
    let complete;
    s.context.HubAuth.api = async () => new Promise(resolve => { complete = resolve; });
    const sync = s.run('reloadLibrary()');
    await Promise.resolve(); await Promise.resolve();
    assert.equal(typeof complete, 'function');
    s.store.set('yt_rss_pending_watched:alice', JSON.stringify({ 0: { id: '0', channelId: 'channel', watched: false } }));
    complete({ channels: [], videos: [{ id: '0', watched: true }], watchedSaved: true });
    await sync;
    assert.equal(JSON.parse(s.store.get('yt_rss_pending_watched:alice'))[0].watched, false);
    assert.equal(s.context.appState.videos[0].watched, false);
});
