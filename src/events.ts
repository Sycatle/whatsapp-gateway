export type Direction = 'in' | 'out';
/** `webhook`: live Cloud API traffic, `api`: sent through this server, `app`: sent from the WhatsApp Business app, `history`: synced backlog. */
export type Source = 'webhook' | 'api' | 'app' | 'history';

export interface Message {
  id: string;
  /** The other party: a user's phone number, or a group id. */
  chat: string;
  from: string;
  direction: Direction;
  source: Source;
  type: string;
  timestamp: number;
  /** The type-specific object of the payload (`text`, `image`, `location`...). */
  content: Record<string, unknown>;
  contextId?: string;
  /** Business-scoped user ID of the user, present once WhatsApp usernames roll out. */
  userId?: string;
  name?: string;
  /** Delivery status, known for history messages only. */
  status?: string;
  mediaPath?: string;
}

export interface Status {
  id: string;
  status: string;
  recipient: string;
  timestamp: number;
  errors?: unknown;
}

/** A user edited a message (`id` is the original message). */
export interface Edit {
  id: string;
  eventId: string;
  chat: string;
  timestamp: number;
  type: string;
  content: Record<string, unknown>;
}

/** A user deleted a message (`id` is the original message). */
export interface Revoke {
  id: string;
  eventId: string;
  chat: string;
  timestamp: number;
}

export interface ContactSync {
  phone: string;
  name?: string;
  action: string;
}

export interface HistoryProgress {
  phase?: number;
  chunk?: number;
  progress?: number;
  messages: number;
  errors?: unknown;
}

/** Any other webhook field (templates, quality, account updates, calls...), passed through untouched. */
export interface Change {
  field: string;
  value: unknown;
}

export interface ParsedEvent {
  messages: Message[];
  statuses: Status[];
  edits: Edit[];
  revokes: Revoke[];
  contacts: ContactSync[];
  history: HistoryProgress[];
  changes: Change[];
}

type Obj = Record<string, unknown>;
const rec = (value: unknown): Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Obj) : {};
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;
const num = (value: unknown): number | undefined => (Number.isFinite(Number(value)) && value !== '' ? Number(value) : undefined);
const now = () => Math.floor(Date.now() / 1000);

export const emptyEvent = (): ParsedEvent => ({
  messages: [], statuses: [], edits: [], revokes: [], contacts: [], history: [], changes: [],
});

interface Origin {
  chat: string;
  direction: Direction;
  source: Source;
  name?: string;
  userId?: string;
}

function toMessage(raw: Obj, origin: Origin): Message | null {
  const id = str(raw.id);
  const type = str(raw.type);
  if (!id || !type) return null;
  const message: Message = {
    id,
    chat: origin.chat,
    from: str(raw.from) ?? origin.chat,
    direction: origin.direction,
    source: origin.source,
    type,
    timestamp: num(raw.timestamp) ?? now(),
    content: raw.errors ? { ...rec(raw[type]), errors: raw.errors } : rec(raw[type]),
  };
  if (origin.userId) message.userId = origin.userId;
  const contextId = str(rec(raw.context).id);
  if (contextId) message.contextId = contextId;
  if (origin.name) message.name = origin.name;
  const status = str(rec(raw.history_context).status);
  if (status) message.status = status.toLowerCase();
  return message;
}

function parseMessages(value: Obj, event: ParsedEvent): void {
  const names = new Map<string, string>();
  for (const contact of arr(value.contacts).map(rec)) {
    const profile = rec(contact.profile);
    const name = str(profile.name) ?? str(profile.username);
    if (!name) continue;
    for (const key of [str(contact.wa_id), str(contact.user_id)]) if (key) names.set(key, name);
  }
  for (const raw of arr(value.messages).map(rec)) {
    // Users with a WhatsApp username may be known by their BSUID only.
    const userId = str(raw.from_user_id);
    const from = str(raw.from) ?? userId;
    const chat = str(raw.group_id) ?? from;
    if (!chat) continue;
    if (raw.type === 'edit' || raw.type === 'revoke') {
      const eventId = str(raw.id);
      const timestamp = num(raw.timestamp) ?? now();
      if (!eventId) continue;
      if (raw.type === 'revoke') {
        const id = str(rec(raw.revoke).original_message_id);
        if (id) event.revokes.push({ id, eventId, chat, timestamp });
      } else {
        const edit = rec(raw.edit);
        const inner = rec(edit.message);
        const id = str(edit.original_message_id);
        const type = str(inner.type);
        if (id && type) event.edits.push({ id, eventId, chat, timestamp, type, content: rec(inner[type]) });
      }
      continue;
    }
    const name = names.get(from!) ?? (userId ? names.get(userId) : undefined);
    const message = toMessage(raw, { chat, direction: 'in', source: 'webhook', name, userId });
    if (message) event.messages.push(message);
  }
  for (const raw of arr(value.statuses).map(rec)) {
    const id = str(raw.id);
    const status = str(raw.status);
    const recipient = str(raw.recipient_id) ?? str(raw.recipient_user_id);
    if (!id || !status || !recipient) continue;
    const parsed: Status = { id, status, recipient, timestamp: num(raw.timestamp) ?? now() };
    if (raw.errors) parsed.errors = raw.errors;
    event.statuses.push(parsed);
  }
}

function parseEchoes(value: Obj, event: ParsedEvent): void {
  for (const raw of arr(value.message_echoes).map(rec)) {
    const chat = str(raw.to);
    if (!chat) continue;
    const message = toMessage(raw, { chat, direction: 'out', source: 'app' });
    if (message) event.messages.push(message);
  }
}

function parseHistory(value: Obj, event: ParsedEvent): void {
  for (const part of arr(value.history).map(rec)) {
    const meta = rec(part.metadata);
    let count = 0;
    for (const thread of arr(part.threads).map(rec)) {
      const chat = str(thread.id);
      if (!chat) continue;
      for (const raw of arr(thread.messages).map(rec)) {
        const direction = str(raw.from) === chat ? 'in' : 'out';
        const message = toMessage(raw, { chat, direction, source: 'history' });
        if (!message) continue;
        event.messages.push(message);
        count++;
      }
    }
    const progress: HistoryProgress = { messages: count };
    const phase = num(meta.phase);
    const chunk = num(meta.chunk_order);
    const percent = num(meta.progress);
    if (phase !== undefined) progress.phase = phase;
    if (chunk !== undefined) progress.chunk = chunk;
    if (percent !== undefined) progress.progress = percent;
    if (part.errors) progress.errors = part.errors;
    event.history.push(progress);
  }
}

function parseContacts(value: Obj, event: ParsedEvent): void {
  for (const raw of arr(value.state_sync).map(rec)) {
    const contact = rec(raw.contact);
    const phone = str(contact.phone_number);
    if (raw.type !== 'contact' || !phone) continue;
    const entry: ContactSync = { phone, action: str(raw.action) ?? 'add' };
    const name = str(contact.full_name) ?? str(contact.first_name);
    if (name) entry.name = name;
    event.contacts.push(entry);
  }
}

export function parseEvent(payload: unknown): ParsedEvent {
  const event = emptyEvent();
  for (const entry of arr(rec(payload).entry).map(rec)) {
    for (const change of arr(entry.changes).map(rec)) {
      const field = str(change.field);
      const value = rec(change.value);
      if (!field) continue;
      if (field === 'messages') parseMessages(value, event);
      else if (field === 'smb_message_echoes') parseEchoes(value, event);
      else if (field === 'history') parseHistory(value, event);
      else if (field === 'smb_app_state_sync') parseContacts(value, event);
      else event.changes.push({ field, value: change.value });
    }
  }
  return event;
}

export const isEmpty = (event: ParsedEvent): boolean => Object.values(event).every((list) => list.length === 0);

const mask = (id: string) => `***${id.slice(-4)}`;

/** One log line per item. Never includes message content or full phone numbers. */
export function describe(event: ParsedEvent): string[] {
  const lines: string[] = [];
  for (const m of event.messages) {
    lines.push(`message id=${m.id} chat=${mask(m.chat)} dir=${m.direction} source=${m.source} type=${m.type}`);
  }
  for (const s of event.statuses) lines.push(`status id=${s.id} to=${mask(s.recipient)} status=${s.status}`);
  for (const e of event.edits) lines.push(`edit id=${e.id} chat=${mask(e.chat)}`);
  for (const r of event.revokes) lines.push(`revoke id=${r.id} chat=${mask(r.chat)}`);
  if (event.contacts.length) lines.push(`contacts synced count=${event.contacts.length}`);
  for (const h of event.history) {
    lines.push(`history phase=${h.phase} chunk=${h.chunk} progress=${h.progress} messages=${h.messages}`);
  }
  for (const c of event.changes) lines.push(`change field=${c.field}`);
  return lines;
}

/** Remembers the most recent keys so retried deliveries can be dropped. */
export class SeenKeys {
  private keys = new Set<string>();
  constructor(private max = 10_000) {}

  /** Returns true the first time a key is seen. */
  add(key: string): boolean {
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    if (this.keys.size > this.max) this.keys.delete(this.keys.values().next().value as string);
    return true;
  }
}

/** Drops what Meta already delivered. History is idempotent downstream, so it is not tracked. */
export function dropSeen(event: ParsedEvent, seen: SeenKeys): ParsedEvent {
  return {
    ...event,
    messages: event.messages.filter((m) => m.source === 'history' || seen.add(`m:${m.id}`)),
    statuses: event.statuses.filter((s) => seen.add(`s:${s.id}:${s.status}`)),
    edits: event.edits.filter((e) => seen.add(`e:${e.eventId}`)),
    revokes: event.revokes.filter((r) => seen.add(`r:${r.eventId}`)),
  };
}
