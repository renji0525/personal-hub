const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../web/talk/js/model.js');
const message = (id, sentAt) => ({ id, sender: 'alice', text: '本文', sentAt });
test('トークを日時とIDで安定して並べ、送信中の追加と再送を保持する', () => {
    const first = message('message_01', '2026-11-19T10:00:00.000Z');
    const second = message('message_02', first.sentAt);
    const last = message('message_03', '2026-11-19T10:01:00.000Z');
    const local = { revision: 0, messages: [second, first], pending: [first, last] };
    assert.deepEqual(model.view(local), [first, second, last]);
    assert.deepEqual(model.acknowledge(local, { revision: 1, messages: [first, second] }, [first]).pending, [last]);
    assert.equal(model.message({ ...first, text: ' 本文 ' }).text, '本文');
    for (const change of [{ text: ' ' }, { text: 'a'.repeat(2001) }, { sentAt: 'invalid' }, { sender: '' }])
        assert.throws(() => model.message({ ...first, ...change }));
});
