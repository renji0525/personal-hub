// レシートの文字解析は家計簿の保存モデルから独立させる
var BudgetReceiptParser = (() => {
    const clean = value => value.normalize('NFKC').replace(/[ \t\u3000]+/g, ' ').trim();
    function amount(value) {
        const source = value.replace(/\([^)]*\)/g, '').replace(/^\s*[0-9]+\s*点\s*/, '');
        const match = source.match(/[¥￥]\s*([0-9][0-9,]*(?:\.[0-9]+)?)/) ||
            source.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*円/) ||
            source.match(/([0-9][0-9,]*(?:\.[0-9]+)?)/);
        if (!match) return null;
        const number = Number(match[1].replace(/,/g, ''));
        return Number.isSafeInteger(number) && number > 0 && number <= 999999999999 ? number : null;
    }
    function date(text) {
        const match = text.match(/(20[0-9]{2})\s*[年/.\-]\s*([0-9]{1,2})\s*[月/.\-]\s*([0-9]{1,2})日?/);
        if (!match) return '';
        const value = [match[1], match[2].padStart(2, '0'), match[3].padStart(2, '0')].join('-');
        const parsed = new Date(value + 'T00:00:00Z');
        return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : '';
    }
    function parse(text) {
        const lines = text.normalize('NFKC').split(/\r?\n/).map(clean).filter(Boolean);
        const ignored = /小\s*計|税|預[りか]|おつり|お釣|釣銭|釣り|点数|点\s*計|値引|割引|ポイント|クレジット|現金|カード|決済|支払方法|領収|レシート|電話|TEL|登録番号|担当|責任者|営業時間|住所|〒|[0-9]{2,4}[-ー][0-9]{2,4}[-ー][0-9]{3,4}/i;
        let total = null;
        // 小計・預り・釣銭・税額を合計として採用しない
        for (let i = 0; i < lines.length; i++) {
            const label = lines[i].replace(/\s/g, '');
            if (!/(?:合計|総額|お買上額|お買上金額|ご利用額|お支払(?:金額|い額)|TOTAL)/i.test(label) ||
                /小計|税額|消費税|対象|預[りか]|釣/.test(label)) continue;
            const tail = lines[i].replace(/^.*?(?:合\s*計|総額|お買上額|お買上金額|ご利用額|お支払(?:金額|い額)|TOTAL)[:：]?/i, '');
            const candidate = amount(tail) ?? (lines[i + 1] && /^[¥￥]?[\d,]+円?$/.test(lines[i + 1].replace(/\s/g, '')) ? amount(lines[i + 1]) : null);
            if (candidate !== null) total = candidate;
        }
        const items = [];
        for (const line of lines) {
            if (ignored.test(line) || /合\s*計|TOTAL|総額/i.test(line) || date(line)) continue;
            const match = line.match(/^(.+?)(?:\s+|(?=[¥￥]))(?:[¥￥]\s*)?([0-9][0-9,]*)\s*円?[※*軽]?$/);
            if (!match || !amount(match[2])) continue;
            const name = match[1].replace(/[※*軽]$/, '').trim();
            if (name && !/^[\d\s.,%x×]+$/.test(name)) items.push(name);
        }
        const shop = lines.slice(0, 8).find(line =>
            !ignored.test(line) && !date(line) && !/合\s*計|TOTAL|ありがとう|いらっしゃい|^[\d\s:./\-]+$/i.test(line) &&
            !/\s[¥￥]?[\d,]+円?[※*軽]?$/.test(line)) || '';
        return {
            type: 'expense', date: date(lines.join('\n')), amount: total,
            shop: shop.slice(0, 80), productName: items.join('・').slice(0, 80),
            memo: items.length > 1 ? items.join('、').slice(0, 200) : '', items
        };
    }
    function category(parsed, entries, categories) {
        const normalize = value => clean(value || '').replace(/\s/g, '').toLowerCase();
        const sameProduct = entries.filter(entry => parsed.productName && normalize(entry.productName) === normalize(parsed.productName));
        const matches = sameProduct.length ? sameProduct : entries.filter(entry => parsed.shop && normalize(entry.shop) === normalize(parsed.shop));
        const paths = new Map();
        for (const entry of matches) {
            if (!categories.some(value => value.id === entry.categoryId && !value.parentId)) continue;
            const middle = categories.find(value => value.id === entry.categoryMiddleId && value.parentId === entry.categoryId);
            const small = middle && categories.find(value => value.id === entry.categorySmallId && value.parentId === middle.id);
            const path = [entry.categoryId, middle?.id || '', small?.id || ''];
            paths.set(path.join('/'), path);
        }
        return paths.size === 1 ? [...paths.values()][0] : ['', '', ''];
    }
    return { parse, category };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = BudgetReceiptParser;
