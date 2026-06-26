import React, { useState, useRef, useEffect } from 'react';
import { Bot, Sparkles, X, BrainCircuit, MessageSquare, Loader2, Send, Cpu, Cloud, ArrowUp, Trash2 } from 'lucide-react';
import { getHeaders } from '@/lib/api-client';

interface AIAnalyzerModalProps {
  isOpen: boolean;
  onClose: () => void;
  stats: any;
  globalStats: any;
  filteredData: any[];
  trendData: any[];
  masterDirectories: any;
  isDarkMode: boolean;
}

export default function AIAnalyzerModal({ isOpen, onClose, stats, globalStats, filteredData, trendData, masterDirectories, isDarkMode }: AIAnalyzerModalProps) {
  const [selectedModel, setSelectedModel] = useState<string>('gpt-4o-mini');
  const [messages, setMessages] = useState<{role: 'system' | 'user' | 'assistant', content: string, timestamp?: Date}[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'; // Reset height
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(scrollHeight, 132)}px`; // 132px ~ 5 baris
    }
  }, [inputMessage]);

  // Auto-scroll ke bawah saat ada pesan baru atau saat modal dibuka
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  }, [messages, isOpen]);

  // Pesan sambutan saat modal dibuka
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([
        {
          role: 'assistant',
          content: 'Halo! Saya adalah Asisten AI Anda. Saya telah membaca ringkasan data Work Order saat ini. Anda bisa meminta saya untuk:\n\n1. Membuat narasi laporan eksekutif.\n2. Menganalisis potensi anomali pengeluaran.\n3. Memberikan ringkasan performa vendor.\n\nPilih model AI di atas, lalu ketikkan pertanyaan Anda!'
        }
      ]);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Siapkan konteks data dari dashboard untuk disuapkan ke LLM
  const getSystemPrompt = () => {
    return `Anda adalah Asisten Eksekutif Cerdas Shiphubs (AI Enterprise RAG). Jawablah dalam Bahasa Indonesia yang profesional, rapi, dan presisi berdasarkan data resmi yang disuntikkan dari tabel PostgreSQL: ai_work_orders, ai_wo_breakdowns, dan ai_material_deliveries.`;
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    const newUserMsg = inputMessage;
    setInputMessage("");
    setMessages(prev => [...prev, { role: 'user', content: newUserMsg, timestamp: new Date() }]);
    setIsLoading(true);

    try {
      const isLocalModel = selectedModel === 'llama3.1' || selectedModel === 'gemma2';
      
      // Hapus pesan sambutan awal agar tidak ditolak oleh API eksternal yang ketat
      const chatHistory = messages.filter(m => 
        m.role !== 'system' && 
        !m.content.includes('Halo! Saya adalah Asisten AI Anda') &&
        !m.content.includes('Koneksi Gagal')
      );
      
      if (!isLocalModel) {
        const headers = await getHeaders();
        const response = await fetch('/api/chat/sumopod', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: selectedModel,
            messages: [
              { role: 'system', content: getSystemPrompt() },
              ...chatHistory,
              { role: 'user', content: newUserMsg }
            ],
            max_tokens: 1500,
            temperature: 0.7
          })
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error?.message || err.message || `Gagal terhubung ke Sumopod API (Status: ${response.status})`);
        }

        const data = await response.json();
        if (data.choices && data.choices[0]?.message?.content) {
          setMessages(prev => [...prev, { role: 'assistant', content: data.choices[0].message.content, timestamp: new Date() }]);
        }
      } else {
        // Mencoba menembak API proxy lokal Ollama di backend Go
        const response = await fetch('/api/chat/ollama', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: selectedModel,
            messages: [
              { role: 'system', content: getSystemPrompt() },
              ...chatHistory,
              { role: 'user', content: newUserMsg }
            ],
            stream: false // Untuk kemudahan, kita tunggu balasan penuh
          })
        });

        if (!response.ok) {
          throw new Error("Gagal terhubung ke Ollama");
        }

        const data = await response.json();
        if (data.message && data.message.content) {
          setMessages(prev => [...prev, { role: 'assistant', content: data.message.content, timestamp: new Date() }]);
        }
      }
    } catch (error: any) {
      console.error(error);
      const isLocalModel = selectedModel === 'llama3.1' || selectedModel === 'gemma2';
      const isFailedToFetch = error.message.includes("Failed to fetch");
      
      let errorText = `**Error:** ${error.message}`;
      
      if (isLocalModel && (error.message === "Gagal terhubung ke Ollama" || isFailedToFetch)) {
        errorText = `**Koneksi Gagal:** Pastikan aplikasi **Ollama** sedang berjalan di komputer/server Anda (localhost:11434) dan model \`${selectedModel}\` sudah terunduh (jalankan \`ollama run ${selectedModel}\` di terminal Anda terlebih dahulu).`;
      } else if (!isLocalModel && isFailedToFetch) {
        errorText = `**Koneksi Gagal ke Sumopod API:** Kemungkinan terblokir oleh masalah jaringan atau ekstensi AdBlocker. Pastikan URL \`https://ai.sumopod.com\` dapat diakses.`;
      }
        
      setMessages(prev => [...prev, { role: 'assistant', content: errorText, timestamp: new Date() }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-[100] flex items-end justify-end pointer-events-none">
      <div className="relative pointer-events-auto">
        <div className={`w-[calc(100vw-2rem)] sm:w-[450px] h-[calc(100vh-8rem)] sm:h-[650px] max-h-[85vh] flex flex-col rounded-3xl overflow-hidden shadow-2xl border transition-all ${isDarkMode ? 'bg-slate-900 border-slate-700 shadow-slate-900/50' : 'bg-white border-slate-200 shadow-slate-500/20'}`}>
        
        {/* HEADER */}
        <div className={`p-5 flex items-center justify-between border-b ${isDarkMode ? 'bg-slate-950/50 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/20">
              <Sparkles size={24} />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold font-display tracking-tight bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-transparent">
                Analisa Cerdas AI
              </h2>
              <p className="text-[10px] font-medium text-slate-500 mt-0.5">Integrasi LLaMA & Sumopod</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className={`flex items-center p-0.5 rounded-xl border ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-slate-100 border-slate-200'}`}>
              <Cpu size={14} className={`ml-2 ${selectedModel === 'llama3.1' || selectedModel === 'gemma2' ? 'text-indigo-500' : 'text-emerald-500'}`} />
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className={`bg-transparent outline-none text-[11px] font-bold py-1.5 px-1 cursor-pointer w-[90px] text-ellipsis ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}
              >
                <optgroup label="Local (Ollama)">
                  <option value="llama3.1">LLaMA 3.1</option>
                  <option value="gemma2">Gemma 2</option>
                </optgroup>
                <optgroup label="Cloud (Sumopod API)">
                  <option value="gpt-4o-mini">GPT-4o-Mini</option>
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gpt-5">GPT-5</option>
                  <option value="claude-opus-4-8">Claude Opus 4.8</option>
                  <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                  <option value="gemini/gemini-3.1-pro-preview">Gemini 3.1 Pro</option>
                  <option value="deepseek-v4-pro">DeepSeek v4 Pro</option>
                  <option value="qwen3.7-max">Qwen 3.7 Max</option>
                </optgroup>
              </select>
            </div>

            <button 
              onClick={() => {
                if (window.confirm("Apakah Anda yakin ingin menghapus seluruh riwayat percakapan?")) {
                  setMessages([]);
                }
              }}
              title="Clear Chat"
              className={`p-1.5 rounded-xl border transition-all ${isDarkMode ? 'border-slate-700 text-slate-400 hover:bg-rose-500/10 hover:text-rose-500 hover:border-rose-500/20' : 'border-slate-200 text-slate-400 hover:bg-rose-50 hover:text-rose-500 hover:border-rose-200'}`}
            >
              <Trash2 size={16} />
            </button>
            <button 
              onClick={onClose}
              title="Tutup Widget AI"
              className={`p-1.5 rounded-xl border transition-all ${isDarkMode ? 'border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white' : 'border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* CHAT AREA */}
        <div className={`flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar ${isDarkMode ? 'bg-slate-900' : 'bg-white'}`}>
          {/* Panel Info Konteks */}
          <div className={`p-4 rounded-2xl border text-xs leading-relaxed flex flex-col gap-3 ${isDarkMode ? 'bg-slate-800/50 border-slate-700 text-slate-300' : 'bg-indigo-50/50 border-indigo-100 text-slate-600'}`}>
            <div className="flex items-start gap-3">
              <BrainCircuit size={18} className="text-indigo-500 mt-0.5 shrink-0" />
              <div>
                <strong>Konteks Aktif:</strong> AI membaca {globalStats?.totalWOs || 0} total dokumen perusahaan, dan {stats.totalWOs} dokumen yang sedang Anda saring di layar. Anda bisa bertanya tentang data global secara bebas!
              </div>
            </div>
            
            {/* API Key info removed for security */}
          </div>

          {messages.map((msg, idx) => (
            msg.role !== 'system' && (
              <div key={idx} className={`flex flex-col gap-1 max-w-[85%] ${msg.role === 'user' ? 'ml-auto items-end' : 'items-start'}`}>
                <div className={`flex gap-3 max-w-full ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' : 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md'}`}>
                    {msg.role === 'user' ? <MessageSquare size={14} /> : <Bot size={16} />}
                  </div>
                  <div className={`p-3.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${msg.role === 'user' ? (isDarkMode ? 'bg-indigo-600 text-white rounded-tr-sm' : 'bg-indigo-500 text-white rounded-tr-sm') : (isDarkMode ? 'bg-slate-800 text-slate-200 border border-slate-700 rounded-tl-sm' : 'bg-slate-50 border border-slate-200 text-slate-700 rounded-tl-sm')}`}>
                    {msg.content}
                  </div>
                </div>
                {msg.timestamp && (
                  <span className={`text-[10px] px-11 font-medium ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                    {msg.timestamp.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            )
          ))}
          {isLoading && (
            <div className="flex gap-4 max-w-[85%]">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center shadow-md animate-pulse">
                <Bot size={16} />
              </div>
              <div className={`p-4 rounded-2xl text-sm flex items-center gap-2 ${isDarkMode ? 'bg-slate-800 text-slate-400 border border-slate-700' : 'bg-slate-50 text-slate-500 border border-slate-200'}`}>
                <Loader2 size={16} className="animate-spin text-indigo-500" /> AI sedang berpikir dan menganalisis data...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* INPUT AREA */}
        <div className={`p-5 border-t ${isDarkMode ? 'bg-slate-950/50 border-slate-800' : 'bg-white border-slate-200'}`}>
          <div className="flex items-end gap-3 relative">
            <textarea 
              ref={textareaRef}
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder="Ask Shiphubs..."
              className={`w-full resize-none rounded-2xl border py-3 px-4 pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] ${isDarkMode ? 'bg-slate-900 border-slate-700 text-slate-100 placeholder:text-slate-600' : 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400'}`}
              rows={1}
              style={{ minHeight: '46px', maxHeight: '132px' }}
            />
            <button 
              onClick={handleSendMessage}
              disabled={!inputMessage.trim() || isLoading}
              className={`absolute right-2 bottom-1.5 p-2 rounded-full transition-all duration-200 ${!inputMessage.trim() ? 'opacity-0 scale-75 pointer-events-none' : isLoading ? 'opacity-50 cursor-not-allowed bg-slate-900 dark:bg-white text-white dark:text-slate-900' : 'opacity-100 scale-100 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-slate-900 shadow-md'}`}
            >
              <ArrowUp size={18} strokeWidth={3} />
            </button>
          </div>
          <div className="text-center mt-3 text-[10px] font-medium text-slate-400 dark:text-slate-500 flex items-center justify-center gap-1.5">
            {!(selectedModel === 'llama3.1' || selectedModel === 'gemma2') ? (
              <><Cloud size={12} className="text-emerald-500" /> Menggunakan Sumopod API (Cloud). Data dikirimkan ke server Sumopod secara rahasia.</>
            ) : (
              <><BrainCircuit size={12} /> AI diaktifkan secara luring (Local AI) sehingga seluruh data perusahaan terjamin aman 100%.</>
            )}
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
