import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ContactSync, Edit, Message, Revoke, Status } from './events.js';

const DAY = 24 * 60 * 60;
/** Delivery states only move forward; `failed` always wins. */
const RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, played: 4 };

export interface StoredMessage {
  id: string;
  chat: string;
  from: string;
  direction: string;
  source: string;
  type: string;
  timestamp: number;
  content: unknown;
  contextId: string | null;
  status: string | null;
  mediaPath: string | null;
  edited: boolean;
  deleted: boolean;
}

export interface Conversation {
  chat: string;
  name: string | null;
  messages: number;
  lastTimestamp: number;
  lastInbound: number | null;
  /** Whether free-form messages are allowed right now (24 h after the user's last live message). */
  windowOpen: boolean;
  windowExpiresAt: number | null;
}

export type Store = ReturnType<typeof openStore>;

export function openStore(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  if (path !== ':memory:') chmodSync(path, 0o600);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat TEXT NOT NULL,
      sender TEXT NOT NULL,
      direction TEXT NOT NULL,
      source TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT,
      context_id TEXT,
      timestamp INTEGER NOT NULL,
      status TEXT,
      media_path TEXT,
      edited INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS messages_chat ON messages (chat, timestamp);
    CREATE TABLE IF NOT EXISTS contacts (
      phone TEXT PRIMARY KEY,
      name TEXT,
      profile_name TEXT
    );
  `);

  const q = {
    insert: db.prepare(`
      INSERT INTO messages (id, chat, sender, direction, source, type, content, context_id, timestamp, status, media_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        type = excluded.type, content = excluded.content, context_id = excluded.context_id,
        media_path = COALESCE(excluded.media_path, messages.media_path)
      WHERE messages.type = 'media_placeholder'`),
    status: db.prepare('SELECT status FROM messages WHERE id = ?'),
    setStatus: db.prepare('UPDATE messages SET status = ? WHERE id = ?'),
    edit: db.prepare('UPDATE messages SET type = ?, content = ?, edited = 1 WHERE id = ?'),
    mediaOf: db.prepare('SELECT media_path FROM messages WHERE id = ?'),
    revoke: db.prepare('UPDATE messages SET deleted = 1, content = NULL, media_path = NULL WHERE id = ?'),
    setMedia: db.prepare('UPDATE messages SET media_path = ? WHERE id = ?'),
    profile: db.prepare(`
      INSERT INTO contacts (phone, profile_name) VALUES (?, ?)
      ON CONFLICT (phone) DO UPDATE SET profile_name = excluded.profile_name`),
    contact: db.prepare(`
      INSERT INTO contacts (phone, name) VALUES (?, ?)
      ON CONFLICT (phone) DO UPDATE SET name = excluded.name`),
    contacts: db.prepare(`
      SELECT phone, name, profile_name AS profileName FROM contacts
      WHERE name IS NOT NULL OR profile_name IS NOT NULL ORDER BY COALESCE(name, profile_name)`),
    conversations: db.prepare(`
      SELECT m.chat AS chat, COALESCE(c.name, c.profile_name) AS name, COUNT(*) AS messages,
             MAX(m.timestamp) AS lastTimestamp,
             MAX(CASE WHEN m.direction = 'in' AND m.source = 'webhook' THEN m.timestamp END) AS lastInbound
      FROM messages m LEFT JOIN contacts c ON c.phone = m.chat
      GROUP BY m.chat ORDER BY lastTimestamp DESC LIMIT ?`),
    thread: db.prepare(`
      SELECT id, chat, sender AS "from", direction, source, type, timestamp, content, context_id AS contextId,
             status, media_path AS mediaPath, edited, deleted
      FROM messages WHERE chat = ? AND timestamp < ? ORDER BY timestamp DESC, id LIMIT ?`),
    chatMedia: db.prepare('SELECT media_path FROM messages WHERE chat = ? AND media_path IS NOT NULL'),
    deleteMessages: db.prepare('DELETE FROM messages WHERE chat = ?'),
    deleteContact: db.prepare('DELETE FROM contacts WHERE phone = ?'),
  };

  const transaction = <T>(work: () => T): T => {
    db.exec('BEGIN');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  const run = (statement: ReturnType<typeof db.prepare>, ...params: SQLInputValue[]) => statement.run(...params);

  return {
    saveMessages(messages: Message[]): void {
      transaction(() => {
        for (const m of messages) {
          run(q.insert, m.id, m.chat, m.from, m.direction, m.source, m.type, JSON.stringify(m.content), m.contextId ?? null,
            m.timestamp, m.status ?? null, m.mediaPath ?? null);
          if (m.name && m.direction === 'in') run(q.profile, m.chat, m.name);
        }
      });
    },

    applyStatus(s: Status): void {
      const row = q.status.get(s.id) as { status: string | null } | undefined;
      if (!row) return;
      const current = RANK[row.status ?? ''] ?? -1;
      if (s.status === 'failed' || (RANK[s.status] ?? -1) > current) run(q.setStatus, s.status, s.id);
    },

    applyEdit(e: Edit): void {
      run(q.edit, e.type, JSON.stringify(e.content), e.id);
    },

    /** Forgets the content of a deleted message and returns the media file to remove, if any. */
    applyRevoke(r: Revoke): string | null {
      const row = q.mediaOf.get(r.id) as { media_path: string | null } | undefined;
      run(q.revoke, r.id);
      return row?.media_path ?? null;
    },

    setMediaPath(id: string, path: string): void {
      run(q.setMedia, path, id);
    },

    syncContact(c: ContactSync): void {
      run(q.contact, c.phone, c.action === 'remove' ? null : c.name ?? null);
    },

    contacts: () =>
      (q.contacts.all() as { phone: string; name: string | null; profileName: string | null }[]).map((row) => ({ ...row })),

    conversations(limit = 50, now = Math.floor(Date.now() / 1000)): Conversation[] {
      const rows = q.conversations.all(limit) as Omit<Conversation, 'windowOpen' | 'windowExpiresAt'>[];
      return rows.map((row) => {
        const expiresAt = row.lastInbound === null ? null : row.lastInbound + DAY;
        return { ...row, windowOpen: expiresAt !== null && expiresAt > now, windowExpiresAt: expiresAt };
      });
    },

    /** Newest first. Pass the oldest timestamp received as `before` to get the previous page. */
    messages(chat: string, limit = 50, before = Number.MAX_SAFE_INTEGER): StoredMessage[] {
      const rows = q.thread.all(chat, before, limit) as (Omit<StoredMessage, 'content' | 'edited' | 'deleted'> & {
        content: string | null; edited: number; deleted: number;
      })[];
      return rows.map((row) => ({
        ...row,
        content: row.content === null ? null : JSON.parse(row.content),
        edited: row.edited === 1,
        deleted: row.deleted === 1,
      }));
    },

    /** Erases everything held about a chat and returns the media files to remove. */
    deleteChat(chat: string): string[] {
      return transaction(() => {
        const paths = (q.chatMedia.all(chat) as { media_path: string }[]).map((row) => row.media_path);
        run(q.deleteMessages, chat);
        run(q.deleteContact, chat);
        return paths;
      });
    },

    close: () => db.close(),
  };
}
