import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Fingerprint, Search, Loader2, FileSpreadsheet } from 'lucide-react';
import { getHeaders } from '@/lib/api-client';

// Absensi: fingerprint punches turned into work days (check-in, check-out,
// hours, overtime) per worker, with totals per vendor and per day.

type Day = {
  emp_code: string; name: string; kepala_subkon: string; nama_pt: string; keahlian?: string; department?: string; position?: string;
  date: string; hari: string; check_in: string; check_out: string; punches: number; status: string;
  worked_minutes: number | null; estimated_minutes: number; overtime_minutes: number;
};
type Vendor = { nama_pt: string; workers: number; man_days: number; incomplete_days: number; estimated_minutes: number; overtime_minutes: number };
type DateRow = { date: string; hari: string; workers: number; incomplete: number; hours: number; overtime_hours: number };

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const h = (m: number) => (Math.round(m / 6) / 10).toLocaleString('id-ID');
const STATUS: Record<string, string> = { lengkap: 'Lengkap', tanpa_absen_pulang: 'Tanpa absen pulang', tanpa_absen_masuk: 'Tanpa absen masuk' };
const TABS = [['vendors', 'Per Vendor'], ['dates', 'Per Hari'], ['people', 'Per Orang']] as const;
const groupOf = (d: Day) => (d.nama_pt && d.nama_pt !== '-' ? d.nama_pt : d.department ? `Internal - ${d.department}` : 'Tanpa PT');

export default function Attendance() {
  const [params, setParams] = useSearchParams();
  const from = params.get('from') || today();
  const to = params.get('to') || from;
  const tab = (params.get('tab') || 'vendors') as typeof TABS[number][0];
  const vendor = params.get('vendor') || '';
  const status = params.get('status') || '';
  const [search, setSearch] = useState('');
  const [data, setData] = useState<{ vendors: Vendor[]; dates: DateRow[]; days: Day[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [shown, setShown] = useState(200);

  const set = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k); }
    setParams(next, { replace: true });
    setShown(200);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/attendance/daily?from=${from}&to=${to}`, { headers: await getHeaders() });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        if (!cancelled) { setData({ vendors: body.vendors || [], dates: body.dates || [], days: body.days || [] }); setError(''); }
      } catch (e: any) {
        if (!cancelled) setError(`Gagal memuat absensi: ${e?.message || 'koneksi terputus'}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [from, to]);

  const people = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.days || []).filter(d =>
      (!vendor || groupOf(d) === vendor) &&
      (!status || (status === 'incomplete' ? d.status !== 'lengkap' : d.status === status)) &&
      (!q || `${d.name} ${d.emp_code} ${d.kepala_subkon} ${d.keahlian || ''} ${d.position || ''}`.toLowerCase().includes(q)))
      .sort((a, b) => (a.date !== b.date ? b.date.localeCompare(a.date) : groupOf(a).localeCompare(groupOf(b)) || a.name.localeCompare(b.name)));
  }, [data, vendor, status, search]);

  const totals = useMemo(() => {
    const workers = new Set((data?.days || []).map(d => d.emp_code)).size;
    const minutes = (data?.days || []).reduce((s, d) => s + d.estimated_minutes, 0);
    const incomplete = (data?.days || []).filter(d => d.status !== 'lengkap').length;
    return { workers, manDays: data?.days.length || 0, minutes, incomplete };
  }, [data]);

  const exportExcel = async () => {
    if (!data) return;
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Vendor', 'Pekerja', 'Hari kerja', 'Belum lengkap', 'Jam kerja', 'Jam lembur'],
      ...data.vendors.map(v => [v.nama_pt, v.workers, v.man_days, v.incomplete_days, Math.round(v.estimated_minutes / 6) / 10, Math.round(v.overtime_minutes / 6) / 10]),
    ]), 'Per Vendor');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Tanggal', 'Hari', 'Pekerja', 'Belum lengkap', 'Jam kerja', 'Jam lembur'],
      ...data.dates.map(d => [d.date, d.hari, d.workers, d.incomplete, d.hours, d.overtime_hours]),
    ]), 'Per Hari');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Tanggal', 'Hari', 'Kode', 'Nama', 'Vendor', 'Kepala subkon', 'Keahlian / jabatan', 'Masuk', 'Pulang', 'Status', 'Jam kerja', 'Jam lembur'],
      ...people.map(d => [d.date, d.hari, d.emp_code, d.name, groupOf(d), d.kepala_subkon, d.keahlian || d.position || '', d.check_in, d.check_out,
        STATUS[d.status] || d.status, Math.round(d.estimated_minutes / 6) / 10, Math.round(d.overtime_minutes / 6) / 10]),
    ]), 'Per Orang');
    XLSX.writeFile(wb, `Absensi_${from}${to !== from ? `_${to}` : ''}.xlsx`);
  };

  const inputCls = 'py-2 px-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
  const vendorNames = useMemo(() => [...new Set((data?.days || []).map(groupOf))].sort(), [data]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur-md border-slate-200 px-6 py-4 flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="font-display font-bold text-xl md:text-2xl tracking-tight text-slate-800 flex items-center gap-2">
            <Fingerprint className="text-indigo-500" size={22} aria-hidden="true" /> Absensi
          </h2>
          <p className="text-xs md:text-sm text-slate-500 mt-1">Absen fingerprint per pekerja per hari. Absen sebelum jam 05.00 dihitung hari sebelumnya; jam kerja normal 8 jam (Sabtu 4 jam).</p>
        </div>
        <button type="button" onClick={exportExcel} disabled={!data}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <FileSpreadsheet size={13} aria-hidden="true" /> Ekspor Excel
        </button>
      </header>

      <main className="w-full p-4 md:p-8 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-slate-600">Dari
            <input type="date" value={from} max={today()} onChange={e => e.target.value && set({ from: e.target.value, to: e.target.value > to ? e.target.value : to })} className={inputCls} />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-600">sampai
            <input type="date" value={to} min={from} max={today()} onChange={e => e.target.value && set({ to: e.target.value })} className={inputCls} />
          </label>
          {[['Hari ini', 0], ['7 hari', 6], ['30 hari', 29]].map(([label, n]) => (
            <button key={label} type="button" onClick={() => { const t = today(); const f = new Date(Date.parse(t) - (n as number) * 86400000).toISOString().slice(0, 10); set({ from: f, to: t }); }}
              className="px-3 py-1.5 rounded-full text-xs border border-slate-200 bg-white text-slate-600 hover:border-slate-400">{label}</button>
          ))}
        </div>

        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[['Pekerja', totals.workers.toLocaleString('id-ID')], ['Hari kerja', totals.manDays.toLocaleString('id-ID')], ['Jam kerja', h(totals.minutes)], ['Absen belum lengkap', totals.incomplete.toLocaleString('id-ID')]].map(([l, v]) => (
              <div key={l} className="p-3 rounded-xl border border-slate-200 bg-white">
                <p className="text-xs text-slate-500">{l}</p>
                <p className="mt-0.5 text-lg font-bold text-slate-800 tabular-nums">{v}</p>
              </div>
            ))}
          </div>
        )}

        <div role="tablist" aria-label="Tampilan" className="flex gap-1">
          {TABS.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => set({ tab: k === 'vendors' ? '' : k })}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${tab === k ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>

        {tab === 'people' && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative block w-full md:w-64">
              <span className="sr-only">Cari nama, kode, kepala subkon, atau keahlian</span>
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari nama, kode, subkon, keahlian" className={`${inputCls} w-full pl-8`} />
            </label>
            <select aria-label="Vendor" value={vendor} onChange={e => set({ vendor: e.target.value })} className={`${inputCls} md:max-w-64`}>
              <option value="">Semua vendor</option>
              {vendorNames.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <select aria-label="Status absen" value={status} onChange={e => set({ status: e.target.value })} className={inputCls}>
              <option value="">Semua status</option>
              <option value="lengkap">Lengkap</option>
              <option value="incomplete">Belum lengkap</option>
              <option value="tanpa_absen_pulang">Tanpa absen pulang</option>
              <option value="tanpa_absen_masuk">Tanpa absen masuk</option>
            </select>
          </div>
        )}

        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        {loading && <p className="text-xs text-slate-500"><Loader2 size={12} className="inline mr-1 animate-spin" aria-hidden="true" />Memuat…</p>}

        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          {tab === 'vendors' && (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 text-left"><tr>
                <th scope="col" className="px-3 py-2 font-semibold">Vendor</th>
                <th scope="col" className="px-3 py-2 font-semibold text-right">Pekerja</th>
                <th scope="col" className="px-3 py-2 font-semibold text-right">Hari kerja</th>
                <th scope="col" className="px-3 py-2 font-semibold text-right">Belum lengkap</th>
                <th scope="col" className="px-3 py-2 font-semibold text-right">Jam kerja</th>
                <th scope="col" className="px-3 py-2 font-semibold text-right">Jam lembur</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data?.vendors.map(v => (
                  <tr key={v.nama_pt} onClick={() => set({ tab: 'people', vendor: v.nama_pt })} className="cursor-pointer hover:bg-slate-50">
                    <td className="px-3 py-2"><button type="button" className="text-left font-medium text-slate-800 hover:text-indigo-700 break-words">{v.nama_pt}</button></td>
                    <td className="px-3 py-2 text-right tabular-nums">{v.workers}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{v.man_days}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{v.incomplete_days}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{h(v.estimated_minutes)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{h(v.overtime_minutes)}</td>
                  </tr>
                ))}
                {data?.vendors.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">Belum ada absen di periode ini.</td></tr>}
              </tbody>
            </table>
          )}
          {tab === 'dates' && (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 text-left"><tr>
                <th scope="col" className="px-3 py-2 font-semibold">Tanggal</th>
                <th scope="col" className="px-3 py-2 font-semibold text-right">Pekerja</th>
                <th scope="col" className="px-3 py-2 font-semibold text-right">Belum lengkap</th>
                <th scope="col" className="px-3 py-2 font-semibold text-right">Jam kerja</th>
                <th scope="col" className="px-3 py-2 font-semibold text-right">Jam lembur</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {[...(data?.dates || [])].reverse().map(d => (
                  <tr key={d.date} onClick={() => set({ tab: 'people', from: d.date, to: d.date })} className="cursor-pointer hover:bg-slate-50">
                    <td className="px-3 py-2"><button type="button" className="text-left font-medium text-slate-800 hover:text-indigo-700">{d.hari}, {d.date}</button></td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.workers}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.incomplete}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.hours.toLocaleString('id-ID')}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.overtime_hours.toLocaleString('id-ID')}</td>
                  </tr>
                ))}
                {data?.dates.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">Belum ada absen di periode ini.</td></tr>}
              </tbody>
            </table>
          )}
          {tab === 'people' && (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 text-left"><tr>
                <th scope="col" className="px-3 py-2 font-semibold">Tanggal</th>
                <th scope="col" className="px-3 py-2 font-semibold">Pekerja</th>
                <th scope="col" className="px-3 py-2 font-semibold hidden md:table-cell">Vendor</th>
                <th scope="col" className="px-3 py-2 font-semibold">Masuk</th>
                <th scope="col" className="px-3 py-2 font-semibold">Pulang</th>
                <th scope="col" className="px-3 py-2 font-semibold text-right">Jam</th>
                <th scope="col" className="px-3 py-2 font-semibold text-right hidden sm:table-cell">Lembur</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {people.slice(0, shown).map(d => (
                  <tr key={`${d.emp_code}-${d.date}`} className="align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">{d.hari.slice(0, 3)}, {d.date.slice(5)}</td>
                    <td className="px-3 py-2 min-w-[10rem]">
                      <span className="font-medium text-slate-800 break-words">{d.name || d.emp_code}</span>
                      <span className="block text-xs text-slate-500 break-words">{[d.emp_code, d.keahlian || d.position].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td className="px-3 py-2 hidden md:table-cell min-w-[10rem]">
                      <span className="text-slate-700 break-words">{groupOf(d)}</span>
                      {d.kepala_subkon && d.kepala_subkon !== '-' && <span className="block text-xs text-slate-500 break-words">{d.kepala_subkon}</span>}
                    </td>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">{d.check_in ? d.check_in.slice(0, 5) : <span className="text-xs font-semibold text-amber-800">tidak ada</span>}</td>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">{d.check_out ? d.check_out.slice(0, 5) : <span className="text-xs font-semibold text-amber-800">tidak ada</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap" title={d.worked_minutes === null ? 'Perkiraan: absen yang hilang diisi jam 08.00 atau jam pulang standar' : undefined}>
                      {h(d.estimated_minutes)}{d.worked_minutes === null && <span className="text-slate-400">*</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums hidden sm:table-cell">{d.overtime_minutes ? h(d.overtime_minutes) : '–'}</td>
                  </tr>
                ))}
                {data && people.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">Tidak ada absen yang cocok.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
        {tab === 'people' && data && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>{Math.min(shown, people.length).toLocaleString('id-ID')} dari {people.length.toLocaleString('id-ID')} hari kerja · * jam perkiraan karena absen masuk atau pulang tidak ada</span>
            {shown < people.length && (
              <button type="button" onClick={() => setShown(shown + 200)} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 font-semibold hover:bg-slate-50">Tampilkan 200 lagi</button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
