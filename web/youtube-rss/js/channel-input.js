// ブラウザとGASで同じ入力規則を使い、取得先をYouTubeのチャンネルに限定する
var YouTubeChannelInput = (() => {
    const validId = value => typeof value === 'string' && /^UC[a-zA-Z0-9_-]{22}$/.test(value);
    function parse(value) {
        if (typeof value !== 'string' || !value.trim() || value.length > 1000) throw new Error('チャンネルURL、@ハンドル、またはUCから始まるチャンネルIDを入力してください。');
        value = value.trim();
        if (validId(value)) return { channelId: value };
        if (/[\x00-\x20\\<>"']/.test(value)) throw new Error('チャンネルURLの形式を確認してください。');
        let path;
        if (value.startsWith('@')) path = '/' + value;
        else {
            const match = value.match(/^(?:https?:\/\/)?(?:www\.|m\.|music\.)?youtube\.com(\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$/i);
            if (!match) throw new Error('YouTubeのチャンネルURLを入力してください。');
            path = match[1] || '/';
        }
        let parts;
        try { parts = path.replace(/\/+$/, '').split('/').slice(1).map(decodeURIComponent); }
        catch (error) { throw new Error('URLの文字コードを確認してください。'); }
        const suffix = ['featured', 'videos', 'shorts', 'streams', 'playlists', 'community', 'about', 'live'];
        const safeName = name => typeof name === 'string' && name.length > 0 && name.length <= 100 && !/[\s\/\\?#@<>"'&%:]/.test(name) && !['.', '..'].includes(name);
        let base;
        if (parts[0] === 'channel') {
            if (!validId(parts[1]) || parts.length > 3 || parts[2] && !suffix.includes(parts[2])) throw new Error('チャンネルIDを含むURLを確認してください。');
            return { channelId: parts[1] };
        } else if (parts[0]?.startsWith('@') && safeName(parts[0].slice(1))) base = '@' + encodeURIComponent(parts[0].slice(1));
        else if (['user', 'c'].includes(parts[0]) && safeName(parts[1])) { base = parts[0] + '/' + encodeURIComponent(parts[1]); parts = parts.slice(1); }
        else if (safeName(parts[0]) && !['watch','shorts','live','playlist','feed','results','redirect','embed','account','gaming','channel','user','c'].includes(parts[0].toLowerCase())) base = encodeURIComponent(parts[0]);
        else throw new Error('動画URLではなく、チャンネルのURLを入力してください。');
        if (parts.length > 2 || parts[1] && !suffix.includes(parts[1])) throw new Error('チャンネルのホームURLを入力してください。');
        return { url: 'https://www.youtube.com/' + base };
    }
    function metadata(html) {
        const match = /"channelMetadataRenderer"\s*:\s*\{/.exec(html);
        if (!match) return null;
        const start = match.index + match[0].length - 1; let depth = 0, quoted = false, escaped = false;
        for (let i = start; i < html.length; i++) {
            const char = html[i];
            if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
            else if (char === '"') quoted = true;
            else if (char === '{') depth++;
            else if (char === '}' && --depth === 0) { try { const data = JSON.parse(html.slice(start, i + 1)); return validId(data.externalId) ? data.externalId : null; } catch (error) { return null; } }
        }
        return null;
    }
    function extract(html) {
        if (typeof html !== 'string' || html.length > 3000000) return null;
        const id = metadata(html); if (id) return id;
        const head = html.split(/<\/head\s*>/i)[0];
        for (const tag of head.match(/<link\b[^>]*>/gi) || []) {
            const attributes = {};
            for (const match of tag.matchAll(/\b(href|rel|type)\s*=\s*(["'])(.*?)\2/gi)) attributes[match[1].toLowerCase()] = match[3].replace(/&amp;/gi, '&');
            if (attributes.rel?.toLowerCase() === 'canonical') {
                try { const result = parse(attributes.href); if (result.channelId) return result.channelId; } catch (error) { /* チャンネルID形式以外は次の候補を確認する */ }
            }
            if (attributes.type?.toLowerCase() === 'application/rss+xml' && /^https:\/\/(?:www\.)?youtube\.com\/feeds\/videos\.xml\?/.test(attributes.href || '')) {
                const match = attributes.href.split('?')[1].match(/(?:^|&)channel_id=(UC[a-zA-Z0-9_-]{22})(?:&|$)/); if (match) return match[1];
            }
        }
        return null;
    }
    return { parse, extract, validId };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = YouTubeChannelInput;
