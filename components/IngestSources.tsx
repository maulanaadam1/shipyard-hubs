import React, { useEffect, useState } from 'react';
import { Copy, Inbox, KeyRound, Pencil, Plus, Power, X } from 'lucide-react';
import { getHeaders } from '@/lib/api-client';

// Sumber Data Eksternal (Admin only): systems that push rows to
// POST /api/ingest/{id}, each with its own token. A token is shown once, when
// a source is created or its token is rotated; the server keeps only a hash.
//
// Design: follows the Pengaturan AI page (sticky header, rounded-2xl cards,
// indigo accent). Dials ENERGY 1 / RHYTHM 1 / MOTION 1: an admin settings page,
// calm and uniform, no motion beyond hover and focus. Icons are Lucide, the
// app-wide set: Inbox = incoming data, Copy = copy, KeyRound = token,
// Pencil = edit, Power = on/off, Plus = add, X = close.

type Kind = { value: string; label: string; needs_key: boolean };

type LastResult = {
  ok: boolean;
  error?: string;
  received?: number;
  saved?: number;
  unchanged?: number;
  skipped?: number;
  problems?: string[] | null;
};

type Source = {
  id: string;
  name: string;
  kind: string;
  kind_label: string;
  key_column: string;
  token_hint: string;
  is_active: boolean;
  created_by: string;
  created_at: string;
  token_rotated_at: string;
  last_received_at: string;
  last_result: LastResult | null;
  rows: number;
};

type NewToken = { source: Source; token: string; rotated: boolean };

const field = 'w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
const label = 'block text-sm font-semibold text-slate-700 mb-1';
const help = 'mt-1 text-xs text-slate-500';
// Every button is at least 44px tall (touch target) and shows the same
// indigo focus ring as the inputs when reached by keyboard.
const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2';
const btn = `inline-flex items-center justify-center gap-1.5 min-h-11 px-3 py-2 rounded-lg text-sm font-semibold border border-slate-300 text-slate-700 bg-white hover:bg-slate-100 disabled:opacity-50 ${focusRing}`;
const primary = `inline-flex items-center justify-center gap-1.5 min-h-11 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 ${focusRing}`;

const endpointFor = (id: string) => `${window.location.origin}/api/ingest/${id}`;

function slugify(name: string) {
  // Same rule as the server: at most 50 characters.
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 50).replace(/-+$/, '');
}

function formatTime(value: string) {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d.valueOf()) ? value : d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(path, { ...init, headers: { ...(await getHeaders()), ...(init.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

// copyText: Clipboard API, or the older execCommand path where that API is
// blocked (plain http on a LAN address, embedded browsers).
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

function CopyButton({ text, what }: { text: string; what: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <button type="button" className={btn}
      onClick={async () => {
        setState((await copyText(text)) ? 'copied' : 'failed');
        setTimeout(() => setState('idle'), 2500);
      }}>
      <Copy size={14} />
      {state === 'copied' ? 'Tersalin' : state === 'failed' ? 'Gagal, salin manual' : `Salin ${what}`}
    </button>
  );
}

function lastResultText(s: Source) {
  if (!s.last_received_at) return 'Belum pernah mengirim data.';
  const when = formatTime(s.last_received_at);
  const r = s.last_result;
  if (!r) return `Terakhir mengirim ${when}.`;
  if (!r.ok) return `Kiriman terakhir ${when} gagal: ${r.error}`;
  return `Terakhir ${when}: ${r.received} baris, ${r.saved} baru/berubah, ${r.unchanged} sudah ada, ${r.skipped} dilewati.`;
}

export default function IngestSources() {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [loadError, setLoadError] = useState('');
  const [newToken, setNewToken] = useState<NewToken | null>(null);
  const [busy, setBusy] = useState('');
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', id: '', kind: 'attendance', key_column: '' });
  const [formError, setFormError] = useState('');

  const [editing, setEditing] = useState<{ id: string; name: string; key_column: string } | null>(null);

  const load = async () => {
    try {
      const data = await api('/api/ingest-sources');
      setSources(data.data);
      setKinds(data.kinds);
      setLoadError('');
    } catch (e: any) {
      setLoadError(`Gagal memuat sumber data: ${e?.message || 'koneksi terputus'}`);
    }
  };
  useEffect(() => { load(); }, []);

  const kindOf = (value: string) => kinds.find(k => k.value === value);
  const formKind = kindOf(form.kind);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('create');
    setFormError('');
    try {
      const data = await api('/api/ingest-sources', {
        method: 'POST',
        body: JSON.stringify({ ...form, id: form.id.trim() }),
      });
      setNewToken({ source: data.source, token: data.token, rotated: false });
      setForm({ name: '', id: '', kind: form.kind, key_column: '' });
      setShowForm(false);
      await load();
    } catch (e: any) {
      setFormError(e?.message || 'koneksi terputus');
    } finally {
      setBusy('');
    }
  };

  const rotate = async (s: Source) => {
    if (!window.confirm(`Ganti token "${s.name}"? Token lama langsung berhenti berfungsi, jadi script pengirim harus diisi token baru.`)) return;
    setBusy(s.id);
    setRowError(null);
    try {
      const data = await api(`/api/ingest-sources/${s.id}/rotate-token`, { method: 'POST' });
      setNewToken({ source: data.source, token: data.token, rotated: true });
      await load();
    } catch (e: any) {
      setRowError({ id: s.id, text: `Gagal mengganti token: ${e?.message || 'koneksi terputus'}` });
    } finally {
      setBusy('');
    }
  };

  const update = async (id: string, body: Record<string, unknown>) => {
    setBusy(id);
    setRowError(null);
    try {
      await api(`/api/ingest-sources/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      setEditing(null);
      await load();
    } catch (e: any) {
      setRowError({ id, text: `Gagal menyimpan: ${e?.message || 'koneksi terputus'}` });
    } finally {
      setBusy('');
    }
  };

  const toggleActive = (s: Source) => {
    if (s.is_active && !window.confirm(`Nonaktifkan "${s.name}"? Kiriman dari sumber ini akan ditolak sampai diaktifkan lagi. Data yang sudah masuk tetap ada.`)) return;
    update(s.id, { is_active: !s.is_active });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur-md border-slate-200 px-6 py-4">
        <h2 className="font-display font-bold text-xl md:text-2xl tracking-tight text-slate-800 flex items-center gap-2">
          <Inbox className="text-indigo-500" size={22} /> Sumber Data Eksternal
        </h2>
        <p className="text-xs md:text-sm text-slate-500 mt-1">
          Sistem luar (Google Sheet lewat Apps Script, aplikasi lain) yang mengirim data ke ShipHub. Setiap sumber punya token sendiri.
        </p>
      </header>

      <main className="w-full max-w-4xl mx-auto p-4 md:p-8 flex flex-col gap-4">
        {newToken && (
          <section role="alert" className="p-4 rounded-2xl border border-amber-300 bg-amber-50 text-amber-950 text-sm flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <p>
                <span className="font-semibold">
                  {newToken.rotated ? `Token baru untuk ${newToken.source.name}.` : `Sumber ${newToken.source.name} dibuat.`}
                </span>{' '}
                Salin token ini sekarang. Token tidak akan ditampilkan lagi; kalau hilang, ganti token.
              </p>
              <button type="button" aria-label="Tutup" onClick={() => setNewToken(null)}
                className={`inline-flex items-center justify-center min-h-11 min-w-11 -m-2 rounded-md hover:bg-amber-100 ${focusRing}`}>
                <X size={16} />
              </button>
            </div>
            <div>
              <label htmlFor="new-token" className="block text-xs font-semibold mb-1">Token</label>
              <input id="new-token" readOnly value={newToken.token} onFocus={e => e.currentTarget.select()}
                className={`${field} font-mono text-xs`} />
            </div>
            <div>
              <label htmlFor="new-endpoint" className="block text-xs font-semibold mb-1">URL tujuan</label>
              <input id="new-endpoint" readOnly value={endpointFor(newToken.source.id)} onFocus={e => e.currentTarget.select()}
                className={`${field} font-mono text-xs`} />
            </div>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={newToken.token} what="token" />
              <CopyButton text={endpointFor(newToken.source.id)} what="URL" />
            </div>
            <p className="text-xs">
              Pengirim memanggil <code className="font-mono">POST</code> ke URL di atas dengan header{' '}
              <code className="font-mono">Authorization: Bearer &lt;token&gt;</code> dan body{' '}
              <code className="font-mono">{'{"rows": [ … ]}'}</code>, maksimal 5000 baris per kiriman.
            </p>
          </section>
        )}

        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold text-slate-800">
            {sources ? `${sources.length} sumber` : 'Sumber'}
          </h3>
          {!showForm && (
            <button type="button" onClick={() => { setShowForm(true); setFormError(''); }}
              className={primary}>
              <Plus size={15} /> Tambah sumber
            </button>
          )}
        </div>

        {showForm && (
          <form onSubmit={create} className="p-5 rounded-2xl border border-slate-200 bg-white flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="src-name" className={label}>Nama</label>
                <input id="src-name" className={field} value={form.name} required autoFocus
                  placeholder="mis. Absensi Fingerprint Galangan"
                  onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label htmlFor="src-id" className={label}>ID</label>
                <input id="src-id" className={`${field} font-mono`} value={form.id} spellCheck={false} autoComplete="off"
                  placeholder={slugify(form.name) || 'dibuat dari nama'}
                  onChange={e => setForm({ ...form, id: e.target.value.toLowerCase() })} />
                <p className={help}>Bagian dari URL. Huruf kecil, angka dan tanda minus. Tidak bisa diubah nanti.</p>
              </div>
              <div>
                <label htmlFor="src-kind" className={label}>Jenis</label>
                <select id="src-kind" className={field} value={form.kind}
                  onChange={e => setForm({ ...form, kind: e.target.value })}>
                  {kinds.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
                <p className={help}>
                  {form.kind === 'attendance'
                    ? 'Baris absen mesin fingerprint (id, emp_code, punch_time). Masuk ke perhitungan jam kerja.'
                    : 'Baris apa saja, disimpan apa adanya. Baris dengan kolom kunci yang sama diperbarui.'}
                </p>
              </div>
              {formKind?.needs_key && (
                <div>
                  <label htmlFor="src-key" className={label}>Kolom kunci</label>
                  <input id="src-key" className={`${field} font-mono`} value={form.key_column} required spellCheck={false}
                    placeholder="mis. emp_code"
                    onChange={e => setForm({ ...form, key_column: e.target.value })} />
                  <p className={help}>Nama kolom yang unik per baris, sesuai header di sumber.</p>
                </div>
              )}
            </div>
            {formError && <p role="alert" className="text-sm text-rose-700">{formError}</p>}
            <div className="flex flex-wrap gap-3">
              <button type="submit" disabled={busy === 'create'}
                className={primary}>
                {busy === 'create' ? 'Membuat…' : 'Buat sumber dan token'}
              </button>
              <button type="button" className={btn} onClick={() => setShowForm(false)}>Batal</button>
            </div>
          </form>
        )}

        {loadError && (
          <div role="alert" className="p-4 rounded-2xl border border-rose-200 bg-rose-50 text-sm text-rose-800 flex flex-wrap items-center gap-3">
            <span>{loadError}</span>
            <button type="button" className={btn} onClick={load}>Coba lagi</button>
          </div>
        )}

        {!sources && !loadError && <p className="text-sm text-slate-500" role="status">Memuat sumber data…</p>}

        {sources && sources.length === 0 && !showForm && (
          <div className="p-6 rounded-2xl border border-dashed border-slate-300 bg-white text-sm text-slate-600">
            <p className="font-semibold text-slate-800">Belum ada sumber.</p>
            <p className="mt-1">Tambah sumber untuk mendapatkan URL dan token, lalu pasang keduanya di script atau sistem pengirim.</p>
          </div>
        )}

        {sources?.map(s => {
          const isEditing = editing?.id === s.id;
          const needsKey = kindOf(s.kind)?.needs_key;
          return (
            <article key={s.id} className={`p-5 rounded-2xl border border-slate-200 flex flex-col gap-3 ${s.is_active ? 'bg-white' : 'bg-slate-50'}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="font-semibold text-slate-900 break-words">{s.name}</h4>
                  <p className="text-xs text-slate-500 font-mono break-all">{s.id}</p>
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded-md ${s.is_active ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                  {s.is_active ? 'Aktif' : 'Nonaktif'}
                </span>
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-slate-500">Jenis</dt>
                <dd className="text-slate-800">{s.kind_label || s.kind}{s.key_column && <> · kunci <span className="font-mono">{s.key_column}</span></>}</dd>
                <dt className="text-slate-500">URL tujuan</dt>
                <dd className="text-slate-800 font-mono text-xs break-all">{endpointFor(s.id)}</dd>
                <dt className="text-slate-500">Token</dt>
                <dd className="text-slate-800 font-mono text-xs">shs_…{s.token_hint}
                  {s.token_rotated_at && <span className="font-sans text-slate-500"> (dibuat {formatTime(s.token_rotated_at)})</span>}
                </dd>
                <dt className="text-slate-500">Data tersimpan</dt>
                <dd className="text-slate-800">{s.rows.toLocaleString('id-ID')} baris</dd>
                <dt className="text-slate-500">Kiriman</dt>
                <dd className={s.last_result && !s.last_result.ok ? 'text-rose-700 break-words' : 'text-slate-800'}>
                  {lastResultText(s)}
                  {!!s.last_result?.problems?.length && (
                    <ul className="mt-1 list-disc pl-5 text-xs text-amber-800 break-words">
                      {s.last_result.problems.slice(0, 5).map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  )}
                </dd>
              </dl>

              {isEditing && editing && (
                <form className="flex flex-col gap-3 pt-2 border-t border-slate-100"
                  onSubmit={e => { e.preventDefault(); update(s.id, { name: editing.name, key_column: editing.key_column }); }}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor={`edit-name-${s.id}`} className={label}>Nama</label>
                      <input id={`edit-name-${s.id}`} className={field} value={editing.name} required
                        onChange={e => setEditing({ ...editing, name: e.target.value })} />
                    </div>
                    {needsKey && (
                      <div>
                        <label htmlFor={`edit-key-${s.id}`} className={label}>Kolom kunci</label>
                        <input id={`edit-key-${s.id}`} className={`${field} font-mono`} value={editing.key_column} required
                          onChange={e => setEditing({ ...editing, key_column: e.target.value })} />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" disabled={busy === s.id}
                      className={primary}>
                      {busy === s.id ? 'Menyimpan…' : 'Simpan'}
                    </button>
                    <button type="button" className={btn} onClick={() => setEditing(null)}>Batal</button>
                  </div>
                </form>
              )}

              {rowError?.id === s.id && <p role="alert" className="text-sm text-rose-700">{rowError.text}</p>}

              {!isEditing && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <CopyButton text={endpointFor(s.id)} what="URL" />
                  <button type="button" className={btn} disabled={busy === s.id} onClick={() => rotate(s)}>
                    <KeyRound size={14} /> Ganti token
                  </button>
                  <button type="button" className={btn} disabled={busy === s.id}
                    onClick={() => setEditing({ id: s.id, name: s.name, key_column: s.key_column })}>
                    <Pencil size={14} /> Ubah
                  </button>
                  <button type="button" className={btn} disabled={busy === s.id} onClick={() => toggleActive(s)}>
                    <Power size={14} /> {s.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </main>
    </div>
  );
}
