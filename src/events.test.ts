import { describe as suite, it } from 'node:test';
import assert from 'node:assert/strict';
import { describe, dropSeen, parseEvent, SeenKeys } from './events.js';

const wrap = (value: object, field = 'messages') => ({ entry: [{ changes: [{ field, value }] }] });
const text = (id: string, body = 'secret') => ({ id, from: '33612345678', timestamp: '1700000000', type: 'text', text: { body } });

suite('parseEvent: messages field', () => {
  it('extracts messages with the profile name and reply context', () => {
    const { messages } = parseEvent(wrap({
      contacts: [{ wa_id: '33612345678', profile: { name: 'Ada' } }],
      messages: [{ ...text('wamid.1'), context: { id: 'wamid.0', from: '1' } }],
    }));
    assert.deepEqual(messages, [{
      id: 'wamid.1', chat: '33612345678', from: '33612345678', direction: 'in', source: 'webhook',
      type: 'text', timestamp: 1700000000, content: { body: 'secret' }, contextId: 'wamid.0', name: 'Ada',
    }]);
  });

  it('keeps every other message type with its content', () => {
    const { messages } = parseEvent(wrap({
      messages: [
        { id: 'a', from: '1', type: 'location', location: { latitude: 1, longitude: 2 } },
        { id: 'b', from: '1', type: 'reaction', reaction: { message_id: 'x', emoji: '👍' } },
        { id: 'c', from: '1', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'y' } } },
        { id: 'd', from: '1', type: 'video', video: { id: '9', mime_type: 'video/mp4' } },
      ],
    }));
    assert.deepEqual(messages.map((m) => m.type), ['location', 'reaction', 'interactive', 'video']);
    assert.deepEqual(messages[1]!.content, { message_id: 'x', emoji: '👍' });
  });

  it('files group messages under the group id', () => {
    const { messages } = parseEvent(wrap({ messages: [{ ...text('g1'), group_id: 'GROUP' }] }));
    assert.equal(messages[0]!.chat, 'GROUP');
    assert.equal(messages[0]!.from, '33612345678');
  });

  it('extracts statuses', () => {
    const { statuses } = parseEvent(wrap({ statuses: [{ id: 'w', status: 'read', recipient_id: '1', timestamp: '5' }] }));
    assert.deepEqual(statuses, [{ id: 'w', status: 'read', recipient: '1', timestamp: 5 }]);
  });

  it('separates edits and revokes from messages', () => {
    const event = parseEvent(wrap({
      messages: [
        { id: 'e1', from: '1', timestamp: '7', type: 'edit', edit: { original_message_id: 'o1', message: { type: 'text', text: { body: 'new' } } } },
        { id: 'r1', from: '1', timestamp: '8', type: 'revoke', revoke: { original_message_id: 'o2' } },
      ],
    }));
    assert.deepEqual(event.messages, []);
    assert.deepEqual(event.edits, [{ id: 'o1', eventId: 'e1', chat: '1', timestamp: 7, type: 'text', content: { body: 'new' } }]);
    assert.deepEqual(event.revokes, [{ id: 'o2', eventId: 'r1', chat: '1', timestamp: 8 }]);
  });

  it('ignores malformed payloads', () => {
    for (const payload of [null, 'x', {}, wrap({ messages: [{ nope: 1 }] }), wrap({ messages: 'no' })]) {
      assert.equal(parseEvent(payload).messages.length, 0);
    }
  });
});

suite('parseEvent: business-scoped user ids', () => {
  it('falls back to the BSUID when the phone number is not shared', () => {
    const { messages, statuses } = parseEvent(wrap({
      contacts: [{ user_id: 'US.123', profile: { name: 'Ada', username: 'ada' } }],
      messages: [{ id: 'm', from_user_id: 'US.123', timestamp: '1', type: 'text', text: { body: 'hi' } }],
      statuses: [{ id: 's', status: 'delivered', recipient_user_id: 'US.123' }],
    }));
    assert.deepEqual([messages[0]!.chat, messages[0]!.userId, messages[0]!.name], ['US.123', 'US.123', 'Ada']);
    assert.equal(statuses[0]!.recipient, 'US.123');
  });

  it('keeps both identifiers when both are present, and unsupported-message errors', () => {
    const { messages } = parseEvent(wrap({
      messages: [{ id: 'm', from: '33600000001', from_user_id: 'FR.9', timestamp: '1', type: 'unsupported', errors: [{ code: 131060 }] }],
    }));
    assert.deepEqual([messages[0]!.chat, messages[0]!.userId], ['33600000001', 'FR.9']);
    assert.deepEqual(messages[0]!.content, { errors: [{ code: 131060 }] });
  });
});

suite('parseEvent: coexistence fields', () => {
  it('reads messages sent from the Business app', () => {
    const { messages } = parseEvent(wrap({
      message_echoes: [{ from: '15550783881', to: '16505551234', id: 'wamid.e', timestamp: '1700255121', type: 'text', text: { body: 'hi' } }],
    }, 'smb_message_echoes'));
    assert.equal(messages[0]!.chat, '16505551234');
    assert.equal(messages[0]!.direction, 'out');
    assert.equal(messages[0]!.source, 'app');
  });

  it('reads history threads, direction, status and progress', () => {
    const { messages, history } = parseEvent(wrap({
      history: [{
        metadata: { phase: 1, chunk_order: 2, progress: 55 },
        threads: [{
          id: '16505551234',
          messages: [
            { from: '16505551234', id: 'h1', timestamp: '1', type: 'text', text: { body: 'q' }, history_context: { status: 'READ' } },
            { from: '15550783881', to: '16505551234', id: 'h2', timestamp: '2', type: 'media_placeholder' },
          ],
        }],
      }],
    }, 'history'));
    assert.deepEqual(messages.map((m) => [m.direction, m.source, m.status]), [['in', 'history', 'read'], ['out', 'history', undefined]]);
    assert.deepEqual(history, [{ phase: 1, chunk: 2, progress: 55, messages: 2 }]);
  });

  it('reads contact sync', () => {
    const { contacts } = parseEvent(wrap({
      state_sync: [
        { type: 'contact', action: 'add', contact: { full_name: 'Pablo Morales', first_name: 'Pablo', phone_number: '16505551234' } },
        { type: 'contact', action: 'remove', contact: { phone_number: '16505550000' } },
      ],
    }, 'smb_app_state_sync'));
    assert.deepEqual(contacts, [
      { phone: '16505551234', name: 'Pablo Morales', action: 'add' },
      { phone: '16505550000', action: 'remove' },
    ]);
  });

  it('passes other fields through', () => {
    const value = { event: 'PARTNER_REMOVED' };
    assert.deepEqual(parseEvent(wrap(value, 'account_update')).changes, [{ field: 'account_update', value }]);
  });
});

suite('describe', () => {
  it('masks identifiers and never includes message content', () => {
    const lines = describe(parseEvent(wrap({ messages: [text('wamid.1')] })));
    assert.deepEqual(lines, ['message id=wamid.1 chat=***5678 dir=in source=webhook type=text']);
  });
});

suite('dropSeen', () => {
  const event = () => parseEvent(wrap({
    messages: [text('wamid.1')],
    statuses: [{ id: 'wamid.2', status: 'read', recipient_id: '1' }],
  }));

  it('drops retried messages and statuses', () => {
    const seen = new SeenKeys();
    assert.equal(dropSeen(event(), seen).messages.length, 1);
    const retry = dropSeen(event(), seen);
    assert.deepEqual([retry.messages, retry.statuses], [[], []]);
  });

  it('keeps history messages, which are idempotent downstream', () => {
    const seen = new SeenKeys();
    const history = () => parseEvent(wrap({ history: [{ threads: [{ id: '1', messages: [{ id: 'h', from: '1', type: 'text', text: {} }] }] }] }, 'history'));
    assert.equal(dropSeen(history(), seen).messages.length, 1);
    assert.equal(dropSeen(history(), seen).messages.length, 1);
  });

  it('forgets the oldest key beyond its capacity', () => {
    const seen = new SeenKeys(2);
    assert.ok(seen.add('a') && seen.add('b') && seen.add('c'));
    assert.ok(seen.add('a'));
  });
});
