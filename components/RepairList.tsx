import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Search, Loader2, RefreshCw, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { getHeaders } from '@/lib/api-client';
import { useData } from '@/context/DataContext';

// Repair List: each Job Order's full repair list from SIAGA, with the WOs that
// carry each activity. Prices need the Harga Penawaran permission (the server
// leaves them out otherwise).

type JobRow = {
  jo_id: string; jo_code: string; version: number; items: number; items_in_wo: number;
  total_price?: number; price_in_wo?: number; fetched_at: string; error: string;
};
type WOUse = { wo_id: string; wo_code: string; vendor: string; cost?: number };
type Item = {
  uniqcode: string; parent: string; depth: number; path: string; description: string; unit: string; quantity: number;
  unit_price?: number; total_price?: number; leaf: boolean; wos: WOUse[];
};
type Summary = {
  jo_id: string; jo_code: string; version: number; fetched_at: string; error: string; items: number; items_in_wo: number;
  total_price?: number; price_in_wo?: number; price_without_wo?: number; cost?: number; cost_approved?: number; margin?: number;
};

const FILTERS = [
  { key: 'all', label: 'Semua' },
  { key: 'without', label: 'Belum ada WO' },
  { key: 'with', label: 'Sudah ada WO' },
] as const;

export default function RepairList() {
  const { canAccess } = useData();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [showPrice, setShowPrice] = useState(false);
  const [selected, setSelected] = useState<string>('');
  const [detail, setDetail] = useState<{ summary: Summary; items: Item[] } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [filter, setFilter] = useState<typeof FILTERS[number]['key']>('all');
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('hideNominal_WO') !== 'false'; } catch { return true; } });

  const idr = (v?: number) => (v === undefined ? '–' : hidden ? 'Rp ****'
    : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v || 0));
  const toggleHidden = () => { const next = !hidden; setHidden(next); try { localStorage.setItem('hideNominal_WO', String(next)); } catch { /* storage blocked */ } };

  useEffect(() => { const t = setTimeout(() => setSearch(query.trim()), 350); return () => clearTimeout(t); }, [query]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ limit: '500' });
        if (search) params.set('q', search);
        const res = await fetch(`/api/repair-lists?${params}`, { headers: await getHeaders() });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        if (cancelled) return;
        setJobs(body.job_orders || []);
        setShowPrice(!!body.show_price);
        setError('');
      } catch (e: any) {
        if (!cancelled) setError(`Gagal memuat repair list: ${e?.message || 'koneksi terputus'}`);
      }
    })();
    return () => { cancelled = true; };
  }, [search]);

  const loadDetail = async (joID: string) => {
    setSelected(joID);
    setLoadingDetail(true);
    setFilter('all');
    try {
      const res = await fetch(`/api/repair-lists/${encodeURIComponent(joID)}`, { headers: await getHeaders() });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setDetail(body);
      setError('');
    } catch (e: any) {
      setDetail(null);
      setError(`Gagal memuat repair list: ${e?.message || 'koneksi terputus'}`);
    } finally {
      setLoadingDetail(false);
    }
  };

  const resync = async () => {
    if (!selected) return;
    setSyncing(true);
    try {
      const res = await fetch(`/api/repair-lists/${encodeURIComponent(selected)}/sync`, { method: 'POST', headers: await getHeaders() });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      await loadDetail(selected);
    } catch (e: any) {
      setError(e?.message || 'Gagal menarik repair list');
    } finally {
      setSyncing(false);
    }
  };

  // With a filter, keep the matching activities and the groups above them.
  const rows = useMemo(() => {
    if (!detail) return [];
    if (filter === 'all') return detail.items;
    const keep = new Set<string>();
    const byID = new Map(detail.items.map(i => [i.uniqcode, i]));
    for (const it of detail.items) {
      if (!it.leaf) continue;
      const has = it.wos.length > 0;
      if ((filter === 'with') !== has) continue;
      let cur: Item | undefined = it;
      while (cur) { keep.add(cur.uniqcode); cur = cur.parent ? byID.get(cur.parent) : undefined; }
    }
    return detail.items.filter(i => keep.has(i.uniqcode));
  }, [detail, filter]);

  const s = detail?.summary;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur-md border-slate-200 px-6 py-4 flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="font-display font-bold text-xl md:text-2xl tracking-tight text-slate-800 flex items-center gap-2">
            <ClipboardList className="text-indigo-500" size={22} aria-hidden="true" /> Repair List
          </h2>
          <p className="text-xs md:text-sm text-slate-500 mt-1">Isi repair list setiap Job Order dari SIAGA (versi terbaru), dengan WO yang mengerjakan setiap aktivitas.</p>
        </div>
        {showPrice && (
          <button type="button" onClick={toggleHidden} title={hidden ? 'Tampilkan nominal' : 'Sembunyikan nominal'} aria-label={hidden ? 'Tampilkan nominal' : 'Sembunyikan nominal'}
            className={`p-2 rounded-xl border shadow-sm ${hidden ? 'bg-amber-100 border-amber-200 text-amber-700' : 'bg-white border-slate-200 text-slate-500 hover:text-slate-800'}`}>
            {hidden ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        )}
      </header>

      <main className="w-full p-4 md:p-8 flex flex-col lg:flex-row gap-4 items-start">
        <aside className="w-full lg:w-80 shrink-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="p-3 border-b border-slate-100">
            <label className="relative block">
              <span className="sr-only">Cari Job Order atau kapal</span>
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Cari Job Order atau kapal"
                className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" />
            </label>
          </div>
          <ul className="max-h-[70vh] overflow-y-auto divide-y divide-slate-100">
            {jobs === null && <li className="p-4 text-sm text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Memuat…</li>}
            {jobs?.length === 0 && <li className="p-4 text-sm text-slate-500">Belum ada repair list yang ditarik. Penarikan berjalan otomatis beberapa menit setelah server start.</li>}
            {jobs?.map(j => (
              <li key={j.jo_id}>
                <button type="button" onClick={() => loadDetail(j.jo_id)} aria-current={selected === j.jo_id ? 'true' : undefined}
                  className={`w-full text-left px-3 py-2.5 ${selected === j.jo_id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                  <span className="block text-sm font-medium text-slate-800 break-words">{j.jo_code || `Job Order ${j.jo_id}`}</span>
                  <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500">
                    <span>{j.items_in_wo}/{j.items} aktivitas ada WO</span>
                    {j.total_price !== undefined && <span className="tabular-nums">{idr(j.total_price)}</span>}
                    {j.error && <span className="text-rose-700">gagal ditarik</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="flex-1 min-w-0 w-full rounded-2xl border border-slate-200 bg-white shadow-sm p-4 md:p-5 flex flex-col gap-4">
          {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
          {!selected && <p className="text-sm text-slate-500">Pilih Job Order di kiri untuk melihat repair list-nya.</p>}
          {loadingDetail && <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Memuat repair list…</p>}

          {s && !loadingDetail && (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-slate-800 break-words">{s.jo_code || `Job Order ${s.jo_id}`}</p>
                  <p className="text-xs text-slate-500">Versi {s.version || '–'} · ditarik {s.fetched_at || '–'} · {s.items_in_wo} dari {s.items} aktivitas sudah ada WO</p>
                  {s.error && <p className="mt-1 text-xs text-rose-700 flex items-center gap-1"><AlertTriangle size={12} aria-hidden="true" /> Penarikan terakhir gagal: {s.error}</p>}
                </div>
                {canAccess('Repair List', 'edit') && (
                  <button type="button" onClick={resync} disabled={syncing}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} aria-hidden="true" /> {syncing ? 'Menarik…' : 'Tarik ulang dari SIAGA'}
                  </button>
                )}
              </div>

              {showPrice && s.total_price !== undefined && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {[
                    ['Total penawaran', idr(s.total_price), `${s.items} aktivitas`],
                    ['Sudah ada WO', idr(s.price_in_wo), `${s.items_in_wo} aktivitas`],
                    ['Belum ada WO', idr(s.price_without_wo), `${s.items - s.items_in_wo} aktivitas`],
                    ['Biaya vendor', idr(s.cost), `${idr(s.cost_approved)} approved`],
                    ['Margin', idr(s.margin), s.total_price ? `${(((s.margin || 0) / s.total_price) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : '–'],
                  ].map(([label, value, sub]) => (
                    <div key={label} className="p-3 rounded-xl bg-slate-50">
                      <p className="text-xs text-slate-500">{label}</p>
                      <p className="mt-0.5 text-base font-bold text-slate-800 tabular-nums">{value}</p>
                      <p className="text-[11px] text-slate-500">{sub}</p>
                    </div>
                  ))}
                </div>
              )}

              <div role="radiogroup" aria-label="Saring aktivitas" className="flex flex-wrap gap-1.5">
                {FILTERS.map(f => (
                  <button key={f.key} type="button" role="radio" aria-checked={filter === f.key} onClick={() => setFilter(f.key)}
                    className={`px-3 py-1 rounded-full text-xs border ${filter === f.key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-semibold">Aktivitas</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Qty</th>
                      {showPrice && <th scope="col" className="px-3 py-2 text-right font-semibold">Harga satuan</th>}
                      {showPrice && <th scope="col" className="px-3 py-2 text-right font-semibold">Total</th>}
                      <th scope="col" className="px-3 py-2 text-left font-semibold">WO</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map(it => (
                      <tr key={it.uniqcode} className={it.leaf ? '' : 'bg-slate-50/60'}>
                        <td className="px-3 py-1.5 align-top" style={{ paddingLeft: `${12 + it.depth * 16}px` }}>
                          <span className={it.leaf ? 'text-slate-700' : 'font-semibold text-slate-800'}>{it.description || '–'}</span>
                        </td>
                        <td className="px-3 py-1.5 text-right align-top tabular-nums whitespace-nowrap text-slate-600">
                          {it.leaf ? `${it.quantity.toLocaleString('id-ID')} ${it.unit || ''}` : ''}
                        </td>
                        {showPrice && <td className="px-3 py-1.5 text-right align-top tabular-nums whitespace-nowrap">{it.leaf ? idr(it.unit_price) : ''}</td>}
                        {showPrice && <td className="px-3 py-1.5 text-right align-top tabular-nums whitespace-nowrap font-medium">{it.leaf ? idr(it.total_price) : ''}</td>}
                        <td className="px-3 py-1.5 align-top text-xs">
                          {it.leaf && it.wos.length === 0 && <span className="inline-block rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-900">Belum ada WO</span>}
                          {it.wos.map(w => (
                            <span key={w.wo_id} className="block text-slate-600">
                              {w.wo_code} · {w.vendor || '–'}{showPrice && w.cost !== undefined ? <>: <span className="tabular-nums">{idr(w.cost)}</span></> : null}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={showPrice ? 5 : 3} className="px-3 py-6 text-center text-slate-500">Tidak ada aktivitas untuk saringan ini.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
