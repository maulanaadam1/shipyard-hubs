import React, { useEffect, useState } from 'react';
import { Copy, MapPin, Save } from 'lucide-react';
import { getHeaders } from '@/lib/api-client';

// Pengaturan AI, "Akses demo tanpa login": switches the public share page
// (/ai-assistant/share) on and off, picks the role guests read data with, the
// daily limit for all guests together, and lists who has used it.

type ShareSettings = {
  enabled: boolean;
  role: string;
  daily_limit: number;
  roles: string[];
  role_exists: boolean;
  used_today: number;
  updated_by: string;
  updated_at: string;
};

type Guest = {
  id: string;
  name: string;
  device: string;
  latitude?: number;
  longitude?: number;
  location_accuracy?: number;
  created_at: string;
  last_seen: string;
  questions: number;
};

const field = 'w-full min-h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
const label = 'block text-sm font-semibold text-slate-700 mb-1';
const help = 'mt-1 text-xs text-slate-500';

export default function AIShareSettings({ canEdit }: { canEdit: boolean }) {
  const [saved, setSaved] = useState<ShareSettings | null>(null);
  const [form, setForm] = useState<ShareSettings | null>(null);
  const [guests, setGuests] = useState<Guest[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [guestError, setGuestError] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const shareUrl = `${window.location.origin}/ai-assistant/share`;

  const load = async () => {
    try {
      const res = await fetch('/api/ai/share-settings', { headers: await getHeaders() });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setSaved(body);
      setForm(body);
      setLoadError('');
    } catch (e: any) {
      setLoadError(`Gagal memuat pengaturan demo: ${e?.message || 'koneksi terputus'}`);
    }
  };
  const loadGuests = async () => {
    try {
      const res = await fetch('/api/ai/share-guests', { headers: await getHeaders() });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setGuests(body.guests || []);
      setGuestError('');
    } catch (e: any) {
      setGuestError(`Gagal memuat daftar tamu: ${e?.message || 'koneksi terputus'}`);
    }
  };
  useEffect(() => { load(); loadGuests(); }, []);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/ai/share-settings', {
        method: 'PUT',
        headers: await getHeaders(),
        body: JSON.stringify({ enabled: form.enabled, role: form.role, daily_limit: form.daily_limit }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setSaved(body);
      setForm(body);
      setMessage({ ok: true, text: 'Tersimpan.' });
    } catch (e: any) {
      setMessage({ ok: false, text: e?.message || 'Gagal menyimpan.' });
    } finally {
      setSaving(false);
    }
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked: the URL is visible to copy by hand */ }
  };

  const dirty = !!form && !!saved && (form.enabled !== saved.enabled || form.role !== saved.role || form.daily_limit !== saved.daily_limit);

  return (
    <section className="p-5 rounded-2xl border border-slate-200 bg-white flex flex-col gap-5" aria-labelledby="share-title">
      <div>
        <h3 id="share-title" className="text-base font-bold text-slate-800">Akses demo tanpa login</h3>
        <p className={help}>
          Halaman AI Assistant untuk tamu (misalnya juri) tanpa akun ShipHub. Tamu mengisi nama; riwayat chat terpisah per browser.
        </p>
      </div>

      {loadError && (
        <div role="alert" className="text-sm text-rose-700 flex flex-wrap items-center gap-3">
          <span>{loadError}</span>
          <button type="button" onClick={load} className="min-h-11 px-4 rounded-lg border border-rose-200 font-semibold hover:bg-rose-50">Coba lagi</button>
        </div>
      )}
      {!form && !loadError && <p role="status" className="text-sm text-slate-500">Memuat pengaturan demo…</p>}

      {form && saved && (
        <form className="flex flex-col gap-5" onSubmit={e => { e.preventDefault(); save(); }}>
          <div>
            <span className={label}>Alamat halaman demo</span>
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 min-w-0 break-all px-3 py-2 rounded-lg bg-slate-100 text-sm text-slate-800">{shareUrl}</code>
              <button type="button" onClick={copyUrl}
                className="min-h-11 inline-flex items-center gap-1.5 px-4 rounded-lg text-sm font-semibold border border-slate-300 text-slate-700 bg-white hover:bg-slate-100">
                <Copy size={15} aria-hidden="true" /> {copied ? 'Tersalin' : 'Salin'}
              </button>
            </div>
            <p className={help}>{saved.enabled ? 'Halaman ini sekarang bisa dibuka siapa saja yang punya alamatnya.' : 'Halaman ini tertutup sampai akses demo diaktifkan.'}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label htmlFor="share-role" className={label}>Role data untuk tamu</label>
              <select id="share-role" className={field} value={form.role} disabled={!canEdit}
                onChange={e => setForm({ ...form, role: e.target.value })}>
                {!form.roles.includes(form.role) && <option value={form.role}>{form.role} (belum ada)</option>}
                {form.roles.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <p className={help}>Tamu hanya bisa membaca data yang diizinkan untuk role ini di Role Management. Role Admin tidak bisa dipilih.</p>
              {!saved.role_exists && (
                <p role="alert" className="mt-1 text-xs text-amber-800">
                  Role "{saved.role}" belum ada, jadi tamu belum bisa membaca data apa pun. Buat role ini di Role Management lalu beri izin lihat untuk menu yang boleh ditanyakan.
                </p>
              )}
            </div>
            <div>
              <label htmlFor="share-limit" className={label}>Batas pertanyaan semua tamu per hari</label>
              <input id="share-limit" type="number" min={0} max={10000} className={field} value={form.daily_limit} disabled={!canEdit}
                onChange={e => setForm({ ...form, daily_limit: Number(e.target.value) })} />
              <p className={help}>Terpakai hari ini: {saved.used_today}. 0 = tanpa batas. Batas per pengguna di atas tetap berlaku untuk tiap tamu.</p>
            </div>
          </div>

          <label className="flex items-start gap-3 text-sm text-slate-700 min-h-11">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-indigo-600" checked={form.enabled} disabled={!canEdit}
              onChange={e => setForm({ ...form, enabled: e.target.checked })} />
            <span>
              <span className="font-semibold">Aktifkan akses demo</span>
              <span className="block text-xs text-slate-500">Menonaktifkan langsung memutus semua tamu, termasuk yang sedang membuka halaman.</span>
            </span>
          </label>

          {canEdit && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={saving || !dirty}
                className="min-h-11 inline-flex items-center gap-1.5 px-4 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                <Save size={15} aria-hidden="true" /> {saving ? 'Menyimpan…' : 'Simpan akses demo'}
              </button>
              {message && <p role="status" className={`text-sm ${message.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{message.text}</p>}
            </div>
          )}
          {saved.updated_by && <p className="text-xs text-slate-500 -mt-2">Terakhir diubah oleh {saved.updated_by}, {saved.updated_at}.</p>}
        </form>
      )}

      <div>
        <h4 className="text-sm font-semibold text-slate-700 mb-2">Tamu terakhir</h4>
        {guestError && (
          <div role="alert" className="text-sm text-rose-700 flex flex-wrap items-center gap-3">
            <span>{guestError}</span>
            <button type="button" onClick={loadGuests} className="min-h-11 px-4 rounded-lg border border-rose-200 font-semibold hover:bg-rose-50">Coba lagi</button>
          </div>
        )}
        {!guests && !guestError && <p role="status" className="text-sm text-slate-500">Memuat daftar tamu…</p>}
        {guests && guests.length === 0 && <p className="text-sm text-slate-500">Belum ada tamu.</p>}
        {guests && guests.length > 0 && (
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-semibold">Nama</th>
                  <th className="px-3 py-2 font-semibold">Perangkat</th>
                  <th className="px-3 py-2 font-semibold">Lokasi</th>
                  <th className="px-3 py-2 font-semibold text-right">Pertanyaan</th>
                  <th className="px-3 py-2 font-semibold">Terakhir aktif</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {guests.map(g => (
                  <tr key={g.id}>
                    <td className="px-3 py-2 font-medium text-slate-800">{g.name}</td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{g.device || '-'}</td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                      {g.latitude !== undefined && g.longitude !== undefined ? (
                        <a href={`https://www.openstreetmap.org/?mlat=${g.latitude}&mlon=${g.longitude}#map=15/${g.latitude}/${g.longitude}`}
                          target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-indigo-700 underline">
                          <MapPin size={13} aria-hidden="true" />
                          {g.latitude.toFixed(4)}, {g.longitude.toFixed(4)}
                        </a>
                      ) : 'tidak diizinkan'}
                    </td>
                    <td className="px-3 py-2 text-slate-600 text-right tabular-nums">{g.questions}</td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{g.last_seen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
