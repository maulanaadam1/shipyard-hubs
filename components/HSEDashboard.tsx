import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getHeaders } from '@/lib/api-client';

// Dashboard HSE: one day's attendance and active work permits, with the
// trend before it. Each part shows only with its data permission.

type Count = { name: string; count: number };
type Dashboard = {
  date: string;
  permits?: { active: number; approved: number; not_approved: number; manpower: number; status: Count[]; risks: Count[]; areas: Count[]; vendors: Count[]; monthly: { month: string; count: number }[] };
  attendance?: { present: number; incomplete: number; with_overtime: number; hours: number; vendors: Count[]; daily: { date: string; workers: number }[] };
};

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function Stat({ label, value, sub, to }: { label: string; value: React.ReactNode; sub?: string; to?: string }) {
  const body = (
    <>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-2xl font-bold text-slate-800 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </>
  );
  return to
    ? <Link to={to} className="block p-4 rounded-2xl border border-slate-200 bg-white hover:border-indigo-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">{body}</Link>
    : <div className="p-4 rounded-2xl border border-slate-200 bg-white">{body}</div>;
}

function TopList({ title, items, empty, link }: { title: string; items: Count[]; empty: string; link?: (name: string) => string }) {
  const max = Math.max(1, ...items.map(i => i.count));
  return (
    <div className="p-4 rounded-2xl border border-slate-200 bg-white">
      <p className="text-sm font-semibold text-slate-700 mb-2">{title}</p>
      {items.length === 0 && <p className="text-xs text-slate-500">{empty}</p>}
      <ul className="space-y-1.5">
        {items.map(i => (
          <li key={i.name} className="text-xs">
            <div className="flex justify-between gap-2">
              {link ? <Link to={link(i.name)} className="text-slate-700 hover:text-indigo-700 break-words min-w-0">{i.name}</Link> : <span className="text-slate-700 break-words min-w-0">{i.name}</span>}
              <span className="tabular-nums text-slate-500 shrink-0">{i.count}</span>
            </div>
            <div className="mt-0.5 h-1.5 rounded-full bg-slate-100 overflow-hidden" aria-hidden="true">
              <div className="h-full bg-indigo-500" style={{ width: `${(i.count / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function HSEDashboard() {
  const [date, setDate] = useState(today());
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/hse/dashboard?date=${date}`, { headers: await getHeaders() });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        if (!cancelled) { setData(body); setError(''); }
      } catch (e: any) {
        if (!cancelled) setError(`Gagal memuat dashboard: ${e?.message || 'koneksi terputus'}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [date]);

  const p = data?.permits;
  const a = data?.attendance;
  const isToday = date === today();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur-md border-slate-200 px-6 py-4 flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="font-display font-bold text-xl md:text-2xl tracking-tight text-slate-800 flex items-center gap-2">
            <ShieldCheck className="text-indigo-500" size={22} aria-hidden="true" /> Dashboard HSE
          </h2>
          <p className="text-xs md:text-sm text-slate-500 mt-1">Kehadiran pekerja dan izin kerja aktif {isToday ? 'hari ini' : `tanggal ${date}`}.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <span>Tanggal</span>
          <input type="date" value={date} max={today()} onChange={e => e.target.value && setDate(e.target.value)}
            className="py-2 px-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" />
        </label>
      </header>

      <main className="w-full p-4 md:p-8 flex flex-col gap-6">
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        {loading && !data && <p className="text-sm text-slate-500"><Loader2 size={14} className="inline mr-2 animate-spin" aria-hidden="true" />Memuat…</p>}
        {data && !p && !a && <p className="text-sm text-slate-500">Role Anda belum punya izin Data Absensi atau Data HSE, jadi belum ada yang bisa ditampilkan.</p>}

        {a && (
          <section aria-labelledby="hse-att" className="flex flex-col gap-3">
            <h3 id="hse-att" className="text-sm font-bold text-slate-700">Absensi</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Pekerja hadir" value={a.present.toLocaleString('id-ID')} sub="orang dengan absen" to={`/hse/attendance?from=${date}&to=${date}`} />
              <Stat label="Absen belum lengkap" value={a.incomplete.toLocaleString('id-ID')} sub="tanpa absen masuk atau pulang" to={`/hse/attendance?from=${date}&to=${date}&tab=people&status=incomplete`} />
              <Stat label="Lembur" value={a.with_overtime.toLocaleString('id-ID')} sub="orang, dari absen lengkap" />
              <Stat label="Jam kerja" value={a.hours.toLocaleString('id-ID')} sub="total jam (perkiraan)" />
            </div>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="p-4 rounded-2xl border border-slate-200 bg-white">
                <p className="text-sm font-semibold text-slate-700 mb-2">Pekerja hadir, 30 hari terakhir</p>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={a.daily} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="date" tickFormatter={d => String(d).slice(8)} tick={{ fontSize: 10, fill: '#64748b' }} interval={2} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                      <Tooltip formatter={(v: any) => [`${v} orang`, 'Hadir']} labelFormatter={l => String(l)} />
                      <Bar dataKey="workers" fill="#6366f1" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <TopList title="Hadir per vendor" items={a.vendors} empty="Belum ada absen di tanggal ini." />
            </div>
          </section>
        )}

        {p && (
          <section aria-labelledby="hse-wp" className="flex flex-col gap-3">
            <h3 id="hse-wp" className="text-sm font-bold text-slate-700">Work Permit</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Izin kerja aktif" value={p.active.toLocaleString('id-ID')} sub="semua status" to={`/hse/work-permits?active=${date}`} />
              <Stat label="Sudah approved" value={p.approved.toLocaleString('id-ID')} to={`/hse/work-permits?active=${date}&status=Approved`} />
              <Stat label="Belum approved" value={p.not_approved.toLocaleString('id-ID')} sub="Draft / Approval 1 / 2" />
              <Stat label="Manpower di izin approved" value={p.manpower.toLocaleString('id-ID')} sub="orang" />
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <TopList title="Pekerjaan berisiko" items={p.risks} empty="Tidak ada izin approved." link={n => `/hse/work-permits?active=${date}&risk=${encodeURIComponent(n)}`} />
              <TopList title="Area kerja" items={p.areas} empty="Tidak ada izin approved." />
              <TopList title="Vendor" items={p.vendors} empty="Tidak ada izin approved." />
              <TopList title="Status izin aktif" items={p.status} empty="Tidak ada izin aktif." />
            </div>
            <div className="p-4 rounded-2xl border border-slate-200 bg-white">
              <p className="text-sm font-semibold text-slate-700 mb-2">Izin kerja per bulan mulai, 12 bulan terakhir</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={p.monthly} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="month" tickFormatter={m => `${MONTHS[Number(String(m).slice(5)) - 1]} ${String(m).slice(2, 4)}`} tick={{ fontSize: 10, fill: '#64748b' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                    <Tooltip formatter={(v: any) => [`${v} izin`, 'Dimulai']} />
                    <Bar dataKey="count" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
