import React, { useEffect, useMemo, useState } from 'react';
import { Search, ListChecks, ChevronLeft, ChevronRight, ArrowDown, ArrowUp, Eye, EyeOff, Layers } from 'lucide-react';
import { getHeaders } from '@/lib/api-client';
import { SearchableSelect } from './SearchableSelect';

// Work items flattened from every WO detail (wo_items), searchable by item,
// price, project, vendor or activity, with per-group price summaries.

type View = 'list' | 'project_item' | 'project_activity' | 'activity' | 'category' | 'item' | 'vendor_activity';

const VIEWS: { key: View; label: string }[] = [
  { key: 'list', label: 'Daftar Item' },
  { key: 'project_item', label: 'Per Proyek per Item' },
  { key: 'project_activity', label: 'Per Proyek per Aktivitas' },
  { key: 'activity', label: 'Per Aktivitas' },
  { key: 'item', label: 'Per Item (Harga)' },
  { key: 'category', label: 'Per Kategori' },
  { key: 'vendor_activity', label: 'Per Vendor per Aktivitas' },
];

// Columns that identify a group in each summary view.
const GROUP_COLUMNS: Record<Exclude<View, 'list'>, { key: string; label: string }[]> = {
  project_item: [{ key: 'project_name', label: 'Proyek' }, { key: 'label', label: 'Item' }, { key: 'unit', label: 'Satuan' }],
  project_activity: [{ key: 'project_name', label: 'Proyek' }, { key: 'activity_name', label: 'Aktivitas' }],
  activity: [{ key: 'activity_name', label: 'Aktivitas' }],
  item: [{ key: 'label', label: 'Item' }, { key: 'unit', label: 'Satuan' }],
  category: [{ key: 'category', label: 'Kategori' }],
  vendor_activity: [{ key: 'vendor_name', label: 'Vendor' }, { key: 'activity_name', label: 'Aktivitas' }],
};

const STATUS_STYLE: Record<string, string> = {
  approved: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  rejected: 'bg-rose-100 text-rose-700',
};

const PAGE_SIZE = 25;

export default function WorkOrderItems() {
  const [view, setView] = useState<View>('list');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [projectType, setProjectType] = useState<'All' | 'external' | 'internal'>('All');
  const [status, setStatus] = useState('All');
  const [category, setCategory] = useState('All');
  const [project, setProject] = useState('All');
  const [vendor, setVendor] = useState('All');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('total_price');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [totalValue, setTotalValue] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [facets, setFacets] = useState<{ categories: string[]; itemCount: number; woCount: number } | null>(null);
  const [options, setOptions] = useState<{ projects: string[]; vendors: string[] }>({ projects: [], vendors: [] });
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
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Filter options: categories from items, projects/vendors from the WO summary.
  useEffect(() => {
    (async () => {
      try {
        const headers = await getHeaders();
        const [itemFacets, woFacets] = await Promise.all([
          fetch('/api/wo-items/facets', { headers }).then(r => r.ok ? r.json() : null),
          fetch('/api/work-orders/facets?scope=global', { headers }).then(r => r.ok ? r.json() : null),
        ]);
        if (itemFacets) setFacets(itemFacets);
        if (woFacets) setOptions({ projects: woFacets.projectOptions || [], vendors: woFacets.vendorOptions || [] });
      } catch { /* options are optional */ }
    })();
  }, []);

  // Reset paging and sorting when the question changes.
  useEffect(() => { setPage(1); }, [debouncedSearch, projectType, status, category, project, vendor, startDate, endDate, view]);
  useEffect(() => {
    setSort(view === 'list' ? 'total_price' : 'total_value');
    setDir('desc');
  }, [view]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError('');
      try {
        const headers = await getHeaders();
        const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), sort, dir });
        if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
        if (projectType !== 'All') params.set('project_type', projectType);
        if (status !== 'All') params.set('status', status);
        if (category !== 'All') params.set('category', category);
        if (project !== 'All') params.set('project', project);
        if (vendor !== 'All') params.set('vendor', vendor);
        if (startDate) params.set('start_date', startDate);
        if (endDate) params.set('end_date', endDate);
        if (view !== 'list') params.set('group', view);
        const url = view === 'list' ? `/api/wo-items?${params}` : `/api/wo-items/summary?${params}`;
        const res = await fetch(url, { headers, signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (controller.signal.aborted) return;
        setRows(json.data || []);
        setTotal(json.total || 0);
        setTotalValue(view === 'list' ? json.totalValue || 0 : 0);
      } catch (e: any) {
        if (!controller.signal.aborted) setError('Gagal memuat data item.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [page, sort, dir, debouncedSearch, projectType, status, category, project, vendor, startDate, endDate, view]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const onSort = (column: string) => {
    if (sort === column) setDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSort(column); setDir('desc'); }
  };
  const SortHead = ({ column, children, align = 'right' }: { column: string; children: React.ReactNode; align?: 'left' | 'right' }) => (
    <th
      onClick={() => onSort(column)}
      className={`py-3 px-4 cursor-pointer select-none whitespace-nowrap hover:text-slate-700 ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sort === column && (dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </span>
    </th>
  );

  const groupColumns = view === 'list' ? [] : GROUP_COLUMNS[view];
  const summaryCaption = useMemo(() => {
    if (view === 'list') return `${total.toLocaleString('id-ID')} item · total ${formatIDR(totalValue)}`;
    return `${total.toLocaleString('id-ID')} grup`;
  }, [view, total, totalValue, isNominalHidden]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur-md border-slate-200 px-6 py-4 flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="font-display font-bold text-xl md:text-2xl tracking-tight text-slate-800 flex items-center gap-2">
            <ListChecks className="text-indigo-500" size={22} /> Item Pekerjaan WO
          </h2>
          <p className="text-xs md:text-sm text-slate-500 mt-1">
            Cari item pekerjaan, bandingkan harga, dan lihat ringkasan per proyek
            {facets ? ` · ${facets.itemCount.toLocaleString('id-ID')} item dari ${facets.woCount.toLocaleString('id-ID')} WO` : ''}
          </p>
        </div>
        <button
          onClick={toggleNominal}
          title={isNominalHidden ? 'Tampilkan Nominal' : 'Sembunyikan Nominal'}
          className={`flex items-center justify-center p-2 rounded-xl border transition-all shadow-sm ${isNominalHidden ? 'bg-amber-100 border-amber-200 text-amber-600' : 'bg-white border-slate-200 text-slate-500 hover:text-slate-800'}`}
        >
          {isNominalHidden ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </header>

      <main className="w-full p-4 md:p-8 space-y-6">
        <section className="p-5 rounded-2xl border bg-white border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-wrap gap-2">
            {VIEWS.map(v => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${view === v.key ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-500/5 hover:bg-slate-500/10 text-slate-600'}`}
              >
                {v.key === 'list' ? <span className="inline-flex items-center gap-1"><ListChecks size={12} /> {v.label}</span> : <span className="inline-flex items-center gap-1"><Layers size={12} /> {v.label}</span>}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Jenis Project</span>
            {([['All', 'Semua'], ['external', 'External (Kapal)'], ['internal', 'Internal (Fasilitas)']] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setProjectType(key)}
                className={`px-3 py-1 rounded-lg text-[11px] font-bold transition-all ${projectType === key ? 'bg-indigo-600 text-white' : 'bg-slate-500/5 hover:bg-slate-500/10 text-slate-500'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative lg:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Cari item atau aktivitas (mis. cleaning, plat, sandblasting)…"
                className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
              />
            </div>
            <SearchableSelect value={category} onChange={setCategory} options={facets?.categories || []} allLabel="Semua Kategori" />
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none"
            >
              <option value="All">Semua Status</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
            </select>
            <div className="lg:col-span-2">
              <SearchableSelect value={project} onChange={setProject} options={options.projects} allLabel="Semua Proyek" />
            </div>
            <SearchableSelect value={vendor} onChange={setVendor} options={options.vendors} allLabel="Semua Vendor" />
            <div className="flex items-center gap-2">
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} title="Tanggal approval dari"
                className="w-full px-2 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none" />
              <span className="text-slate-400 text-xs">–</span>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} title="Tanggal approval sampai"
                className="w-full px-2 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none" />
            </div>
          </div>
          <p className="text-[11px] text-slate-400">Filter tanggal memakai tanggal approval item, jadi hanya item yang sudah approved yang ikut.</p>
        </section>

        <section className="rounded-2xl border bg-white border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-700">{VIEWS.find(v => v.key === view)?.label}</p>
            <p className="text-xs text-slate-500">{loading ? 'Memuat…' : summaryCaption}</p>
          </div>

          {error ? (
            <div className="p-8 text-center text-sm text-rose-600">{error}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wide text-[10px]">
                  {view === 'list' ? (
                    <tr>
                      <SortHead column="label" align="left">Item / Aktivitas</SortHead>
                      <SortHead column="wo_code" align="left">WO / Proyek</SortHead>
                      <th className="py-3 px-4 text-left">Vendor</th>
                      <SortHead column="volume">Volume</SortHead>
                      <SortHead column="unit_price">Harga Satuan</SortHead>
                      <SortHead column="total_price">Total</SortHead>
                      <th className="py-3 px-4 text-left">Status</th>
                      <SortHead column="approval_date" align="left">Tgl Approval</SortHead>
                    </tr>
                  ) : (
                    <tr>
                      {groupColumns.map(c => <th key={c.key} className="py-3 px-4 text-left">{c.label}</th>)}
                      <SortHead column="item_count">Item</SortHead>
                      <SortHead column="wo_count">WO</SortHead>
                      <SortHead column="total_volume">Total Volume</SortHead>
                      <SortHead column="min_price">Harga Min</SortHead>
                      <SortHead column="avg_price">Harga Rata²</SortHead>
                      <SortHead column="max_price">Harga Maks</SortHead>
                      <SortHead column="total_value">Total Nilai</SortHead>
                    </tr>
                  )}
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {!loading && rows.length === 0 && (
                    <tr><td colSpan={10} className="p-8 text-center text-slate-400">Tidak ada item yang cocok dengan filter.</td></tr>
                  )}
                  {view === 'list'
                    ? rows.map(r => (
                      <tr key={`${r.wo_id}-${r.item_id}`} className="hover:bg-slate-50 align-top">
                        <td className="py-2.5 px-4 max-w-md">
                          <p className="font-semibold text-slate-800">{r.label || '-'}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">{r.activity_name}</p>
                        </td>
                        <td className="py-2.5 px-4">
                          <a
                            href={`https://shipyard-siaga.samudera.id/v2/work-orders/progress/${r.wo_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono font-semibold text-indigo-500 hover:underline"
                          >{r.wo_code}</a>
                          {r.project_type === 'internal' && (
                            <span className="ml-1 px-1 py-0.5 rounded bg-amber-100 text-amber-700 text-[9px] font-bold uppercase">Internal</span>
                          )}
                          <p className="text-[10px] text-slate-500 mt-0.5">{r.project_name}</p>
                        </td>
                        <td className="py-2.5 px-4 text-slate-600">{r.vendor_name || '-'}</td>
                        <td className="py-2.5 px-4 text-right font-mono whitespace-nowrap">{formatNum(r.volume)} {r.unit}</td>
                        <td className="py-2.5 px-4 text-right font-mono whitespace-nowrap">{formatIDR(r.unit_price)}</td>
                        <td className="py-2.5 px-4 text-right font-mono font-semibold whitespace-nowrap">{formatIDR(r.total_price)}</td>
                        <td className="py-2.5 px-4">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${STATUS_STYLE[r.status] || 'bg-slate-100 text-slate-600'}`}>{r.status}</span>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap">{r.approval_date || '-'}</td>
                      </tr>
                    ))
                    : rows.map((r, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 align-top">
                        {groupColumns.map(c => (
                          <td key={c.key} className={`py-2.5 px-4 ${c.key === 'unit' ? 'whitespace-nowrap' : 'max-w-md'}`}>
                            <span className={c.key === groupColumns[groupColumns.length - 1].key && c.key !== 'unit' ? 'font-semibold text-slate-800' : 'text-slate-600'}>
                              {r[c.key] || '-'}
                            </span>
                          </td>
                        ))}
                        <td className="py-2.5 px-4 text-right font-mono">{formatNum(r.item_count)}</td>
                        <td className="py-2.5 px-4 text-right font-mono">{formatNum(r.wo_count)}</td>
                        <td className="py-2.5 px-4 text-right font-mono">{formatNum(r.total_volume)}</td>
                        <td className="py-2.5 px-4 text-right font-mono whitespace-nowrap">{formatIDR(r.min_price)}</td>
                        <td className="py-2.5 px-4 text-right font-mono whitespace-nowrap">{formatIDR(r.avg_price)}</td>
                        <td className="py-2.5 px-4 text-right font-mono whitespace-nowrap">{formatIDR(r.max_price)}</td>
                        <td className="py-2.5 px-4 text-right font-mono font-semibold whitespace-nowrap">{formatIDR(r.total_value)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-400 font-semibold">Hal. {page} dari {totalPages}</span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="p-1 rounded-md border hover:bg-slate-100 disabled:opacity-30"><ChevronLeft size={14} /></button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="p-1 rounded-md border hover:bg-slate-100 disabled:opacity-30"><ChevronRight size={14} /></button>
            </div>
          </div>
        </section>

        <p className="text-[11px] text-slate-400">
          Harga rata² = total nilai ÷ total volume (tertimbang volume). Item dihitung dengan aturan yang sama dengan angka dashboard,
          jadi total per WO selalu cocok.
        </p>
      </main>
    </div>
  );
}
