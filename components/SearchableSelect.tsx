import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  allLabel?: string;
  uppercaseText?: boolean;
}

export function SearchableSelect({ 
  value, 
  onChange, 
  options, 
  allLabel = "Semua",
  uppercaseText = false
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredOptions = options.filter(opt => 
    opt.toLowerCase().includes(search.toLowerCase())
  );

  const displayValue = value === 'all' 
    ? allLabel 
    : (uppercaseText ? value.toUpperCase() : value);

  return (
    <div ref={wrapperRef} className="relative w-full text-sm">
      <div 
        className={`w-full border rounded-lg px-3 py-2 flex items-center justify-between cursor-pointer bg-white transition-colors ${isOpen ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-slate-200 hover:border-indigo-300'}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="truncate pr-2 font-medium text-slate-700">
          {displayValue}
        </span>
        <ChevronDown size={14} className={`text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-64 overflow-hidden flex flex-col">
          <div className="p-2 border-b border-slate-100 flex items-center gap-2 bg-slate-50/50">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input 
              type="text" 
              className="w-full outline-none text-sm bg-transparent placeholder-slate-400 text-slate-700"
              placeholder="Cari..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            {search && (
              <X 
                size={14} 
                className="text-slate-400 cursor-pointer hover:text-slate-600 shrink-0" 
                onClick={() => setSearch('')} 
              />
            )}
          </div>
          <div className="overflow-y-auto overflow-x-hidden flex-1 custom-scrollbar">
            <div 
              className={`px-3 py-2.5 cursor-pointer transition-colors border-b border-slate-50 ${value === 'all' ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'hover:bg-slate-50 text-slate-700 font-medium'}`}
              onClick={() => {
                onChange('all');
                setIsOpen(false);
                setSearch('');
              }}
            >
              {allLabel}
            </div>
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-6 text-center text-slate-400 text-xs">Pencarian tidak ditemukan</div>
            ) : (
              filteredOptions.map(opt => (
                <div 
                  key={opt}
                  className={`px-3 py-2 cursor-pointer truncate transition-colors ${value === opt ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'hover:bg-slate-50 text-slate-600'}`}
                  title={opt}
                  onClick={() => {
                    onChange(opt);
                    setIsOpen(false);
                    setSearch('');
                  }}
                >
                  {uppercaseText ? opt.toUpperCase() : opt}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
