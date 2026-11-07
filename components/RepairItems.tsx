import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ListChecks, Search, Loader2, Eye, EyeOff, FileSpreadsheet, ChevronLeft, ChevronRight } from 'lucide-react';
import * as XLSX from 'xlsx';
import { getHeaders } from '@/lib/api-client';

// Item Repair List: every activity of every Job Order's repair list, split
// into work types like Item Pekerjaan WO. The marketing side: customer prices
// (with Harga Penawaran), not vendor costs.

type Item = {
  jo_id: string; jo_code: string; ship: string; customer: string; service: string; est_start: string; version: number;
  no: string; activity: string; group: string; work_type: string; size: string; component: string; recognized: boolean;
  unit: string; quantity: number; unit_price?: number; total_price?: number; wos: string[];
};
type SummaryRow = Record<string, any> & { activities: number; activities_with_wo: number; job_orders: number };
type Facet = { value: string; count: number };

const VIEWS = [
  { key: 'list', label: 'Daftar Item' },
  { key: 'job_order', label: 'Per Job Order' },
  { key: 'group', label: 'Per Grup' },
  { key: 'work_type', label: 'Per Jenis Pekerjaan' },
  { key: 'work_type_size', label: 'Per Jenis Pekerjaan & Ukuran' },
  { key: 'customer', label: 'Per Customer' },
  { key: 'service', label: 'Per Jenis Job Order' },
] as const;
type View = typeof VIEWS[number]['key'];

// Columns of each summary view, and the list filter a row opens.
const KEY_COLUMNS: Record<Exclude<View, 'list'>, { key: string; label: string }[]> = {
  job_order: [{ key: 'ship', label: 'Job Order' }, { key: 'customer', label: 'Customer' }],
  group: [{ key: 'group', label: 'Grup' }],
  work_type: [{ key: 'work_type', label: 'Jenis pekerjaan' }],
  work_type_size: [{ key: 'work_type', label: 'Jenis pekerjaan' }, { key: 'size', label: 'Ukuran' }, { key: 'unit', label: 'Satuan' }],
  customer: [{ key: 'customer', label: 'Customer' }],
  service: [{ key: 'service', label: 'Jenis Job Order' }],
};
const ROW_FILTER: Record<Exclude<View, 'list'>, (r: SummaryRow) => Record<string, string>> = {
  job_order: r => ({ jo_id: r.jo_id }),
  group: r => ({ q: r.group }),
  work_type: r => ({ work_type: r.work_type || '', recognized: r.work_type ? '' : 'no' }),
  work_type_size: r => ({ work_type: r.work_type || '', size: r.size || '', unit: r.unit || '', recognized: r.work_type ? '' : 'no' }),
  customer: r => ({ customer: r.customer }),
  service: r => ({ service: r.service }),
};
const FILTER_KEYS = ['q', 'year', 'service', 'customer', 'jo_id', 'version', 'wo', 'recognized', 'work_type', 'size', 'unit'];
const PAGE = 50;

export default function RepairItems() {
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') || 'list') as View;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [query, setQuery] = useState(params.get('q') || '');
  const [facets, setFacets] = useState<{ years: Facet[]; services: Facet[]; customers: Facet[] } | null>(null);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('hideNominal_WO') !== 'false'; } catch { return true; } });
  const toggleHidden = () => { const next = !hidden; setHidden(next); try { localStorage.setItem('hideNominal_WO', String(next)); } catch { /* storage blocked */ } };
  const idr = (v?: number) => (v === undefined || v === null ? '–' : hidden ? 'Rp ****'
    : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v || 0));
  const num = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: 2 });

  const set = (changes: Record<string, string>, keepPage = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k); }
    if (!keepPage) next.delete('page');
    setParams(next, { replace: true });
  };
  const filterQuery = useMemo(() => {
    const q = new URLSearchParams();
    for (const k of FILTER_KEYS) { const v = params.get(k); if (v) q.set(k, v); }
    return q;
  }, [params]);

  useEffect(() => { const t = setTimeout(() => { if (query !== (params.get('q') || '')) set({ q: query.trim() }); }, 400); return () => clearTimeout(t); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/repair-items/facets', { headers: await getHeaders() });
        if (res.ok) setFacets(await res.json());
      } catch { /* filters stay empty */ }
    })();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const q = new URLSearchParams(filterQuery);
        let url: string;
        if (view === 'list') {
          q.set('page', String(page)); q.set('limit', String(PAGE));
          if (params.get('sort')) q.set('sort', params.get('sort')!);
          url = `/api/repair-items?${q}`;
        } else {
          q.set('by', view);
          if (params.get('sort')) q.set('sort', params.get('sort')!);
          url = `/api/repair-items/summary?${q}`;
        }
        const res = await fetch(url, { headers: await getHeaders(), signal: controller.signal });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        setData(body);
        setError('');
      } catch (e: any) {
        if (e?.name !== 'AbortError') setError(`Gagal memuat item repair list: ${e?.message || 'koneksi terputus'}`);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [view, page, filterQuery, params]);

  const showPrice = !!data?.show_price;
  const activeFilters = FILTER_KEYS.filter(k => k !== 'q' && params.get(k));
  const filterLabel: Record<string, string> = { year: 'Tahun', service: 'Jenis JO', customer: 'Customer', jo_id: 'Job Order', version: 'Versi', wo: 'WO',
    recognized: 'Dikenali', work_type: 'Jenis pekerjaan', size: 'Ukuran', unit: 'Satuan' };
  const valueLabel = (k: string, v: string) => (k === 'wo' ? (v === 'with' ? 'sudah ada' : 'belum ada') : k === 'recognized' ? (v === 'yes' ? 'ya' : 'belum') : v || '(kosong)');

  const exportExcel = async () => {
    setExporting(true);
    try {
      let head: string[]; let rows: (string | number)[][];
      if (view === 'list') {
        const q = new URLSearchParams(filterQuery); q.set('all', '1'); q.set('limit', '20000');
        const res = await fetch(`/api/repair-items?${q}`, { headers: await getHeaders() });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        head = ['Kode JO', 'Kapal', 'Customer', 'Jenis JO', 'Rencana mulai', 'Versi', 'No', 'Grup', 'Aktivitas', 'Jenis pekerjaan', 'Ukuran', 'Komponen', 'Qty', 'Satuan',
          ...(body.show_price ? ['Harga satuan', 'Total'] : []), 'WO'];
        rows = (body.items as Item[]).map(it => [it.jo_code, it.ship, it.customer, it.service, it.est_start, it.version === 1 ? 'Utama' : `Tambahan v${it.version}`,
          it.no, it.group, it.activity, it.work_type, it.size, it.component, it.quantity, it.unit, ...(body.show_price ? [it.unit_price ?? '', it.total_price ?? ''] : []), it.wos.join(', ')]);
      } else {
        const cols = KEY_COLUMNS[view];
        head = [...cols.map(c => c.label), 'Aktivitas', 'Sudah ada WO', 'Job Order', ...(view === 'work_type_size' ? ['Qty'] : []),
          ...(showPrice ? ['Total penawaran'] : []), ...(showPrice && view === 'work_type_size' ? ['Harga satuan median', 'Min', 'Max'] : [])];
        rows = (data?.rows || []).map((r: SummaryRow) => [...cols.map(c => (c.key === 'ship' ? `${r.jo_code} ${r.ship}`.trim() : r[c.key] || '')), r.activities, r.activities_with_wo, r.job_orders,
          ...(view === 'work_type_size' ? [r.quantity] : []), ...(showPrice ? [r.total_price] : []),
          ...(showPrice && view === 'work_type_size' ? [r.unit_price_median ?? '', r.unit_price_min ?? '', r.unit_price_max ?? ''] : [])]);
      }
      const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Item Repair List');
      XLSX.writeFile(wb, `ItemRepairList_${VIEWS.find(v => v.key === view)?.label.replace(/\W+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e: any) {
      setError(`Gagal ekspor: ${e?.message || 'koneksi terputus'}`);
    } finally {
      setExporting(false);
    }
  };

  const selectCls = 'py-2 px-2 rounded-lg border border-slate-200 bg-white text-sm max-w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
  const totalPages = view === 'list' && data ? Math.max(1, Math.ceil((data.total || 0) / PAGE)) : 1;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur-md border-slate-200 px-6 py-4 flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="font-display font-bold text-xl md:text-2xl tracking-tight text-slate-800 flex items-center gap-2">
            <ListChecks className="text-indigo-500" size={22} aria-hidden="true" /> Item Repair List
          </h2>
          <p className="text-xs md:text-sm text-slate-500 mt-1">Semua aktivitas repair list Job Order, dikelompokkan per jenis pekerjaan. Harga adalah harga penawaran ke customer.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={exportExcel} disabled={exporting || !data}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {exporting ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <FileSpreadsheet size={13} aria-hidden="true" />} Ekspor Excel
          </button>
          {showPrice && (
            <button type="button" onClick={toggleHidden} title={hidden ? 'Tampilkan nominal' : 'Sembunyikan nominal'} aria-label={hidden ? 'Tampilkan nominal' : 'Sembunyikan nominal'}
              className={`p-2 rounded-xl border shadow-sm ${hidden ? 'bg-amber-100 border-amber-200 text-amber-700' : 'bg-white border-slate-200 text-slate-500 hover:text-slate-800'}`}>
              {hidden ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
          )}
        </div>
      </header>

      <main className="w-full p-4 md:p-8 flex flex-col gap-3">
        <div role="tablist" aria-label="Tampilan" className="flex gap-1 overflow-x-auto pb-1">
          {VIEWS.map(v => (
            <button key={v.key} type="button" role="tab" aria-selected={view === v.key} onClick={() => set({ view: v.key === 'list' ? '' : v.key, sort: '' })}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold ${view === v.key ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              {v.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative block w-full md:w-72">
            <span className="sr-only">Cari aktivitas, grup, kapal, atau kode</span>
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Cari aktivitas, grup, kapal, atau kode"
              className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" />
          </label>
          <select aria-label="Tahun" value={params.get('year') || ''} onChange={e => set({ year: e.target.value })} className={selectCls}>
            <option value="">Semua tahun</option>
            {facets?.years.map(f => <option key={f.value} value={f.value}>{f.value}</option>)}
          </select>
          <select aria-label="Jenis Job Order" value={params.get('service') || ''} onChange={e => set({ service: e.target.value })} className={selectCls}>
            <option value="">Semua jenis JO</option>
            {facets?.services.map(f => <option key={f.value} value={f.value}>{f.value}</option>)}
          </select>
          <select aria-label="Customer" value={params.get('customer') || ''} onChange={e => set({ customer: e.target.value })} className={`${selectCls} md:max-w-56`}>
            <option value="">Semua customer</option>
            {facets?.customers.map(f => <option key={f.value} value={f.value}>{f.value}</option>)}
          </select>
          <select aria-label="Versi repair list" value={params.get('version') || ''} onChange={e => set({ version: e.target.value })} className={selectCls}>
            <option value="">Semua versi</option>
            <option value="utama">Versi 1 (utama)</option>
            <option value="tambahan">Tambahan</option>
          </select>
          <select aria-label="Status WO" value={params.get('wo') || ''} onChange={e => set({ wo: e.target.value })} className={selectCls}>
            <option value="">Semua status WO</option>
            <option value="with">Sudah ada WO</option>
            <option value="without">Belum ada WO</option>
          </select>
          <select aria-label="Jenis pekerjaan dikenali" value={params.get('recognized') || ''} onChange={e => set({ recognized: e.target.value })} className={selectCls}>
            <option value="">Dikenali & belum</option>
            <option value="yes">Jenis pekerjaan dikenali</option>
            <option value="no">Belum dikenali</option>
          </select>
        </div>

        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {activeFilters.map(k => (
              <button key={k} type="button" onClick={() => set({ [k]: '' })} aria-label={`Hapus saringan ${filterLabel[k]}`}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-indigo-50 text-indigo-800 hover:bg-indigo-100">
                {filterLabel[k]}: {valueLabel(k, params.get(k) || '')} <span aria-hidden="true">×</span>
              </button>
            ))}
            <button type="button" onClick={() => { setQuery(''); set(Object.fromEntries(FILTER_KEYS.map(k => [k, '']))); }} className="px-2 py-1 font-semibold text-slate-600 hover:text-slate-900">Hapus semua</button>
          </div>
        )}

        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}

        {data && (
          <p className="text-xs text-slate-500">
            {view === 'list'
              ? `${(data.total || 0).toLocaleString('id-ID')} aktivitas`
              : `${(data.groups || 0).toLocaleString('id-ID')} kelompok · ${(data.activities || 0).toLocaleString('id-ID')} aktivitas`}
            {showPrice && data.total_price !== undefined && <> · total penawaran <span className="tabular-nums">{idr(data.total_price)}</span></>}
            {loading && <Loader2 size={12} className="inline ml-2 animate-spin" aria-label="Memuat" />}
          </p>
        )}

        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          {view === 'list' ? (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 text-left">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">Job Order</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Aktivitas</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Jenis pekerjaan</th>
                  <th scope="col" className="px-3 py-2 font-semibold text-right">Qty</th>
                  {showPrice && (
                    <th scope="col" className="px-3 py-2 font-semibold text-right">
                      <button type="button" onClick={() => set({ sort: params.get('sort') === 'unit_price' ? '' : 'unit_price' })} className="hover:text-slate-800">
                        Harga satuan{params.get('sort') === 'unit_price' && ' ↓'}
                      </button>
                    </th>
                  )}
                  {showPrice && (
                    <th scope="col" className="px-3 py-2 font-semibold text-right">
                      <button type="button" onClick={() => set({ sort: params.get('sort') === 'total_price' ? '' : 'total_price' })} className="hover:text-slate-800">
                        Total{params.get('sort') === 'total_price' && ' ↓'}
                      </button>
                    </th>
                  )}
                  <th scope="col" className="px-3 py-2 font-semibold">WO</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.items as Item[] | undefined)?.map((it, i) => (
                  <tr key={`${it.jo_id}-${it.no}-${i}`} className="align-top">
                    <td className="px-3 py-2 min-w-[10rem]">
                      <Link to={`/repair-list/${encodeURIComponent(it.jo_id)}`} className="font-medium text-slate-800 hover:text-indigo-700 break-words">{it.ship || it.jo_code}</Link>
                      <span className="block text-xs text-slate-500 break-words">{it.jo_code}{it.version > 1 ? ` · tambahan v${it.version}` : ''}</span>
                    </td>
                    <td className="px-3 py-2 min-w-[14rem]">
                      <span className="text-slate-800 break-words">{it.activity}</span>
                      {it.group && <span className="block text-xs text-slate-500 break-words">{it.no ? `${it.no} · ` : ''}{it.group}</span>}
                    </td>
                    <td className="px-3 py-2 min-w-[10rem]">
                      {it.work_type ? <span className="text-slate-700">{it.work_type}</span> : <span className="text-xs text-amber-800">Belum dikenali</span>}
                      {(it.size || it.component) && <span className="block text-xs text-slate-500">{[it.size, it.component].filter(Boolean).join(' · ')}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-slate-600">{num(it.quantity)} {it.unit}</td>
                    {showPrice && <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{idr(it.unit_price)}</td>}
                    {showPrice && <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium">{idr(it.total_price)}</td>}
                    <td className="px-3 py-2 text-xs">
                      {it.wos.length === 0 ? <span className="inline-block rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-900 whitespace-nowrap">Belum ada WO</span> : (
                        <span className="flex flex-wrap gap-1">
                          {it.wos.slice(0, 2).map(w => <span key={w} className="rounded bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-800 whitespace-nowrap">{w}</span>)}
                          {it.wos.length > 2 && <span title={it.wos.slice(2).join(', ')} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">+{it.wos.length - 2}</span>}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {data?.items?.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">Tidak ada aktivitas yang cocok.</td></tr>}
                {!data && loading && <tr><td colSpan={7} className="px-3 py-6 text-slate-500"><Loader2 size={14} className="inline mr-2 animate-spin" aria-hidden="true" />Memuat…</td></tr>}
              </tbody>
            </table>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 text-left">
                <tr>
                  {KEY_COLUMNS[view].map(c => <th key={c.key} scope="col" className="px-3 py-2 font-semibold">{c.label}</th>)}
                  {[['activities', 'Aktivitas'], ['job_orders', 'Job Order']].map(([k, l]) => (
                    <th key={k} scope="col" className="px-3 py-2 font-semibold text-right">
                      <button type="button" onClick={() => set({ sort: k })} className="hover:text-slate-800">{l}{params.get('sort') === k && ' ↓'}</button>
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 font-semibold text-right">Sudah ada WO</th>
                  {view === 'work_type_size' && <th scope="col" className="px-3 py-2 font-semibold text-right">Qty</th>}
                  {showPrice && (
                    <th scope="col" className="px-3 py-2 font-semibold text-right">
                      <button type="button" onClick={() => set({ sort: '' })} className="hover:text-slate-800">Total penawaran{!params.get('sort') && ' ↓'}</button>
                    </th>
                  )}
                  {showPrice && view === 'work_type_size' && <th scope="col" className="px-3 py-2 font-semibold text-right">Harga satuan (median · rentang)</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.rows as SummaryRow[] | undefined)?.map((r, i) => (
                  <tr key={i} onClick={() => set({ ...ROW_FILTER[view](r), view: '', sort: '' })} className="cursor-pointer hover:bg-slate-50 align-top">
                    {KEY_COLUMNS[view].map((c, ci) => (
                      <td key={c.key} className="px-3 py-2 break-words min-w-[8rem]">
                        {ci === 0 ? (
                          <button type="button" className="text-left font-medium text-slate-800 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded">
                            {c.key === 'ship' ? (r.ship || r.jo_code) : (r[c.key] || <span className="text-amber-800">{c.key === 'work_type' ? 'Belum dikenali' : '(kosong)'}</span>)}
                          </button>
                        ) : <span className="text-slate-600">{r[c.key] || '–'}</span>}
                        {c.key === 'ship' && <span className="block text-xs text-slate-500">{r.jo_code}</span>}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right tabular-nums">{r.activities.toLocaleString('id-ID')}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.job_orders.toLocaleString('id-ID')}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{r.activities ? `${Math.round((r.activities_with_wo / r.activities) * 100)}%` : '–'}</td>
                    {view === 'work_type_size' && <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-slate-600">{num(r.quantity || 0)} {r.unit}</td>}
                    {showPrice && <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium">{idr(r.total_price)}</td>}
                    {showPrice && view === 'work_type_size' && (
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                        {r.unit_price_median !== undefined ? (
                          <>{idr(r.unit_price_median)}<span className="block text-xs text-slate-500">{idr(r.unit_price_min)} – {idr(r.unit_price_max)} · {r.priced} harga</span></>
                        ) : '–'}
                      </td>
                    )}
                  </tr>
                ))}
                {data?.rows?.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">Tidak ada aktivitas yang cocok.</td></tr>}
              </tbody>
            </table>
          )}
        </div>

        {view === 'list' && data && totalPages > 1 && (
          <nav aria-label="Halaman" className="flex items-center justify-end gap-2 text-xs text-slate-600">
            <button type="button" disabled={page <= 1} onClick={() => set({ page: String(page - 1) }, true)} aria-label="Halaman sebelumnya"
              className="p-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40"><ChevronLeft size={14} aria-hidden="true" /></button>
            <span>Halaman {page} dari {totalPages.toLocaleString('id-ID')}</span>
            <button type="button" disabled={page >= totalPages} onClick={() => set({ page: String(page + 1) }, true)} aria-label="Halaman berikutnya"
              className="p-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40"><ChevronRight size={14} aria-hidden="true" /></button>
          </nav>
        )}
        {view !== 'list' && data && data.groups > (data.rows?.length || 0) && (
          <p className="text-xs text-slate-500">Menampilkan {data.rows.length} kelompok teratas dari {data.groups.toLocaleString('id-ID')}. Persempit dengan saringan.</p>
        )}
      </main>
    </div>
  );
}
