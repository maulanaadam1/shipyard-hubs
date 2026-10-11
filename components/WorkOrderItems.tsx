import React, { useEffect, useMemo, useState } from 'react';
import { Search, ListChecks, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronDown, ArrowDown, ArrowUp, Eye, EyeOff, Layers, RotateCcw } from 'lucide-react';
import { getHeaders } from '@/lib/api-client';
import { SearchableSelect } from './SearchableSelect';

// Work items flattened from every WO detail (wo_items), searchable by item,
// cost, project, vendor or activity, with per-group cost summaries.

type View = 'list' | 'project_item' | 'project_activity' | 'activity' | 'category' | 'item' | 'vendor_activity';

const VIEWS: { key: View; label: string }[] = [
  { key: 'list', label: 'Daftar Item' },
  { key: 'project_item', label: 'Per Proyek per Item' },
  { key: 'project_activity', label: 'Per Proyek per Aktivitas' },
  { key: 'activity', label: 'Per Aktivitas' },
  { key: 'item', label: 'Per Item (Biaya)' },
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

// Summary group column -> /api/wo-items filter used to list that group's items.
const GROUP_FILTER_PARAM: Record<string, string> = {
  project_name: 'project',
  vendor_name: 'vendor',
  activity_name: 'activity',
  category: 'category',
  label: 'label',
  unit: 'unit',
};

const DETAIL_PAGE_SIZE = 20;

type GroupDetail = { loading: boolean; rows: any[]; total: number; limit: number; error?: string };

const STATUS_STYLE: Record<string, string> = {
  approved: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  rejected: 'bg-rose-100 text-rose-700',
};

const PAGE_SIZES = [25, 50, 100];

const FIELD_LABEL = 'block text-[11px] font-bold uppercase tracking-wide text-slate-500';
const FIELD_INPUT = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500';

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
  const [pageSize, setPageSize] = useState(25);
  const [jumpTo, setJumpTo] = useState('');
  const [sort, setSort] = useState('item_date');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [rows, setRows] = useState<any[]>([]);
  // The view the current rows were fetched for; rows of another view are never
  // rendered under this view's columns.
  const [rowsView, setRowsView] = useState<View | null>(null);
  const [total, setTotal] = useState(0);
  const [totalCost, setTotalCost] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [facets, setFacets] = useState<{ categories: string[]; itemCount: number; woCount: number } | null>(null);
  // Per-group item details in the summary views, keyed by the group's values.
  const [details, setDetails] = useState<Record<string, GroupDetail>>({});
  const [showAllDetails, setShowAllDetails] = useState(false);
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

  // Filters shared by the list, the summaries and the per-group details.
  const baseParams = () => {
    const params = new URLSearchParams();
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
    if (projectType !== 'All') params.set('project_type', projectType);
    if (status !== 'All') params.set('status', status);
    if (category !== 'All') params.set('category', category);
    if (project !== 'All') params.set('project', project);
    if (vendor !== 'All') params.set('vendor', vendor);
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    return params;
  };

  const groupKey = (row: any) => JSON.stringify((view === 'list' ? [] : GROUP_COLUMNS[view]).map(c => row[c.key] ?? ''));

  const loadGroupDetail = async (row: any, limit = DETAIL_PAGE_SIZE) => {
    if (view === 'list') return;
    const key = groupKey(row);
    setDetails(prev => ({ ...prev, [key]: { ...(prev[key] || { rows: [], total: 0 }), loading: true, limit } }));
    try {
      const headers = await getHeaders();
      const params = baseParams();
      GROUP_COLUMNS[view].forEach(c => {
        const param = GROUP_FILTER_PARAM[c.key];
        const value = row[c.key] ?? '';
        if (!param) return;
        // An empty vendor group is the "no vendor" bucket.
        if (param === 'vendor' && value === '') params.set('vendor', 'Tanpa Vendor');
        else params.set(param, value);
      });
      params.set('page', '1');
      params.set('limit', String(limit));
      params.set('sort', 'item_date');
      params.set('dir', 'desc');
      const res = await fetch(`/api/wo-items?${params}`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setDetails(prev => ({ ...prev, [key]: { loading: false, rows: json.data || [], total: json.total || 0, limit } }));
    } catch {
      setDetails(prev => ({ ...prev, [key]: { loading: false, rows: [], total: 0, limit, error: 'Gagal memuat detail.' } }));
    }
  };

  const toggleGroup = (row: any) => {
    const key = groupKey(row);
    if (details[key]) {
      setDetails(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } else {
      loadGroupDetail(row);
    }
  };

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

  // Opened group details belong to the rows they were opened on.
  useEffect(() => { setDetails({}); }, [rows]);
  // "Show all details": open every group on the current page.
  useEffect(() => {
    if (view === 'list' || !showAllDetails || rowsView !== view) return;
    rows.forEach(r => loadGroupDetail(r));
  }, [rows, rowsView, view, showAllDetails]);

  // Reset paging and sorting when the question changes.
  useEffect(() => { setPage(1); }, [debouncedSearch, projectType, status, category, project, vendor, startDate, endDate, view, pageSize]);
  // Switching view clears the table at once instead of showing the previous
  // view's rows under the new columns while the new data loads.
  useEffect(() => {
    setRows([]);
    setRowsView(null);
    setTotal(0);
    setTotalCost(0);
    setDetails({});
  }, [view]);
  const visibleRows = rowsView === view ? rows : [];
  useEffect(() => {
    // Newest first in every view: items by date, groups by their newest item.
    setSort(view === 'list' ? 'item_date' : 'latest_date');
    setDir('desc');
  }, [view]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError('');
      try {
        const headers = await getHeaders();
        const params = new URLSearchParams({ page: String(page), limit: String(pageSize), sort, dir });
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
        setRowsView(view);
        setTotal(json.total || 0);
        setTotalCost(view === 'list' ? json.totalCost || 0 : 0);
      } catch (e: any) {
        if (!controller.signal.aborted) setError('Gagal memuat data item.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [page, pageSize, sort, dir, debouncedSearch, projectType, status, category, project, vendor, startDate, endDate, view]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);
  // Page buttons: first, last, and a window around the current page.
  const pageButtons = useMemo(() => {
    const pages = new Set<number>([1, totalPages]);
    for (let p = page - 2; p <= page + 2; p++) if (p >= 1 && p <= totalPages) pages.add(p);
    const sorted = Array.from(pages).sort((a, b) => a - b);
    const out: (number | 'gap')[] = [];
    sorted.forEach((p, i) => {
      if (i > 0 && p - sorted[i - 1] > 1) out.push('gap');
      out.push(p);
    });
    return out;
  }, [page, totalPages]);
  const goToPage = (p: number) => setPage(Math.min(totalPages, Math.max(1, p)));

  const filtersActive = !!(searchTerm || projectType !== 'All' || status !== 'All' || category !== 'All' || project !== 'All'
    || vendor !== 'All' || startDate || endDate);
  const resetFilters = () => {
    setSearchTerm('');
    setDebouncedSearch('');
    setProjectType('All');
    setStatus('All');
    setCategory('All');
    setProject('All');
    setVendor('All');
    setStartDate('');
    setEndDate('');
    setShowAllDetails(false);
    setDetails({});
    setPage(1);
  };

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
    if (view === 'list') return `${total.toLocaleString('id-ID')} item · total biaya ${formatIDR(totalCost)}`;
    return `${total.toLocaleString('id-ID')} grup`;
  }, [view, total, totalCost, isNominalHidden]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur-md border-slate-200 px-6 py-4 flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="font-display font-bold text-xl md:text-2xl tracking-tight text-slate-800 flex items-center gap-2">
            <ListChecks className="text-indigo-500" size={22} /> Item Pekerjaan WO
          </h2>
          <p className="text-xs md:text-sm text-slate-500 mt-1">
            Cari item pekerjaan, bandingkan biaya, dan lihat ringkasan per proyek
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
          <div className="flex flex-wrap items-center justify-between gap-2">
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
          <button
            onClick={resetFilters}
            disabled={!filtersActive}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-indigo-600 hover:bg-indigo-50 disabled:text-slate-300 disabled:hover:bg-transparent transition"
            title="Kosongkan pencarian dan semua filter"
          >
            <RotateCcw size={12} /> Reset Filter
          </button>
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

          {/* Every filter: a title above and the same width (one grid cell each). */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
            <div className="space-y-1">
              <label className={FIELD_LABEL}>Pencarian Item / Aktivitas</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="mis. cleaning, plat, sandblasting"
                  className={`${FIELD_INPUT} pl-9`}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className={FIELD_LABEL}>Kategori</label>
              <SearchableSelect value={category} onChange={setCategory} options={facets?.categories || []} allLabel="Semua Kategori" />
            </div>
            <div className="space-y-1">
              <label className={FIELD_LABEL}>Status Approval</label>
              <select value={status} onChange={e => setStatus(e.target.value)} className={FIELD_INPUT}>
                <option value="All">Semua Status</option>
                <option value="approved">Approved</option>
                <option value="pending">Pending</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className={FIELD_LABEL}>Proyek</label>
              <SearchableSelect value={project} onChange={setProject} options={options.projects} allLabel="Semua Proyek" />
            </div>
            <div className="space-y-1">
              <label className={FIELD_LABEL}>Vendor</label>
              <SearchableSelect value={vendor} onChange={setVendor} options={options.vendors} allLabel="Semua Vendor" />
            </div>
            <div className="space-y-1">
              <label className={FIELD_LABEL}>Tanggal Approval Dari</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={FIELD_INPUT} />
            </div>
            <div className="space-y-1">
              <label className={FIELD_LABEL}>Tanggal Approval Sampai</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={FIELD_INPUT} />
            </div>
          </div>
          <p className="text-[11px] text-slate-400">Filter tanggal memakai tanggal approval item, jadi hanya item yang sudah approved yang ikut.</p>
        </section>

        <section className="rounded-2xl border bg-white border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-700">{VIEWS.find(v => v.key === view)?.label}</p>
            <div className="flex items-center gap-4">
              {view !== 'list' && (
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showAllDetails}
                    onChange={e => {
                      setShowAllDetails(e.target.checked);
                      if (!e.target.checked) setDetails({});
                    }}
                    className="accent-indigo-600"
                  />
                  Tampilkan semua detail
                </label>
              )}
              <p className="text-xs text-slate-500">{loading ? 'Memuat…' : summaryCaption}</p>
            </div>
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
                      <SortHead column="unit_cost">Biaya Satuan</SortHead>
                      <SortHead column="total_cost">Total Biaya</SortHead>
                      <th className="py-3 px-4 text-left">Status</th>
                      <SortHead column="item_date" align="left">Tanggal</SortHead>
                    </tr>
                  ) : (
                    <tr>
                      <th className="py-3 pl-4 w-8" aria-label="Detail"></th>
                      {groupColumns.map(c => <th key={c.key} className="py-3 px-4 text-left">{c.label}</th>)}
                      <SortHead column="item_count">Item</SortHead>
                      <SortHead column="wo_count">WO</SortHead>
                      <SortHead column="total_volume">Total Volume</SortHead>
                      <SortHead column="min_cost">Biaya Min</SortHead>
                      <SortHead column="avg_cost">Biaya Rata²</SortHead>
                      <SortHead column="max_cost">Biaya Maks</SortHead>
                      <SortHead column="latest_date">Tgl Terbaru</SortHead>
                      <SortHead column="total_cost">Total Biaya</SortHead>
                    </tr>
                  )}
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading && visibleRows.length === 0 && (
                    <tr><td colSpan={12} className="p-8 text-center text-slate-400">Memuat data…</td></tr>
                  )}
                  {!loading && visibleRows.length === 0 && (
                    <tr><td colSpan={10} className="p-8 text-center text-slate-400">Tidak ada item yang cocok dengan filter.</td></tr>
                  )}
                  {view === 'list'
                    ? visibleRows.map(r => (
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
                        <td className="py-2.5 px-4 text-right font-mono whitespace-nowrap">{formatIDR(r.unit_cost)}</td>
                        <td className="py-2.5 px-4 text-right font-mono font-semibold whitespace-nowrap">{formatIDR(r.total_cost)}</td>
                        <td className="py-2.5 px-4">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${STATUS_STYLE[r.status] || 'bg-slate-100 text-slate-600'}`}>{r.status}</span>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap">
                          {r.item_date || '-'}
                          {!r.approval_date && r.item_date && <p className="text-[9px] font-sans text-slate-400">update WO</p>}
                        </td>
                      </tr>
                    ))
                    : visibleRows.map((r, idx) => {
                      const key = groupKey(r);
                      const detail = details[key];
                      return (
                      <React.Fragment key={idx}>
                      <tr className={`hover:bg-slate-50 align-top cursor-pointer ${detail ? 'bg-indigo-50/40' : ''}`} onClick={() => toggleGroup(r)}>
                        <td className="py-2.5 pl-4 text-slate-400">
                          <ChevronDown size={14} className={`transition-transform ${detail ? '' : '-rotate-90'}`} />
                        </td>
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
                        <td className="py-2.5 px-4 text-right font-mono whitespace-nowrap">{formatIDR(r.min_cost)}</td>
                        <td className="py-2.5 px-4 text-right font-mono whitespace-nowrap">{formatIDR(r.avg_cost)}</td>
                        <td className="py-2.5 px-4 text-right font-mono whitespace-nowrap">{formatIDR(r.max_cost)}</td>
                        <td className="py-2.5 px-4 text-right font-mono text-slate-500 whitespace-nowrap">{r.latest_date || '-'}</td>
                        <td className="py-2.5 px-4 text-right font-mono font-semibold whitespace-nowrap">{formatIDR(r.total_cost)}</td>
                      </tr>
                      {detail && (
                        <tr className="bg-slate-50/60">
                          <td colSpan={groupColumns.length + 9} className="px-4 pb-4 pt-1">
                            {detail.error ? (
                              <p className="text-xs text-rose-600 py-2">{detail.error}</p>
                            ) : (
                              <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
                                <table className="w-full text-[11px]">
                                  <thead className="bg-slate-50 text-slate-400 uppercase tracking-wide text-[9px]">
                                    <tr>
                                      <th className="py-2 px-3 text-left">Item / Aktivitas</th>
                                      <th className="py-2 px-3 text-left">WO / Proyek</th>
                                      <th className="py-2 px-3 text-left">Vendor</th>
                                      <th className="py-2 px-3 text-right">Volume</th>
                                      <th className="py-2 px-3 text-right">Biaya Satuan</th>
                                      <th className="py-2 px-3 text-right">Total Biaya</th>
                                      <th className="py-2 px-3 text-left">Status</th>
                                      <th className="py-2 px-3 text-left">Tanggal</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {detail.rows.map(it => (
                                      <tr key={`${it.wo_id}-${it.item_id}`} className="align-top">
                                        <td className="py-1.5 px-3 max-w-md">
                                          <p className="font-medium text-slate-700">{it.label || '-'}</p>
                                          <p className="text-[10px] text-slate-400">{it.activity_name}</p>
                                        </td>
                                        <td className="py-1.5 px-3">
                                          <a href={`https://shipyard-siaga.samudera.id/v2/work-orders/progress/${it.wo_id}`} target="_blank" rel="noopener noreferrer"
                                            onClick={e => e.stopPropagation()} className="font-mono font-semibold text-indigo-500 hover:underline">{it.wo_code}</a>
                                          <p className="text-[10px] text-slate-500">{it.project_name}</p>
                                        </td>
                                        <td className="py-1.5 px-3 text-slate-600">{it.vendor_name || '-'}</td>
                                        <td className="py-1.5 px-3 text-right font-mono whitespace-nowrap">{formatNum(it.volume)} {it.unit}</td>
                                        <td className="py-1.5 px-3 text-right font-mono whitespace-nowrap">{formatIDR(it.unit_cost)}</td>
                                        <td className="py-1.5 px-3 text-right font-mono font-semibold whitespace-nowrap">{formatIDR(it.total_cost)}</td>
                                        <td className="py-1.5 px-3">
                                          <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold capitalize ${STATUS_STYLE[it.status] || 'bg-slate-100 text-slate-600'}`}>{it.status}</span>
                                        </td>
                                        <td className="py-1.5 px-3 font-mono text-slate-500 whitespace-nowrap">
                                          {it.item_date || '-'}
                                          {!it.approval_date && it.item_date && <p className="text-[9px] font-sans text-slate-400">update WO</p>}
                                        </td>
                                      </tr>
                                    ))}
                                    {detail.loading && (
                                      <tr><td colSpan={8} className="py-3 text-center text-slate-400">Memuat detail…</td></tr>
                                    )}
                                    {!detail.loading && detail.rows.length === 0 && (
                                      <tr><td colSpan={8} className="py-3 text-center text-slate-400">Tidak ada item.</td></tr>
                                    )}
                                  </tbody>
                                </table>
                                {!detail.loading && detail.total > detail.rows.length && (
                                  <div className="px-3 py-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                                    <span>Menampilkan {detail.rows.length} dari {detail.total.toLocaleString('id-ID')} item</span>
                                    <button
                                      onClick={e => { e.stopPropagation(); loadGroupDetail(r, detail.limit + 50); }}
                                      className="font-semibold text-indigo-600 hover:text-indigo-700"
                                    >
                                      Muat 50 lagi
                                    </button>
                                  </div>
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

          <div className="px-5 py-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-3 text-slate-500">
              <span className="font-semibold">
                {firstRow.toLocaleString('id-ID')}–{lastRow.toLocaleString('id-ID')} dari {total.toLocaleString('id-ID')} {view === 'list' ? 'item' : 'grup'}
              </span>
              <label className="inline-flex items-center gap-1">
                Baris
                <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}
                  className="px-1.5 py-1 border border-slate-200 rounded-md bg-white outline-none">
                  {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <button onClick={() => goToPage(1)} disabled={page === 1} title="Halaman pertama"
                className="p-1 rounded-md border hover:bg-slate-100 disabled:opacity-30"><ChevronsLeft size={14} /></button>
              <button onClick={() => goToPage(page - 1)} disabled={page === 1} title="Sebelumnya"
                className="p-1 rounded-md border hover:bg-slate-100 disabled:opacity-30"><ChevronLeft size={14} /></button>
              {pageButtons.map((p, i) => p === 'gap'
                ? <span key={`gap-${i}`} className="px-1 text-slate-400">…</span>
                : (
                  <button key={p} onClick={() => goToPage(p)}
                    className={`min-w-[28px] px-1.5 py-1 rounded-md border text-[11px] font-semibold ${p === page ? 'bg-indigo-600 border-indigo-600 text-white' : 'hover:bg-slate-100 text-slate-600'}`}>
                    {p.toLocaleString('id-ID')}
                  </button>
                ))}
              <button onClick={() => goToPage(page + 1)} disabled={page >= totalPages} title="Berikutnya"
                className="p-1 rounded-md border hover:bg-slate-100 disabled:opacity-30"><ChevronRight size={14} /></button>
              <button onClick={() => goToPage(totalPages)} disabled={page >= totalPages} title="Halaman terakhir"
                className="p-1 rounded-md border hover:bg-slate-100 disabled:opacity-30"><ChevronsRight size={14} /></button>
              <form
                onSubmit={e => { e.preventDefault(); const n = parseInt(jumpTo, 10); if (!isNaN(n)) goToPage(n); setJumpTo(''); }}
                className="inline-flex items-center gap-1 ml-2 text-slate-500"
              >
                Ke hal.
                <input value={jumpTo} onChange={e => setJumpTo(e.target.value.replace(/[^0-9]/g, ''))} placeholder={String(page)}
                  className="w-14 px-1.5 py-1 border border-slate-200 rounded-md outline-none text-center" />
              </form>
            </div>
          </div>
        </section>

        <p className="text-[11px] text-slate-400">
          Nilai adalah biaya dari SIAGA (biaya per satuan × volume), bukan harga jual. Biaya rata² = total biaya ÷ total volume
          (tertimbang volume); item tanpa biaya per satuan tidak ikut dalam min/rata²/maks. Aturannya sama dengan angka dashboard,
          jadi total per WO selalu cocok.
        </p>
      </main>
    </div>
  );
}
