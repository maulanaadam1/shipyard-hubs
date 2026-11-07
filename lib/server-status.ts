// Watches the app's API calls: a network failure or a 500/502/503/504 from /api
// means the server is down, restarting (a deploy) or in maintenance mode. The
// health check (/api/health) then decides which, and ServerStatusGate shows
// the maintenance screen until the server answers again.
//
// fetch is wrapped once, before the app renders, so failures during the very
// first requests (the session check) are seen too.

export type ServerDown = { kind: 'maintenance' | 'offline' | 'unreachable'; message?: string; until?: string };

type Listener = (state: ServerDown | null) => void;

const listeners = new Set<Listener>();
let current: ServerDown | null = null;
let checking: Promise<void> | null = null;
let originalFetch: typeof fetch | null = null;

const isApi = (url: string) => {
  try {
    const u = new URL(url, window.location.origin);
    return u.origin === window.location.origin && u.pathname.startsWith('/api/') && u.pathname !== '/api/health';
  } catch {
    return false;
  }
};

function publish(state: ServerDown | null) {
  current = state;
  listeners.forEach(l => l(state));
}

/** Asks /api/health and publishes the result: null when the server is fine. */
export async function checkServer(): Promise<ServerDown | null> {
  if (!originalFetch) return null;
  if (!navigator.onLine) {
    publish({ kind: 'offline' });
    return current;
  }
  try {
    const res = await originalFetch('/api/health', { cache: 'no-store' });
    if (res.ok) {
      publish(null);
      return null;
    }
    const body = await res.json().catch(() => ({}));
    publish(body?.status === 'maintenance'
      ? { kind: 'maintenance', message: body.message || '', until: body.until || '' }
      : { kind: 'unreachable' });
  } catch {
    publish(navigator.onLine ? { kind: 'unreachable' } : { kind: 'offline' });
  }
  return current;
}

function suspect() {
  if (checking || current) return;
  checking = checkServer().then(() => undefined).finally(() => { checking = null; });
}

export function installServerWatch() {
  if (originalFetch || typeof window === 'undefined') return;
  originalFetch = window.fetch.bind(window);
  const base = originalFetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    try {
      const res = await base(input, init);
      // 500 too: a dev proxy answers it for a stopped server, and a broken
      // database gives it; the health check tells those from a plain error.
      if ([500, 502, 503, 504].includes(res.status) && isApi(url)) suspect();
      return res;
    } catch (e: any) {
      if (e?.name !== 'AbortError' && isApi(url)) suspect();
      throw e;
    }
  };
  window.addEventListener('offline', () => publish({ kind: 'offline' }));
  window.addEventListener('online', () => { if (current?.kind === 'offline') checkServer(); });
}

export function subscribeServerStatus(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => { listeners.delete(listener); };
}
