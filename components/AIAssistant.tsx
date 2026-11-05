import React, { useEffect, useRef, useState } from 'react';
import { Bot, Send, RotateCcw, Database, Copy, Check, ThumbsUp, ThumbsDown, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getHeaders } from '@/lib/api-client';
import AIMarkdown from './AIMarkdown';

// AI Asisten: questions about ShipHub data, answered by the AI provider set in
// Pengaturan AI with the read-only tools of the backend (/api/ai/chat,
// streamed as server-sent events). The conversation lives in this page (text
// only); each answer lists the data it used and can be rated.

type ToolCall = { name: string; input: Record<string, unknown>; is_error: boolean };
type Message = {
  role: 'user' | 'assistant'; content: string; tools?: ToolCall[]; error?: boolean;
  id?: string; feedback?: 'up' | 'down' | ''; streaming?: boolean; activity?: string[];
};
type Status = { enabled: boolean; provider: string; model: string; daily_limit: number; used_today: number; tools: string[]; is_admin: boolean };

const TOOL_LABELS: Record<string, string> = {
  search_work_orders: 'Pencarian WO',
  get_work_order: 'Detail WO',
  billing_summary: 'Tagihan (Financial Dashboard)',
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

const EXAMPLES = [
  'Berapa WO yang masih Waiting dan berapa nilainya?',
  'Berapa tagihan yang di-approve sebulan terakhir, per minggu?',
  'Berapa harga wajar bongkar & ganti baru kampas rem?',
  'Ada item belum approved yang harganya perlu dicek?',
];

const describeInput = (input: Record<string, unknown>) =>
  Object.entries(input || {}).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ');

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
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const loadStatus = async () => {
    try {
      const headers = await getHeaders();
      const res = await fetch('/api/ai/status', { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus(await res.json());
      setStatusError('');
    } catch (e: any) {
      setStatusError(`Gagal memuat status AI Asisten: ${e?.message || 'koneksi terputus'}`);
    }
  };
  useEffect(() => { loadStatus(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: sending ? 'auto' : 'smooth', block: 'end' }); }, [messages, sending]);

  // updateLast changes the last message (the answer being written).
  const updateLast = (fn: (m: Message) => Message) =>
    setMessages(prev => (prev.length ? [...prev.slice(0, -1), fn(prev[prev.length - 1])] : prev));

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || sending) return;
    const history = messages.filter(m => !m.error && !m.streaming);
    setMessages([...messages, { role: 'user', content: question },
      { role: 'assistant', content: '', streaming: true, activity: ['Membaca pertanyaan'] }]);
    setDraft('');
    setSending(true);
    try {
      const headers = await getHeaders();
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { ...headers, Accept: 'text/event-stream' },
        body: JSON.stringify({ messages: [...history, { role: 'user', content: question }].map(m => ({ role: m.role, content: m.content })) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `server membalas HTTP ${res.status}`);
      }
      if (!(res.headers.get('Content-Type') || '').includes('text/event-stream')) {
        const body = await res.json();
        updateLast(() => ({ role: 'assistant', content: body.answer, tools: body.tool_calls, id: body.id, feedback: '' }));
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
          updateLast(() => ({ role: 'assistant', content: data.answer, tools: data.tool_calls, id: data.id, feedback: '' }));
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
    }
  };

  const rate = async (index: number, rating: 'up' | 'down') => {
    const m = messages[index];
    if (!m?.id) return;
    const next = m.feedback === rating ? '' : rating;
    setMessages(prev => prev.map((x, i) => (i === index ? { ...x, feedback: next } : x)));
    try {
      const headers = await getHeaders();
      await fetch('/api/ai/feedback', { method: 'POST', headers, body: JSON.stringify({ id: m.id, rating: next }) });
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

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur-md border-slate-200 px-6 py-4 flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="font-display font-bold text-xl md:text-2xl tracking-tight text-slate-800 flex items-center gap-2">
            <Bot className="text-indigo-500" size={22} /> AI Asisten
          </h2>
          <p className="text-xs md:text-sm text-slate-500 mt-1">
            Tanya data ShipHub: WO, tagihan, item pekerjaan, harga acuan dan data perlu dicek. Jawaban hanya dari data ShipHub.
            {status?.enabled ? ` Sisa ${remaining} dari ${status.daily_limit} pertanyaan hari ini.` : ''}
          </p>
        </div>
        <button
          onClick={() => setMessages([])}
          disabled={messages.length === 0 || sending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-slate-200 text-slate-700 bg-white hover:bg-slate-100 disabled:opacity-50"
        >
          <RotateCcw size={14} /> Percakapan baru
        </button>
      </header>

      <main className="flex-1 w-full max-w-4xl mx-auto p-4 md:p-8 flex flex-col gap-4">
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

        {messages.length === 0 && (
          <section className="p-5 rounded-2xl border border-slate-200 bg-white">
            <p className="text-sm font-semibold text-slate-700">Contoh pertanyaan</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {EXAMPLES.map(ex => (
                <button key={ex} onClick={() => send(ex)} disabled={!canAsk || sending}
                  className="px-3 py-1.5 rounded-lg text-sm text-left border border-slate-200 text-slate-700 hover:bg-indigo-50 hover:border-indigo-200 disabled:opacity-50">
                  {ex}
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="flex flex-col gap-3" aria-live="polite" aria-busy={sending}>
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[92%] md:max-w-[85%] min-w-0 rounded-2xl px-4 py-3 text-sm ${
                m.role === 'user' ? 'bg-indigo-600 text-white whitespace-pre-wrap'
                  : m.error ? 'bg-rose-50 text-rose-800 border border-rose-200 whitespace-pre-wrap'
                  : 'bg-white text-slate-800 border border-slate-200'}`}>
                {m.role === 'user' || m.error ? m.content : (
                  <>
                    {m.streaming && (
                      <ul className="mb-2 flex flex-col gap-1 text-xs text-slate-500" aria-label="Progres jawaban">
                        {(m.activity || []).map((a, j, all) => (
                          <li key={j} className="flex items-start gap-1.5">
                            {j === all.length - 1 && !m.content
                              ? <Loader2 size={12} className="mt-0.5 animate-spin shrink-0" aria-hidden="true" />
                              : <Check size={12} className="mt-0.5 text-emerald-600 shrink-0" aria-hidden="true" />}
                            <span className="break-words min-w-0">{a}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {m.content && <AIMarkdown text={m.content} />}
                    {m.streaming && m.content && <span className="inline-block w-1.5 h-4 align-text-bottom bg-slate-400 animate-pulse" aria-hidden="true" />}
                  </>
                )}
                {!m.streaming && m.tools && m.tools.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                    <Database size={12} aria-hidden="true" /> Sumber data:
                    {m.tools.map((t, j) => (
                      <span key={j} title={describeInput(t.input)}
                        className={`px-1.5 py-0.5 rounded break-words ${t.is_error ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-700'}`}>
                        {TOOL_LABELS[t.name] || t.name}{describeInput(t.input) ? ` (${describeInput(t.input)})` : ''}
                      </span>
                    ))}
                  </div>
                )}
                {m.role === 'assistant' && !m.error && !m.streaming && (
                  <div className="mt-2 flex items-center gap-1 text-slate-500">
                    <button type="button" onClick={() => copy(i)}
                      className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-xs hover:bg-slate-100 hover:text-slate-800">
                      {copied === i ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />} {copied === i ? 'Tersalin' : 'Salin'}
                    </button>
                    {m.id && (
                      <>
                        <button type="button" onClick={() => rate(i, 'up')} aria-label="Jawaban membantu" aria-pressed={m.feedback === 'up'} title="Jawaban membantu"
                          className={`p-1.5 rounded hover:bg-slate-100 ${m.feedback === 'up' ? 'text-emerald-600' : 'hover:text-slate-800'}`}>
                          <ThumbsUp size={13} aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => rate(i, 'down')} aria-label="Jawaban salah atau kurang membantu" aria-pressed={m.feedback === 'down'} title="Jawaban salah atau kurang membantu"
                          className={`p-1.5 rounded hover:bg-slate-100 ${m.feedback === 'down' ? 'text-rose-600' : 'hover:text-slate-800'}`}>
                          <ThumbsDown size={13} aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>

        <form
          className="sticky bottom-4 mt-auto flex gap-2 p-2 rounded-2xl border border-slate-200 bg-white shadow-sm"
          onSubmit={e => { e.preventDefault(); send(draft); }}
        >
          <label htmlFor="ai-question" className="sr-only">Pertanyaan</label>
          <textarea
            id="ai-question"
            rows={2}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft); } }}
            disabled={!canAsk || sending}
            placeholder={canAsk ? 'Tulis pertanyaan (Enter untuk kirim, Shift+Enter baris baru)' : status?.enabled ? 'Batas pertanyaan hari ini sudah tercapai' : 'AI Asisten belum aktif'}
            className="flex-1 resize-none px-3 py-2 text-sm outline-none rounded-lg disabled:bg-slate-50"
          />
          <button type="submit" disabled={!canAsk || sending || !draft.trim()} aria-label="Kirim pertanyaan"
            className="self-end inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
            {sending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Send size={14} aria-hidden="true" />} Kirim
          </button>
        </form>
      </main>
    </div>
  );
}
