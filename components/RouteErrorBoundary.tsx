import { Component, type ReactNode } from 'react';

// After a deploy, a tab opened before it still asks for the old page files,
// which are gone. Reloading once fetches the new ones.
const isStaleChunk = (error: Error) =>
  /dynamically imported module|Importing a module script failed|Loading chunk/i.test(error.message);
const RELOAD_KEY = 'shiphub:chunk-reload';

type Props = { children: ReactNode; resetKey: string };
type State = { error: Error | null };

// Keeps one broken page from blanking the whole app: the sidebar and header
// stay, and moving to another menu (resetKey changes) clears the error.
export default class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (!isStaleChunk(error)) return;
    try {
      if (sessionStorage.getItem(RELOAD_KEY) === location.pathname) return;
      sessionStorage.setItem(RELOAD_KEY, location.pathname);
    } catch {
      return;
    }
    location.reload();
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isStaleChunk(error);
    return (
      <div role="alert" className="p-8 max-w-lg">
        <h2 className="text-lg font-semibold text-slate-800 mb-2">
          {stale ? 'ShipHub baru saja diperbarui' : 'Halaman ini gagal ditampilkan'}
        </h2>
        <p className="text-sm text-slate-600 mb-4">
          {stale
            ? 'Muat ulang untuk memakai versi terbaru.'
            : 'Menu lain tetap bisa dipakai. Kalau terus terjadi, kirim pesan di bawah ke admin.'}
        </p>
        {!stale && <pre className="text-xs text-slate-600 bg-slate-100 rounded-lg p-3 mb-4 whitespace-pre-wrap break-words">{error.message}</pre>}
        <button
          type="button"
          onClick={() => location.reload()}
          className="min-h-11 px-4 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800"
        >
          Muat ulang
        </button>
      </div>
    );
  }
}
