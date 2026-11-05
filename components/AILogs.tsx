import React, { useEffect, useState } from 'react';
import { ScrollText, ThumbsUp, ThumbsDown, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { getHeaders } from '@/lib/api-client';
import AIMarkdown from './AIMarkdown';

// Log AI (Admin only): who asked the AI Asisten what, which data it used,
// failed answers, ratings, and token use per day.

type ToolCall = { name: string; input: Record<string, unknown>; is_error: boolean };
type Entry = {
  id: string; created_at: string; user_email: string; question: string; answer: string; tools: ToolCall[];
  model: string; error: string; input_tokens: number; output_tokens: number; cache_read_tokens: number;
  duration_ms: number; feedback: string;
};
type Logs = {
  days: number; since: string;
  summary: { questions: number; users: number; errors: number; up: number; down: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; avg_duration_ms: number };
  per_day: { date: string; questions: number; errors: number; tokens: number }[];
  per_user: { email: string; questions: number; tokens: number; down: number; last: string }[];
  tool_use: Record<string, number>;
  entries: Entry[];
};

const TOOL_LABELS: Record<string, string> = {
  search_work_orders: 'Pencarian WO', get_work_order: 'Detail WO', billing_summary: 'Tagihan',
  search_work_items: 'Item Pekerjaan WO', price_reference: 'Harga Acuan', data_findings: 'Data Perlu Dicek',
  unrecognized_activities: 'Item belum dikenali', query_app_data: 'Data aplikasi',
};

const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n || 0);
const secs = (ms: number) => (ms ? `${(ms / 1000).toFixed(1)} dtk` : '–');
const field = 'px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';

export default function AILogs() {
  const [days, setDays] = useState(30);
  const [filter, setFilter] = useState('all');
  const [user, setUser] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<Logs | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(query), 400);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ days: String(days), filter, limit: '200' });
        if (user) params.set('user', user);
        if (search.trim()) params.set('q', search.trim());
        const res = await fetch(`/api/ai/logs?${params}`, { headers: await getHeaders() });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        if (!cancelled) { setData(body); setError(''); }
      } catch (e: any) {
        if (!cancelled) setError(`Gagal memuat log: ${e?.message || 'koneksi terputus'}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [days, filter, user, search]);

  const s = data?.summary;
  const maxDay = Math.max(1, ...(data?.per_day || []).map(d => d.questions));
  const toolUse = Object.entries(data?.tool_use || {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur-md border-slate-200 px-6 py-4">
        <h2 className="font-display font-bold text-xl md:text-2xl tracking-tight text-slate-800 flex items-center gap-2">
          <ScrollText className="text-indigo-500" size={22} /> Log AI
        </h2>
        <p className="text-xs md:text-sm text-slate-500 mt-1">Pertanyaan ke AI Asisten, data yang dipakai, jawaban gagal, penilaian pengguna dan pemakaian token.</p>
      </header>

      <main className="w-full max-w-6xl mx-auto p-4 md:p-8 flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="log-days" className="block text-xs font-semibold text-slate-600 mb-1">Periode</label>
            <select id="log-days" className={field} value={days} onChange={e => setDays(Number(e.target.value))}>
              <option value={1}>Hari ini</option>
              <option value={7}>7 hari</option>
              <option value={30}>30 hari</option>
              <option value={90}>90 hari</option>
            </select>
          </div>
          <div>
            <label htmlFor="log-filter" className="block text-xs font-semibold text-slate-600 mb-1">Tampilkan</label>
            <select id="log-filter" className={field} value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="all">Semua pertanyaan</option>
              <option value="errors">Gagal dijawab</option>
              <option value="down">Dinilai 👎</option>
              <option value="up">Dinilai 👍</option>
            </select>
          </div>
          <div>
            <label htmlFor="log-user" className="block text-xs font-semibold text-slate-600 mb-1">Pengguna</label>
            <select id="log-user" className={`${field} max-w-[16rem]`} value={user} onChange={e => setUser(e.target.value)}>
              <option value="">Semua pengguna</option>
              {(data?.per_user || []).map(u => <option key={u.email} value={u.email}>{u.email || '(tanpa email)'}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[12rem]">
            <label htmlFor="log-q" className="block text-xs font-semibold text-slate-600 mb-1">Cari di pertanyaan atau jawaban</label>
            <input id="log-q" className={`${field} w-full`} value={query} onChange={e => setQuery(e.target.value)} placeholder="mis. kampas rem" />
          </div>
        </div>

        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}

        {s && (
          <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              ['Pertanyaan', fmt(s.questions), `${fmt(s.users)} pengguna`],
              ['Gagal dijawab', fmt(s.errors), s.questions ? `${Math.round((s.errors / s.questions) * 100)}% dari pertanyaan` : ''],
              ['Penilaian', `${fmt(s.up)} 👍 · ${fmt(s.down)} 👎`, 'dari pengguna'],
              ['Rata-rata waktu', secs(s.avg_duration_ms), 'per jawaban'],
              ['Token', fmt(s.input_tokens + s.output_tokens), `${fmt(s.input_tokens)} masuk · ${fmt(s.output_tokens)} keluar`],
            ].map(([label, value, sub]) => (
              <div key={label} className="p-4 rounded-2xl border border-slate-200 bg-white">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-1 text-lg font-bold text-slate-800 tabular-nums">{value}</p>
                {sub && <p className="text-xs text-slate-500">{sub}</p>}
              </div>
            ))}
          </section>
        )}

        {data && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <section className="lg:col-span-2 p-4 rounded-2xl border border-slate-200 bg-white min-w-0">
              <h3 className="text-sm font-semibold text-slate-700">Pertanyaan per hari</h3>
              {data.per_day.length === 0 ? <p className="mt-3 text-sm text-slate-500">Belum ada pertanyaan pada periode ini.</p> : (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {data.per_day.slice(-31).map(d => (
                    <li key={d.date} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-xs">
                      <span className="text-slate-500 tabular-nums">{d.date}</span>
                      <span className="h-3 rounded bg-slate-100 overflow-hidden" aria-hidden="true">
                        <span className="block h-full bg-indigo-500 rounded" style={{ width: `${(d.questions / maxDay) * 100}%` }} />
                      </span>
                      <span className="text-slate-700 tabular-nums whitespace-nowrap">{d.questions}{d.errors ? <span className="text-rose-700"> · {d.errors} gagal</span> : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="p-4 rounded-2xl border border-slate-200 bg-white min-w-0">
              <h3 className="text-sm font-semibold text-slate-700">Pengguna</h3>
              <ul className="mt-3 flex flex-col divide-y divide-slate-100 text-xs">
                {data.per_user.slice(0, 10).map(u => (
                  <li key={u.email} className="py-1.5 flex justify-between gap-2">
                    <span className="truncate text-slate-700" title={u.email}>{u.email || '(tanpa email)'}</span>
                    <span className="text-slate-500 tabular-nums whitespace-nowrap">{u.questions} tanya{u.down ? ` · ${u.down} 👎` : ''}</span>
                  </li>
                ))}
                {data.per_user.length === 0 && <li className="py-1.5 text-slate-500">–</li>}
              </ul>
              {toolUse.length > 0 && (
                <>
                  <h3 className="mt-4 text-sm font-semibold text-slate-700">Data yang paling sering dipakai</h3>
                  <ul className="mt-2 flex flex-col gap-1 text-xs">
                    {toolUse.map(([name, n]) => (
                      <li key={name} className="flex justify-between gap-2"><span className="text-slate-700">{TOOL_LABELS[name] || name}</span><span className="text-slate-500 tabular-nums">{n}×</span></li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>
        )}

        {data && (
          <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <h3 className="px-4 pt-4 text-sm font-semibold text-slate-700">
              Pertanyaan {loading && <span className="font-normal text-slate-500">(memuat…)</span>}
            </h3>
            {data.entries.length === 0 ? <p className="p-4 text-sm text-slate-500">Tidak ada pertanyaan yang cocok dengan filter ini.</p> : (
              <ul className="mt-2 divide-y divide-slate-100">
                {data.entries.map(e => {
                  const isOpen = open === e.id;
                  return (
                    <li key={e.id}>
                      <button type="button" onClick={() => setOpen(isOpen ? null : e.id)} aria-expanded={isOpen}
                        className="w-full px-4 py-3 flex items-start gap-2 text-left hover:bg-slate-50">
                        {isOpen ? <ChevronDown size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" /> : <ChevronRight size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />}
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm text-slate-800 break-words">{e.question}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                            <span className="tabular-nums">{e.created_at}</span>
                            <span className="truncate max-w-[14rem]">{e.user_email}</span>
                            <span className="tabular-nums">{secs(e.duration_ms)}</span>
                            <span className="tabular-nums">{fmt(e.input_tokens + e.output_tokens)} token</span>
                            {e.error && <span className="inline-flex items-center gap-1 text-rose-700"><AlertTriangle size={12} aria-hidden="true" /> gagal</span>}
                            {e.feedback === 'up' && <span className="inline-flex items-center gap-1 text-emerald-700"><ThumbsUp size={12} aria-hidden="true" /> membantu</span>}
                            {e.feedback === 'down' && <span className="inline-flex items-center gap-1 text-rose-700"><ThumbsDown size={12} aria-hidden="true" /> kurang tepat</span>}
                          </span>
                        </span>
                      </button>
                      {isOpen && (
                        <div className="px-4 pb-4 pl-10 flex flex-col gap-3 text-sm">
                          {e.error
                            ? <p className="p-3 rounded-lg bg-rose-50 text-rose-800 border border-rose-200">{e.error}</p>
                            : <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 min-w-0"><AIMarkdown text={e.answer} /></div>}
                          <div className="text-xs text-slate-600 flex flex-col gap-1">
                            <p><span className="font-semibold">Model:</span> {e.model || '–'}</p>
                            <p className="font-semibold">Data yang dipakai:</p>
                            {e.tools.length === 0 ? <p>Tidak ada (dijawab tanpa data)</p> : (
                              <ul className="flex flex-col gap-0.5">
                                {e.tools.map((t, j) => (
                                  <li key={j} className={`break-words ${t.is_error ? 'text-rose-700' : ''}`}>
                                    {TOOL_LABELS[t.name] || t.name}: <code className="font-mono">{JSON.stringify(t.input)}</code>{t.is_error ? ' (gagal)' : ''}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
