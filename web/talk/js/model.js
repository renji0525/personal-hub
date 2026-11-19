// 投稿日時とIDで順番を固定し、受信順や同期の再試行に依存させない
var TalkModel = (() => {
    function message(value) {
        if (!value || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(value.id) ||
            typeof value.sender !== 'string' || !/^[a-z0-9_-]{3,32}$/.test(value.sender) ||
            typeof value.text !== 'string' || !value.text.trim() || value.text.length > 2000 ||
            typeof value.sentAt !== 'string' || !Number.isFinite(Date.parse(value.sentAt))) {
            throw new Error('本文は1〜2000文字で入力し、投稿情報を確認してください。');
        }
        return { id: value.id, sender: value.sender, text: value.text.trim(), sentAt: new Date(value.sentAt).toISOString() };
    }
    function ordered(messages) {
        return [...messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.id.localeCompare(b.id));
    }
    function view(local) {
        const messages = new Map(local.messages.map(value => [value.id, value]));
        for (const value of local.pending) if (!messages.has(value.id)) messages.set(value.id, value);
        return ordered([...messages.values()]);
    }
    function acknowledge(local, result, sent) {
        const saved = new Set(sent.map(value => value.id));
        return { revision: result.revision, messages: result.messages, pending: local.pending.filter(value => !saved.has(value.id)) };
    }
    return { message, ordered, view, acknowledge };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = TalkModel;
