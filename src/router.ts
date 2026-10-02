import type { IncomingMessage, ServerResponse } from 'node:http';

export interface Context {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  /** `:name` segments of the route, plus `rest` for a trailing `*`. */
  params: Record<string, string>;
}

export type Handler = (ctx: Context) => void | Promise<void>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

/** Matches `METHOD /path/:param/*` patterns, first match wins. */
export function createRouter(table: Record<string, Handler>) {
  const routes: Route[] = Object.entries(table).map(([key, handler]) => {
    const [method, path] = key.split(' ') as [string, string];
    return { method, segments: path.split('/').filter(Boolean), handler };
  });

  return function match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of routes) {
      if (route.method !== method) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.segments.length && ok; i++) {
        const segment = route.segments[i]!;
        if (segment === '*') {
          params.rest = parts.slice(i).join('/');
          ok = parts.length > i;
          break;
        }
        if (parts[i] === undefined) ok = false;
        else if (segment.startsWith(':')) params[segment.slice(1)] = parts[i]!;
        else ok = segment === parts[i];
        if (i === route.segments.length - 1 && parts.length > route.segments.length) ok = false;
      }
      if (ok) return { handler: route.handler, params };
    }
    return null;
  };
}
