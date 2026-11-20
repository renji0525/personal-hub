const test = require('node:test');
const assert = require('node:assert/strict');
const parser = require('../web/budget/receipt/parser.js');

test('レシートから日付・合計・店舗・複数商品を読み、小計や釣銭を除外する', () => {
    const result = parser.parse('中央スーパー\n2026年11月20日 18:30\nりんご 120\n牛乳 200\n小計 296\n合 計(税込) ￥３２０\nお預り ￥1000\nお釣り ￥680');
    assert.equal(result.date, '2026-11-20');
    assert.equal(result.amount, 320);
    assert.equal(result.shop, '中央スーパー');
    assert.equal(result.productName, 'りんご・牛乳');
    assert.equal(result.memo, 'りんご、牛乳');
    assert.equal(parser.parse('合計\n￥1,280').amount, 1280);
    assert.equal(parser.parse('合計 ￥1,280\n内消費税合計 ￥95').amount, 1280);
    assert.equal(parser.parse('合計 (税込8%) ￥1,280').amount, 1280);
    assert.equal(parser.parse('合計 3点 1,280円').amount, 1280);
    assert.equal(parser.parse('牛乳￥200\n合計200').productName, '牛乳');
});

test('不明な日付や金額を推測で補わず、入力上限内に収める', () => {
    const value = parser.parse('テスト店\n2026/02/30\n小計 200\n消費税 20\nお預り1000\nお釣り780');
    assert.equal(value.date, '');
    assert.equal(value.amount, null);
    assert.equal(parser.parse('合計 ￥1.50').amount, null);
    assert.equal(parser.parse('合計 ￥0').amount, null);
    const long = parser.parse('店'.repeat(100) + '\n' + '商品名'.repeat(40) + ' 100\n合計100');
    assert.equal(long.shop.length, 80);
    assert.equal(long.productName.length, 80);
});

test('過去記録のカテゴリ候補は一意の有効な階層だけを返す', () => {
    const categories = [{ id: 'large', name: '食費' }, { id: 'middle', parentId: 'large' }, { id: 'small', parentId: 'middle' }, { id: 'other' }];
    const entries = [{ shop: '中央 スーパー', productName: '牛乳', categoryId: 'large', categoryMiddleId: 'middle', categorySmallId: 'small' }];
    assert.deepEqual(parser.category({ shop: '中央スーパー' }, entries, categories), ['large', 'middle', 'small']);
    assert.deepEqual(parser.category({ shop: '中央スーパー' }, [...entries, { shop: '中央スーパー', categoryId: 'other' }], categories), ['', '', '']);
    assert.deepEqual(parser.category({ shop: '中央スーパー' }, entries, []), ['', '', '']);
});
