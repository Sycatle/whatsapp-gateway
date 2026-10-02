import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Message } from './events.js';
import { openStore, type Store } from './store.js';

const message = (over: Partial<Message> = {}): Message => ({
  id: 'm1', chat: '33600000001', from: '33600000001', direction: 'in', source: 'webhook',
  type: 'text', timestamp: 1000, content: { body: 'hello' }, ...over,
});

describe('store', () => {
  let store: Store;
  beforeEach(() => { store = openStore(':memory:'); });

  it('saves messages once and returns a thread newest first', () => {
    store.saveMessages([message(), message(), message({ id: 'm2', timestamp: 2000, direction: 'out', content: { body: 'yo' } })]);
    const thread = store.messages('33600000001');
    assert.deepEqual(thread.map((m) => m.id), ['m2', 'm1']);
    assert.deepEqual(thread[1]!.content, { body: 'hello' });
    assert.deepEqual(store.messages('33600000001', 10, 2000).map((m) => m.id), ['m1']);
  });

  it('pages with a composite cursor when timestamps collide', () => {
    store.saveMessages(['a', 'b', 'c'].map((id) => message({ id, timestamp: 1000 })));
    const first = store.messages('33600000001', 2);
    assert.deepEqual(first.map((m) => m.id), ['a', 'b']);
    assert.deepEqual(store.messages('33600000001', 2, 1000, 'b').map((m) => m.id), ['c']);
    assert.deepEqual(store.messages('33600000001', 2, 1000).map((m) => m.id), []);
  });

  it('only moves delivery status forward, except for failures', () => {
    store.saveMessages([message({ direction: 'out', status: 'sent' })]);
    const status = (s: string) => { store.applyStatus({ id: 'm1', status: s, recipient: 'x', timestamp: 1 }); return store.messages('33600000001')[0]!.status; };
    assert.equal(status('read'), 'read');
    assert.equal(status('delivered'), 'read');
    assert.equal(status('failed'), 'failed');
    store.applyStatus({ id: 'unknown', status: 'read', recipient: 'x', timestamp: 1 });
  });

  it('applies edits and forgets deleted content, returning the media to remove', () => {
    store.saveMessages([message({ type: 'image', content: { id: '9' }, mediaPath: '/d/9.jpg' })]);
    store.applyEdit({ id: 'm1', eventId: 'e', chat: 'c', timestamp: 2, type: 'image', content: { id: '9', caption: 'new' } });
    assert.equal(store.messages('33600000001')[0]!.edited, true);
    assert.equal(store.applyRevoke({ id: 'm1', eventId: 'r', chat: 'c', timestamp: 3 }), '/d/9.jpg');
    const [stored] = store.messages('33600000001');
    assert.deepEqual([stored!.deleted, stored!.content, stored!.mediaPath], [true, null, null]);
  });

  it('replaces a history media placeholder with the real message', () => {
    store.saveMessages([message({ type: 'media_placeholder', content: {}, source: 'history' })]);
    store.saveMessages([message({ type: 'video', content: { id: '5' }, source: 'history' })]);
    assert.equal(store.messages('33600000001')[0]!.type, 'video');
    store.saveMessages([message({ type: 'text', content: { body: 'other' } })]);
    assert.equal(store.messages('33600000001')[0]!.type, 'video');
  });

  it('computes the 24 h window from live inbound messages only', () => {
    store.saveMessages([
      message({ id: 'live', timestamp: 10_000 }),
      message({ id: 'old', chat: 'b', timestamp: 50_000, source: 'history' }),
      message({ id: 'out', chat: 'c', direction: 'out', timestamp: 50_000 }),
    ]);
    const byChat = Object.fromEntries(store.conversations(50, 20_000).map((c) => [c.chat, c]));
    assert.equal(byChat['33600000001']!.windowOpen, true);
    assert.equal(byChat['33600000001']!.windowExpiresAt, 10_000 + 86_400);
    assert.equal(byChat.b!.windowOpen, false);
    assert.equal(byChat.c!.windowOpen, false);
    assert.equal(store.conversations(50, 10_000 + 86_400)[0]!.windowOpen, false);
  });

  it('tracks contacts from profile names and address-book sync', () => {
    store.saveMessages([message({ name: 'Ada' })]);
    assert.equal(store.conversations()[0]!.name, 'Ada');
    store.syncContact({ phone: '33600000001', name: 'Ada Lovelace', action: 'add' });
    assert.deepEqual(store.contacts(), [{ phone: '33600000001', name: 'Ada Lovelace', profileName: 'Ada' }]);
    store.syncContact({ phone: '33600000001', action: 'remove' });
    assert.equal(store.contacts()[0]!.name, null);
  });

  it('merges a BSUID chat into the phone chat once both are seen', () => {
    store.saveMessages([message({ id: 'b1', chat: 'FR.9', from: 'FR.9', userId: 'FR.9', name: 'Ada' })]);
    assert.deepEqual(store.conversations().map((c) => c.chat), ['FR.9']);
    store.saveMessages([message({ id: 'p1', timestamp: 3000, userId: 'FR.9' })]);
    assert.deepEqual(store.conversations().map((c) => [c.chat, c.messages, c.name]), [['33600000001', 2, 'Ada']]);
    store.saveMessages([message({ id: 'b2', timestamp: 4000, chat: 'FR.9', from: 'FR.9', userId: 'FR.9' })]);
    assert.equal(store.messages('FR.9').length, 3);
    assert.equal(store.resolveChat('FR.9'), '33600000001');
  });

  it('erases a chat and lists its media', () => {
    store.saveMessages([message({ mediaPath: '/d/a.jpg', name: 'Ada' }), message({ id: 'm2', chat: 'other', from: 'other' })]);
    assert.deepEqual(store.deleteChat('33600000001'), ['/d/a.jpg']);
    assert.deepEqual(store.conversations().map((c) => c.chat), ['other']);
    assert.deepEqual(store.contacts(), []);
  });
});
