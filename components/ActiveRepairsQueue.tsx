'use client';

import React from 'react';
import { AlertCircle, Clock, Wrench } from 'lucide-react';

import { useData } from '@/context/DataContext';

export default function ActiveRepairsQueue() {
  const { fleet } = useData();
  
  const repairs = fleet
    .filter(a => a.available === 'Damaged' || a.available === 'Maintenance')
    .map(a => ({
      id: a.no_asset,
      type: a.type,
      issue: a.name,
      priority: a.available === 'Damaged' ? 'High' : 'Medium',
      time: a.created_at ? new Date(a.created_at).toLocaleDateString() : 'Recently'
    }))
    .slice(0, 5);

  const priorityColors: Record<string, string> = {
    Critical: 'bg-red-100 text-red-700',
    High: 'bg-orange-100 text-orange-700',
    Medium: 'bg-blue-100 text-blue-700',
    Low: 'bg-slate-100 text-slate-700',
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-display font-bold text-slate-800">Active Repairs Queue</h3>
        <button className="text-xs font-bold text-[#FDB913] hover:text-[#e5a611] uppercase tracking-wider">View All</button>
      </div>
      
      <div className="space-y-4 overflow-y-auto pr-2 custom-scrollbar">
        {repairs.map((repair) => (
          <div key={repair.id} className="group p-4 rounded-xl border border-slate-100 hover:border-[#FDB913]/30 hover:bg-[#FDB913]/10/30 transition-all">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-slate-400">{repair.id}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-tight ${priorityColors[repair.priority]}`}>
                  {repair.priority}
                </span>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-slate-400 font-medium">
                <Clock className="w-3 h-3" />
                {repair.time}
              </div>
            </div>
            
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-800">{repair.issue}</p>
                <p className="text-xs text-slate-500 mt-0.5">{repair.type} Repair</p>
              </div>
              <button className="p-2 bg-white border border-slate-200 rounded-lg text-slate-400 group-hover:text-[#FDB913] group-hover:border-[#FDB913]/30 transition-colors shadow-sm">
                <Wrench className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
