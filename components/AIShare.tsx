import React, { useState } from 'react';
import { Bot, Loader2, MapPin } from 'lucide-react';
import AIAssistant from './AIAssistant';
import { describeDevice } from '@/lib/device';

// Public AI Assistant page for demos (/ai-assistant/share). The visitor types
// a name once; the guest token is kept in this browser, so each browser has
// its own history. Device type is always sent, location only when the
// visitor allows it in the browser prompt.

const STORAGE_KEY = 'ai_share_guest';

type Guest = { token: string; name: string };

const readGuest = (): Guest | null => {
  try {
    const g = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return g?.token && g?.name ? g : null;
  } catch {
    return null;
  }
};

const saveGuest = (g: Guest | null) => {
  try {
    if (g) localStorage.setItem(STORAGE_KEY, JSON.stringify(g));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* private window: the session lasts until the page is closed */ }
};

const askLocation = () =>
  new Promise<GeolocationPosition | null>(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { timeout: 10000, maximumAge: 600000 });
  });

export default function AIShare() {
  const [guest, setGuest] = useState<Guest | null>(readGuest);
  const [name, setName] = useState('');
  const [step, setStep] = useState<'' | 'location' | 'starting'>('');
  const [error, setError] = useState('');

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) {
      setError('Isi nama Anda (minimal 2 huruf).');
      return;
    }
    setError('');
    setStep('location');
    const pos = await askLocation();
    setStep('starting');
    try {
      const res = await fetch('/api/ai/share/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          device: describeDevice(navigator.userAgent),
          latitude: pos?.coords.latitude,
          longitude: pos?.coords.longitude,
          accuracy: pos?.coords.accuracy,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `server membalas HTTP ${res.status}`);
      const g = { token: body.token, name: body.name };
      saveGuest(g);
      setGuest(g);
    } catch (err: any) {
      setError(err?.message || 'Gagal memulai demo. Coba lagi.');
    } finally {
      setStep('');
    }
  };

  if (guest) {
    return <AIAssistant guest={{ ...guest, onInvalid: () => { saveGuest(null); setGuest(null); } }} />;
  }

  const busy = step !== '';
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10">
      <form onSubmit={start} className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 flex flex-col gap-5">
        <div>
          <h1 className="font-display font-bold text-2xl tracking-tight text-slate-800 flex items-center gap-2">
            <Bot size={26} className="text-slate-700" aria-hidden="true" /> AI Assistant ShipHub
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Halaman demo. Tanyakan data galangan kapal dalam bahasa sehari-hari; AI hanya membaca data yang dibuka Admin untuk demo ini.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="guest-name" className="text-sm font-semibold text-slate-700">Nama Anda</label>
          <input
            id="guest-name"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={60}
            autoComplete="name"
            autoFocus
            className="w-full min-h-11 px-4 rounded-xl border border-slate-300 text-sm outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-300"
            placeholder="Contoh: Budi Santoso"
          />
        </div>

        <p className="text-xs text-slate-600 flex gap-2">
          <MapPin size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
          <span>Nama, jenis perangkat, dan lokasi (bila Anda izinkan di browser) dicatat untuk keperluan demo. Menolak izin lokasi tidak menghalangi demo.</span>
        </p>

        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="min-h-11 px-6 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
          {step === 'location' ? 'Menunggu izin lokasi…' : step === 'starting' ? 'Menyiapkan demo…' : 'Mulai demo'}
        </button>
      </form>
    </div>
  );
}
