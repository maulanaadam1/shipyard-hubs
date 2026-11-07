import React, { useEffect, useMemo, useState } from 'react';
import { BookA, Plus, RefreshCw, Pencil, Trash2, Search, Loader2 } from 'lucide-react';
import { getHeaders } from '@/lib/api-client';

// Kamus Istilah: the words people at the yard use and what they mean in the
// data. The AI Assistant reads it with every question. Rows filled from the
// data ("otomatis") can be filled again; the Admin's own rows stay.

type Term = { id: string; term: string; meaning: string; kind: string; source: 'auto' | 'manual'; updated_by: string; updated_at: string };

const KINDS: Record<string, string> = { kapal: 'Tipe kapal', jenis_jo: 'Jenis Job Order', kode_jo: 'Kode Job Order', lokasi: 'Lokasi', umum: 'Umum' };
const field = 'w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';

export default function AITermsSettings({ canEdit }: { canEdit: boolean }) {
  const [terms, setTerms] = useState<Term[] | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<{ id?: string; term: string; meaning: string; kind: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(path, { method, headers: { ...(await getHeaders()), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  };
  const load = async () => {
    try {
      const data = await call('GET', '/api/ai/terms');
      setTerms(data.terms || []);
      setError('');
    } catch (e: any) {
      setError(`Gagal memuat kamus: ${e?.message || 'koneksi terputus'}`);
    }
  };
  useEffect(() => { load(); }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    try {
      const body = { term: form.term, meaning: form.meaning, kind: form.kind };
      if (form.id) await call('PUT', `/api/ai/terms/${encodeURIComponent(form.id)}`, body);
      else await call('POST', '/api/ai/terms', body);
      setMessage(form.id ? `Istilah "${form.term}" diperbarui.` : `Istilah "${form.term}" ditambahkan.`);
      setForm(null);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Gagal menyimpan');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (t: Term) => {
    if (!window.confirm(`Hapus istilah "${t.term}" dari kamus?`)) return;
    setBusy(true);
    try {
      await call('DELETE', `/api/ai/terms/${encodeURIComponent(t.id)}`);
      setMessage(`Istilah "${t.term}" dihapus.`);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Gagal menghapus');
    } finally {
      setBusy(false);
    }
  };
  const refill = async () => {
    setBusy(true);
    try {
      const data = await call('POST', '/api/ai/terms/autofill');
      setMessage(`Isi otomatis diperbarui dari data: ${data.auto_terms} istilah. Istilah buatan sendiri tidak diubah.`);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Gagal mengisi ulang');
    } finally {
      setBusy(false);
    }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (terms || []).filter(t => !q || `${t.term} ${t.meaning}`.toLowerCase().includes(q));
  }, [terms, query]);

  return (
    <section className="p-5 rounded-2xl border border-slate-200 bg-white flex flex-col gap-4" aria-labelledby="terms-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="terms-title" className="text-base font-bold text-slate-800 flex items-center gap-2"><BookA size={18} className="text-indigo-500" aria-hidden="true" /> Kamus Istilah</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            Istilah sehari-hari dan artinya di data, misalnya <em>tongkang</em> = tipe kapal Barge atau <em>kantor</em> = lokasi tertentu. AI Assistant membaca kamus ini setiap menjawab.
            Istilah <span className="font-semibold">otomatis</span> diisi dari data; istilah yang Anda tambah atau ubah tidak tertimpa saat isi ulang.
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={refill} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw size={13} className={busy ? 'animate-spin' : ''} aria-hidden="true" /> Isi ulang dari data
            </button>
            <button type="button" onClick={() => setForm({ term: '', meaning: '', kind: 'umum' })} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50">
              <Plus size={13} aria-hidden="true" /> Tambah istilah
            </button>
          </div>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      {message && <p role="status" className="text-sm text-emerald-800">{message}</p>}

      {form && (
        <form onSubmit={save} className="p-4 rounded-xl border border-slate-200 bg-slate-50 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)_auto] md:items-end">
          <label className="text-xs font-semibold text-slate-600">Istilah
            <input className={`${field} mt-1`} value={form.term} onChange={e => setForm({ ...form, term: e.target.value })} placeholder="mis. tongkang" maxLength={60} required />
          </label>
          <label className="text-xs font-semibold text-slate-600">Artinya di data
            <input className={`${field} mt-1`} value={form.meaning} onChange={e => setForm({ ...form, meaning: e.target.value })} placeholder="mis. tipe kapal Barge" maxLength={300} required />
          </label>
          <label className="text-xs font-semibold text-slate-600">Jenis
            <select className={`${field} mt-1`} value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
              {Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" aria-label="Menyimpan" /> : 'Simpan'}
            </button>
            <button type="button" onClick={() => setForm(null)} className="px-4 py-2 rounded-lg text-sm font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">Batal</button>
          </div>
        </form>
      )}

      <label className="relative block md:max-w-xs">
        <span className="sr-only">Cari istilah atau arti</span>
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input className={`${field} pl-8`} value={query} onChange={e => setQuery(e.target.value)} placeholder="Cari istilah atau arti" />
      </label>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 text-left">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">Istilah</th>
              <th scope="col" className="px-3 py-2 font-semibold">Artinya di data</th>
              <th scope="col" className="px-3 py-2 font-semibold hidden md:table-cell">Jenis</th>
              <th scope="col" className="px-3 py-2 font-semibold hidden sm:table-cell">Sumber</th>
              {canEdit && <th scope="col" className="px-3 py-2"><span className="sr-only">Aksi</span></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {terms === null && !error && <tr><td colSpan={5} className="px-3 py-4 text-slate-500"><Loader2 size={14} className="inline mr-2 animate-spin" aria-hidden="true" />Memuat…</td></tr>}
            {shown.map(t => (
              <tr key={t.id} className="align-top">
                <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">{t.term}</td>
                <td className="px-3 py-2 text-slate-700 min-w-[14rem] break-words">{t.meaning}</td>
                <td className="px-3 py-2 text-xs text-slate-500 hidden md:table-cell whitespace-nowrap">{KINDS[t.kind] || t.kind}</td>
                <td className="px-3 py-2 text-xs hidden sm:table-cell whitespace-nowrap">
                  {t.source === 'auto' ? <span className="text-slate-500">otomatis</span> : <span className="font-semibold text-slate-700" title={`${t.updated_by} · ${t.updated_at}`}>buatan sendiri</span>}
                </td>
                {canEdit && (
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    <button type="button" onClick={() => setForm({ id: t.id, term: t.term, meaning: t.meaning, kind: t.kind || 'umum' })} aria-label={`Ubah ${t.term}`}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100"><Pencil size={14} aria-hidden="true" /></button>
                    <button type="button" onClick={() => remove(t)} aria-label={`Hapus ${t.term}`}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-700 hover:bg-rose-50"><Trash2 size={14} aria-hidden="true" /></button>
                  </td>
                )}
              </tr>
            ))}
            {terms && shown.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-500">Tidak ada istilah yang cocok.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
