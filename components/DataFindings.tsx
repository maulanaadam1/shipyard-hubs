import React, { useEffect, useState } from 'react';
import { Search, SearchCheck, ChevronLeft, ChevronRight, ArrowDown, ArrowUp, Eye, EyeOff, FileSpreadsheet, RotateCcw, X } from 'lucide-react';
import { getHeaders } from '@/lib/api-client';
import { useData } from '@/context/DataContext';
import UnrecognizedActivities from './UnrecognizedActivities';

// Work items the server flags for a check against reference unit costs
// (wo_item_findings). ShipHub only points at them: fixes happen in SIAGA, and
// a finding closes itself once the item no longer matches. A finding that is
// fine as it is can be ignored with a reason.

const RESOURCE = 'Data Perlu Dicek';
const FIELD_LABEL = 'block text-xs font-semibold text-slate-500';
const FIELD_INPUT = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500';

const STATUS_LABELS: Record<string, string> = { open: 'Perlu dicek', ignored: 'Diabaikan', resolved: 'Selesai' };
const STATUS_STYLES: Record<string, string> = {
  open: 'bg-amber-100 text-amber-800',
  ignored: 'bg-slate-100 text-slate-600',
  resolved: 'bg-emerald-100 text-emerald-800',
};
const ITEM_STATUS_LABELS: Record<string, string> = { approved: 'Approved', pending: 'Belum approved', rejected: 'Rejected' };

type Summary = {
  counts: Record<string, Record<string, number>>;
  open_excess: Record<string, number>;
  open_pending: Record<string, number>;
  rules: Record<string, string>;
  last_run: string;
  references: number;
};

export default function DataFindings() {
  const { canAccess } = useData();
  const canEdit = canAccess(RESOURCE, 'edit');
  const canExport = canAccess(RESOURCE, 'export');

  const [summary, setSummary] = useState<Summary | null>(null);
  const [tab, setTab] = useState<'findings' | 'unrecognized'>('findings');
  const [rule, setRule] = useState('all');
  const [status, setStatus] = useState('open');
  // Items not approved yet come first: those can still be fixed before approval.
  const [itemStatus, setItemStatus] = useState('pending');
  const [searchTerm, setSearchTerm] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('excess');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const pageSize = 25;
  // The page belongs to the filters it was chosen under (see WorkOrderItems).
  const filterKey = [rule, status, itemStatus, search, sort, dir].join('\u0001');
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const setPage = (p: number) => setPageState({ key: filterKey, page: p });

  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [totalExcess, setTotalExcess] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [ignoreTarget, setIgnoreTarget] = useState<any>(null);
  const [ignoreNote, setIgnoreNote] = useState('');
  const [actionError, setActionError] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

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
    const t = setTimeout(() => setSearch(searchTerm.trim()), 350);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const params = () => {
    const p = new URLSearchParams({ rule, status, item_status: itemStatus, sort, dir });
    if (search) p.set('search', search);
    return p;
  };

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const headers = await getHeaders();
        const res = await fetch('/api/wo-findings/summary', { headers, signal: controller.signal });
        if (res.ok) setSummary(await res.json());
      } catch { /* the list shows the error */ }
    })();
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const headers = await getHeaders();
        const p = params();
        p.set('page', String(page));
        p.set('limit', String(pageSize));
        const res = await fetch(`/api/wo-findings?${p}`, { headers, signal: controller.signal });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || `server membalas HTTP ${res.status}`);
        }
        const body = await res.json();
        setRows(body.data || []);
        setTotal(body.total || 0);
        setTotalExcess(body.excess || 0);
        setError('');
      } catch (e: any) {
        if (e?.name !== 'AbortError') setError(`Gagal memuat temuan: ${e?.message || 'koneksi terputus'}`);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [rule, status, itemStatus, search, sort, dir, page, reload]);

  const setFindingStatus = async (row: any, next: 'ignored' | 'open', note = '') => {
    setSaving(true);
    setActionError('');
    try {
      const headers = await getHeaders();
      const res = await fetch('/api/wo-findings/status', {
        method: 'POST',
        headers,
        body: JSON.stringify({ wo_id: row.wo_id, item_id: row.item_id, rule: row.rule, status: next, note }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `server membalas HTTP ${res.status}`);
      }
      setIgnoreTarget(null);
      setIgnoreNote('');
      setReload(n => n + 1);
    } catch (e: any) {
      setActionError(e?.message || 'Gagal menyimpan');
    } finally {
      setSaving(false);
    }
  };

  const exportExcel = async () => {
    setExporting(true);
    setActionError('');
    try {
      const headers = await getHeaders();
      const res = await fetch(`/api/wo-findings/export?${params()}`, { headers });
      if (!res.ok) throw new Error(`server membalas HTTP ${res.status}`);
      const blob = await res.blob();
      const filename = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'Data_Perlu_Dicek.xlsx';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setActionError(`Export gagal: ${e?.message || 'koneksi terputus'}. Coba lagi.`);
    } finally {
      setExporting(false);
    }
  };

  const onSort = (column: string) => {
    if (sort === column) setDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSort(column); setDir('desc'); }
  };
  const SortHead = ({ column, children, align = 'right' }: { column: string; children: React.ReactNode; align?: 'left' | 'right' }) => (
    <th className={`py-3 px-4 whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button onClick={() => onSort(column)} className="inline-flex items-center gap-1 font-semibold hover:text-slate-800">
        {children}
        {sort === column && (dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  );

  const filtersActive = rule !== 'all' || status !== 'open' || itemStatus !== 'pending' || !!searchTerm;
  const resetFilters = () => {
    setRule('all');
    setStatus('open');
    setItemStatus('pending');
    setSearchTerm('');
    setSearch('');
  };
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const ruleKeys = Object.keys(summary?.rules || {});

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur-md border-slate-200 px-6 py-4 flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="font-display font-bold text-xl md:text-2xl tracking-tight text-slate-800 flex items-center gap-2">
            <SearchCheck className="text-indigo-500" size={22} /> Data Perlu Dicek
          </h2>
          <p className="text-xs md:text-sm text-slate-500 mt-1">
            Item yang harganya jauh di atas acuan atau isiannya tidak wajar. Perbaiki di SIAGA; temuan selesai sendiri setelah datanya benar.
            {summary?.last_run ? ` Terakhir diperiksa ${summary.last_run}.` : ' Belum pernah diperiksa.'}
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
        <div role="tablist" aria-label="Jenis data" className="flex flex-wrap gap-2">
          {([['findings', 'Temuan harga & isian'], ['unrecognized', 'Item belum dikenali (per aktivitas)']] as const).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${tab === key ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'unrecognized' && <UnrecognizedActivities formatIDR={formatIDR} formatNum={formatNum} />}

        {tab === 'findings' && (<>
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ruleKeys.map(key => {
            const c = summary?.counts?.[key] || {};
            const active = rule === key;
            return (
              <button
                key={key}
                onClick={() => { setRule(active ? 'all' : key); setStatus('open'); setItemStatus('pending'); }}
                className={`text-left p-5 rounded-2xl border bg-white shadow-sm transition hover:shadow-md ${active ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-slate-200'}`}
              >
                <p className="text-sm font-semibold text-slate-600">{summary?.rules[key]}</p>
                <p className="mt-1 text-2xl font-bold text-slate-800">{(summary?.open_pending?.[key] || 0).toLocaleString('id-ID')} <span className="text-sm font-semibold text-slate-500">belum approved, perlu dicek</span></p>
                <p className="mt-1 text-xs text-slate-500">{(c.open || 0).toLocaleString('id-ID')} temuan terbuka termasuk item yang sudah approved</p>
                <p className="mt-1 text-xs text-slate-500">
                  {summary?.open_excess?.[key] ? `Selisih dari acuan ${formatIDR(summary.open_excess[key])} · ` : ''}
                  {(c.ignored || 0).toLocaleString('id-ID')} diabaikan · {(c.resolved || 0).toLocaleString('id-ID')} selesai
                </p>
              </button>
            );
          })}
        </section>

        <section className="p-5 rounded-2xl border bg-white border-slate-200 shadow-sm space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
            <div className="space-y-1">
              <label htmlFor="df-search" className={FIELD_LABEL}>Cari item, WO, proyek atau vendor</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input id="df-search" type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="mis. packing karet" className={`${FIELD_INPUT} pl-9`} />
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor="df-rule" className={FIELD_LABEL}>Jenis temuan</label>
              <select id="df-rule" value={rule} onChange={e => setRule(e.target.value)} className={FIELD_INPUT}>
                <option value="all">Semua temuan</option>
                {ruleKeys.map(key => <option key={key} value={key}>{summary?.rules[key]}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="df-status" className={FIELD_LABEL}>Status temuan</label>
              <select id="df-status" value={status} onChange={e => setStatus(e.target.value)} className={FIELD_INPUT}>
                <option value="open">Perlu dicek</option>
                <option value="ignored">Diabaikan</option>
                <option value="resolved">Selesai</option>
                <option value="all">Semua status</option>
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="df-item-status" className={FIELD_LABEL}>Status item di SIAGA</label>
              <select id="df-item-status" value={itemStatus} onChange={e => setItemStatus(e.target.value)} className={FIELD_INPUT}>
                <option value="all">Semua</option>
                <option value="pending">Belum approved</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={resetFilters}
              disabled={!filtersActive}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-indigo-600 hover:bg-indigo-50 disabled:text-slate-400 disabled:hover:bg-transparent transition"
            >
              <RotateCcw size={12} /> Reset filter
            </button>
          </div>
        </section>

        <section className="rounded-2xl border bg-white border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-700">
              {loading ? 'Memuat…' : `${total.toLocaleString('id-ID')} temuan`}
              {!loading && totalExcess > 0 && <span className="font-normal text-slate-500"> · selisih dari acuan {formatIDR(totalExcess)}</span>}
            </p>
            {canExport && (
              <button
                onClick={exportExcel}
                disabled={exporting || loading || total === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 transition"
              >
                <FileSpreadsheet size={13} /> {exporting ? 'Menyiapkan file…' : `Export Excel (${total.toLocaleString('id-ID')} baris)`}
              </button>
            )}
          </div>
          {actionError && <p role="alert" className="px-5 py-2 text-xs text-rose-700 bg-rose-50 border-b border-rose-100">{actionError}</p>}

          {error ? (
            <div className="p-8 text-center text-sm text-rose-700">{error}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 text-xs">
                  <tr>
                    <th className="py-3 px-4 text-left font-semibold">Item</th>
                    <SortHead column="wo_code" align="left">WO / Proyek</SortHead>
                    <th className="py-3 px-4 text-right font-semibold">Harga Satuan</th>
                    <th className="py-3 px-4 text-right font-semibold">Acuan</th>
                    <SortHead column="ratio">Kali Median</SortHead>
                    <SortHead column="excess">Selisih</SortHead>
                    <th className="py-3 px-4 text-left font-semibold">Temuan</th>
                    <th className="py-3 px-4 text-left font-semibold">Status</th>
                    {canEdit && <th className="py-3 px-4 text-right font-semibold">Aksi</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {!loading && rows.length === 0 && (
                    <tr><td colSpan={9} className="p-8 text-center text-slate-500">
                      {status === 'open' && rule === 'all' && !search && itemStatus === 'pending' ? 'Tidak ada item belum approved yang perlu dicek.' : 'Tidak ada temuan yang cocok dengan filter.'}
                    </td></tr>
                  )}
                  {rows.map(r => (
                    <tr key={`${r.wo_id}-${r.item_id}-${r.rule}`} className="align-top hover:bg-slate-50">
                      <td className="py-2.5 px-4 max-w-md">
                        <p className="font-semibold text-slate-800">{r.label || '-'}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {r.work_type}{r.size ? ` · ${r.size}` : ''} · {formatNum(r.volume)} {r.unit}
                          {r.item_status ? ` · ${ITEM_STATUS_LABELS[r.item_status] || r.item_status}` : ''}
                        </p>
                      </td>
                      <td className="py-2.5 px-4">
                        <a href={`https://shipyard-siaga.samudera.id/v2/work-orders/progress/${r.wo_id}`} target="_blank" rel="noopener noreferrer"
                          className="font-mono font-semibold text-indigo-600 hover:underline">{r.wo_code || r.wo_id}</a>
                        <p className="text-xs text-slate-600 mt-0.5">{r.project_name}</p>
                        <p className="text-xs text-slate-500">{r.vendor_name || 'Tanpa Vendor'}</p>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono whitespace-nowrap">{r.unit_cost ? formatIDR(r.unit_cost) : '-'}</td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        {r.reference ? (
                          <>
                            <p className="font-mono">{formatIDR(r.reference)}</p>
                            <p className="text-xs text-slate-500">{formatIDR(r.ref_p25)} s/d {formatIDR(r.ref_p75)}</p>
                            <p className="text-xs text-slate-500">{r.ref_n} item, {r.ref_basis}</p>
                          </>
                        ) : '-'}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono whitespace-nowrap">{r.reference ? `${(r.unit_cost / r.reference).toFixed(1)}x` : '-'}</td>
                      <td className="py-2.5 px-4 text-right font-mono font-semibold whitespace-nowrap">{r.excess ? formatIDR(r.excess) : '-'}</td>
                      <td className="py-2.5 px-4 max-w-xs">
                        <p className="font-semibold text-slate-700">{r.rule_label}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{isNominalHidden && r.rule === 'price_high' ? 'Harga disembunyikan' : r.detail}</p>
                      </td>
                      <td className="py-2.5 px-4">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${STATUS_STYLES[r.status] || ''}`}>{STATUS_LABELS[r.status] || r.status}</span>
                        {r.status === 'ignored' && (
                          <p className="text-xs text-slate-500 mt-1 max-w-[16rem]">"{r.note}" · {r.ignored_by || '-'}, {r.ignored_at?.split(' ')[0]}</p>
                        )}
                        {r.status === 'resolved' && r.resolved_at && <p className="text-xs text-slate-500 mt-1">{r.resolved_at.split(' ')[0]}</p>}
                      </td>
                      {canEdit && (
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          {r.status === 'open' && (
                            <button onClick={() => { setIgnoreTarget(r); setIgnoreNote(''); setActionError(''); }}
                              className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-100">Abaikan</button>
                          )}
                          {r.status === 'ignored' && (
                            <button onClick={() => setFindingStatus(r, 'open')} disabled={saving}
                              className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-50">Buka lagi</button>
                          )}
                        </td>
                      )}
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
        </>)}
      </main>

      {ignoreTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="df-ignore-title">
          <div className="absolute inset-0 bg-slate-950/50" onClick={() => !saving && setIgnoreTarget(null)} />
          <div className="relative w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-xl p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <h3 id="df-ignore-title" className="text-base font-bold text-slate-800">Abaikan temuan ini?</h3>
              <button onClick={() => setIgnoreTarget(null)} aria-label="Tutup" className="p-1 rounded-lg text-slate-500 hover:bg-slate-100"><X size={16} /></button>
            </div>
            <p className="text-sm text-slate-600">{ignoreTarget.wo_code}: {ignoreTarget.label}</p>
            <label htmlFor="df-note" className={FIELD_LABEL}>Alasan (wajib)</label>
            <textarea id="df-note" value={ignoreNote} onChange={e => setIgnoreNote(e.target.value)} rows={3} autoFocus
              placeholder="mis. harga khusus pekerjaan darurat, sudah dikonfirmasi ke PPC" className={FIELD_INPUT} />
            {actionError && <p role="alert" className="text-xs text-rose-700">{actionError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setIgnoreTarget(null)} disabled={saving} className="px-3 py-2 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-100">Batal</button>
              <button onClick={() => setFindingStatus(ignoreTarget, 'ignored', ignoreNote.trim())} disabled={saving || !ignoreNote.trim()}
                className="px-3 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Menyimpan…' : 'Abaikan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
