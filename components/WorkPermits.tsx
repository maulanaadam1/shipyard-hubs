import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileCheck2, Search, Loader2, FileSpreadsheet, ChevronDown, ChevronRight, ChevronLeft } from 'lucide-react';
import { getHeaders } from '@/lib/api-client';

// Work Permit: the HSE work permits (MasterHSE spreadsheet): who works where,
// on what, with which risks, controls and PPE, and the approval status.

type Permit = {
  id: string; no_workpermit: string; category: string; status: string; project_id: string; shipname: string; wo: string; dept: string;
  supervisi: string; vendor: string; manpower: number; area_kerja: string; pekerjaan: string; date_start: string; date_finish: string;
  time_start: string; time_end: string; duration_days: number; risks: string[]; hazards: string[]; controls: string[]; tools: string[];
  ppe: string[]; others: string[]; persons: string[]; project_lead: string; safetyman: string; created_by: string; create_date: string;
};
type Count = { name: string; count: number };
type Result = { permits: Permit[]; total: number; manpower: number; statuses: Count[]; categories: Count[]; risks: Count[] };

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const PAGE = 50;
const STATUS_TONE: Record<string, string> = {
  Approved: 'bg-emerald-50 text-emerald-800', Draft: 'bg-slate-100 text-slate-700', 'Approval 1': 'bg-amber-50 text-amber-900', 'Approval 2': 'bg-amber-50 text-amber-900',
};
const FILTERS = ['q', 'status', 'category', 'risk', 'vendor', 'area', 'active', 'from', 'to'];

function Chips({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-slate-600 mb-1">{title}</p>
      <div className="flex flex-wrap gap-1">{items.map(i => <span key={i} className="rounded bg-white border border-slate-200 px-1.5 py-0.5 text-xs text-slate-700">{i}</span>)}</div>
    </div>
  );
}

export default function WorkPermits() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') || '');
  const [data, setData] = useState<Result | null>(null);
  const [facets, setFacets] = useState<{ vendors: Count[]; areas: Count[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState('');
  const page = Math.max(1, Number(params.get('page')) || 1);

  const set = (changes: Record<string, string>, keepPage = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k); }
    if (!keepPage) next.delete('page');
    setParams(next, { replace: true });
    setOpen('');
  };
  const query = () => {
    const q = new URLSearchParams();
    for (const k of FILTERS) { const v = params.get(k); if (v) q.set(k, v); }
    return q;
  };

  useEffect(() => { const t = setTimeout(() => { if (search !== (params.get('q') || '')) set({ q: search.trim() }); }, 400); return () => clearTimeout(t); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hse/work-permits/facets', { headers: await getHeaders() });
        if (res.ok) setFacets(await res.json());
      } catch { /* filters stay empty */ }
    })();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const q = query(); q.set('page', String(page)); q.set('limit', String(PAGE));
        const res = await fetch(`/api/hse/work-permits?${q}`, { headers: await getHeaders(), signal: controller.signal });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        setData(body);
        setError('');
      } catch (e: any) {
        if (e?.name !== 'AbortError') setError(`Gagal memuat work permit: ${e?.message || 'koneksi terputus'}`);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportExcel = async () => {
    try {
      const q = query(); q.set('all', '1'); q.set('limit', '5000');
      const res = await fetch(`/api/hse/work-permits?${q}`, { headers: await getHeaders() });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      const head = ['No WP', 'Status', 'Kategori', 'Kapal', 'Project', 'WO', 'Bagian', 'Vendor', 'Manpower', 'Area', 'Pekerjaan', 'Mulai', 'Selesai', 'Jam',
        'Pekerjaan berisiko', 'Bahaya', 'Pengendalian', 'Alat', 'APD', 'Lainnya', 'Supervisi', 'Project lead', 'Safetyman', 'Personel'];
      const rows = (body.permits as Permit[]).map(p => [p.no_workpermit, p.status, p.category, p.shipname, p.project_id, p.wo, p.dept, p.vendor, p.manpower, p.area_kerja,
        p.pekerjaan, p.date_start, p.date_finish, `${p.time_start}–${p.time_end}`, p.risks.join(', '), p.hazards.join(', '), p.controls.join(', '), p.tools.join(', '),
        p.ppe.join(', '), p.others.join(', '), p.supervisi, p.project_lead, p.safetyman, p.persons.join(', ')]);
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...rows]), 'Work Permit');
      XLSX.writeFile(wb, `WorkPermit_${today()}.xlsx`);
    } catch (e: any) {
      setError(`Gagal ekspor: ${e?.message || 'koneksi terputus'}`);
    }
  };

  const inputCls = 'py-2 px-2 rounded-lg border border-slate-200 bg-white text-sm max-w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  const activeDay = params.get('active') || '';

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur-md border-slate-200 px-6 py-4 flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="font-display font-bold text-xl md:text-2xl tracking-tight text-slate-800 flex items-center gap-2">
            <FileCheck2 className="text-indigo-500" size={22} aria-hidden="true" /> Work Permit
          </h2>
          <p className="text-xs md:text-sm text-slate-500 mt-1">Izin kerja dari spreadsheet MasterHSE: area, pekerjaan, risiko, pengendalian, APD dan status approval.</p>
        </div>
        <button type="button" onClick={exportExcel} disabled={!data}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <FileSpreadsheet size={13} aria-hidden="true" /> Ekspor Excel
        </button>
      </header>

      <main className="w-full p-4 md:p-8 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative block w-full md:w-72">
            <span className="sr-only">Cari nomor, kapal, project, vendor, area, atau pekerjaan</span>
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari nomor, kapal, vendor, area, pekerjaan" className={`${inputCls} w-full pl-8`} />
          </label>
          <button type="button" aria-pressed={activeDay === today()} onClick={() => set({ active: activeDay === today() ? '' : today(), from: '', to: '' })}
            className={`px-3 py-2 rounded-lg text-xs font-semibold border ${activeDay === today() ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>
            Aktif hari ini
          </button>
          <label className="flex items-center gap-1.5 text-sm text-slate-600">Aktif tanggal
            <input type="date" value={activeDay} onChange={e => set({ active: e.target.value, from: '', to: '' })} className={inputCls} />
          </label>
          <select aria-label="Kategori" value={params.get('category') || ''} onChange={e => set({ category: e.target.value })} className={inputCls}>
            <option value="">Semua kategori</option>
            <option value="PROJECT">Project</option>
            <option value="NON PROJECT">Non project</option>
          </select>
          <select aria-label="Pekerjaan berisiko" value={params.get('risk') || ''} onChange={e => set({ risk: e.target.value })} className={`${inputCls} md:max-w-52`}>
            <option value="">Semua risiko</option>
            {(data?.risks ?? []).map(r => <option key={r.name} value={r.name}>{r.name} ({r.count})</option>)}
          </select>
          <select aria-label="Vendor" value={params.get('vendor') || ''} onChange={e => set({ vendor: e.target.value })} className={`${inputCls} md:max-w-52`}>
            <option value="">Semua vendor</option>
            {(facets?.vendors ?? []).map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
          <select aria-label="Area kerja" value={params.get('area') || ''} onChange={e => set({ area: e.target.value })} className={`${inputCls} md:max-w-52`}>
            <option value="">Semua area</option>
            {(facets?.areas ?? []).map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
        </div>

        {data && (
          <div role="radiogroup" aria-label="Status" className="flex flex-wrap gap-1.5">
            {[{ name: '', count: (data.statuses ?? []).reduce((s, x) => s + x.count, 0) }, ...(data.statuses ?? [])].map(s => (
              <button key={s.name || 'all'} type="button" role="radio" aria-checked={(params.get('status') || '') === s.name} onClick={() => set({ status: s.name })}
                className={`px-3 py-1 rounded-full text-xs border ${(params.get('status') || '') === s.name ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
                {s.name || 'Semua status'} <span className="opacity-70">{s.count}</span>
              </button>
            ))}
          </div>
        )}

        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        {data && (
          <p className="text-xs text-slate-500">
            {data.total.toLocaleString('id-ID')} izin kerja · {data.manpower.toLocaleString('id-ID')} manpower
            {loading && <Loader2 size={12} className="inline ml-2 animate-spin" aria-label="Memuat" />}
          </p>
        )}

        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 text-left"><tr>
              <th scope="col" className="py-2 pl-3 w-8"><span className="sr-only">Rincian</span></th>
              <th scope="col" className="px-3 py-2 font-semibold">Izin kerja</th>
              <th scope="col" className="px-3 py-2 font-semibold">Pekerjaan</th>
              <th scope="col" className="px-3 py-2 font-semibold hidden md:table-cell">Vendor</th>
              <th scope="col" className="px-3 py-2 font-semibold">Tanggal</th>
              <th scope="col" className="px-3 py-2 font-semibold hidden lg:table-cell">Risiko</th>
              <th scope="col" className="px-3 py-2 font-semibold">Status</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.permits ?? []).map(p => (
                <React.Fragment key={p.id}>
                  <tr onClick={() => setOpen(open === p.id ? '' : p.id)} className="cursor-pointer hover:bg-slate-50 align-top">
                    <td className="py-2 pl-3">
                      <button type="button" aria-expanded={open === p.id} aria-label={`Rincian ${p.no_workpermit}`} className="text-slate-400 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded">
                        {open === p.id ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                      </button>
                    </td>
                    <td className="px-3 py-2 min-w-[10rem]">
                      <span className="font-medium text-slate-800 whitespace-nowrap">{p.no_workpermit}</span>
                      <span className="block text-xs text-slate-500 break-words">{p.shipname || '–'}{p.category === 'NON PROJECT' ? ' · non project' : ''}</span>
                    </td>
                    <td className="px-3 py-2 min-w-[12rem]">
                      <span className="text-slate-800 break-words">{p.pekerjaan || '–'}</span>
                      <span className="block text-xs text-slate-500 break-words">{[p.area_kerja, p.manpower ? `${p.manpower} orang` : ''].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td className="px-3 py-2 hidden md:table-cell min-w-[9rem]">
                      <span className="text-slate-700 break-words">{p.vendor || '–'}</span>
                      {p.supervisi && <span className="block text-xs text-slate-500 break-words">Supervisi: {p.supervisi}</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600 tabular-nums">
                      {p.date_start || '–'}{p.date_finish && p.date_finish !== p.date_start ? <><br /><span className="text-xs text-slate-500">s/d {p.date_finish}</span></> : null}
                    </td>
                    <td className="px-3 py-2 hidden lg:table-cell">
                      <span className="flex flex-wrap gap-1">{p.risks.slice(0, 3).map(r => <span key={r} className="rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-800 whitespace-nowrap">{r}</span>)}</span>
                    </td>
                    <td className="px-3 py-2"><span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS_TONE[p.status] || 'bg-slate-100 text-slate-700'}`}>{p.status}</span></td>
                  </tr>
                  {open === p.id && (
                    <tr>
                      <td colSpan={7} className="bg-slate-50/70 px-4 py-3">
                        <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4 mb-3">
                          {[['Project', p.project_id], ['WO', p.wo], ['Bagian', p.dept], ['Jam kerja', p.time_start ? `${p.time_start}–${p.time_end}` : ''],
                            ['Durasi', p.duration_days ? `${p.duration_days} hari` : ''], ['Project lead', p.project_lead], ['Safetyman', p.safetyman], ['Dibuat', [p.create_date, p.created_by].filter(Boolean).join(' oleh ')]]
                            .filter(([, v]) => v).map(([k, v]) => (
                              <div key={k} className="flex gap-1.5 min-w-0"><dt className="text-slate-500 shrink-0">{k}:</dt><dd className="text-slate-800 break-words min-w-0">{v}</dd></div>
                            ))}
                        </dl>
                        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                          <Chips title="Pekerjaan berisiko" items={p.risks} />
                          <Chips title="Bahaya" items={p.hazards} />
                          <Chips title="Pengendalian" items={p.controls} />
                          <Chips title="Alat" items={p.tools} />
                          <Chips title="APD" items={p.ppe} />
                          <Chips title="Lainnya" items={p.others} />
                          <Chips title={`Personel (${p.persons.length})`} items={p.persons} />
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {data && !data.permits?.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">Tidak ada izin kerja yang cocok.</td></tr>}
              {!data && loading && <tr><td colSpan={7} className="px-3 py-6 text-slate-500"><Loader2 size={14} className="inline mr-2 animate-spin" aria-hidden="true" />Memuat…</td></tr>}
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
