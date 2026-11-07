import React, { useEffect, useState } from 'react';
import { Search, Tags, ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff, FileSpreadsheet } from 'lucide-react';
import { getHeaders } from '@/lib/api-client';
import { useData } from '@/context/DataContext';
import AskAIButton from './AskAIButton';

// Harga Acuan: the usual unit cost of each work type, size and unit, from
// approved work items (wo_item_reference, rebuilt by the findings job). A row
// opens its trend per year, its vendors and the items it is built from.

const RESOURCE = 'Harga Acuan';
const FIELD_LABEL = 'block text-xs font-semibold text-slate-500';
const FIELD_INPUT = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500';

const SORTS: { key: string; label: string; sort: string; dir: 'asc' | 'desc' }[] = [
  { key: 'n', label: 'Paling banyak pembanding', sort: 'n', dir: 'desc' },
  { key: 'median_desc', label: 'Median tertinggi', sort: 'median', dir: 'desc' },
  { key: 'median_asc', label: 'Median terendah', sort: 'median', dir: 'asc' },
  { key: 'work_type', label: 'Jenis pekerjaan A-Z', sort: 'work_type', dir: 'asc' },
  { key: 'spread', label: 'Rentang harga paling lebar', sort: 'spread', dir: 'desc' },
];

const POSITION: Record<string, { label: string; style: string }> = {
  below: { label: 'di bawah rentang', style: 'bg-sky-100 text-sky-800' },
  within: { label: 'wajar', style: 'bg-emerald-100 text-emerald-800' },
  above: { label: 'di atas rentang', style: 'bg-amber-100 text-amber-800' },
};

type Reference = {
  work_type: string; size: string; unit: string; n: number; p25: number; median: number; p75: number;
  min: number; max: number; basis: string; date_from: string; date_to: string;
};
type Stats = { label: string; n: number; p25: number; median: number; p75: number; min: number; max: number };
type Detail = { loading: boolean; error?: string; years?: Stats[]; vendors?: Stats[]; items?: any[]; item_count?: number };

export default function PriceReference() {
  const { canAccess } = useData();
  const canExport = canAccess(RESOURCE, 'export');
  const [searchTerm, setSearchTerm] = useState('');
  const [search, setSearch] = useState('');
  const [unit, setUnit] = useState('all');
  const [sortKey, setSortKey] = useState('n');
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [data, setData] = useState<{ data: Reference[]; total: number; updated_at: string; units: string[]; min_items: number; window_months: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [isNominalHidden, setIsNominalHidden] = useState(() => {
    try { return localStorage.getItem('hideNominal_WO') !== 'false'; } catch { return true; }
  });

  const toggleNominal = () => {
    const next = !isNominalHidden;
    setIsNominalHidden(next);
    try { localStorage.setItem('hideNominal_WO', String(next)); } catch { /* storage unavailable */ }
  };
  const formatIDR = (value: number) => isNominalHidden
    ? 'Rp ****'
    : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value || 0);
  const formatNum = (value: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(value || 0);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchTerm.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const params = () => {
    const s = SORTS.find(x => x.key === sortKey) || SORTS[0];
    const p = new URLSearchParams({ sort: s.sort, dir: s.dir });
    if (search) p.set('search', search);
    if (unit !== 'all') p.set('unit', unit);
    return p;
  };

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setDetails({});
      try {
        const headers = await getHeaders();
        const p = params();
        p.set('page', String(page));
        p.set('limit', String(pageSize));
        const res = await fetch(`/api/price-reference?${p}`, { headers, signal: controller.signal });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || `server membalas HTTP ${res.status}`);
        }
        setData(await res.json());
        setError('');
      } catch (e: any) {
        if (e?.name !== 'AbortError') setError(`Gagal memuat harga acuan: ${e?.message || 'koneksi terputus'}`);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [search, unit, sortKey, page]);

  const keyOf = (r: Reference) => `${r.work_type}\u0001${r.size}\u0001${r.unit}`;
  const toggle = async (r: Reference) => {
    const key = keyOf(r);
    if (details[key]) {
      setDetails(prev => { const next = { ...prev }; delete next[key]; return next; });
      return;
    }
    setDetails(prev => ({ ...prev, [key]: { loading: true } }));
    try {
      const headers = await getHeaders();
      const p = new URLSearchParams({ work_type: r.work_type, size: r.size, unit: r.unit });
      const res = await fetch(`/api/price-reference/detail?${p}`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setDetails(prev => ({ ...prev, [key]: { loading: false, years: body.years, vendors: body.vendors, items: body.items, item_count: body.item_count } }));
    } catch {
      setDetails(prev => ({ ...prev, [key]: { loading: false, error: 'Gagal memuat rincian. Klik lagi untuk mencoba ulang.' } }));
    }
  };

  const exportExcel = async () => {
    setExporting(true);
    setExportError('');
    try {
      const headers = await getHeaders();
      const res = await fetch(`/api/price-reference/export?${params()}`, { headers });
      if (!res.ok) throw new Error(`server membalas HTTP ${res.status}`);
      const blob = await res.blob();
      const filename = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'Harga_Acuan.xlsx';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setExportError(`Export gagal: ${e?.message || 'koneksi terputus'}. Coba lagi.`);
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / pageSize));
  const basisText = (r: Reference) => `${r.basis === 'semua' ? 'semua tahun' : r.basis}, ${r.date_from || '?'} s/d ${r.date_to || '?'}`;

  const StatsTable = ({ title, rows, first }: { title: string; rows: Stats[]; first: string }) => {
    const maxMedian = Math.max(1, ...rows.map(s => s.median));
    return (
      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <p className="px-3 py-2 text-xs font-semibold text-slate-700 border-b border-slate-100">{title}</p>
        <table className="w-full text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1.5 px-3 text-left font-semibold">{first}</th>
              <th className="py-1.5 px-3 text-right font-semibold">Item</th>
              <th className="py-1.5 px-3 text-right font-semibold">Median</th>
              <th className="py-1.5 px-3 text-right font-semibold">Rentang wajar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(s => (
              <tr key={s.label}>
                <td className="py-1.5 px-3 text-slate-800">{s.label}</td>
                <td className="py-1.5 px-3 text-right font-mono">{formatNum(s.n)}</td>
                <td className="py-1.5 px-3 text-right font-mono whitespace-nowrap">
                  <span className="inline-flex items-center gap-2 justify-end">
                    {!isNominalHidden && <span className="inline-block h-1.5 rounded-full bg-indigo-400" style={{ width: `${Math.max(4, (s.median / maxMedian) * 64)}px` }} aria-hidden="true" />}
                    {formatIDR(s.median)}
                  </span>
                </td>
                <td className="py-1.5 px-3 text-right font-mono whitespace-nowrap text-slate-600">{formatIDR(s.p25)} s/d {formatIDR(s.p75)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur-md border-slate-200 px-6 py-4 flex flex-wrap justify-between items-center gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="font-display font-bold text-xl md:text-2xl tracking-tight text-slate-800 flex items-center gap-2">
              <Tags className="text-indigo-500" size={22} /> Harga Acuan Jasa
            </h2>
            <AskAIButton scope="wo" questions={["Berapa harga wajar bongkar & ganti baru kampas rem?", "Jenis pekerjaan yang harganya paling bervariasi", "Vendor yang sering di atas harga acuan"]} />
          </div>
          <p className="text-xs md:text-sm text-slate-500 mt-1">
            Harga satuan wajar per jenis pekerjaan, ukuran dan satuan, dari item yang sudah approved
            {data ? ` (${data.window_months} bulan terakhir, minimal ${data.min_items} item pembanding)` : ''}.
            {data?.updated_at ? ` Diperbarui ${data.updated_at}.` : ''}
          </p>
        </div>
        <button
          onClick={toggleNominal}
          title={isNominalHidden ? 'Tampilkan Nominal' : 'Sembunyikan Nominal'}
          aria-label={isNominalHidden ? 'Tampilkan nominal' : 'Sembunyikan nominal'}
          className={`flex items-center justify-center p-2 rounded-xl border transition-all shadow-sm ${isNominalHidden ? 'bg-amber-100 border-amber-200 text-amber-700' : 'bg-white border-slate-200 text-slate-500 hover:text-slate-800'}`}
        >
          {isNominalHidden ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </header>

      <main className="w-full p-4 md:p-8 space-y-6">
        <section className="p-5 rounded-2xl border bg-white border-slate-200 shadow-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
            <div className="space-y-1 lg:col-span-2">
              <label htmlFor="pr-search" className={FIELD_LABEL}>Cari jenis pekerjaan atau ukuran</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input id="pr-search" type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                  placeholder={'mis. kampas rem, packing karet 2", replating bottom'} className={`${FIELD_INPUT} pl-9`} />
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor="pr-unit" className={FIELD_LABEL}>Satuan</label>
              <select id="pr-unit" value={unit} onChange={e => { setUnit(e.target.value); setPage(1); }} className={FIELD_INPUT}>
                <option value="all">Semua satuan</option>
                {(data?.units || []).map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="pr-sort" className={FIELD_LABEL}>Urutkan</label>
              <select id="pr-sort" value={sortKey} onChange={e => { setSortKey(e.target.value); setPage(1); }} className={FIELD_INPUT}>
                {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border bg-white border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-700">
              {loading ? 'Memuat…' : `${(data?.total || 0).toLocaleString('id-ID')} harga acuan`}
              <span className="font-normal text-slate-500"> · rentang wajar = 50% item di tengah (P25 s/d P75)</span>
            </p>
            {canExport && (
              <button onClick={exportExcel} disabled={exporting || loading || !data?.total}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 transition">
                <FileSpreadsheet size={13} /> {exporting ? 'Menyiapkan file…' : `Export Excel (${(data?.total || 0).toLocaleString('id-ID')} baris)`}
              </button>
            )}
          </div>
          {exportError && <p role="alert" className="px-5 py-2 text-xs text-rose-700 bg-rose-50 border-b border-rose-100">{exportError}</p>}

          {error ? (
            <div className="p-8 text-center text-sm text-rose-700">{error}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 text-xs">
                  <tr>
                    <th className="py-3 pl-4 w-8" aria-label="Rincian"></th>
                    <th className="py-3 px-4 text-left font-semibold">Jenis pekerjaan / ukuran</th>
                    <th className="py-3 px-4 text-left font-semibold">Satuan</th>
                    <th className="py-3 px-4 text-right font-semibold">Median</th>
                    <th className="py-3 px-4 text-right font-semibold">Rentang wajar</th>
                    <th className="py-3 px-4 text-right font-semibold">Terendah s/d tertinggi</th>
                    <th className="py-3 px-4 text-right font-semibold">Item</th>
                    <th className="py-3 px-4 text-left font-semibold">Dasar data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {!loading && (data?.data || []).length === 0 && (
                    <tr><td colSpan={8} className="p-8 text-center text-slate-500">
                      Tidak ada harga acuan yang cocok. Harga acuan hanya ada untuk kelompok dengan minimal {data?.min_items || 10} item approved.
                    </td></tr>
                  )}
                  {(data?.data || []).map(r => {
                    const key = keyOf(r);
                    const d = details[key];
                    return (
                      <React.Fragment key={key}>
                        <tr className={`align-top cursor-pointer hover:bg-slate-50 ${d ? 'bg-indigo-50/40' : ''}`} onClick={() => toggle(r)}>
                          <td className="py-2.5 pl-4 text-slate-500"><ChevronDown size={14} className={`transition-transform ${d ? '' : '-rotate-90'}`} /></td>
                          <td className="py-2.5 px-4 max-w-md">
                            <button type="button" aria-expanded={!!d} className="text-left font-semibold text-slate-800 hover:text-indigo-700 rounded outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40">
                              {r.work_type}
                            </button>
                            {r.size && <p className="text-xs text-slate-500 mt-0.5">{r.size}</p>}
                          </td>
                          <td className="py-2.5 px-4 text-slate-600">{r.unit || '-'}</td>
                          <td className="py-2.5 px-4 text-right font-mono font-semibold whitespace-nowrap">{formatIDR(r.median)}</td>
                          <td className="py-2.5 px-4 text-right font-mono whitespace-nowrap">{formatIDR(r.p25)} s/d {formatIDR(r.p75)}</td>
                          <td className="py-2.5 px-4 text-right font-mono whitespace-nowrap text-slate-500">{formatIDR(r.min)} s/d {formatIDR(r.max)}</td>
                          <td className="py-2.5 px-4 text-right font-mono">{formatNum(r.n)}</td>
                          <td className="py-2.5 px-4 text-xs text-slate-500 whitespace-nowrap">{basisText(r)}</td>
                        </tr>
                        {d && (
                          <tr className="bg-slate-50/60">
                            <td colSpan={8} className="px-4 pb-4 pt-1">
                              {d.error ? <p className="text-xs text-rose-700 py-2">{d.error}</p>
                                : d.loading ? <p className="text-xs text-slate-500 py-2">Memuat rincian…</p>
                                : (
                                  <div className="space-y-3">
                                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                                      <StatsTable title="Tren per tahun (semua item approved)" rows={d.years || []} first="Tahun" />
                                      <StatsTable title="Per vendor (15 vendor dengan item terbanyak)" rows={d.vendors || []} first="Vendor" />
                                    </div>
                                    <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
                                      <p className="px-3 py-2 text-xs font-semibold text-slate-700 border-b border-slate-100">
                                        Item pembanding terbaru{d.item_count && d.item_count > (d.items || []).length ? ` (${(d.items || []).length} dari ${d.item_count.toLocaleString('id-ID')})` : ''}
                                      </p>
                                      <table className="w-full text-xs">
                                        <thead className="text-slate-500">
                                          <tr>
                                            <th className="py-1.5 px-3 text-left font-semibold">Tanggal</th>
                                            <th className="py-1.5 px-3 text-left font-semibold">WO / Proyek</th>
                                            <th className="py-1.5 px-3 text-left font-semibold">Vendor</th>
                                            <th className="py-1.5 px-3 text-left font-semibold">Deskripsi item</th>
                                            <th className="py-1.5 px-3 text-right font-semibold">Volume</th>
                                            <th className="py-1.5 px-3 text-right font-semibold">Harga satuan</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                          {(d.items || []).map((it, i) => (
                                            <tr key={i} className="align-top">
                                              <td className="py-1.5 px-3 font-mono text-slate-600 whitespace-nowrap">{it.approval_date || '-'}</td>
                                              <td className="py-1.5 px-3">
                                                <a href={`https://shipyard-siaga.samudera.id/v2/work-orders/progress/${it.wo_id}`} target="_blank" rel="noopener noreferrer"
                                                  className="font-mono font-semibold text-indigo-600 hover:underline">{it.wo_code || it.wo_id}</a>
                                                <p className="text-xs text-slate-500">{it.project_name}</p>
                                              </td>
                                              <td className="py-1.5 px-3 text-slate-700">{it.vendor_name || 'Tanpa Vendor'}</td>
                                              <td className="py-1.5 px-3 max-w-md text-slate-800">{it.label}</td>
                                              <td className="py-1.5 px-3 text-right font-mono whitespace-nowrap">{formatNum(it.volume)} {r.unit}</td>
                                              <td className="py-1.5 px-3 text-right whitespace-nowrap">
                                                <span className="font-mono">{formatIDR(it.unit_cost)}</span>
                                                {POSITION[it.position] && (
                                                  <span className={`ml-1.5 inline-block px-1.5 py-0.5 rounded text-xs font-semibold ${POSITION[it.position].style}`}>{POSITION[it.position].label}</span>
                                                )}
                                              </td>
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
      </main>
    </div>
  );
}
