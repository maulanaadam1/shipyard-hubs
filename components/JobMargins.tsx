import React, { useEffect, useState } from 'react';
import { Search, ChevronDown, ChevronRight, Loader2, Info } from 'lucide-react';
import { getHeaders } from '@/lib/api-client';

// Harga penawaran (repair list, to the customer) against vendor cost per Job
// Order. A repair-list activity done by several WOs is priced once per Job
// Order; each WO adds its own cost (rejected items excluded). Margins are per
// Job Order only: vendors often book all their cost under one activity.

type Margin = {
  jo_id: string; jo_code: string; price: number; cost: number; cost_approved: number; margin: number; margin_pct: number;
  activities: number; shared_activities: number; double_counted: number; wo_count: number;
  price_in_wo: number; from_repair_list: boolean;
};
type Activity = {
  key: string; name: string; unit: string; quantity: number; unit_price: number; price: number; cost: number;
  wos: { wo_id: string; wo_code: string; vendor: string; cost: number }[] | null;
};
type Detail = {
  job_order: Margin; activities: Activity[];
  work_orders: { wo_id: string; wo_code: string; vendor: string; status: string; cost: number; cost_approved: number }[];
};

const SORTS = [
  { key: 'price', label: 'Harga terbesar' },
  { key: 'margin', label: 'Margin terbesar' },
  { key: 'margin_asc', label: 'Margin terkecil' },
  { key: 'cost', label: 'Biaya terbesar' },
] as const;

export default function JobMargins({ formatIDR }: { formatIDR: (v: number) => string }) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<typeof SORTS[number]['key']>('price');
  const [data, setData] = useState<{ job_orders: Margin[]; total: Margin; count: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Detail | 'loading' | 'error'>>({});

  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: '200', sort: sort === 'margin_asc' ? 'margin' : sort, dir: sort === 'margin_asc' ? 'asc' : 'desc' });
        if (search) params.set('q', search);
        const res = await fetch(`/api/job-margins?${params}`, { headers: await getHeaders(), signal: controller.signal });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        setData(body);
        setError('');
      } catch (e: any) {
        if (e?.name !== 'AbortError') setError(`Gagal memuat harga penawaran: ${e?.message || 'koneksi terputus'}`);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [search, sort]);

  const toggle = async (joID: string) => {
    if (open === joID) { setOpen(null); return; }
    setOpen(joID);
    if (details[joID] && details[joID] !== 'error') return;
    setDetails(d => ({ ...d, [joID]: 'loading' }));
    try {
      const res = await fetch(`/api/job-margins/detail?jo_id=${encodeURIComponent(joID)}`, { headers: await getHeaders() });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setDetails(d => ({ ...d, [joID]: body }));
    } catch {
      setDetails(d => ({ ...d, [joID]: 'error' }));
    }
  };

  const pct = (m: Margin) => (m.price > 0 ? `${m.margin_pct.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : '–');
  const marginTone = (m: Margin) => (m.price <= 0 ? 'text-slate-500' : m.margin < 0 ? 'text-rose-700' : 'text-emerald-700');
  const t = data?.total;

  return (
    <section className="p-5 rounded-2xl border bg-white border-slate-200 shadow-sm space-y-4">
      <div className="flex items-start gap-2 p-3 rounded-xl bg-slate-50 text-xs text-slate-600">
        <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p>
          Harga penawaran diambil dari repair list lengkap Job Order (menu Repair List); bila belum ditarik, dari aktivitas yang sudah ada di WO. Aktivitas yang dikerjakan beberapa WO dihitung <b className="font-semibold">sekali</b>;
          biaya vendor dijumlah dari semua WO (item rejected tidak dihitung). Margin hanya dihitung per Job Order, karena vendor sering mencatat
          semua biayanya di bawah satu aktivitas.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[14rem]">
          <span className="sr-only">Cari Job Order atau kapal</span>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Cari Job Order atau kapal"
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" />
        </label>
        <label className="text-xs text-slate-600 flex items-center gap-2">
          Urutkan
          <select value={sort} onChange={e => setSort(e.target.value as any)}
            className="py-2 px-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        {loading && <Loader2 size={16} className="animate-spin text-slate-400" aria-label="Memuat" />}
      </div>

      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}

      {t && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ['Harga penawaran', formatIDR(t.price), `${(data?.count || 0).toLocaleString('id-ID')} Job Order`],
            ['Biaya vendor', formatIDR(t.cost), `${formatIDR(t.cost_approved)} sudah approved`],
            ['Margin', formatIDR(t.margin), pct(t)],
            ['Tidak dihitung ganda', formatIDR(t.double_counted), `${t.shared_activities.toLocaleString('id-ID')} aktivitas dipakai >1 WO`],
          ].map(([label, value, sub]) => (
            <div key={label} className="p-3 rounded-xl bg-slate-50">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-0.5 text-base font-bold text-slate-800 tabular-nums">{value}</p>
              <p className="text-[11px] text-slate-500">{sub}</p>
            </div>
          ))}
        </div>
      )}

      {data && (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Job Order</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Harga penawaran</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Biaya vendor</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Margin</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">WO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.job_orders.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">Belum ada Job Order dengan harga penawaran.</td></tr>
              )}
              {data.job_orders.map(m => {
                const d = details[m.jo_id];
                return (
                  <React.Fragment key={m.jo_id}>
                    <tr className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => toggle(m.jo_id)} aria-expanded={open === m.jo_id}
                          className="flex items-start gap-1.5 text-left font-medium text-slate-800 hover:text-indigo-700">
                          {open === m.jo_id ? <ChevronDown size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> : <ChevronRight size={15} className="mt-0.5 shrink-0" aria-hidden="true" />}
                          <span>
                            {m.jo_code || `Job Order ${m.jo_id}`}
                            <span className="block text-[11px] font-normal text-slate-500">
                              {m.from_repair_list ? `Repair list lengkap · ${formatIDR(m.price_in_wo)} sudah ada WO` : 'Dari aktivitas di WO (repair list belum ditarik)'}
                              {m.shared_activities > 0 ? ` · ${m.shared_activities} aktivitas dipakai beberapa WO` : ''}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatIDR(m.price)}</td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatIDR(m.cost)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap font-semibold ${marginTone(m)}`}>
                        {formatIDR(m.margin)} <span className="block text-[11px] font-normal">{pct(m)}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.wo_count}</td>
                    </tr>
                    {open === m.jo_id && (
                      <tr>
                        <td colSpan={5} className="bg-slate-50 px-3 py-3">
                          {d === 'loading' && <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Memuat rincian…</p>}
                          {d === 'error' && <p className="text-sm text-rose-700">Gagal memuat rincian. Klik lagi untuk mencoba.</p>}
                          {d && typeof d === 'object' && (
                            <div className="flex flex-col gap-4">
                              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                                <table className="min-w-full text-xs">
                                  <thead className="bg-slate-50 text-slate-500">
                                    <tr>
                                      <th scope="col" className="px-3 py-1.5 text-left font-semibold">Aktivitas repair list</th>
                                      <th scope="col" className="px-3 py-1.5 text-right font-semibold">Harga penawaran</th>
                                      <th scope="col" className="px-3 py-1.5 text-left font-semibold">WO yang mengerjakan (biaya tercatat)</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {d.activities.map(a => (
                                      <tr key={a.key}>
                                        <td className="px-3 py-1.5 text-slate-700">
                                          {a.name}
                                          <span className="block text-[11px] text-slate-500">{a.quantity.toLocaleString('id-ID')} {a.unit} × {formatIDR(a.unit_price)}</span>
                                        </td>
                                        <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">{formatIDR(a.price)}</td>
                                        <td className="px-3 py-1.5 text-slate-600">
                                          {(a.wos || []).length > 1 && <span className="mr-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">dipakai {(a.wos || []).length} WO, harga dihitung sekali</span>}
                                          {(a.wos || []).map(w => (
                                            <span key={w.wo_id} className="block">{w.wo_code} · {w.vendor || '–'}: <span className="tabular-nums">{formatIDR(w.cost)}</span></span>
                                          ))}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                                <table className="min-w-full text-xs">
                                  <thead className="bg-slate-50 text-slate-500">
                                    <tr>
                                      <th scope="col" className="px-3 py-1.5 text-left font-semibold">WO</th>
                                      <th scope="col" className="px-3 py-1.5 text-left font-semibold">Vendor</th>
                                      <th scope="col" className="px-3 py-1.5 text-left font-semibold">Status</th>
                                      <th scope="col" className="px-3 py-1.5 text-right font-semibold">Biaya</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {d.work_orders.map(w => (
                                      <tr key={w.wo_id}>
                                        <td className="px-3 py-1.5">{w.wo_code}</td>
                                        <td className="px-3 py-1.5">{w.vendor || '–'}</td>
                                        <td className="px-3 py-1.5">{w.status || '–'}</td>
                                        <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">{formatIDR(w.cost)}</td>
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
    </section>
  );
}
