import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BadgeDollarSign, Search, Loader2, Eye, EyeOff, FileSpreadsheet, ChevronDown, ChevronRight, ChevronLeft } from 'lucide-react';
import { getHeaders } from '@/lib/api-client';

// Harga Acuan Marketing: reference unit prices offered to customers, from the
// repair lists, per work type, size, unit and part (jasa / material). The
// vendor side is Harga Acuan Jasa.

type Ref = {
  work_type: string; size: string; unit: string; component: string; n: number; job_orders: number;
  p25: number; median: number; p75: number; min: number; max: number; date_from: string; date_to: string; last_price: number; last_job_order: string;
};
type Spread = { n: number; median: number; min: number; max: number; year?: string; customer?: string };
type Detail = {
  years: Spread[]; customers: Spread[];
  items: { jo_id: string; jo_code: string; ship: string; customer: string; service: string; est_start: string; activity: string; group: string; quantity: number; unit_price: number }[];
};
type Facet = { value: string; count: number };

const PERIODS = [['12', '12 bulan'], ['24', '24 bulan'], ['36', '36 bulan'], ['0', 'Semua']] as const;
const COMPONENTS = [['', 'Semua bagian'], ['none', 'Pekerjaan utuh'], ['jasa', 'Jasa saja'], ['material', 'Material saja']] as const;
const PAGE = 50;
const refKey = (r: Ref) => [r.work_type, r.size, r.unit, r.component].join('|');

export default function MarketingPriceReference() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') || '');
  const [data, setData] = useState<{ rows: Ref[]; total: number; units: { unit: string; count: number }[]; prices: number } | null>(null);
  const [facets, setFacets] = useState<{ services: Facet[]; customers: Facet[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState('');
  const [detail, setDetail] = useState<Record<string, Detail | 'loading' | 'error'>>({});
  const [exporting, setExporting] = useState(false);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('hideNominal_WO') !== 'false'; } catch { return true; } });
  const toggleHidden = () => { const next = !hidden; setHidden(next); try { localStorage.setItem('hideNominal_WO', String(next)); } catch { /* storage blocked */ } };
  const idr = (v?: number) => (v === undefined || v === null ? '–' : hidden ? 'Rp ****'
    : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v));

  const months = params.get('months') ?? '24';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const set = (changes: Record<string, string>, keepPage = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k); }
    if (!keepPage) next.delete('page');
    setParams(next, { replace: true });
    setOpen('');
  };
  const filters = () => {
    const q = new URLSearchParams();
    q.set('months', months);
    for (const k of ['search', 'unit', 'service', 'customer', 'component', 'sort', 'dir']) { const v = params.get(k); if (v) q.set(k, v); }
    return q;
  };

  useEffect(() => { const t = setTimeout(() => { if (search !== (params.get('search') || '')) set({ search: search.trim() }); }, 400); return () => clearTimeout(t); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/marketing-price-reference/facets', { headers: await getHeaders() });
        if (res.ok) setFacets(await res.json());
      } catch { /* filters stay empty */ }
    })();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const q = filters(); q.set('page', String(page)); q.set('limit', String(PAGE));
        const res = await fetch(`/api/marketing-price-reference?${q}`, { headers: await getHeaders(), signal: controller.signal });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        setData(body);
        setDetail({});
        setError('');
      } catch (e: any) {
        if (e?.name !== 'AbortError') setError(`Gagal memuat harga acuan: ${e?.message || 'koneksi terputus'}`);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (r: Ref) => {
    const k = refKey(r);
    if (open === k) { setOpen(''); return; }
    setOpen(k);
    if (detail[k] && detail[k] !== 'error') return;
    setDetail(d => ({ ...d, [k]: 'loading' }));
    try {
      const q = filters();
      q.set('work_type', r.work_type); q.set('size', r.size); q.set('unit', r.unit); q.set('component', r.component);
      const res = await fetch(`/api/marketing-price-reference/detail?${q}`, { headers: await getHeaders() });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error);
      setDetail(d => ({ ...d, [k]: body }));
    } catch {
      setDetail(d => ({ ...d, [k]: 'error' }));
    }
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      const q = filters(); q.set('limit', '5000');
      const res = await fetch(`/api/marketing-price-reference?${q}`, { headers: await getHeaders() });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      const head = ['Jenis pekerjaan', 'Ukuran', 'Satuan', 'Bagian', 'Median', 'P25', 'P75', 'Terendah', 'Tertinggi', 'Jumlah harga', 'Job Order', 'Dari', 'Sampai', 'Harga terakhir', 'JO terakhir'];
      const rows = (body.rows as Ref[]).map(r => [r.work_type, r.size, r.unit, r.component || 'utuh', r.median, r.p25, r.p75, r.min, r.max, r.n, r.job_orders, r.date_from, r.date_to, r.last_price, r.last_job_order]);
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...rows]), 'Harga Acuan Marketing');
      XLSX.writeFile(wb, `HargaAcuanMarketing_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e: any) {
      setError(`Gagal ekspor: ${e?.message || 'koneksi terputus'}`);
    } finally {
      setExporting(false);
    }
  };

  const selectCls = 'py-2 px-2 rounded-lg border border-slate-200 bg-white text-sm max-w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
  const sort = params.get('sort') || 'n';
  const dir = params.get('dir') === 'asc' ? 'asc' : 'desc';
  const sortBtn = (k: string, label: string) => (
    <button type="button" onClick={() => set({ sort: k === 'n' ? '' : k, dir: sort === k && dir === 'desc' && k !== 'work_type' ? 'asc' : '' })} className="hover:text-slate-800">
      {label}{sort === k && (k === 'work_type' ? ' ↑' : dir === 'desc' ? ' ↓' : ' ↑')}
    </button>
  );
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur-md border-slate-200 px-6 py-4 flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="font-display font-bold text-xl md:text-2xl tracking-tight text-slate-800 flex items-center gap-2">
            <BadgeDollarSign className="text-indigo-500" size={22} aria-hidden="true" /> Harga Acuan Marketing
          </h2>
          <p className="text-xs md:text-sm text-slate-500 mt-1">Harga satuan yang ditawarkan ke customer per jenis pekerjaan, ukuran dan satuan, dari repair list Job Order.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={exportExcel} disabled={exporting || !data}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {exporting ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <FileSpreadsheet size={13} aria-hidden="true" />} Ekspor Excel
          </button>
          <button type="button" onClick={toggleHidden} title={hidden ? 'Tampilkan nominal' : 'Sembunyikan nominal'} aria-label={hidden ? 'Tampilkan nominal' : 'Sembunyikan nominal'}
            className={`p-2 rounded-xl border shadow-sm ${hidden ? 'bg-amber-100 border-amber-200 text-amber-700' : 'bg-white border-slate-200 text-slate-500 hover:text-slate-800'}`}>
            {hidden ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        </div>
      </header>

      <main className="w-full p-4 md:p-8 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative block w-full md:w-72">
            <span className="sr-only">Cari jenis pekerjaan atau ukuran</span>
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder='Cari jenis pekerjaan atau ukuran, mis. "sandblasting"'
              className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" />
          </label>
          <select aria-label="Periode" value={months} onChange={e => set({ months: e.target.value === '24' ? '' : e.target.value })} className={selectCls}>
            {PERIODS.map(([v, l]) => <option key={v} value={v}>{v === '0' ? 'Semua periode' : `${l} terakhir`}</option>)}
          </select>
          <select aria-label="Satuan" value={params.get('unit') || ''} onChange={e => set({ unit: e.target.value })} className={selectCls}>
            <option value="">Semua satuan</option>
            {(data?.units ?? []).map(u => <option key={u.unit} value={u.unit}>{u.unit || '(tanpa satuan)'} ({u.count})</option>)}
          </select>
          <select aria-label="Bagian" value={params.get('component') || ''} onChange={e => set({ component: e.target.value })} className={selectCls}>
            {COMPONENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select aria-label="Jenis Job Order" value={params.get('service') || ''} onChange={e => set({ service: e.target.value })} className={selectCls}>
            <option value="">Semua jenis JO</option>
            {(facets?.services ?? []).map(f => <option key={f.value} value={f.value}>{f.value}</option>)}
          </select>
          <select aria-label="Customer" value={params.get('customer') || ''} onChange={e => set({ customer: e.target.value })} className={`${selectCls} md:max-w-56`}>
            <option value="">Semua customer</option>
            {(facets?.customers ?? []).map(f => <option key={f.value} value={f.value}>{f.value}</option>)}
          </select>
        </div>

        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        {data && (
          <p className="text-xs text-slate-500">
            {data.total.toLocaleString('id-ID')} harga acuan dari {data.prices.toLocaleString('id-ID')} harga aktivitas.
            Rentang wajar = 25%–75% harga tengah. Paket pembangunan kapal baru dan aktivitas yang jenis pekerjaannya belum dikenali tidak dihitung.
            {loading && <Loader2 size={12} className="inline ml-2 animate-spin" aria-label="Memuat" />}
          </p>
        )}

        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th scope="col" className="py-2 pl-3 w-8"><span className="sr-only">Rincian</span></th>
                <th scope="col" className="py-2 px-3 text-left font-semibold">{sortBtn('work_type', 'Jenis pekerjaan / ukuran')}</th>
                <th scope="col" className="py-2 px-3 text-left font-semibold">Satuan</th>
                <th scope="col" className="py-2 px-3 text-right font-semibold">{sortBtn('median', 'Median')}</th>
                <th scope="col" className="py-2 px-3 text-right font-semibold">Rentang wajar</th>
                <th scope="col" className="py-2 px-3 text-right font-semibold hidden md:table-cell">Terendah s/d tertinggi</th>
                <th scope="col" className="py-2 px-3 text-right font-semibold">{sortBtn('n', 'Harga')}</th>
                <th scope="col" className="py-2 px-3 text-right font-semibold hidden sm:table-cell">{sortBtn('job_orders', 'Job Order')}</th>
                <th scope="col" className="py-2 px-3 text-left font-semibold hidden lg:table-cell">Terakhir</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.rows ?? []).map(r => {
                const k = refKey(r);
                const d = detail[k];
                return (
                  <React.Fragment key={k}>
                    <tr onClick={() => toggle(r)} className="cursor-pointer hover:bg-slate-50 align-top">
                      <td className="py-2 pl-3">
                        <button type="button" aria-expanded={open === k} aria-label={`Rincian ${r.work_type}`} className="text-slate-400 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded">
                          {open === k ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                        </button>
                      </td>
                      <td className="py-2 px-3 min-w-[12rem]">
                        <span className="font-medium text-slate-800">{r.work_type}</span>
                        {(r.size || r.component) && (
                          <span className="block text-xs text-slate-500">{r.size}{r.size && r.component ? ' · ' : ''}{r.component && <span className="font-semibold text-slate-600">{r.component}</span>}</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-slate-600 whitespace-nowrap">{r.unit || '–'}</td>
                      <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap font-semibold text-slate-800">{idr(r.median)}</td>
                      <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap text-slate-600">{idr(r.p25)} – {idr(r.p75)}</td>
                      <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap text-slate-500 hidden md:table-cell">{idr(r.min)} – {idr(r.max)}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{r.n.toLocaleString('id-ID')}</td>
                      <td className="py-2 px-3 text-right tabular-nums hidden sm:table-cell">{r.job_orders.toLocaleString('id-ID')}</td>
                      <td className="py-2 px-3 text-xs text-slate-500 hidden lg:table-cell min-w-[10rem]">
                        <span className="tabular-nums">{idr(r.last_price)}</span> · {r.date_to || '–'}
                        <span className="block break-words">{r.last_job_order}</span>
                      </td>
                    </tr>
                    {open === k && (
                      <tr>
                        <td colSpan={9} className="bg-slate-50/70 px-3 py-3">
                          {d === 'loading' && <p className="text-xs text-slate-500"><Loader2 size={12} className="inline mr-1 animate-spin" aria-hidden="true" />Memuat rincian…</p>}
                          {d === 'error' && <p className="text-xs text-rose-700">Gagal memuat rincian.</p>}
                          {d && typeof d === 'object' && (
                            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]">
                              {([['Per tahun', d.years, 'year'], ['Per customer', d.customers, 'customer']] as const).map(([title, list, field]) => (
                                <div key={title} className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
                                  <p className="px-3 pt-2 text-xs font-semibold text-slate-600">{title}</p>
                                  <table className="min-w-full text-xs">
                                    <thead className="text-slate-500"><tr>
                                      <th scope="col" className="py-1.5 px-3 text-left font-semibold">{field === 'year' ? 'Tahun' : 'Customer'}</th>
                                      <th scope="col" className="py-1.5 px-3 text-right font-semibold">Harga</th>
                                      <th scope="col" className="py-1.5 px-3 text-right font-semibold">Median</th>
                                    </tr></thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {list.slice(0, 10).map((s, i) => (
                                        <tr key={i}>
                                          <td className="py-1.5 px-3 break-words">{(field === 'year' ? s.year : s.customer) || '–'}</td>
                                          <td className="py-1.5 px-3 text-right tabular-nums">{s.n}</td>
                                          <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap">{idr(s.median)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ))}
                              <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
                                <p className="px-3 pt-2 text-xs font-semibold text-slate-600">Aktivitas di repair list ({d.items.length}{d.items.length >= 200 ? '+' : ''})</p>
                                <table className="min-w-full text-xs">
                                  <thead className="text-slate-500"><tr>
                                    <th scope="col" className="py-1.5 px-3 text-left font-semibold">Job Order</th>
                                    <th scope="col" className="py-1.5 px-3 text-left font-semibold">Aktivitas</th>
                                    <th scope="col" className="py-1.5 px-3 text-right font-semibold">Qty</th>
                                    <th scope="col" className="py-1.5 px-3 text-right font-semibold">Harga satuan</th>
                                  </tr></thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {d.items.slice(0, 50).map((it, i) => (
                                      <tr key={i} className="align-top">
                                        <td className="py-1.5 px-3 min-w-[9rem]">
                                          <Link to={`/repair-list/${encodeURIComponent(it.jo_id)}`} className="font-medium text-slate-800 hover:text-indigo-700 break-words">{it.ship || it.jo_code}</Link>
                                          <span className="block text-slate-500">{it.est_start} · {it.customer}</span>
                                        </td>
                                        <td className="py-1.5 px-3 min-w-[12rem]">
                                          <span className="text-slate-700 break-words">{it.activity}</span>
                                          {it.group && <span className="block text-slate-500 break-words">{it.group}</span>}
                                        </td>
                                        <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap">{it.quantity.toLocaleString('id-ID')} {r.unit}</td>
                                        <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap">{idr(it.unit_price)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {data && !data.rows?.length && <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-500">Belum ada harga acuan untuk saringan ini.</td></tr>}
              {!data && loading && <tr><td colSpan={9} className="px-3 py-6 text-slate-500"><Loader2 size={14} className="inline mr-2 animate-spin" aria-hidden="true" />Memuat…</td></tr>}
            </tbody>
          </table>
        </div>

        {data && totalPages > 1 && (
          <nav aria-label="Halaman" className="flex items-center justify-end gap-2 text-xs text-slate-600">
            <button type="button" disabled={page <= 1} onClick={() => set({ page: String(page - 1) }, true)} aria-label="Halaman sebelumnya"
              className="p-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40"><ChevronLeft size={14} aria-hidden="true" /></button>
            <span>Halaman {page} dari {totalPages.toLocaleString('id-ID')}</span>
            <button type="button" disabled={page >= totalPages} onClick={() => set({ page: String(page + 1) }, true)} aria-label="Halaman berikutnya"
              className="p-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40"><ChevronRight size={14} aria-hidden="true" /></button>
          </nav>
        )}
      </main>
    </div>
  );
}
