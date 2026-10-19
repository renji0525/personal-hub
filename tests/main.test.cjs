const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function app() {
    const store = new Map();
    const input = { value: 'UCtest' };
    const context = vm.createContext({
        URL, URLSearchParams, setTimeout, window: {},
        localStorage: { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v) },
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
