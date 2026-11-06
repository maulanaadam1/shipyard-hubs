import React, { useEffect, useState } from 'react';
import { Bot, KeyRound, PlugZap, Save } from 'lucide-react';
import { getHeaders } from '@/lib/api-client';

// Pengaturan AI (Admin only): which AI provider the AI Assistant uses. Saved in
// the database; the API key is stored encrypted and never shown again.

type Settings = {
  provider: 'anthropic' | 'openai';
  base_url: string;
  model: string;
  max_tokens: number;
  daily_limit: number;
  enabled: boolean;
  active: boolean;
  api_key_set: boolean;
  api_key_hint: string;
  api_key_broken: boolean;
  updated_by: string;
  updated_at: string;
  default_model: string;
};

type TestResult = { ok: boolean; reply?: string; error?: string; model?: string; latency_ms?: number };

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic (Claude)', hint: 'Claude Messages API. Base URL hanya diisi bila memakai gateway.' },
  { value: 'openai', label: 'OpenAI-compatible', hint: 'OpenAI, Azure OpenAI, OpenRouter, Groq, DeepSeek, Gemini (endpoint OpenAI), Ollama, vLLM, atau server lain dengan /chat/completions.' },
] as const;

const field = 'w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
const label = 'block text-sm font-semibold text-slate-700 mb-1';
const help = 'mt-1 text-xs text-slate-500';

export default function AISettings() {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/ai/settings', { headers: await getHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setSaved(data);
      setForm(data);
      setLoadError('');
    } catch (e: any) {
      setLoadError(`Gagal memuat pengaturan: ${e?.message || 'koneksi terputus'}`);
    }
  };
  useEffect(() => { load(); }, []);

  const save = async (extra: Record<string, unknown> = {}) => {
    if (!form) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/ai/settings', {
        method: 'PUT',
        headers: { ...(await getHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: form.provider, base_url: form.base_url, model: form.model,
          max_tokens: Number(form.max_tokens) || 0, daily_limit: Number(form.daily_limit) || 0,
          enabled: form.enabled, api_key: apiKey, ...extra,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setSaved(data);
      setForm(data);
      setApiKey('');
      setMessage({ ok: true, text: data.active ? 'Tersimpan. AI Assistant aktif.' : 'Tersimpan. AI Assistant belum aktif.' });
    } catch (e: any) {
      setMessage({ ok: false, text: `Gagal menyimpan: ${e?.message || 'koneksi terputus'}` });
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      const res = await fetch('/api/ai/settings/test', { method: 'POST', headers: await getHeaders() });
      const data = await res.json();
      setTest(res.ok ? data : { ok: false, error: data?.error || `HTTP ${res.status}` });
    } catch (e: any) {
      setTest({ ok: false, error: e?.message || 'koneksi terputus' });
    } finally {
      setTesting(false);
    }
  };

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => form && setForm({ ...form, [key]: value });
  const dirty = !!form && !!saved && (apiKey !== '' || (['provider', 'base_url', 'model', 'max_tokens', 'daily_limit', 'enabled'] as const)
    .some(k => String(form[k]) !== String(saved[k])));
  const provider = PROVIDERS.find(p => p.value === form?.provider) ?? PROVIDERS[0];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur-md border-slate-200 px-6 py-4">
        <h2 className="font-display font-bold text-xl md:text-2xl tracking-tight text-slate-800 flex items-center gap-2">
          <Bot className="text-indigo-500" size={22} /> Pengaturan AI
        </h2>
        <p className="text-xs md:text-sm text-slate-500 mt-1">
          Provider dan model yang dipakai AI Assistant. Hanya Admin yang bisa membuka halaman ini.
        </p>
      </header>

      <main className="w-full max-w-3xl mx-auto p-4 md:p-8 flex flex-col gap-4">
        {loadError && <p role="alert" className="text-sm text-rose-700">{loadError}</p>}
        {form && saved && (
          <>
            <section className={`p-4 rounded-2xl border text-sm ${saved.active ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
              <p className="font-semibold">{saved.active ? 'AI Assistant aktif' : 'AI Assistant belum aktif'}</p>
              <p className="mt-1">
                {saved.active
                  ? `Pertanyaan pengguna dan data ShipHub yang dibutuhkan untuk menjawab dikirim ke ${provider.label}${saved.base_url ? ` (${saved.base_url})` : ''}.`
                  : 'Tidak ada data yang dikirim ke luar sampai AI Assistant diaktifkan dan pengaturannya lengkap.'}
              </p>
              {saved.updated_by && <p className="mt-1 text-xs opacity-80">Terakhir diubah oleh {saved.updated_by}, {saved.updated_at}.</p>}
            </section>

            <form
              className="p-5 rounded-2xl border border-slate-200 bg-white flex flex-col gap-5"
              onSubmit={e => { e.preventDefault(); save(); }}
            >
              <div>
                <label htmlFor="ai-provider" className={label}>Provider</label>
                <select id="ai-provider" className={field} value={form.provider}
                  onChange={e => set('provider', e.target.value as Settings['provider'])}>
                  {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                <p className={help}>{provider.hint}</p>
              </div>

              <div>
                <label htmlFor="ai-base-url" className={label}>Base URL</label>
                <input id="ai-base-url" className={field} value={form.base_url} inputMode="url" autoComplete="off" spellCheck={false}
                  placeholder={form.provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com'}
                  onChange={e => set('base_url', e.target.value)} />
                <p className={help}>
                  {form.provider === 'openai'
                    ? 'Kosongkan untuk OpenAI. Contoh lain: https://openrouter.ai/api/v1, http://ollama:11434/v1.'
                    : 'Kosongkan untuk API Anthropic langsung.'}
                </p>
              </div>

              <div>
                <label htmlFor="ai-model" className={label}>Model</label>
                <input id="ai-model" className={field} value={form.model} autoComplete="off" spellCheck={false}
                  placeholder={form.provider === 'anthropic' ? saved.default_model : 'mis. gpt-5, deepseek-chat, llama3.1'}
                  onChange={e => set('model', e.target.value)} />
                <p className={help}>
                  {form.provider === 'anthropic' ? `Kosongkan untuk ${saved.default_model}.` : 'Wajib diisi. Model harus mendukung tool/function calling.'}
                </p>
              </div>

              <div>
                <label htmlFor="ai-key" className={label}>API key</label>
                <input id="ai-key" type="password" className={field} value={apiKey} autoComplete="new-password" spellCheck={false}
                  placeholder={saved.api_key_set ? `Tersimpan (berakhiran ${saved.api_key_hint || '…'}). Isi untuk mengganti.` : 'Tempel API key'}
                  onChange={e => setApiKey(e.target.value)} />
                <p className={help}>Disimpan terenkripsi dan tidak pernah ditampilkan lagi. Server lokal tanpa key (Ollama) boleh dikosongkan.</p>
                {saved.api_key_broken && (
                  <p role="alert" className="mt-1 text-xs text-rose-700">API key tersimpan tidak bisa dibuka karena kunci rahasia server berubah. Isi ulang API key.</p>
                )}
                {saved.api_key_set && (
                  <button type="button" disabled={saving}
                    onClick={() => { if (window.confirm('Hapus API key yang tersimpan? AI Assistant akan berhenti.')) save({ clear_api_key: true, api_key: '' }); }}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 hover:underline disabled:opacity-50">
                    <KeyRound size={13} /> Hapus API key
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label htmlFor="ai-limit" className={label}>Batas pertanyaan per pengguna per hari</label>
                  <input id="ai-limit" type="number" min={0} max={10000} className={field} value={form.daily_limit}
                    onChange={e => set('daily_limit', Number(e.target.value))} />
                  <p className={help}>0 = tanpa batas.</p>
                </div>
                <div>
                  <label htmlFor="ai-max-tokens" className={label}>Max tokens jawaban</label>
                  <input id="ai-max-tokens" type="number" min={0} max={128000} className={field} value={form.max_tokens}
                    onChange={e => set('max_tokens', Number(e.target.value))} />
                  <p className={help}>0 = bawaan provider.</p>
                </div>
              </div>

              <label className="flex items-start gap-3 text-sm text-slate-700">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-indigo-600" checked={form.enabled}
                  onChange={e => set('enabled', e.target.checked)} />
                <span>
                  <span className="font-semibold">Aktifkan AI Assistant</span>
                  <span className="block text-xs text-slate-500">Aktifkan hanya setelah ada persetujuan perusahaan untuk mengirim data ke provider ini.</span>
                </span>
              </label>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button type="submit" disabled={saving || !dirty}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                  <Save size={15} /> {saving ? 'Menyimpan…' : 'Simpan'}
                </button>
                <button type="button" onClick={runTest} disabled={testing || dirty}
                  title={dirty ? 'Simpan perubahan dulu' : undefined}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border border-slate-300 text-slate-700 bg-white hover:bg-slate-100 disabled:opacity-50">
                  <PlugZap size={15} /> {testing ? 'Menguji…' : 'Tes koneksi'}
                </button>
                {message && <p role="status" className={`text-sm ${message.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{message.text}</p>}
              </div>
              <p className="text-xs text-slate-500 -mt-2">Tes koneksi mengirim satu pesan pendek tanpa data ShipHub ke pengaturan yang sudah disimpan.</p>
            </form>

            {test && (
              <section role="status" className={`p-4 rounded-2xl border text-sm ${test.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-900'}`}>
                {test.ok
                  ? <p><span className="font-semibold">Terhubung.</span> {test.model} menjawab “{test.reply || '(kosong)'}” dalam {((test.latency_ms || 0) / 1000).toFixed(1)} detik.</p>
                  : <p className="break-words"><span className="font-semibold">Gagal terhubung.</span> {test.error}</p>}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
