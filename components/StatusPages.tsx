import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Ship, RefreshCw, ArrowLeft, LayoutDashboard, WifiOff, Wrench, Anchor } from 'lucide-react';
import { checkServer, subscribeServerStatus, type ServerDown } from '@/lib/server-status';

// ShipHub's own pages for an address that doesn't exist (404) and for a
// server that can't serve the app (maintenance mode, a restart during a
// deploy, or no internet).

const RETRY_SECONDS = 15;

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-9 h-9 bg-[#FDB913] rounded-xl flex items-center justify-center shadow-sm">
        <Ship className="w-5 h-5 text-slate-900" aria-hidden="true" />
      </span>
      <span className="font-display font-bold text-lg tracking-tight text-slate-800">Shipyard Hub</span>
    </div>
  );
}

// A ship on the waterline: the one picture both pages share.
function Waterline({ adrift = false }: { adrift?: boolean }) {
  return (
    <svg viewBox="0 0 320 64" className="w-full max-w-sm h-auto" aria-hidden="true">
      <g transform={adrift ? 'translate(196 6) rotate(8)' : 'translate(138 6)'}>
        <path d="M6 30 L44 30 L38 42 L12 42 Z" fill="#0f172a" />
        <rect x="16" y="20" width="16" height="10" rx="1.5" fill="#0f172a" />
        <rect x="22" y="10" width="4" height="10" fill="#FDB913" />
      </g>
      <path d="M0 50 Q 20 44 40 50 T 80 50 T 120 50 T 160 50 T 200 50 T 240 50 T 280 50 T 320 50" fill="none" stroke="#94a3b8" strokeWidth="2" />
      <path d="M20 58 Q 40 53 60 58 T 100 58 T 140 58 T 180 58 T 220 58 T 260 58 T 300 58" fill="none" stroke="#cbd5e1" strokeWidth="2" />
    </svg>
  );
}

export function NotFoundPage() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div className="min-h-[80vh] flex items-center justify-center p-6">
      <div className="w-full max-w-lg flex flex-col items-center text-center gap-5">
        <Waterline adrift />
        <div>
          <p className="font-display font-extrabold text-6xl tracking-tight text-slate-900">404</p>
          <h1 className="mt-2 font-display font-bold text-xl text-slate-800">Halaman tidak ditemukan</h1>
          <p className="mt-2 text-sm text-slate-500">
            Alamat <code className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 break-all">{location.pathname}</code> tidak ada di Shipyard Hub.
            Tautannya mungkin salah ketik, atau menunya sudah pindah tempat di side panel.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Link to="/dashboard" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-900">
            <LayoutDashboard size={16} aria-hidden="true" /> Ke Dashboard
          </Link>
          <button type="button" onClick={() => navigate(-1)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            <ArrowLeft size={16} aria-hidden="true" /> Halaman sebelumnya
          </button>
        </div>
      </div>
    </div>
  );
}

const COPY: Record<ServerDown['kind'], { icon: React.ElementType; title: string; text: string }> = {
  maintenance: { icon: Wrench, title: 'Shipyard Hub sedang dalam perawatan', text: 'Tim sedang memperbarui sistem. Data Anda aman; halaman ini akan tersambung lagi sendiri begitu selesai.' },
  unreachable: { icon: Anchor, title: 'Shipyard Hub belum bisa dihubungi', text: 'Server sedang dimulai ulang atau diperbarui, biasanya hanya beberapa menit. Halaman ini akan tersambung lagi sendiri.' },
  offline: { icon: WifiOff, title: 'Koneksi internet terputus', text: 'Periksa koneksi internet Anda. Halaman ini akan tersambung lagi sendiri begitu koneksi kembali.' },
};

export function MaintenanceScreen({ state, onRetry, seconds, retrying }: { state: ServerDown; onRetry: () => void; seconds: number; retrying: boolean }) {
  const copy = COPY[state.kind];
  const Icon = copy.icon;
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="server-down-title" aria-describedby="server-down-text"
      className="fixed inset-0 z-[200] bg-slate-50 flex flex-col">
      <header className="px-6 py-5"><Brand /></header>
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-lg flex flex-col items-center text-center gap-5">
          <Waterline />
          <span className="w-12 h-12 rounded-2xl bg-[#FDB913]/15 text-[#a36d00] flex items-center justify-center">
            <Icon size={22} aria-hidden="true" />
          </span>
          <div>
            <h1 id="server-down-title" className="font-display font-bold text-xl text-slate-800">{copy.title}</h1>
            <p id="server-down-text" className="mt-2 text-sm text-slate-500">{state.message || copy.text}</p>
            {state.until && <p className="mt-2 text-sm font-semibold text-slate-700">Perkiraan selesai: {state.until}</p>}
          </div>
          <div className="flex flex-col items-center gap-2">
            <button type="button" onClick={onRetry} disabled={retrying}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-900">
              <RefreshCw size={16} className={retrying ? 'animate-spin' : ''} aria-hidden="true" /> {retrying ? 'Menghubungkan…' : 'Coba sekarang'}
            </button>
            <p className="text-xs text-slate-500" aria-live="polite">{retrying ? 'Memeriksa server…' : `Mencoba lagi otomatis dalam ${seconds} detik`}</p>
          </div>
        </div>
      </main>
    </div>
  );
}

/** Shows the maintenance screen over the app while the server can't serve it,
 *  and reloads the page once it answers again. */
export function ServerStatusGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ServerDown | null>(null);
  const [seconds, setSeconds] = useState(RETRY_SECONDS);
  const [retrying, setRetrying] = useState(false);
  const wasDown = useRef(false);

  useEffect(() => subscribeServerStatus(s => {
    if (s) wasDown.current = true;
    else if (wasDown.current) window.location.reload(); // back: reload the data the failed calls missed
    setState(s);
  }), []);

  const retry = async () => {
    setRetrying(true);
    await checkServer();
    setRetrying(false);
    setSeconds(RETRY_SECONDS);
  };

  useEffect(() => {
    if (!state) return;
    const t = setInterval(() => setSeconds(s => {
      if (s <= 1) { retry(); return RETRY_SECONDS; }
      return s - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {children}
      {state && <MaintenanceScreen state={state} onRetry={retry} seconds={seconds} retrying={retrying} />}
    </>
  );
}
