import { rm } from 'node:fs/promises';
import type { ParsedEvent } from './events.js';
import type { Graph } from './graph.js';
import { saveMedia } from './media.js';
import type { Transcriber } from './transcribe.js';
import type { Store } from './store.js';

export interface PipelineDeps {
  downloadsDir: string;
  store: Store;
  /** Absent when sending is not configured: media cannot be downloaded without a token. */
  graph?: Graph;
  /** Turns audio and voice notes into text, stored as `content.transcript`. */
  transcribe?: Transcriber;
  /** Receives the processed event, with media paths filled in. */
  forward?: (event: ParsedEvent) => void;
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Applies an acknowledged webhook event: downloads media, then records everything. */
export function createPipeline({ downloadsDir, store, graph, transcribe, forward }: PipelineDeps) {
  async function download(id: string, item: { type: string; content: Record<string, unknown> }): Promise<string | undefined> {
    if (!graph) return undefined;
    try {
      const path = await saveMedia(graph, downloadsDir, item);
      if (path) console.log(`media saved id=${id} path=${path}`);
      return path ?? undefined;
    } catch (error) {
      console.error(`media failed id=${id}: ${reason(error)}`);
      return undefined;
    }
  }

  /** One failing step must not stop the rest of the event: the webhook was acknowledged and will not be redelivered. */
  async function step(label: string, work: () => void | Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      console.error(`${label} failed: ${reason(error)}`);
    }
  }

  async function apply(event: ParsedEvent): Promise<void> {
    // History first lists media as placeholders without ids; the real messages follow in later webhooks
    // (last 14 days only) and are downloaded like any other.
    for (const message of event.messages) {
      const path = await download(message.id, message);
      if (!path) continue;
      message.mediaPath = path;
      if (transcribe && message.type === 'audio') {
        const transcript = await transcribe(path, message.id);
        if (transcript) message.content = { ...message.content, transcript };
      }
    }
    await step('saving messages', () => store.saveMessages(event.messages));

    for (const edit of event.edits) {
      await step(`edit id=${edit.id}`, async () => {
        store.applyEdit(edit);
        const path = await download(edit.id, edit);
        if (path) store.setMediaPath(edit.id, path);
      });
    }
    for (const revoke of event.revokes) {
      await step(`revoke id=${revoke.id}`, async () => {
        const path = store.applyRevoke(revoke);
        if (path) await rm(path, { force: true });
      });
    }
    for (const status of event.statuses) await step(`status id=${status.id}`, () => store.applyStatus(status));
    for (const contact of event.contacts) await step('contact sync', () => store.syncContact(contact));

    // The history backlog can hold thousands of messages: it stays in the store and only its progress is forwarded.
    await step('forwarding', () => forward?.({ ...event, messages: event.messages.filter((m) => m.source !== 'history') }));
  }

  // Events are applied one at a time, in arrival order: a status or an edit must never overtake its message.
  let tail: Promise<void> = Promise.resolve();
  const run = (event: ParsedEvent): Promise<void> => {
    const result = tail.then(() => apply(event));
    tail = result.catch(() => undefined);
    return result;
  };

  return Object.assign(run, {
    /** Queues an acknowledged event; failures are logged, never thrown. */
    enqueue(event: ParsedEvent): void {
      run(event).catch((error) => console.error(`event processing failed: ${reason(error)}`));
    },
    /** Resolves once every queued event has been applied. */
    idle: (): Promise<void> => tail,
  });
}

export type Pipeline = ReturnType<typeof createPipeline>;
