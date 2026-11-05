import React, { useEffect, useRef, useState } from 'react';
import {
  Bot, Send, Plus, Database, Copy, Check, ThumbsUp, ThumbsDown, Loader2, FileSpreadsheet, History, Trash2, X,
  FileText, Receipt, Tags, AlertTriangle, ChevronDown, CornerDownRight,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { getHeaders } from '@/lib/api-client';
import AIMarkdown, { tablesIn, downloadAnswerTables } from './AIMarkdown';

// AI Asisten: questions about ShipHub data, answered by the AI provider set in
// Pengaturan AI with the read-only tools of the backend (/api/ai/chat,
// streamed as server-sent events). Conversations are kept on the server per
// user (history panel); each answer lists the data it used, can be rated,
// and suggests follow-up questions.

type ToolCall = { name: string; input: Record<string, unknown>; is_error: boolean };
type Message = {
  role: 'user' | 'assistant'; content: string; tools?: ToolCall[]; error?: boolean;
  id?: string; feedback?: 'up' | 'down' | ''; streaming?: boolean; activity?: string[];
  suggestions?: string[]; durationMs?: number;
};
type Status = { enabled: boolean; provider: string; model: string; daily_limit: number; used_today: number; tools: string[]; is_admin: boolean };
type Conversation = { id: string; title: string; updated_at: string; questions: number };

const TOOL_LABELS: Record<string, string> = {
  search_work_orders: 'Pencarian WO',
  get_work_order: 'Detail WO',
  billing_summary: 'Tagihan',
  search_work_items: 'Item Pekerjaan WO',
  price_reference: 'Harga Acuan',
  data_findings: 'Data Perlu Dicek',
  unrecognized_activities: 'Item belum dikenali',
};

const PROGRESS_LABELS: Record<string, string> = {
  search_work_orders: 'Mencari Work Order',
  get_work_order: 'Membuka detail WO',
  billing_summary: 'Menghitung tagihan',
  search_work_items: 'Mencari item pekerjaan',
  price_reference: 'Mengambil harga acuan',
  data_findings: 'Memeriksa data perlu dicek',
  unrecognized_activities: 'Memeriksa item belum dikenali',
};

const CATEGORIES = [
  { icon: FileText, title: 'Work Order', questions: ['Berapa WO yang masih Waiting dan berapa nilainya?', 'WO terbesar bulan ini per kapal'] },
  { icon: Receipt, title: 'Tagihan', questions: ['Tagihan approved sebulan terakhir, per minggu', 'Tagihan per vendor 3 bulan terakhir'] },
  { icon: Tags, title: 'Harga acuan', questions: ['Berapa harga wajar bongkar & ganti baru kampas rem?', 'Harga acuan pekerjaan sandblasting'] },
  { icon: AlertTriangle, title: 'Perlu dicek', questions: ['Item belum approved yang harganya perlu dicek', 'Aktivitas yang item-nya belum dikenali'] },
];

const describeInput = (input: Record<string, unknown>) =>
  Object.entries(input || {}).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ');

// While streaming, hide the follow-up line ("LANJUT: …") the server takes off.
const visibleText = (text: string) => {
  const cut = text.search(/(^|\n)[ \t*_]*LANJUT:/i);
  const t = cut >= 0 ? text.slice(0, cut) : text;
  return t.replace(/\n[ \t*_]*L(A(N(J(U(T)?)?)?)?)?$/i, '');
};

const dayGroup = (when: string) => {
  const d = new Date(when.replace(' ', 'T'));
  if (isNaN(d.getTime())) return 'Lebih lama';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  if (diff <= 0) return 'Hari ini';
  if (diff === 1) return 'Kemarin';
  if (diff < 7) return '7 hari terakhir';
  return 'Lebih lama';
};

// readEvents reads server-sent events from a fetch response.
async function readEvents(res: Response, onEvent: (event: string, data: any) => void) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (data.length) {
        try { onEvent(event, JSON.parse(data.join('\n'))); } catch { /* a malformed event is skipped */ }
      }
    }
    if (done) break;
  }
}

export default function AIAssistant() {
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadStatus = async () => {
    try {
      const res = await fetch('/api/ai/status', { headers: await getHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus(await res.json());
      setStatusError('');
    } catch (e: any) {
      setStatusError(`Gagal memuat status AI Asisten: ${e?.message || 'koneksi terputus'}`);
    }
  };
  const loadConversations = async () => {
    try {
      const res = await fetch('/api/ai/conversations', { headers: await getHeaders() });
      if (res.ok) setConversations((await res.json()).conversations || []);
    } catch { /* the history panel stays as it was */ }
  };
  useEffect(() => { loadStatus(); loadConversations(); }, []);
  // Follow the conversation; with no messages yet, stay at the top.
  useEffect(() => {
    if (messages.length) endRef.current?.scrollIntoView({ behavior: sending ? 'auto' : 'smooth', block: 'end' });
  }, [messages, sending]);

  const updateLast = (fn: (m: Message) => Message) =>
    setMessages(prev => (prev.length ? [...prev.slice(0, -1), fn(prev[prev.length - 1])] : prev));

  const newConversation = () => {
    if (sending) return;
    setMessages([]);
    setConversationId('');
    setHistoryOpen(false);
    inputRef.current?.focus();
  };

  const openConversation = async (id: string) => {
    if (sending) return;
    setHistoryOpen(false);
    setLoadingConversation(true);
    try {
      const res = await fetch(`/api/ai/conversations/${id}`, { headers: await getHeaders() });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      const list: Message[] = [];
      for (const t of body.turns || []) {
        list.push({ role: 'user', content: t.question });
        list.push(t.error
          ? { role: 'assistant', content: t.error, error: true }
          : { role: 'assistant', content: t.answer, tools: t.tool_calls, id: t.id, feedback: t.feedback, durationMs: t.duration_ms });
      }
      setMessages(list);
      setConversationId(id);
    } catch (e: any) {
      setStatusError(`Gagal membuka percakapan: ${e?.message || 'koneksi terputus'}`);
    } finally {
      setLoadingConversation(false);
    }
  };

  const deleteConversation = async (c: Conversation) => {
    if (!window.confirm(`Hapus percakapan "${c.title}" dari riwayat?`)) return;
    try {
      const res = await fetch(`/api/ai/conversations/${c.id}`, { method: 'DELETE', headers: await getHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConversations(prev => prev.filter(x => x.id !== c.id));
      if (c.id === conversationId) newConversation();
    } catch (e: any) {
      setStatusError(`Gagal menghapus percakapan: ${e?.message || 'koneksi terputus'}`);
    }
  };

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || sending) return;
    const history = messages.filter(m => !m.error && !m.streaming);
    setMessages([...messages.map(m => ({ ...m, suggestions: undefined })), { role: 'user', content: question },
      { role: 'assistant', content: '', streaming: true, activity: ['Membaca pertanyaan'] }]);
    setDraft('');
    setSending(true);
    const finish = (data: any) => {
      if (data.conversation_id) setConversationId(data.conversation_id);
      updateLast(() => ({
        role: 'assistant', content: data.answer, tools: data.tool_calls, id: data.id, feedback: '',
        suggestions: data.suggestions, durationMs: data.duration_ms,
      }));
    };
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { ...(await getHeaders()), Accept: 'text/event-stream' },
        body: JSON.stringify({
          conversation_id: conversationId || undefined,
          messages: [...history, { role: 'user', content: question }].map(m => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `server membalas HTTP ${res.status}`);
      }
      if (!(res.headers.get('Content-Type') || '').includes('text/event-stream')) {
        finish(await res.json());
        return;
      }
      let finished = false;
      await readEvents(res, (event, data) => {
        if (event === 'round') {
          updateLast(m => ({ ...m, content: '' }));
        } else if (event === 'tool') {
          const label = PROGRESS_LABELS[data.name] || `Menjalankan ${data.name}`;
          const detail = describeInput(data.input);
          updateLast(m => ({ ...m, activity: [...(m.activity || []), detail ? `${label} (${detail})` : label] }));
        } else if (event === 'text') {
          updateLast(m => ({ ...m, content: m.content + (data.delta || '') }));
        } else if (event === 'done') {
          finished = true;
          finish(data);
        } else if (event === 'error') {
          finished = true;
          updateLast(() => ({ role: 'assistant', content: data.error || 'Gagal menghubungi AI Asisten.', error: true }));
        }
      });
      if (!finished) throw new Error('Koneksi terputus sebelum jawaban selesai. Coba lagi.');
    } catch (e: any) {
      updateLast(() => ({ role: 'assistant', content: e?.message || 'Gagal menghubungi AI Asisten.', error: true }));
    } finally {
      setSending(false);
      loadStatus();
      loadConversations();
    }
  };

  const rate = async (index: number, rating: 'up' | 'down') => {
    const m = messages[index];
    if (!m?.id) return;
    const next = m.feedback === rating ? '' : rating;
    setMessages(prev => prev.map((x, i) => (i === index ? { ...x, feedback: next } : x)));
    try {
      await fetch('/api/ai/feedback', { method: 'POST', headers: await getHeaders(), body: JSON.stringify({ id: m.id, rating: next }) });
    } catch { /* the rating is a hint; a failed save is not shown */ }
  };

  const copy = async (index: number) => {
    try {
      await navigator.clipboard.writeText(messages[index].content);
      setCopied(index);
      setTimeout(() => setCopied(c => (c === index ? null : c)), 1500);
    } catch { /* clipboard blocked by the browser */ }
  };

  const remaining = status ? Math.max(0, status.daily_limit - status.used_today) : 0;
  const canAsk = !!status?.enabled && remaining > 0;
  const groups = conversations.reduce<Record<string, Conversation[]>>((acc, c) => {
    (acc[dayGroup(c.updated_at)] ||= []).push(c);
    return acc;
  }, {});

  const historyPanel = (
    <nav aria-label="Riwayat percakapan" className="flex flex-col gap-4 p-3">
      <button type="button" onClick={newConversation} disabled={sending}
        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50">
        <Plus size={15} aria-hidden="true" /> Percakapan baru
      </button>
      {conversations.length === 0 && <p className="px-1 text-xs text-slate-500">Percakapan Anda akan tersimpan di sini.</p>}
      {['Hari ini', 'Kemarin', '7 hari terakhir', 'Lebih lama'].filter(g => groups[g]).map(g => (
        <div key={g}>
          <p className="px-2 mb-1 text-[11px] font-semibold text-slate-500">{g}</p>
          <ul className="flex flex-col">
            {groups[g].map(c => (
              <li key={c.id} className="group relative">
                <button type="button" onClick={() => openConversation(c.id)} aria-current={c.id === conversationId ? 'true' : undefined}
                  className={`w-full text-left pl-2 pr-8 py-1.5 rounded-lg text-sm truncate ${c.id === conversationId ? 'bg-[#FDB913]/15 text-slate-900 font-medium' : 'text-slate-600 hover:bg-slate-100'}`}
                  title={c.title}>
                  {c.title}
                </button>
                <button type="button" onClick={() => deleteConversation(c)} aria-label={`Hapus percakapan ${c.title}`}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-rose-700 hover:bg-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="sticky top-0 z-30 border-b bg-white/90 backdrop-blur-md border-slate-200 px-4 md:px-6 py-3 flex flex-wrap justify-between items-center gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <button type="button" onClick={() => setHistoryOpen(true)} aria-label="Buka riwayat percakapan"
            className="lg:hidden p-1.5 -ml-1 rounded-lg text-slate-600 hover:bg-slate-100">
            <History size={20} aria-hidden="true" />
          </button>
          <h2 className="font-display font-bold text-xl tracking-tight text-slate-800 flex items-center gap-2">
            <Bot className="text-slate-700" size={22} aria-hidden="true" /> AI Asisten
          </h2>
          {status && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${status.enabled ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>
              {status.enabled ? 'Aktif' : 'Belum aktif'}
            </span>
          )}
        </div>
        {status?.enabled && (
          <p className="text-xs text-slate-600 tabular-nums">{remaining} dari {status.daily_limit} pertanyaan tersisa hari ini</p>
        )}
      </header>

      <div className="flex-1 flex min-h-0">
        <aside className="hidden lg:block w-64 shrink-0 border-r border-slate-200 bg-white">
          <div className="sticky top-[57px] max-h-[calc(100vh-57px)] overflow-y-auto">{historyPanel}</div>
        </aside>

        {historyOpen && (
          <div className="lg:hidden fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Riwayat percakapan">
            <div className="w-72 max-w-[85%] h-full bg-white overflow-y-auto shadow-xl">
              <div className="flex items-center justify-between px-3 pt-3">
                <p className="text-sm font-semibold text-slate-700">Riwayat</p>
                <button type="button" onClick={() => setHistoryOpen(false)} aria-label="Tutup riwayat" className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100">
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
              {historyPanel}
            </div>
            <button type="button" className="flex-1 bg-slate-900/40" onClick={() => setHistoryOpen(false)} aria-label="Tutup riwayat" />
          </div>
        )}

        <main className="flex-1 min-w-0 w-full max-w-4xl mx-auto px-4 md:px-8 pt-6 pb-4 flex flex-col gap-4">
          {statusError && <p role="alert" className="text-sm text-rose-700">{statusError}</p>}
          {status && !status.enabled && (
            <section className="p-5 rounded-2xl border border-amber-200 bg-amber-50 text-sm text-amber-900">
              <p className="font-semibold">AI Asisten belum aktif.</p>
              <p className="mt-1">
                Fitur ini memakai layanan AI eksternal. Setelah ada persetujuan perusahaan, Admin memilih provider dan mengaktifkannya di menu Pengaturan AI; sebelum itu tidak ada data yang dikirim ke luar.
                {status.is_admin && <> <Link to="/ai-settings" className="font-semibold underline">Buka Pengaturan AI</Link></>}
              </p>
            </section>
          )}

          {loadingConversation && <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Membuka percakapan…</p>}

          {messages.length === 0 && !loadingConversation && (
            <section>
              <p className="text-xl font-semibold text-slate-800">Mau cek data apa hari ini?</p>
              <p className="mt-1 text-sm text-slate-600">Jawaban diambil langsung dari data ShipHub. Setiap angka disertai sumbernya.</p>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {CATEGORIES.map(c => (
                  <div key={c.title} className="p-4 rounded-2xl border border-slate-200 bg-white">
                    <p className="text-sm font-semibold text-slate-800 flex items-center gap-2"><c.icon size={16} className="text-slate-500" aria-hidden="true" /> {c.title}</p>
                    <ul className="mt-2 flex flex-col">
                      {c.questions.map(q => (
                        <li key={q} className="border-t border-slate-100 first:border-t-0">
                          <button type="button" onClick={() => send(q)} disabled={!canAsk || sending}
                            className="w-full text-left py-2 text-sm text-slate-600 hover:text-slate-900 disabled:opacity-50 flex items-start gap-1.5">
                            <CornerDownRight size={14} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" /> {q}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="flex flex-col gap-5" aria-live="polite" aria-busy={sending}>
            {messages.map((m, i) => {
              if (m.role === 'user') {
                return (
                  <div key={i} className="self-end max-w-[85%] rounded-2xl px-4 py-2.5 text-sm bg-white border border-slate-200 text-slate-800 whitespace-pre-wrap">
                    {m.content}
                  </div>
                );
              }
              if (m.error) {
                return <div key={i} className="max-w-[92%] rounded-2xl px-4 py-3 text-sm bg-rose-50 text-rose-800 border border-rose-200 whitespace-pre-wrap">{m.content}</div>;
              }
              const text = m.streaming ? visibleText(m.content) : m.content;
              const hasTables = !m.streaming && tablesIn(m.content).length > 0;
              const steps = (m.tools || []).length;
              return (
                <div key={i} className="max-w-[96%] md:max-w-[92%] min-w-0 flex flex-col gap-1.5">
                  {m.streaming ? (
                    <ul className="flex flex-col gap-1 text-xs text-slate-600" aria-label="Progres jawaban">
                      {(m.activity || []).map((a, j, all) => (
                        <li key={j} className="flex items-start gap-1.5">
                          {j === all.length - 1 && !text
                            ? <Loader2 size={13} className="mt-0.5 animate-spin shrink-0" aria-hidden="true" />
                            : <Check size={13} className="mt-0.5 text-emerald-700 shrink-0" aria-hidden="true" />}
                          <span className="break-words min-w-0">{a}</span>
                        </li>
                      ))}
                    </ul>
                  ) : steps > 0 && (
                    <details className="group text-xs text-slate-600">
                      <summary className="cursor-pointer list-none inline-flex items-center gap-1.5 hover:text-slate-900">
                        <Check size={13} className="text-emerald-700" aria-hidden="true" />
                        {TOOL_LABELS[m.tools![0].name] || m.tools![0].name}{steps > 1 ? ` dan ${steps - 1} data lain` : ''}
                        {m.durationMs ? ` · ${(m.durationMs / 1000).toFixed(1)} dtk` : ''}
                        <ChevronDown size={13} className="group-open:rotate-180 transition-transform" aria-hidden="true" />
                      </summary>
                      <ul className="mt-1.5 ml-5 flex flex-col gap-0.5">
                        {m.tools!.map((t, j) => (
                          <li key={j} className={`break-words ${t.is_error ? 'text-rose-700' : ''}`}>
                            {PROGRESS_LABELS[t.name] || t.name}{describeInput(t.input) ? ` (${describeInput(t.input)})` : ''}{t.is_error ? ': gagal' : ''}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {(text || !m.streaming) && (
                    <div className="rounded-2xl px-4 py-3 text-sm bg-white text-slate-800 border border-slate-200 min-w-0">
                      <AIMarkdown text={text} tableDownload={false} />
                      {m.streaming && <span className="inline-block w-1.5 h-4 align-text-bottom bg-slate-400 animate-pulse" aria-hidden="true" />}
                      {!m.streaming && steps > 0 && (
                        <div className="mt-3 pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                          <Database size={12} aria-hidden="true" /> Sumber:
                          {Array.from(new Set(m.tools!.map(t => TOOL_LABELS[t.name] || t.name))).map(label => (
                            <span key={label} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">{label}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {!m.streaming && (
                    <div className="flex flex-wrap items-center gap-1 text-slate-600">
                      <button type="button" onClick={() => copy(i)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs hover:bg-white hover:text-slate-900">
                        {copied === i ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />} {copied === i ? 'Tersalin' : 'Salin'}
                      </button>
                      {hasTables && (
                        <button type="button" onClick={() => downloadAnswerTables(m.content)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs hover:bg-white hover:text-slate-900">
                          <FileSpreadsheet size={13} aria-hidden="true" /> Excel
                        </button>
                      )}
                      {m.id && (
                        <>
                          <button type="button" onClick={() => rate(i, 'up')} aria-label="Jawaban membantu" aria-pressed={m.feedback === 'up'} title="Jawaban membantu"
                            className={`p-1.5 rounded-lg hover:bg-white ${m.feedback === 'up' ? 'text-emerald-700' : 'hover:text-slate-900'}`}>
                            <ThumbsUp size={13} aria-hidden="true" />
                          </button>
                          <button type="button" onClick={() => rate(i, 'down')} aria-label="Jawaban salah atau kurang membantu" aria-pressed={m.feedback === 'down'} title="Jawaban salah atau kurang membantu"
                            className={`p-1.5 rounded-lg hover:bg-white ${m.feedback === 'down' ? 'text-rose-700' : 'hover:text-slate-900'}`}>
                            <ThumbsDown size={13} aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {!m.streaming && i === messages.length - 1 && m.suggestions && m.suggestions.length > 0 && (
                    <div className="mt-1">
                      <p className="text-xs font-semibold text-slate-500 mb-1.5">Lanjutkan</p>
                      <div className="flex flex-wrap gap-2">
                        {m.suggestions.map(q => (
                          <button key={q} type="button" onClick={() => send(q)} disabled={!canAsk || sending}
                            className="px-3 py-1.5 rounded-full text-sm text-left border border-slate-200 bg-white text-slate-700 hover:border-[#FDB913] hover:bg-[#FDB913]/10 disabled:opacity-50">
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={endRef} />
          </div>

          <form
            className="sticky bottom-4 mt-auto flex gap-2 p-2 rounded-2xl border border-slate-300 bg-white shadow-sm"
            onSubmit={e => { e.preventDefault(); send(draft); }}
          >
            <label htmlFor="ai-question" className="sr-only">Pertanyaan</label>
            <textarea
              id="ai-question"
              ref={inputRef}
              rows={2}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft); } }}
              disabled={!canAsk || sending}
              placeholder={canAsk ? 'Tanya tentang WO, tagihan, atau harga… (Enter kirim, Shift+Enter baris baru)' : status?.enabled ? 'Batas pertanyaan hari ini sudah tercapai' : 'AI Asisten belum aktif'}
              className="flex-1 resize-none px-3 py-2 text-sm outline-none rounded-lg disabled:bg-slate-50"
            />
            <button type="submit" disabled={!canAsk || sending || !draft.trim()} aria-label="Kirim pertanyaan"
              className="self-end inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-[#FDB913] text-slate-900 hover:bg-[#e5a611] disabled:opacity-50">
              {sending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Send size={14} aria-hidden="true" />} Kirim
            </button>
          </form>
        </main>
      </div>
    </div>
  );
}
