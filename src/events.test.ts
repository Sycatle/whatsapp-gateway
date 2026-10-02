import { describe as suite, it } from 'node:test';
import assert from 'node:assert/strict';
import { describe, parseEvent } from './events.js';

const wrap = (value: object, field = 'messages') => ({ entry: [{ changes: [{ field, value }] }] });

suite('parseEvent', () => {
  it('extracts messages and statuses', () => {
    const event = parseEvent(wrap({
      messages: [{ id: 'wamid.1', from: '33612345678', type: 'text', text: { body: 'secret' } }],
      statuses: [{ id: 'wamid.2', status: 'read', recipient_id: '33612345678' }],
    }));
    assert.equal(event.messages[0]?.id, 'wamid.1');
    assert.equal(event.statuses[0]?.status, 'read');
  });

  it('ignores other fields and malformed payloads', () => {
    assert.deepEqual(parseEvent(wrap({ messages: [{ id: 'x' }] }, 'other')), { messages: [], statuses: [] });
    assert.deepEqual(parseEvent(null), { messages: [], statuses: [] });
    assert.deepEqual(parseEvent(wrap({ messages: [{ nope: 1 }] })), { messages: [], statuses: [] });
  });
});

suite('describe', () => {
  it('masks phone numbers and never includes message content', () => {
    const lines = describe(parseEvent(wrap({
      messages: [{ id: 'wamid.1', from: '33612345678', type: 'text', text: { body: 'secret' } }],
    })));
    assert.deepEqual(lines, ['message id=wamid.1 from=***5678 type=text']);
  });
});
