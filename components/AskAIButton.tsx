import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, PenLine } from 'lucide-react';
import { useData } from '@/context/DataContext';

// "Tanya AI" on a page: a few questions about that page's data. Choosing one
// opens AI Asisten with the question in the box (not sent yet) and the scope
// matching the page. Hidden for users without the AI Asisten menu.

type Props = { questions: string[]; scope?: string; className?: string };

export default function AskAIButton({ questions, scope, className = '' }: Props) {
  const { canAccess } = useData();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  if (!canAccess('AI Asisten', 'view')) return null;

  const ask = (q: string) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    params.set('scope', scope || '');
    setOpen(false);
    navigate(`/ai-assistant?${params}`);
  };

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="menu"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border border-slate-200 bg-white text-slate-700 hover:border-[#FDB913] hover:bg-[#FDB913]/10">
        <Sparkles size={13} className="text-amber-700" aria-hidden="true" /> Tanya AI
      </button>
      {open && (
        <div role="menu" className="absolute left-0 z-40 mt-1.5 w-72 max-w-[85vw] rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
          {questions.map(q => (
            <button key={q} type="button" role="menuitem" onClick={() => ask(q)}
              className="w-full text-left px-2.5 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-50">
              {q}
            </button>
          ))}
          <button type="button" role="menuitem" onClick={() => ask('')}
            className="w-full text-left px-2.5 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-50 flex items-center gap-1.5 border-t border-slate-100 mt-1">
            <PenLine size={13} aria-hidden="true" /> Tulis pertanyaan sendiri
          </button>
        </div>
      )}
    </div>
  );
}
