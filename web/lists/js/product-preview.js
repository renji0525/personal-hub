// 商品ページと画像の取得先を確認し、GASでも同じ判定を使用する
const ListProductPreview = (() => {
    const shops = new Set([
        'amazon.co.jp', 'www.amazon.co.jp', 'amzn.asia', 'amzn.to',
        'item.rakuten.co.jp', 'product.rakuten.co.jp', 'a.r10.to',
        'store.shopping.yahoo.co.jp', 'shopping.yahoo.co.jp',
        'jp.mercari.com', 'www.yodobashi.com', 'www.biccamera.com'
    ]);
    const imageHosts = new Set([
        'm.media-amazon.com', 'images-na.ssl-images-amazon.com',
        'image.rakuten.co.jp', 'thumbnail.image.rakuten.co.jp', 'shop.r10s.jp', 'tshop.r10s.jp',
        'item-shopping.c.yimg.jp', 'shopping.c.yimg.jp', 'static.mercdn.net',
        'image.yodobashi.com', 'image.biccamera.com'
    ]);
    function parse(value) {
        if (typeof value !== 'string' || value.length > 2048 || /[\s\x00-\x1f\x7f<>"'\\]/.test(value)) return null;
        const match = /^https:\/\/([a-z0-9.-]+)(?=[/?#]|$)[^#]*/i.exec(value);
        return match ? { url: match[0], host: match[1].toLowerCase(), origin: 'https://' + match[1].toLowerCase() } : null;
    }
    function absolute(value, page) {
        if (value.startsWith('//')) return 'https:' + value;
        if (value.startsWith('/')) return parse(page).origin + value;
        return value;
    }
    function pageUrl(value, base) {
        const result = parse(base && typeof value === 'string' ? absolute(value, base) : value);
        return result && shops.has(result.host) ? result.url : '';
    }
    function imageUrl(value) {
        const result = parse(value);
        return result && (shops.has(result.host) || imageHosts.has(result.host)) ? result.url : '';
    }
    function extract(html, page) {
        const images = new Map();
        for (const tag of html.matchAll(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
            const attributes = new Map();
            for (const [, key, double, single] of tag[0].matchAll(/\s([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
                attributes.set(key.toLowerCase(), double ?? single);
            const name = (attributes.get('property') || attributes.get('name') || '').toLowerCase();
            const value = attributes.get('content');
            if (!['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src'].includes(name) || !value) continue;
            const url = imageUrl(absolute(value.trim().replace(/&(?:amp|#38|#x26);/gi, '&'), page));
            if (url && !images.has(name)) images.set(name, url);
        }
        return images.get('og:image:secure_url') || images.get('og:image') || images.get('twitter:image') || images.get('twitter:image:src') || '';
    }
    return { pageUrl, imageUrl, extract };
})();
