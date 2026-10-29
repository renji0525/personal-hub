const test = require('node:test');
const assert = require('node:assert/strict');
const channel = require('../web/youtube-rss/js/channel-input.js');
const id = 'UC' + 'a'.repeat(22), other = 'UC' + 'b'.repeat(22);
test('チャンネルIDとID形式URLを通信なしで正規化する', () => {
    for (const value of [id, 'https://www.youtube.com/channel/' + id, 'youtube.com/channel/' + id + '/videos?view=0#top']) assert.equal(channel.parse(value).channelId, id);
});
test('ハンドル・旧ユーザー名・カスタムURL・日本語をYouTubeのホームURLに正規化する', () => {
    for (const [value, url] of [['@GoogleDevelopers', 'https://www.youtube.com/@GoogleDevelopers'], ['https://m.youtube.com/@GoogleDevelopers/videos?si=abc', 'https://www.youtube.com/@GoogleDevelopers'], ['https://www.youtube.com/user/GoogleDevelopers/featured', 'https://www.youtube.com/user/GoogleDevelopers'], ['youtube.com/c/Example/about', 'https://www.youtube.com/c/Example'], ['https://youtube.com/Example', 'https://www.youtube.com/Example'], ['https://www.youtube.com/@日本語', 'https://www.youtube.com/@' + encodeURIComponent('日本語')]]) assert.equal(channel.parse(value).url, url);
});
test('外部サイト・認証情報・任意ポート・動画URL・壊れたエンコードを拒否する', () => {
    for (const value of ['https://evil.example/channel/' + id, 'https://youtube.com.evil.example/@name', 'https://youtube.com@evil.example/@name', 'https://user@youtube.com/@name', 'https://youtube.com:443/@name', 'https://youtube.com/watch?v=abcdefghijk', 'https://youtu.be/abcdefghijk', 'https://youtube.com/@%ZZ', 'https://youtube.com/@foo%2fbar', 'https://youtube.com/redirect?url=https://evil.example', 'UCbad', 'https://youtube.com/@foo\\bar']) assert.throws(() => channel.parse(value), value);
});
test('おすすめ動画のIDを採用せず、チャンネルのメタデータ・RSS・canonicalだけから抽出する', () => {
    const metadata = { title: '引用符 " と } を含む名前', description: '説明', externalId: id };
    assert.equal(channel.extract('<script>{"videoDetails":{"channelId":"' + other + '"},"metadata":{"channelMetadataRenderer":' + JSON.stringify(metadata) + '}}</script>'), id);
    assert.equal(channel.extract('<head><link type="application/rss+xml" href="https://www.youtube.com/feeds/videos.xml?x=1&amp;channel_id=' + id + '" rel="alternate"></head>'), id);
    assert.equal(channel.extract('<head><link href="https://www.youtube.com/channel/' + id + '" rel="canonical"></head>'), id);
    assert.equal(channel.extract('<head></head><body><a href="https://www.youtube.com/channel/' + other + '">おすすめ</a><script>{"channelId":"' + other + '"}</script>'), null);
    assert.equal(channel.extract('<head><link rel="canonical" href="https://evil.example/channel/' + id + '"></head>'), null);
});

test('GAS向けの文字列形式初期データを実行せず復号して対象チャンネルを取得する', () => {
    const data = JSON.stringify({ contents: { channelId: other }, metadata: { channelMetadataRenderer: { title: '引用符 " と } とバックスラッシュ \\ と改行\n', externalId: id } } });
    // 日本語はそのまま、記号だけをYouTubeと同じ16進エスケープにする
    const youtube = data.replace(/[\\"'{}\[\]<>=&]/g, char => '\\x' + char.charCodeAt(0).toString(16).padStart(2, '0'));
    assert.equal(channel.extract('<script>var ytInitialData = \'' + youtube + '\';</script>'), id);
    const ascii = JSON.stringify({ metadata: { channelMetadataRenderer: { externalId: id } } });
    const unicode = ascii.replace(/"/g, '\\u0022');
    assert.equal(channel.extract('<script>ytInitialData = \'' + unicode + '\';</script>'), id);
    assert.equal(channel.extract('<script>ytInitialData = ' + JSON.stringify(ascii) + ';</script>'), id);
    assert.equal(channel.extract('<script>ytInitialData = \'\\x7b\\x22channelId\\x22: \\x22' + other + '\\x22\\x7d\';</script>'), null);
    assert.equal(channel.extract('<script>ytInitialData = \'\\xZZ\';</script>'), null);
    assert.equal(channel.extract('<script>ytInitialData = \'unterminated'), null);
    globalThis.channelInputExecuted = false;
    assert.equal(channel.extract('<script>ytInitialData = (globalThis.channelInputExecuted = true);</script>'), null);
    assert.equal(globalThis.channelInputExecuted, false);
    delete globalThis.channelInputExecuted;
});
