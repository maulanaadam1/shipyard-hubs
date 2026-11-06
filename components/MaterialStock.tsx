import React, { useEffect, useMemo, useState } from 'react';
import { Boxes, Search, ChevronLeft, ChevronRight, Eye, EyeOff, ArrowUp, ArrowDown, FileSpreadsheet } from 'lucide-react';
import { getHeaders } from '@/lib/api-client';
import AskAIButton from './AskAIButton';

// Persediaan Material: the Master Inventory workbook as its macro last sent it
// (stock, purchases, usage, opening balances, materials). Stock and FIFO
// values are calculated in the workbook; this page only lists and filters.

type Kind = 'text' | 'num' | 'money' | 'date' | 'status' | 'id';
type Column = { key: string; label: string; kind: Kind };
type Dataset = {
  key: string; label: string; noun: string; searchHint: string;
  filters: { col: string; label: string }[];
  hasDates?: boolean; dateLabel?: string;
  totals: { col: string; label: string; money: boolean }[];
  columns: Column[];
};

// Columns in the workbook's own order and header names, as the macro maps
// them (Datasets() in tools/excel/ShipHubPersediaan.bas). "Header=key:kind",
// kind: t text, i id, d date, n number, m rupiah, s status.
const KINDS: Record<string, Kind> = { t: 'text', i: 'id', d: 'date', n: 'num', m: 'money', s: 'status' };
const excelColumns = (spec: string): Column[] => spec.split(';').map(part => {
  const [label, rest] = part.split('=');
  const [key, kind] = rest.split(':');
  return { label, key, kind: KINDS[kind] };
});

const NEED_ORDER = '__need_order';

const DATASETS: Dataset[] = [
  {
    key: 'stok', label: 'Stok', noun: 'baris stok', searchHint: 'nama material, ukuran, kategori',
    filters: [{ col: 'status', label: 'Status' }, { col: 'kategori', label: 'Kode Material' }, { col: 'gudang', label: 'Gudang' }],
    totals: [{ col: 'nilai_stok', label: 'Nilai Stok FIFO', money: true }],
    columns: excelColumns('Kode Material=kategori:t;Nama Material=nama:t;Ukuran=ukuran:t;Gudang=gudang:t;Satuan=satuan:t;'
      + 'ID Saldo Awal=id_saldo_awal:i;Tanggal Cut Off=tanggal_cutoff:t;Qty Saldo Awal=qty_saldo_awal:n;Nilai Saldo Awal=nilai_saldo_awal:m;'
      + 'Harga Unit Saldo Awal=harga_unit_saldo_awal:m;Qty Terpakai FIFO=qty_terpakai:n;Sisa Saldo FIFO=sisa_saldo:n;Nilai Sisa FIFO=nilai_sisa:m;'
      + 'Total Pembelian=total_pembelian:n;Total Pemakaian=total_pemakaian:n;Stok Akhir=stok_akhir:n;Stok Minimum=stok_minimum:n;'
      + 'Nilai Stok FIFO=nilai_stok:m;Harga FIFO Rata-rata=harga_rata:m;Status=status:s'),
  },
  {
    key: 'pembelian', label: 'Pembelian', noun: 'pembelian', searchHint: 'material, ID, no. PO, pemasok',
    filters: [{ col: 'proyek', label: 'Proyek' }, { col: 'pemasok', label: 'Pemasok' }, { col: 'kategori', label: 'Kode Material' }],
    hasDates: true, dateLabel: 'Tanggal',
    totals: [{ col: 'nilai', label: 'Nilai Pembelian', money: true }, { col: 'nilai_sisa', label: 'Nilai Sisa Lot', money: true }],
    columns: excelColumns('ID Pembelian=id_pembelian:i;Tanggal=tanggal:d;No. PO=no_po:t;Kode Material=kategori:t;Nama Material=nama:t;'
      + 'Ukuran=ukuran:t;Pemasok=pemasok:t;Proyek=proyek:t;Gudang=gudang:t;Qty=qty:n;Satuan=satuan:t;Harga Unit=harga_unit:m;'
      + 'Nilai Pembelian=nilai:m;Qty Terpakai FIFO=qty_terpakai:n;Sisa Lot FIFO=sisa_qty:n;Nilai Sisa Lot=nilai_sisa:m;Catatan=catatan:t'),
  },
  {
    key: 'pemakaian', label: 'Pemakaian', noun: 'pemakaian', searchHint: 'material, ID, no. dokumen, pemakai',
    filters: [{ col: 'proyek', label: 'Proyek' }, { col: 'pemakai', label: 'Pemakai/Bagian' }, { col: 'kategori', label: 'Kode Material' }],
    hasDates: true, dateLabel: 'Tanggal',
    totals: [{ col: 'biaya_fifo', label: 'Biaya FIFO', money: true }],
    columns: excelColumns('ID Pemakaian=id_pemakaian:i;Tanggal=tanggal:d;No. Dokumen=no_dokumen:t;Kode Material=kategori:t;Nama Material=nama:t;'
      + 'Ukuran=ukuran:t;Proyek=proyek:t;Gudang=gudang:t;Qty=qty:n;Satuan=satuan:t;Pemakai/Bagian=pemakai:t;Biaya FIFO=biaya_fifo:m;'
      + 'Harga FIFO Rata-rata=harga_rata:m;Catatan=catatan:t'),
  },
  {
    key: 'saldo-awal', label: 'Saldo Awal', noun: 'saldo awal', searchHint: 'material, ID saldo awal',
    filters: [{ col: 'kategori', label: 'Kode Material' }, { col: 'gudang', label: 'Gudang' }],
    hasDates: true, dateLabel: 'Tanggal Cut Off',
    totals: [{ col: 'nilai', label: 'Nilai Saldo Awal', money: true }, { col: 'nilai_sisa', label: 'Nilai Sisa FIFO', money: true }],
    columns: excelColumns('ID Saldo Awal=id_saldo_awal:i;Tanggal Cut Off=tanggal:d;Kode Material=kategori:t;Nama Material=nama:t;Proyek=proyek:t;'
      + 'Gudang=gudang:t;Qty Saldo Awal=qty:n;Satuan=satuan:t;Nilai Saldo Awal=nilai:m;Harga Unit=harga_unit:m;Qty Terpakai FIFO=qty_terpakai:n;'
      + 'Sisa Saldo FIFO=sisa_qty:n;Nilai Sisa FIFO=nilai_sisa:m;Ukuran=ukuran:t;Catatan=catatan:t'),
  },
  {
    key: 'material', label: 'Master Material', noun: 'material', searchHint: 'nama, ukuran, kode material, CODA',
    filters: [{ col: 'kategori', label: 'Kode Material' }, { col: 'satuan', label: 'Satuan' }],
    totals: [],
    columns: excelColumns('Kode Material=kategori:t;Nama Material=nama:t;CODA=coda:t;Ukuran=ukuran:t;Satuan=satuan:t;'
      + 'Stok Minimum=stok_minimum:n;Aktif=aktif:t;Catatan=catatan:t;Status Data=status_data:t'),
  },
];

const STATUS_STYLE: Record<string, string> = {
  'AMAN': 'bg-emerald-100 text-emerald-800',
  'PESAN ULANG': 'bg-amber-100 text-amber-900',
  'STOK NEGATIF': 'bg-rose-100 text-rose-800',
};

const FIELD_LABEL = 'block text-xs font-semibold text-slate-500';
const FIELD_INPUT = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500';
const PAGE_SIZE = 50;

type SyncInfo = { at: string; by: string; rows: number; source: string } | null;
type Summary = {
  stock_items: number; stock_value: number; need_order: number; negative_stock: number; need_order_statuses: string[];
  purchase_rows: number; purchase_value: number; usage_rows: number; usage_cost: number;
  synced: Record<string, SyncInfo>;
};
type ListResponse = {
  data: Record<string, any>[]; total: number; totals: Record<string, number>;
  facets: Record<string, { value: string; count: number }[]>; synced: SyncInfo;
};

const formatDate = (s?: string) => {
  if (!s) return '-';
  const d = new Date(`${s.slice(0, 10)}T00:00:00`);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
};
const formatSyncTime = (s: string) => {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default function MaterialStock() {
  const [tab, setTab] = useState('stok');
  const ds = DATASETS.find(d => d.key === tab) || DATASETS[0];
  const [searchTerm, setSearchTerm] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isNominalHidden, setIsNominalHidden] = useState(() => {
    try { return localStorage.getItem('hideNominal_WO') !== 'false'; } catch { return true; }
  });

  const toggleNominal = () => {
    const next = !isNominalHidden;
    setIsNominalHidden(next);
    try { localStorage.setItem('hideNominal_WO', String(next)); } catch { /* storage unavailable */ }
  };
  const formatIDR = (value: number | null | undefined) => {
    if (value === null || value === undefined) return '-';
    return isNominalHidden
      ? 'Rp ****'
      : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
  };
  const formatNum = (value: number | null | undefined) =>
    value === null || value === undefined ? '-' : new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(value);

  const switchTab = (key: string, preset: Record<string, string> = {}) => {
    setTab(key);
    setFilters(preset);
    setSearchTerm('');
    setSearch('');
    setDateFrom('');
    setDateTo('');
    setSort(null);
    setPage(1);
    setData(null);
  };

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchTerm.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const headers = await getHeaders();
        const res = await fetch('/api/inventory/summary', { headers, signal: controller.signal });
        if (res.ok) setSummary(await res.json());
      } catch { /* the figures stay hidden; the list shows its own error */ }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const headers = await getHeaders();
        const p = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
        if (search) p.set('search', search);
        for (const [col, value] of Object.entries(filters)) {
          if (!value) continue;
          if (value === NEED_ORDER) (summary?.need_order_statuses || ['PESAN ULANG', 'STOK NEGATIF']).forEach(s => p.append(col, s));
          else p.set(col, value);
        }
        if (ds.hasDates && dateFrom) p.set('date_from', dateFrom);
        if (ds.hasDates && dateTo) p.set('date_to', dateTo);
        if (sort) { p.set('sort', sort.col); p.set('dir', sort.dir); }
        const res = await fetch(`/api/inventory/data/${ds.key}?${p}`, { headers, signal: controller.signal });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || `server membalas HTTP ${res.status}`);
        }
        setData(await res.json());
        setError('');
      } catch (e: any) {
        if (e?.name !== 'AbortError') setError(`Gagal memuat data ${ds.label.toLowerCase()}: ${e?.message || 'koneksi terputus'}`);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [ds.key, search, filters, dateFrom, dateTo, sort, page]);

  const toggleSort = (c: Column) => {
    const numeric = c.kind === 'num' || c.kind === 'money' || c.kind === 'date';
    setSort(prev => prev?.col === c.key
      ? { col: c.key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { col: c.key, dir: numeric ? 'desc' : 'asc' });
    setPage(1);
  };

  const cell = (c: Column, row: Record<string, any>) => {
    const v = row[c.key];
    switch (c.kind) {
      case 'id': return <span className="font-mono text-slate-800 whitespace-nowrap">{v || '-'}</span>;
      case 'date': return <span className="font-mono text-slate-600 whitespace-nowrap">{formatDate(v)}</span>;
      case 'money': return <span className="font-mono whitespace-nowrap">{formatIDR(v)}</span>;
      case 'num':
        return <span className={`font-mono whitespace-nowrap ${typeof v === 'number' && v < 0 ? 'text-rose-700 font-semibold' : ''}`}>{formatNum(v)}</span>;
      case 'status':
        return v ? <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap ${STATUS_STYLE[v] || 'bg-slate-100 text-slate-700'}`}>{v}</span> : '-';
      default: return <span className="text-slate-700">{v ?? '-'}</span>;
    }
  };
  const isRight = (c: Column) => c.kind === 'num' || c.kind === 'money';
  // Nama Material stays in view while the wide tables scroll sideways.
  const isPinned = (c: Column) => c.key === 'nama';

  const synced = data?.synced ?? summary?.synced?.[ds.key] ?? null;
  const neverSynced = !loading && !error && data && data.total === 0 && !synced;
  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / PAGE_SIZE));
  const filterActive = !!search || Object.values(filters).some(Boolean) || !!dateFrom || !!dateTo;
  const statusOptions = useMemo(() => data?.facets?.status || [], [data]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur-md border-slate-200 px-6 py-4 flex flex-wrap justify-between items-center gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="font-display font-bold text-xl md:text-2xl tracking-tight text-slate-800 flex items-center gap-2">
              <Boxes className="text-indigo-500" size={22} /> Persediaan Material
            </h2>
            <AskAIButton scope="material" questions={["Material apa yang perlu dipesan ulang?", "Pemakaian material terbesar bulan ini per proyek", "Nilai stok per gudang"]} />
          </div>
          <p className="text-xs md:text-sm text-slate-500 mt-1">
            Isi file Master Inventory, dikirim lewat macro Excel. Stok dan nilai FIFO dihitung di file Excel, bukan di ShipHub.
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
        {summary && summary.stock_items > 0 && (
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Ringkasan persediaan">
            <div className="p-4 rounded-2xl border bg-white border-slate-200 shadow-sm">
              <p className="text-xs font-semibold text-slate-500">Nilai stok FIFO</p>
              <p className="mt-1 text-lg font-bold font-mono text-slate-800">{formatIDR(summary.stock_value)}</p>
              <p className="text-xs text-slate-500">{formatNum(summary.stock_items)} baris stok</p>
            </div>
            <button type="button" onClick={() => switchTab('stok', { status: NEED_ORDER })}
              className="p-4 rounded-2xl border bg-white border-amber-200 shadow-sm text-left hover:bg-amber-50 outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40">
              <p className="text-xs font-semibold text-amber-800">Perlu pesan ulang</p>
              <p className="mt-1 text-lg font-bold font-mono text-slate-800">{formatNum(summary.need_order)} item</p>
              <p className="text-xs text-slate-500">
                {summary.negative_stock > 0 ? `${formatNum(summary.negative_stock)} di antaranya stok negatif · ` : ''}lihat daftar
              </p>
            </button>
            <div className="p-4 rounded-2xl border bg-white border-slate-200 shadow-sm">
              <p className="text-xs font-semibold text-slate-500">Total pembelian</p>
              <p className="mt-1 text-lg font-bold font-mono text-slate-800">{formatIDR(summary.purchase_value)}</p>
              <p className="text-xs text-slate-500">{formatNum(summary.purchase_rows)} lot</p>
            </div>
            <div className="p-4 rounded-2xl border bg-white border-slate-200 shadow-sm">
              <p className="text-xs font-semibold text-slate-500">Biaya pemakaian</p>
              <p className="mt-1 text-lg font-bold font-mono text-slate-800">{formatIDR(summary.usage_cost)}</p>
              <p className="text-xs text-slate-500">{formatNum(summary.usage_rows)} transaksi</p>
            </div>
          </section>
        )}

        <div role="tablist" aria-label="Tabel persediaan" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-200">
          {DATASETS.map(d => (
            <button key={d.key} role="tab" aria-selected={d.key === tab} onClick={() => d.key !== tab && switchTab(d.key)}
              className={`px-4 py-2 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 rounded-t ${d.key === tab ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
              {d.label}
            </button>
          ))}
        </div>

        <section className="p-5 rounded-2xl border bg-white border-slate-200 shadow-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
            <div className="space-y-1 sm:col-span-2">
              <label htmlFor="inv-search" className={FIELD_LABEL}>Cari</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input id="inv-search" type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                  placeholder={ds.searchHint} className={`${FIELD_INPUT} pl-9`} />
              </div>
            </div>
            {ds.filters.map(f => (
              <div key={f.col} className="space-y-1">
                <label htmlFor={`inv-${f.col}`} className={FIELD_LABEL}>{f.label}</label>
                <select id={`inv-${f.col}`} value={filters[f.col] || ''} className={FIELD_INPUT}
                  onChange={e => { setFilters(prev => ({ ...prev, [f.col]: e.target.value })); setPage(1); }}>
                  <option value="">Semua</option>
                  {f.col === 'status' && <option value={NEED_ORDER}>Perlu pesan ulang (PESAN ULANG + STOK NEGATIF)</option>}
                  {(f.col === 'status' ? statusOptions : data?.facets?.[f.col] || []).map(o => (
                    <option key={o.value} value={o.value}>{o.value} ({formatNum(o.count)})</option>
                  ))}
                </select>
              </div>
            ))}
            {ds.hasDates && (
              <>
                <div className="space-y-1">
                  <label htmlFor="inv-from" className={FIELD_LABEL}>{ds.dateLabel} dari</label>
                  <input id="inv-from" type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} className={FIELD_INPUT} />
                </div>
                <div className="space-y-1">
                  <label htmlFor="inv-to" className={FIELD_LABEL}>sampai</label>
                  <input id="inv-to" type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} className={FIELD_INPUT} />
                </div>
              </>
            )}
          </div>
          {filterActive && (
            <button type="button" onClick={() => switchTab(ds.key)} className="mt-3 text-xs font-semibold text-indigo-700 hover:underline">
              Hapus semua filter
            </button>
          )}
        </section>

        <section className="rounded-2xl border bg-white border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <p className="text-sm font-semibold text-slate-700">
              {loading && !data ? 'Memuat…' : `${(data?.total || 0).toLocaleString('id-ID')} ${ds.noun}`}
              {ds.totals.map(t => (
                <span key={t.col} className="font-normal text-slate-500"> · {t.label}: <span className="font-mono text-slate-700">{t.money ? formatIDR(data?.totals?.[t.col] ?? 0) : formatNum(data?.totals?.[t.col] ?? 0)}</span></span>
              ))}
            </p>
            {synced && (
              <p className="text-xs text-slate-500">
                Disinkron {formatSyncTime(synced.at)}{synced.by ? ` oleh ${synced.by}` : ''} · {formatNum(synced.rows)} baris{synced.source ? ` dari ${synced.source}` : ''}
              </p>
            )}
          </div>

          {error ? (
            <div role="alert" className="p-8 text-center text-sm text-rose-700">{error}</div>
          ) : neverSynced ? (
            <div className="p-10 text-center max-w-xl mx-auto">
              <FileSpreadsheet className="mx-auto text-slate-300" size={36} />
              <p className="mt-3 text-sm font-semibold text-slate-700">Data {ds.label.toLowerCase()} belum pernah dikirim</p>
              <p className="mt-1 text-sm text-slate-500">
                Buka file Master Inventory, lalu jalankan macro <span className="font-mono">ShipHub_SinkronPersediaan</span>. Semua tabel di file akan dikirim ke halaman ini.
              </p>
            </div>
          ) : (
            <div className={`overflow-x-auto transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 text-xs">
                  <tr>
                    {ds.columns.map(c => {
                      const active = sort?.col === c.key;
                      return (
                        <th key={c.key} scope="col" aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                          className={`py-3 px-3 font-semibold whitespace-nowrap ${isRight(c) ? 'text-right' : 'text-left'} ${isPinned(c) ? 'sticky left-0 z-10 bg-slate-50 shadow-[1px_0_0_0_theme(colors.slate.200)]' : ''}`}>
                          <button type="button" onClick={() => toggleSort(c)}
                            className={`inline-flex items-center gap-1 rounded outline-none hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${active ? 'text-slate-800' : ''}`}>
                            {c.label}
                            {active && (sort!.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {!loading && (data?.data || []).length === 0 && (
                    <tr><td colSpan={ds.columns.length} className="p-8 text-center text-slate-500">
                      Tidak ada {ds.noun} yang cocok dengan filter ini.
                    </td></tr>
                  )}
                  {(data?.data || []).map(row => (
                    <tr key={row.row_no} className="group align-top">
                      {ds.columns.map(c => (
                        <td key={c.key} className={`py-2.5 px-3 group-hover:bg-slate-50 ${isRight(c) ? 'text-right' : ''} ${isPinned(c) ? 'sticky left-0 z-10 bg-white min-w-[8.5rem] max-w-[10rem] sm:min-w-[12rem] sm:max-w-xs font-semibold text-slate-800 shadow-[1px_0_0_0_theme(colors.slate.200)]' : ''} ${c.kind === 'text' && !isPinned(c) ? 'max-w-xs' : ''}`}>
                          {cell(c, row)}
                        </td>
                      ))}
                    </tr>
                  ))}
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
