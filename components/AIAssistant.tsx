import React, { useEffect, useRef, useState } from 'react';
import { Bot, Send, RotateCcw, Database } from 'lucide-react';
import { getHeaders } from '@/lib/api-client';

// AI Asisten: questions about ShipHub data, answered by Claude with the
// read-only tools of the backend (/api/ai/chat). The conversation lives in
// this page (text only); each answer lists the data it used.

type ToolCall = { name: string; input: Record<string, unknown>; is_error: boolean };
type Message = { role: 'user' | 'assistant'; content: string; tools?: ToolCall[]; error?: boolean };
type Status = { enabled: boolean; model: string; daily_limit: number; used_today: number; tools: string[] };

const TOOL_LABELS: Record<string, string> = {
  search_work_orders: 'Pencarian WO',
  get_work_order: 'Detail WO',
  billing_summary: 'Tagihan (Financial Dashboard)',
  search_work_items: 'Item Pekerjaan WO',
  price_reference: 'Harga Acuan',
  data_findings: 'Data Perlu Dicek',
  unrecognized_activities: 'Item belum dikenali',
};

const EXAMPLES = [
  'Berapa WO yang masih Waiting dan berapa nilainya?',
  'Berapa tagihan yang di-approve sebulan terakhir, per minggu?',
  'Berapa harga wajar bongkar & ganti baru kampas rem?',
  'Ada item belum approved yang harganya perlu dicek?',
];

const describeInput = (input: Record<string, unknown>) =>
  Object.entries(input || {}).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ');

export default function AIAssistant() {
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
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
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, sending]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || sending) return;
    const history = messages.filter(m => !m.error);
    const next: Message[] = [...messages, { role: 'user', content: question }];
    setMessages(next);
    setDraft('');
    setSending(true);
    try {
      const headers = await getHeaders();
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({ messages: [...history, { role: 'user', content: question }].map(m => ({ role: m.role, content: m.content })) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `server membalas HTTP ${res.status}`);
      setMessages([...next, { role: 'assistant', content: body.answer, tools: body.tool_calls }]);
    } catch (e: any) {
      setMessages([...next, { role: 'assistant', content: e?.message || 'Gagal menghubungi AI Asisten.', error: true }]);
    } finally {
      setSending(false);
      loadStatus();
    }
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
            <p className="mt-1">Fitur ini memakai layanan AI eksternal (Anthropic Claude). Setelah ada persetujuan perusahaan, admin server memasang <code className="font-mono">ANTHROPIC_API_KEY</code>; sebelum itu tidak ada data yang dikirim ke luar.</p>
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

        <div className="flex flex-col gap-3" aria-live="polite">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${
                m.role === 'user' ? 'bg-indigo-600 text-white'
                  : m.error ? 'bg-rose-50 text-rose-800 border border-rose-200'
                  : 'bg-white text-slate-800 border border-slate-200'}`}>
                {m.content}
                {m.tools && m.tools.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5 text-xs text-slate-600 whitespace-normal">
                    <Database size={12} aria-hidden="true" /> Sumber data:
                    {m.tools.map((t, j) => (
                      <span key={j} title={describeInput(t.input)}
                        className={`px-1.5 py-0.5 rounded ${t.is_error ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-700'}`}>
                        {TOOL_LABELS[t.name] || t.name}{describeInput(t.input) ? ` (${describeInput(t.input)})` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl px-4 py-3 text-sm bg-white text-slate-500 border border-slate-200">Mencari data dan menyusun jawaban…</div>
            </div>
          )}
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
            <Send size={14} /> Kirim
          </button>
        </form>
      </main>
    </div>
  );
}
