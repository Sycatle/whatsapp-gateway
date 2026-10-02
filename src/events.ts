export interface InboundMessage {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
  image?: Media;
  audio?: Media;
  document?: Media & { filename?: string };
}

export interface Media {
  id: string;
  mime_type: string;
  sha256?: string;
}

export interface DeliveryStatus {
  id: string;
  status: string;
  recipient_id: string;
}

export interface ParsedEvent {
  messages: InboundMessage[];
  statuses: DeliveryStatus[];
}

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

export function parseEvent(payload: unknown): ParsedEvent {
  const parsed: ParsedEvent = { messages: [], statuses: [] };
  for (const entry of asArray(asRecord(payload).entry)) {
    for (const change of asArray(asRecord(entry).changes)) {
      const { field, value } = asRecord(change);
      if (field !== 'messages') continue;
      const { messages, statuses } = asRecord(value);
      parsed.messages.push(...(asArray(messages) as InboundMessage[]).filter((m) => typeof asRecord(m).id === 'string'));
      parsed.statuses.push(...(asArray(statuses) as DeliveryStatus[]).filter((s) => typeof asRecord(s).id === 'string'));
    }
  }
  return parsed;
}

const mask = (phone: string) => `***${phone.slice(-4)}`;

export function describe(event: ParsedEvent): string[] {
  return [
    ...event.messages.map((m) => `message id=${m.id} from=${mask(m.from)} type=${m.type}`),
    ...event.statuses.map((s) => `status id=${s.id} to=${mask(s.recipient_id)} status=${s.status}`),
  ];
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

export function dropSeen(event: ParsedEvent, seen: SeenKeys): ParsedEvent {
  return {
    messages: event.messages.filter((m) => seen.add(`m:${m.id}`)),
    statuses: event.statuses.filter((s) => seen.add(`s:${s.id}:${s.status}`)),
  };
}
