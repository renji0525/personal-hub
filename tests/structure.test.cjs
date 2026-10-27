const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../web');
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? files(path.join(dir,item.name)) : [path.join(dir,item.name)]); }
test('全ページのローカルJS・CSS・画像・移動先の参照が存在する', () => {
    for (const file of files(root).filter(file => file.endsWith('.html'))) {
        const html = fs.readFileSync(file,'utf8');
        for (const [,ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
            if (/^(?:[a-z]+:|#|\/\/)/i.test(ref)) continue;
            assert.ok(fs.existsSync(path.resolve(path.dirname(file),ref.split(/[?#]/)[0])), path.relative(root,file)+' -> '+ref);
        }
    }
});
test('各ページは共通配置で起動し、旧RSS URLには転送を維持する', () => {
    for (const page of ['top','budget','youtube-rss','inventory','lists']) for (const file of ['index.html','js/app.js','css/style.css']) assert.ok(fs.existsSync(path.join(root,page,file)));
    assert.match(fs.readFileSync(path.join(root,'youtube-rss/YoutubeRssFedly.html'),'utf8'), /location\.replace\('index.html'/);
});
