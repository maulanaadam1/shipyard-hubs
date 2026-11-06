import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ClipboardList, Search, Loader2, RefreshCw, Eye, EyeOff, AlertTriangle, ArrowLeft, ChevronRight, ChevronDown, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { getHeaders } from '@/lib/api-client';
import { useData } from '@/context/DataContext';

// Repair List: every Job Order of the Job Order menu in a table; a row opens
// that Job Order's full repair list from SIAGA, with the WOs that carry each
// activity. Prices need the Harga Penawaran permission (the server leaves them
// out otherwise).

type State = 'ok' | 'pending' | 'none' | 'failed';
type JobRow = {
  jo_id: string; jo_code: string; ship: string; customer: string; service: string; est_start: string; est_finish: string;
  state: State; version: number; items: number; items_in_wo: number; total_price?: number; price_in_wo?: number; fetched_at: string; error: string;
};
type WOUse = { wo_id: string; wo_code: string; vendor: string; cost?: number };
type Item = {
  uniqcode: string; parent: string; depth: number; path: string; description: string; unit: string; quantity: number;
  unit_price?: number; total_price?: number; leaf: boolean; wos: WOUse[];
};
type Summary = {
  jo_id: string; jo_code: string; ship: string; customer: string; service: string; state: State; version: number; fetched_at: string; error: string;
  items: number; items_in_wo: number; total_price?: number; price_in_wo?: number; price_without_wo?: number; cost?: number; cost_approved?: number; margin?: number;
};

const STATE_LABEL: Record<State, string> = { ok: 'Sudah ditarik', pending: 'Belum ditarik', none: 'Tidak ada di SIAGA', failed: 'Gagal ditarik' };

// Nominals are masked by default, shared with the Work Order pages.
function useHiddenNominal() {
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('hideNominal_WO') !== 'false'; } catch { return true; } });
  const toggle = () => { const next = !hidden; setHidden(next); try { localStorage.setItem('hideNominal_WO', String(next)); } catch { /* storage blocked */ } };
  const idr = (v?: number) => (v === undefined ? '–' : hidden ? 'Rp ****'
    : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v || 0));
  return { hidden, toggle, idr };
}

function NominalToggle({ hidden, toggle }: { hidden: boolean; toggle: () => void }) {
  return (
    <button type="button" onClick={toggle} title={hidden ? 'Tampilkan nominal' : 'Sembunyikan nominal'} aria-label={hidden ? 'Tampilkan nominal' : 'Sembunyikan nominal'}
      className={`p-2 rounded-xl border shadow-sm ${hidden ? 'bg-amber-100 border-amber-200 text-amber-700' : 'bg-white border-slate-200 text-slate-500 hover:text-slate-800'}`}>
      {hidden ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
    </button>
  );
}

function StateBadge({ job }: { job: Pick<JobRow, 'state' | 'version'> }) {
  if (job.state === 'ok') {
    return <span className="text-xs text-slate-600 whitespace-nowrap">Versi 1{job.version > 1 ? ` + ${job.version - 1} tambahan` : ''}</span>;
  }
  const tone = job.state === 'failed' ? 'bg-rose-50 text-rose-800' : job.state === 'pending' ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-600';
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${tone}`}>{STATE_LABEL[job.state]}</span>;
}

export default function RepairList() {
  const { joId } = useParams();
  return joId ? <RepairListDetail joID={joId} /> : <RepairListIndex />;
}

// ---------------------------------------------------------------------------
// Index: every Job Order
// ---------------------------------------------------------------------------

type SortKey = 'est_start' | 'ship' | 'customer' | 'total_price' | 'progress';
const PAGE = 100;

function RepairListIndex() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { hidden, toggle, idr } = useHiddenNominal();
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [showPrice, setShowPrice] = useState(false);
  const [error, setError] = useState('');
  const [shown, setShown] = useState(PAGE);

  // Search, filters and sort live in the URL, so going back from a Job Order keeps them.
  const query = params.get('q') || '';
  const service = params.get('jenis') || '';
  const state = params.get('status') || '';
  const sort = (params.get('urut') || 'est_start') as SortKey;
  const dir = params.get('arah') === 'naik' ? 1 : -1;
  const setParam = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k); }
    setParams(next, { replace: true });
    setShown(PAGE);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/repair-lists', { headers: await getHeaders() });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        if (cancelled) return;
        setJobs(body.job_orders || []);
        setShowPrice(!!body.show_price);
        setError('');
      } catch (e: any) {
        if (!cancelled) setError(`Gagal memuat Job Order: ${e?.message || 'koneksi terputus'}`);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const services = useMemo(() => {
    const count = new Map<string, number>();
    for (const j of jobs || []) count.set(j.service || 'Lainnya', (count.get(j.service || 'Lainnya') || 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]);
  }, [jobs]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (jobs || []).filter(j =>
      (!q || `${j.jo_code} ${j.ship} ${j.customer}`.toLowerCase().includes(q)) &&
      (!service || (j.service || 'Lainnya') === service) &&
      (!state || (state === 'ok' ? j.state === 'ok' : j.state !== 'ok')));
    const value = (j: JobRow): string | number => {
      switch (sort) {
        case 'ship': return (j.ship || j.jo_code).toLowerCase();
        case 'customer': return j.customer.toLowerCase();
        case 'total_price': return j.state === 'ok' ? j.total_price || 0 : -1;
        case 'progress': return j.state === 'ok' && j.items ? j.items_in_wo / j.items : -1;
        default: return j.est_start;
      }
    };
    return list.sort((a, b) => { const va = value(a), vb = value(b); return (va > vb ? 1 : va < vb ? -1 : 0) * dir; });
  }, [jobs, query, service, state, sort, dir]);

  const fetched = jobs?.filter(j => j.state === 'ok').length || 0;
  const open = (j: JobRow) => navigate(`/repair-list/${encodeURIComponent(j.jo_id)}`, { state: { back: params.toString() } });

  const Header = ({ k, label, className = '' }: { k: SortKey; label: string; className?: string }) => (
    <th scope="col" aria-sort={sort === k ? (dir < 0 ? 'descending' : 'ascending') : 'none'} className={`px-3 py-2 font-semibold ${className}`}>
      <button type="button" onClick={() => setParam({ urut: k === 'est_start' ? '' : k, arah: sort === k && dir < 0 ? 'naik' : '' })}
        className="inline-flex items-center gap-1 hover:text-slate-800">
        {label}{sort === k && <span aria-hidden="true">{dir < 0 ? '↓' : '↑'}</span>}
      </button>
    </th>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur-md border-slate-200 px-6 py-4 flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="font-display font-bold text-xl md:text-2xl tracking-tight text-slate-800 flex items-center gap-2">
            <ClipboardList className="text-indigo-500" size={22} aria-hidden="true" /> Repair List
          </h2>
          <p className="text-xs md:text-sm text-slate-500 mt-1">
            {jobs ? `${jobs.length} Job Order · ${fetched} repair list sudah ditarik dari SIAGA` : 'Repair list setiap Job Order dari SIAGA'}
          </p>
        </div>
        {showPrice && <NominalToggle hidden={hidden} toggle={toggle} />}
      </header>

      <main className="w-full p-4 md:p-8 flex flex-col gap-3">
        <div className="flex flex-col md:flex-row md:items-center gap-2">
          <label className="relative block md:w-80">
            <span className="sr-only">Cari kode, kapal, atau customer</span>
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input value={query} onChange={e => setParam({ q: e.target.value })} placeholder="Cari kode, kapal, atau customer"
              className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <span className="shrink-0">Repair list</span>
            <select value={state} onChange={e => setParam({ status: e.target.value })}
              className="py-2 px-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
              <option value="">Semua</option>
              <option value="ok">Sudah ditarik</option>
              <option value="belum">Belum ada</option>
            </select>
          </label>
        </div>
        <div role="radiogroup" aria-label="Jenis pekerjaan" className="flex flex-wrap gap-1.5">
          {[['', 'Semua jenis', jobs?.length || 0] as const, ...services.map(([s, n]) => [s, s, n] as const)].map(([value, label, n]) => (
            <button key={value || 'all'} type="button" role="radio" aria-checked={service === value} onClick={() => setParam({ jenis: value })}
              className={`px-3 py-1 rounded-full text-xs border ${service === value ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
              {label} <span className={service === value ? 'text-slate-300' : 'text-slate-400'}>{n}</span>
            </button>
          ))}
        </div>

        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}

        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 text-left">
              <tr>
                <Header k="ship" label="Job Order" />
                <Header k="customer" label="Customer" className="hidden md:table-cell" />
                <Header k="est_start" label="Rencana" className="hidden lg:table-cell" />
                {showPrice && <Header k="total_price" label="Penawaran" className="text-right" />}
                <Header k="progress" label="Sudah ada WO" />
                <th scope="col" className="px-3 py-2 font-semibold hidden sm:table-cell">Repair list</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs === null && !error && (
                <tr><td colSpan={6} className="px-3 py-6 text-slate-500"><span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Memuat Job Order…</span></td></tr>
              )}
              {rows.slice(0, shown).map(j => (
                <tr key={j.jo_id} onClick={() => open(j)} className="cursor-pointer hover:bg-slate-50">
                  <td className="px-3 py-2 align-top">
                    <Link to={`/repair-list/${encodeURIComponent(j.jo_id)}`} state={{ back: params.toString() }} onClick={e => e.stopPropagation()}
                      className="font-medium text-slate-800 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded break-words">
                      {j.ship || j.jo_code || `Job Order ${j.jo_id}`}
                    </Link>
                    <span className="block text-xs text-slate-500 break-words">{j.jo_code}{j.service ? ` · ${j.service}` : ''}</span>
                    <span className="sm:hidden mt-1 block"><StateBadge job={j} /></span>
                  </td>
                  <td className="px-3 py-2 align-top text-slate-600 hidden md:table-cell">{j.customer || '–'}</td>
                  <td className="px-3 py-2 align-top text-xs text-slate-500 whitespace-nowrap hidden lg:table-cell">{j.est_start ? `${j.est_start} – ${j.est_finish || '?'}` : '–'}</td>
                  {showPrice && <td className="px-3 py-2 align-top text-right tabular-nums whitespace-nowrap">{j.state === 'ok' ? idr(j.total_price) : '–'}</td>}
                  <td className="px-3 py-2 align-top whitespace-nowrap">
                    {j.state === 'ok' && j.items > 0 ? (
                      <span className="inline-flex items-center gap-2 text-xs text-slate-600 tabular-nums">
                        <span className="h-1.5 w-16 rounded-full bg-slate-100 overflow-hidden" aria-hidden="true">
                          <span className="block h-full bg-indigo-500" style={{ width: `${Math.round((j.items_in_wo / j.items) * 100)}%` }} />
                        </span>
                        {j.items_in_wo}/{j.items}
                      </span>
                    ) : <span className="text-xs text-slate-400">–</span>}
                  </td>
                  <td className="px-3 py-2 align-top hidden sm:table-cell"><StateBadge job={j} /></td>
                </tr>
              ))}
              {jobs && rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">Tidak ada Job Order yang cocok.</td></tr>}
            </tbody>
          </table>
        </div>
        {jobs && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>{Math.min(shown, rows.length)} dari {rows.length} Job Order</span>
            {shown < rows.length && (
              <button type="button" onClick={() => setShown(shown + PAGE)} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 font-semibold hover:bg-slate-50">
                Tampilkan {Math.min(PAGE, rows.length - shown)} lagi
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail: one Job Order's repair list
// ---------------------------------------------------------------------------

const FILTERS = [
  { key: 'all', label: 'Semua' },
  { key: 'without', label: 'Belum ada WO' },
  { key: 'with', label: 'Sudah ada WO' },
] as const;

// The server groups a multi-version repair list under "version-N" roots.
const versionOf = (uniq: string) => (uniq.startsWith('version-') ? Number(uniq.slice(8)) || 0 : 0);

function RepairListDetail({ joID }: { joID: string }) {
  const { canAccess } = useData();
  const navigate = useNavigate();
  const location = useLocation();
  const { hidden, toggle, idr } = useHiddenNominal();
  const [detail, setDetail] = useState<{ summary: Summary; items: Item[]; show_price: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<typeof FILTERS[number]['key']>('all');
  const [version, setVersion] = useState(1); // 0 = every version
  const [closed, setClosed] = useState<Set<string>>(new Set());

  const back = () => {
    const from = (location.state as { back?: string } | null)?.back;
    navigate(from !== undefined ? `/repair-list${from ? `?${from}` : ''}` : '/repair-list');
  };

  const load = async () => {
    setLoading(true);
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
      setLoading(false);
    }
  };
  useEffect(() => { load(); setFilter('all'); setVersion(1); setClosed(new Set()); }, [joID]); // eslint-disable-line react-hooks/exhaustive-deps

  const resync = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`/api/repair-lists/${encodeURIComponent(joID)}/sync`, { method: 'POST', headers: await getHeaders() });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Gagal menarik repair list');
    } finally {
      setSyncing(false);
    }
  };

  const items = detail?.items || [];
  const showPrice = !!detail?.show_price;
  const versions = useMemo(() => items.filter(i => i.depth === 0 && versionOf(i.uniqcode) > 0).map(i => versionOf(i.uniqcode)), [items]);
  const multi = versions.length > 1;

  // Rows of the chosen version and WO filter: matching activities and the groups above them.
  const visible = useMemo(() => {
    const byID = new Map(items.map(i => [i.uniqcode, i]));
    const rootOf = (it: Item) => { let cur = it; while (cur.parent && byID.get(cur.parent)) cur = byID.get(cur.parent)!; return cur; };
    const keep = new Set<string>();
    for (const it of items) {
      if (!it.leaf) continue;
      if (multi && version > 0 && versionOf(rootOf(it).uniqcode) !== version) continue;
      if (filter !== 'all' && (filter === 'with') !== (it.wos.length > 0)) continue;
      let cur: Item | undefined = it;
      while (cur) { keep.add(cur.uniqcode); cur = cur.parent ? byID.get(cur.parent) : undefined; }
    }
    // In one version, its "Repair list versi N" root row adds nothing.
    return items.filter(i => keep.has(i.uniqcode) && !(multi && version > 0 && i.depth === 0))
      .map(i => ({ ...i, level: multi && version > 0 ? i.depth - 1 : i.depth }));
  }, [items, multi, version, filter]);

  // Subtotal and activity count of each group, over the visible activities.
  const groups = useMemo(() => {
    const byID = new Map(items.map(i => [i.uniqcode, i]));
    const out = new Map<string, { total: number; n: number }>();
    for (const it of visible) {
      if (!it.leaf) continue;
      let p = it.parent ? byID.get(it.parent) : undefined;
      while (p) {
        const g = out.get(p.uniqcode) || { total: 0, n: 0 };
        g.total += it.total_price || 0; g.n++;
        out.set(p.uniqcode, g);
        p = p.parent ? byID.get(p.parent) : undefined;
      }
    }
    return out;
  }, [items, visible]);

  // Collapsed groups hide everything below them.
  const rows = useMemo(() => {
    const out: typeof visible = [];
    let hideBelow = -1;
    for (const it of visible) {
      if (hideBelow >= 0 && it.level > hideBelow) continue;
      hideBelow = !it.leaf && closed.has(it.uniqcode) ? it.level : -1;
      out.push(it);
    }
    return out;
  }, [visible, closed]);

  const toggleGroup = (id: string) => setClosed(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const groupIDs = visible.filter(i => !i.leaf).map(i => i.uniqcode);

  const exportExcel = () => {
    if (!detail) return;
    const s = detail.summary;
    const head = ['Path', 'Level', 'Aktivitas', 'Satuan', 'Qty', ...(showPrice ? ['Harga satuan', 'Total'] : []), 'WO', 'Vendor', ...(showPrice ? ['Biaya vendor'] : [])];
    const data = visible.map(it => [
      it.path, it.level, `${'    '.repeat(Math.max(0, it.level))}${it.description}`, it.leaf ? it.unit : '', it.leaf ? it.quantity : '',
      ...(showPrice ? [it.leaf ? it.unit_price ?? '' : '', it.leaf ? it.total_price ?? '' : groups.get(it.uniqcode)?.total ?? ''] : []),
      it.wos.map(w => w.wo_code).join(', '), it.wos.map(w => w.vendor).filter(Boolean).join(', '),
      ...(showPrice ? [it.wos.length ? it.wos.reduce((t, w) => t + (w.cost || 0), 0) : ''] : []),
    ]);
    const title = [`${s.jo_code} ${s.ship}`.trim(), s.customer, multi ? (version > 0 ? (version === 1 ? 'Versi 1 (utama)' : `Tambahan versi ${version}`) : 'Semua versi') : `Versi ${s.version}`];
    const ws = XLSX.utils.aoa_to_sheet([title, [], head, ...data]);
    ws['!cols'] = head.map((h, i) => ({ wch: i === 2 ? 60 : h === 'Path' ? 14 : 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Repair List');
    const name = `${s.jo_code || joID}-${s.ship}`.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_');
    XLSX.writeFile(wb, `RepairList_${name}.xlsx`);
  };

  const s = detail?.summary;
  const colSpan = showPrice ? 6 : 4;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur-md border-slate-200 px-6 py-4 flex flex-wrap justify-between items-center gap-3">
        <div className="min-w-0">
          <button type="button" onClick={back} className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:text-indigo-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded">
            <ArrowLeft size={14} aria-hidden="true" /> Semua Job Order
          </button>
          <h2 className="mt-1 font-display font-bold text-xl md:text-2xl tracking-tight text-slate-800 break-words">
            {s ? s.ship || s.jo_code || `Job Order ${joID}` : 'Repair List'}
          </h2>
          {s && <p className="text-xs md:text-sm text-slate-500 mt-0.5 break-words">{[s.jo_code, s.customer, s.service].filter(Boolean).join(' · ')}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {s && canAccess('Repair List', 'edit') && (
            <button type="button" onClick={resync} disabled={syncing}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} aria-hidden="true" /> {syncing ? 'Menarik…' : s.state === 'ok' ? 'Tarik ulang' : 'Tarik sekarang'}
            </button>
          )}
          {s?.state === 'ok' && (
            <button type="button" onClick={exportExcel} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
              <FileSpreadsheet size={13} aria-hidden="true" /> Ekspor Excel
            </button>
          )}
          {showPrice && <NominalToggle hidden={hidden} toggle={toggle} />}
        </div>
      </header>

      <main className="w-full p-4 md:p-8 flex flex-col gap-4">
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        {loading && <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Memuat repair list…</p>}

        {s && !loading && s.state !== 'ok' && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
            <p>
              {s.state === 'pending' && 'Repair list Job Order ini belum ditarik dari SIAGA. Penarikan otomatis berjalan setiap 6 jam.'}
              {s.state === 'none' && 'SIAGA tidak punya repair list untuk Job Order ini.'}
              {s.state === 'failed' && `Penarikan terakhir gagal: ${s.error}`}
              {s.fetched_at && <span className="block text-xs text-slate-500 mt-1">Dicoba {s.fetched_at}</span>}
            </p>
          </div>
        )}

        {s && !loading && s.state === 'ok' && (
          <>
            <p className="text-xs text-slate-500">
              {multi ? `Versi 1 + ${versions.length - 1} tambahan` : `Versi ${s.version}`} · ditarik {s.fetched_at || '–'}
            </p>
            <div className={`grid grid-cols-2 gap-3 ${showPrice ? 'md:grid-cols-5' : 'md:grid-cols-3'}`}>
              {(showPrice ? [
                ['Total penawaran', idr(s.total_price), `${s.items} aktivitas`],
                ['Sudah ada WO', idr(s.price_in_wo), `${s.items_in_wo} aktivitas`],
                ['Belum ada WO', idr(s.price_without_wo), `${s.items - s.items_in_wo} aktivitas`],
                ['Biaya vendor', idr(s.cost), `${idr(s.cost_approved)} approved`],
                ['Margin', idr(s.margin), s.total_price ? `${(((s.margin || 0) / s.total_price) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : '–'],
              ] : [
                ['Aktivitas', String(s.items), 'semua versi'],
                ['Sudah ada WO', String(s.items_in_wo), s.items ? `${Math.round((s.items_in_wo / s.items) * 100)}%` : '–'],
                ['Belum ada WO', String(s.items - s.items_in_wo), 'aktivitas'],
              ]).map(([label, value, sub]) => (
                <div key={label} className="p-3 rounded-xl border border-slate-200 bg-white">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="mt-0.5 text-base font-bold text-slate-800 tabular-nums">{value}</p>
                  <p className="text-[11px] text-slate-500">{sub}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {multi && (
                <div role="radiogroup" aria-label="Versi repair list" className="flex flex-wrap gap-1.5">
                  {[...versions, 0].map(v => (
                    <button key={v} type="button" role="radio" aria-checked={version === v} onClick={() => setVersion(v)}
                      className={`px-3 py-1 rounded-full text-xs border ${version === v ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
                      {v === 0 ? 'Semua versi' : v === 1 ? 'Versi 1 · utama' : `Tambahan versi ${v}`}
                    </button>
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
              {groupIDs.length > 0 && (
                <div className="flex gap-3 text-xs font-semibold text-indigo-700 md:ml-auto">
                  <button type="button" onClick={() => setClosed(new Set())} className="hover:text-indigo-900">Buka semua</button>
                  <button type="button" onClick={() => setClosed(new Set(groupIDs))} className="hover:text-indigo-900">Tutup semua</button>
                </div>
              )}
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-semibold hidden md:table-cell">Path</th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">Aktivitas</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Qty</th>
                    {showPrice && <th scope="col" className="px-3 py-2 text-right font-semibold hidden lg:table-cell">Harga satuan</th>}
                    {showPrice && <th scope="col" className="px-3 py-2 text-right font-semibold">Total</th>}
                    <th scope="col" className="px-3 py-2 text-left font-semibold">WO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(it => {
                    const g = groups.get(it.uniqcode);
                    const isClosed = closed.has(it.uniqcode);
                    return (
                      <tr key={it.uniqcode} className={it.leaf ? '' : 'bg-slate-50/70'}>
                        <td className="px-3 py-1.5 align-top text-xs text-slate-500 whitespace-nowrap tabular-nums hidden md:table-cell">{it.path}</td>
                        <td className="px-3 py-1.5 align-top" style={{ paddingLeft: `${12 + Math.max(0, it.level) * 16}px` }}>
                          {it.leaf ? <span className="text-slate-700">{it.description || '–'}</span> : (
                            <button type="button" onClick={() => toggleGroup(it.uniqcode)} aria-expanded={!isClosed}
                              className="inline-flex items-start gap-1 text-left font-semibold text-slate-800 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded">
                              {isClosed ? <ChevronRight size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> : <ChevronDown size={14} className="mt-0.5 shrink-0" aria-hidden="true" />}
                              <span>{it.description || '–'} <span className="font-normal text-xs text-slate-500">{g?.n || 0} aktivitas</span></span>
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right align-top tabular-nums whitespace-nowrap text-slate-600">
                          {it.leaf ? `${it.quantity.toLocaleString('id-ID')} ${it.unit || ''}` : ''}
                        </td>
                        {showPrice && <td className="px-3 py-1.5 text-right align-top tabular-nums whitespace-nowrap hidden lg:table-cell">{it.leaf ? idr(it.unit_price) : ''}</td>}
                        {showPrice && (
                          <td className={`px-3 py-1.5 text-right align-top tabular-nums whitespace-nowrap ${it.leaf ? 'font-medium' : 'font-semibold text-slate-700'}`}>
                            {it.leaf ? idr(it.total_price) : idr(g?.total || 0)}
                          </td>
                        )}
                        <td className="px-3 py-1.5 align-top text-xs">
                          {it.leaf && it.wos.length === 0 && <span className="inline-block rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-900 whitespace-nowrap">Belum ada WO</span>}
                          <span className="flex flex-wrap gap-1">
                            {it.wos.slice(0, 2).map(w => (
                              <span key={w.wo_id} title={`${w.vendor || 'Vendor –'}${showPrice && w.cost !== undefined && !hidden ? `: ${idr(w.cost)}` : ''}`}
                                className="inline-block rounded bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-800 whitespace-nowrap">
                                {w.wo_code || w.wo_id}
                              </span>
                            ))}
                            {it.wos.length > 2 && (
                              <span title={it.wos.slice(2).map(w => `${w.wo_code} · ${w.vendor || '–'}`).join('\n')} className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                                +{it.wos.length - 2}
                              </span>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && <tr><td colSpan={colSpan} className="px-3 py-6 text-center text-slate-500">Tidak ada aktivitas untuk saringan ini.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
