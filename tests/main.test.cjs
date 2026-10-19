const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function app() {
    const store = new Map();
    const input = { value: 'UCtest' };
    const context = vm.createContext({
        URL, URLSearchParams, setTimeout, window: {},
        localStorage: { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
        document: { getElementById: () => input, body: { setAttribute() {} } }
    });
    vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../html_file/js/main.js'), 'utf8'), context);
    vm.runInContext('renderVideos = () => { renders++; }; renderChannels = () => {}; showNotification = () => {};', context);
    context.renders = 0;
    return { context, run: code => vm.runInContext(code, context) };
}

test('opening a watched video keeps it watched; checkbox can mark it unread', () => {
    const { run } = app();
    run("appState.videos = [{ id: 'video', watched: true }]; setWatched('video', true);");
    assert.equal(run('appState.videos[0].watched'), true);
    run("setWatched('video', false)");
    assert.equal(run('appState.videos[0].watched'), false);
});

test('backup validation rejects malformed data and executable URLs', () => {
    const { run } = app();
    assert.throws(() => run('validateState({})'));
    run(`backup = { channels: [{ id: 'channel', title: '<b>name</b>' }],
        videos: [{ id: 'video', channelId: 'channel', channelName: 'name', title: '<img onerror=alert(1)>',
        thumb: 'https://example.com/image.jpg', url: 'https://www.youtube.com/watch?v=video',
        published: '2026-10-19', watched: false }], darkMode: true, selectedChannel: 'missing' };`);
    assert.equal(run('validateState(backup).selectedChannel'), 'all');
    run("backup.videos[0].url = 'javascript:alert(1)'");
    assert.throws(() => run('validateState(backup)'));
});

test('video IDs support watch parameters, short links, and shorts', () => {
    const { run } = app();
    for (const url of ['https://youtube.com/watch?v=abc&list=123', 'https://youtu.be/abc?t=3', 'https://youtube.com/shorts/abc']) {
        assert.equal(run(`videoId(${JSON.stringify(url)})`), 'abc');
    }
});

test('merging removes duplicates, preserves read status and sorts dates', () => {
    const { run } = app();
    run(`appState.videos = [{ id: 'old', watched: true, published: '2026-01-01' }];
        mergeVideos([{ id: 'old', watched: false }, { id: 'new', published: '2026-10-19' }, { id: 'new' }]);`);
    assert.equal(run('appState.videos.length'), 2);
    assert.equal(run('appState.videos[0].id'), 'new');
    assert.equal(run('appState.videos[1].watched'), true);
});

test('concurrent additions register once and immediately render videos', async () => {
    const { context, run } = app();
    let complete;
    context.feed = new Promise(resolve => { complete = resolve; });
    run('fetchFeed = () => feed');
    const first = run('addNewChannel()');
    await run('addNewChannel()');
    complete({ name: 'channel', items: [] });
    await first;
    assert.equal(run('appState.channels.length'), 1);
    assert.equal(context.renders, 1);
    assert.equal(run('busy'), false);
});

test('corrupt storage does not interrupt initial rendering', () => {
    const { context, run } = app();
    context.localStorage.setItem('yt_v5_final', '{');
    run('load()');
    assert.equal(context.renders, 1);
});

test('未読表示はチャンネル条件と組み合わせ、既読化で対象から外れる', () => {
    const { run } = app();
    run(`appState.videos = [
        { id: 'a', channelId: 'one', watched: false },
        { id: 'b', channelId: 'one', watched: true },
        { id: 'c', channelId: 'two', watched: false }
    ]; setUnreadOnly(true);`);
    assert.equal(run('getDisplayVideos().length'), 2);
    run("appState.selectedChannel = 'one'");
    assert.equal(run("getDisplayVideos()[0].id"), 'a');
    run("setWatched('a', true)");
    assert.equal(run('getDisplayVideos().length'), 0);
    run('setUnreadOnly(false)');
    assert.equal(run('getDisplayVideos().length'), 2);
});

test('旧バックアップの互換性を保ち、未読表示設定を保存・検証する', () => {
    const { run } = app();
    run("backup = { channels: [], videos: [], darkMode: true, selectedChannel: 'all' }");
    assert.equal(run('validateState(backup).unreadOnly'), false);
    run('backup.unreadOnly = true');
    assert.equal(run('validateState(backup).unreadOnly'), true);
    run("backup.unreadOnly = 'true'");
    assert.throws(() => run('validateState(backup)'));
    run('setUnreadOnly(true); appState.unreadOnly = false; load()');
    assert.equal(run('appState.unreadOnly'), true);
});

test('旧バックアップの欠落したShorts IDを補完し既読状態を維持する', () => {
    const { run } = app();
    run(`backup = { channels: [{ id: 'channel', title: 'チャンネル' }],
        videos: [{ channelId: 'channel', channelName: 'チャンネル', title: '動画',
            thumb: 'https://example.com/image.jpg', url: 'https://www.youtube.com/shorts/abc123',
            published: '2026-10-16', watched: true }], darkMode: true, selectedChannel: 'channel' };`);
    assert.equal(run('validateState(backup).videos[0].id'), 'abc123');
    assert.equal(run('validateState(backup).videos[0].watched'), true);
    assert.equal(run('backup.videos[0].id'), undefined);
    run("backup.videos[0].url = 'javascript:alert(1)'");
    assert.throws(() => run('validateState(backup)'));
});

test('認証キーは独立して保存・復元し、空入力で削除する', () => {
    const { run } = app();
    run("document.getElementById('apiKeyInput').value = ' test-key '; saveApiKey()");
    assert.equal(run("localStorage.getItem('yt_rss_api_key')"), 'test-key');
    run("document.getElementById('apiKeyInput').value = ''; loadApiKey()");
    assert.equal(run("document.getElementById('apiKeyInput').value"), 'test-key');
    assert.equal(run("JSON.stringify(appState).includes('test-key')"), false);
    run("document.getElementById('apiKeyInput').value = ''; saveApiKey(); loadApiKey()");
    assert.equal(run("document.getElementById('apiKeyInput').value"), '');
    assert.equal(run("localStorage.getItem('yt_rss_api_key')"), undefined);
});
