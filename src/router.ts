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

  function matchRoute(route: Route, parts: string[]): Record<string, string> | null {
    const params: Record<string, string> = {};
    for (const [i, segment] of route.segments.entries()) {
      if (segment === '*') {
        if (parts.length <= i) return null;
        params.rest = parts.slice(i).join('/');
        return params;
      }
      const part = parts[i];
      if (part === undefined) return null;
      if (segment.startsWith(':')) params[segment.slice(1)] = part;
      else if (segment !== part) return null;
    }
    return parts.length === route.segments.length ? params : null;
  }

  return function match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of routes) {
      if (route.method !== method) continue;
      const params = matchRoute(route, parts);
      if (params) return { handler: route.handler, params };
    }
    return null;
  };
}
