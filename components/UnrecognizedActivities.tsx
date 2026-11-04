import React, { useEffect, useState } from 'react';
import { Search, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { getHeaders } from '@/lib/api-client';

// Work items whose type is still unknown, grouped by their activity: the
// activity says what the work is about, its items are the detail. Activities
// high on this list are where the item parser needs new words, or SIAGA a
// clearer description.

const FIELD_INPUT = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500';
const STATUS_LABELS: Record<string, string> = { approved: 'Approved', pending: 'Belum approved', rejected: 'Rejected' };

type Activity = { activity: string; category: string; item_count: number; wo_count: number; total_cost: number; latest_date: string };
type Detail = { loading: boolean; rows: any[]; error?: string };

// The last part of "CATEGORY > ... > Activity" names the work; the rest is context.
const splitPath = (path: string) => {
  const parts = path.split('>').map(p => p.trim()).filter(Boolean);
  return { leaf: parts[parts.length - 1] || '(tanpa aktivitas)', parent: parts.slice(0, -1).join(' › ') };
};

export default function UnrecognizedActivities({ formatIDR, formatNum }: { formatIDR: (v: number) => string; formatNum: (v: number) => string }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [data, setData] = useState<{ data: Activity[]; total: number; items: number; wo_count: number; total_cost: number; all_items: number; all_cost: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [details, setDetails] = useState<Record<string, Detail>>({});

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchTerm.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setDetails({});
      try {
        const headers = await getHeaders();
        const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
        if (search) params.set('search', search);
        const res = await fetch(`/api/wo-findings/unrecognized?${params}`, { headers, signal: controller.signal });
        if (!res.ok) throw new Error(`server membalas HTTP ${res.status}`);
        setData(await res.json());
        setError('');
      } catch (e: any) {
        if (e?.name !== 'AbortError') setError(`Gagal memuat: ${e?.message || 'koneksi terputus'}`);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [search, page]);

  const keyOf = (a: Activity) => `${a.category}\u0001${a.activity}`;
  const toggle = async (a: Activity) => {
    const key = keyOf(a);
    if (details[key]) {
      setDetails(prev => { const next = { ...prev }; delete next[key]; return next; });
      return;
    }
    setDetails(prev => ({ ...prev, [key]: { loading: true, rows: [] } }));
    try {
      const headers = await getHeaders();
      const params = new URLSearchParams({ activity: a.activity, category: a.category, limit: '50' });
      const res = await fetch(`/api/wo-findings/unrecognized/items?${params}`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setDetails(prev => ({ ...prev, [key]: { loading: false, rows: body.data || [] } }));
    } catch {
      setDetails(prev => ({ ...prev, [key]: { loading: false, rows: [], error: 'Gagal memuat item. Klik lagi untuk mencoba ulang.' } }));
    }
  };

  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / pageSize));
  const share = data && data.all_items ? (100 * data.items) / data.all_items : 0;

  return (
    <section className="rounded-2xl border bg-white border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 space-y-3">
        <p className="text-sm text-slate-600">
          {data
            ? <>
                <b className="text-slate-800">{data.items.toLocaleString('id-ID')} item</b> ({share.toLocaleString('id-ID', { maximumFractionDigits: 1 })}% dari semua item) senilai{' '}
                <b className="text-slate-800">{formatIDR(data.total_cost)}</b> belum punya jenis pekerjaan, di {data.total.toLocaleString('id-ID')} aktivitas.
                {' '}Klik aktivitas untuk melihat itemnya.
              </>
            : loading ? 'Memuat…' : ''}
        </p>
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <label htmlFor="ua-search" className="sr-only">Cari aktivitas, kategori atau item</label>
          <input id="ua-search" type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            placeholder="Cari aktivitas, kategori atau item" className={`${FIELD_INPUT} pl-9`} />
        </div>
      </div>

      {error ? (
        <div className="p-8 text-center text-sm text-rose-700">{error}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="py-3 pl-4 w-8" aria-label="Rincian"></th>
                <th className="py-3 px-4 text-left font-semibold">Aktivitas</th>
                <th className="py-3 px-4 text-right font-semibold">Item</th>
                <th className="py-3 px-4 text-right font-semibold">WO</th>
                <th className="py-3 px-4 text-right font-semibold">Nilai</th>
                <th className="py-3 px-4 text-right font-semibold">Terbaru</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!loading && (data?.data || []).length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-slate-500">Tidak ada item belum dikenali yang cocok.</td></tr>
              )}
              {(data?.data || []).map(a => {
                const key = keyOf(a);
                const detail = details[key];
                const { leaf, parent } = splitPath(a.activity);
                return (
                  <React.Fragment key={key}>
                    <tr className={`align-top cursor-pointer hover:bg-slate-50 ${detail ? 'bg-indigo-50/40' : ''}`} onClick={() => toggle(a)}>
                      <td className="py-2.5 pl-4 text-slate-500">
                        <ChevronDown size={14} className={`transition-transform ${detail ? '' : '-rotate-90'}`} />
                      </td>
                      <td className="py-2.5 px-4 max-w-xl">
                        <button type="button" aria-expanded={!!detail} className="text-left font-semibold text-slate-800 hover:text-indigo-700 rounded outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40">
                          {leaf}
                        </button>
                        {(parent || (a.category && a.category !== leaf)) && (
                          <p className="text-xs text-slate-500 mt-0.5">{parent || a.category}</p>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono">{formatNum(a.item_count)}</td>
                      <td className="py-2.5 px-4 text-right font-mono">{formatNum(a.wo_count)}</td>
                      <td className="py-2.5 px-4 text-right font-mono font-semibold whitespace-nowrap">{formatIDR(a.total_cost)}</td>
                      <td className="py-2.5 px-4 text-right font-mono text-slate-500 whitespace-nowrap">{a.latest_date?.split(' ')[0] || '-'}</td>
                    </tr>
                    {detail && (
                      <tr className="bg-slate-50/60">
                        <td colSpan={6} className="px-4 pb-4 pt-1">
                          {detail.error ? <p className="text-xs text-rose-700 py-2">{detail.error}</p>
                            : detail.loading ? <p className="text-xs text-slate-500 py-2">Memuat item…</p>
                            : (
                              <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead className="text-slate-500">
                                    <tr>
                                      <th className="py-2 px-3 text-left font-semibold">Deskripsi item</th>
                                      <th className="py-2 px-3 text-left font-semibold">WO / Proyek</th>
                                      <th className="py-2 px-3 text-right font-semibold">Volume</th>
                                      <th className="py-2 px-3 text-right font-semibold">Biaya Satuan</th>
                                      <th className="py-2 px-3 text-right font-semibold">Total</th>
                                      <th className="py-2 px-3 text-left font-semibold">Status</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {detail.rows.map((it, i) => (
                                      <tr key={i} className="align-top">
                                        <td className="py-1.5 px-3 max-w-lg text-slate-800">{it.label || '-'}</td>
                                        <td className="py-1.5 px-3">
                                          <a href={`https://shipyard-siaga.samudera.id/v2/work-orders/progress/${it.wo_id}`} target="_blank" rel="noopener noreferrer"
                                            className="font-mono font-semibold text-indigo-600 hover:underline">{it.wo_code || it.wo_id}</a>
                                          <p className="text-xs text-slate-500">{it.project_name}</p>
                                        </td>
                                        <td className="py-1.5 px-3 text-right font-mono whitespace-nowrap">{formatNum(it.volume)} {it.unit}</td>
                                        <td className="py-1.5 px-3 text-right font-mono whitespace-nowrap">{formatIDR(it.unit_cost)}</td>
                                        <td className="py-1.5 px-3 text-right font-mono font-semibold whitespace-nowrap">{formatIDR(it.total_cost)}</td>
                                        <td className="py-1.5 px-3 whitespace-nowrap">{STATUS_LABELS[it.status] || it.status || '-'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                {a.item_count > detail.rows.length && (
                                  <p className="px-3 py-2 text-xs text-slate-500 border-t border-slate-100">
                                    Menampilkan {detail.rows.length} item termahal dari {a.item_count.toLocaleString('id-ID')}.
                                  </p>
                                )}
                              </div>
                            )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between gap-3">
        <span className="text-xs text-slate-500">Halaman {page} dari {totalPages}</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} aria-label="Halaman sebelumnya"
            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 disabled:opacity-40"><ChevronLeft size={16} /></button>
          <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} aria-label="Halaman berikutnya"
            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 disabled:opacity-40"><ChevronRight size={16} /></button>
        </div>
      </div>
    </section>
  );
}
