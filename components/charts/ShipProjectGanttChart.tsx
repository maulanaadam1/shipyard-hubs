'use client';

import React, { useMemo, useState } from 'react';
import { useData } from '@/context/DataContext';

export default function ShipProjectGanttChart() {
  const { projects } = useData();
  const [viewMode, setViewMode] = useState<'daily' | 'weekly' | 'monthly'>('monthly');

  const chartData = useMemo(() => {
    const headers = [];
    let windowStart = 0;
    let windowEnd = 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (viewMode === 'monthly') {
      const currentYear = today.getFullYear();
      const currentMonth = today.getMonth();
      for (let i = -6; i <= 6; i++) {
        const d = new Date(currentYear, currentMonth + i, 1);
        headers.push({
          label: d.toLocaleString('default', { month: 'short', year: '2-digit' }),
          date: d,
        });
      }
      windowStart = headers[0].date.getTime();
      windowEnd = new Date(currentYear, currentMonth + 7, 0, 23, 59, 59).getTime();
    } else if (viewMode === 'weekly') {
      const day = today.getDay();
      const diff = today.getDate() - day + (day === 0 ? -6 : 1);
      const startOfWeek = new Date(today.setDate(diff));
      
      for (let i = -6; i <= 6; i++) {
        const d = new Date(startOfWeek);
        d.setDate(d.getDate() + (i * 7));
        const endOfWeek = new Date(d);
        endOfWeek.setDate(d.getDate() + 6);
        
        headers.push({
          label: \`W\${i > 0 ? '+' : ''}\${i === 0 ? ' (Now)' : i}\`,
          labelSecondary: \`\${d.getDate()} \${d.toLocaleString('default', { month: 'short' })}\`,
          date: d,
        });
      }
      windowStart = headers[0].date.getTime();
      const lastWeek = headers[headers.length - 1].date;
      windowEnd = new Date(lastWeek.getFullYear(), lastWeek.getMonth(), lastWeek.getDate() + 6, 23, 59, 59).getTime();
    } else if (viewMode === 'daily') {
      for (let i = -15; i <= 15; i++) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + i);
        headers.push({
          label: d.getDate().toString(),
          labelSecondary: d.toLocaleString('default', { month: 'short' }),
          date: d,
        });
      }
      windowStart = headers[0].date.getTime();
      const lastDay = headers[headers.length - 1].date;
      windowEnd = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate(), 23, 59, 59).getTime();
    }

    const totalDuration = windowEnd - windowStart;

    const activeProjects = projects.filter(p => {
      const s = p.status?.toLowerCase() || 'active';
      const isActive = s === 'active' || s === 'in progress' || s === 'on going' || s === 'ongoing';
      if (!isActive) return false;
      const startDateStr = p.est_start || p.actual_start;
      const endDateStr = p.est_finish || p.actual_finish;
      if (!startDateStr || !endDateStr) return false;
      
      const start = new Date(startDateStr).getTime();
      const end = new Date(endDateStr).getTime();
      
      return start <= windowEnd && end >= windowStart;
    }).sort((a, b) => {
      const dateA = new Date(a.create_date || 0).getTime();
      const dateB = new Date(b.create_date || 0).getTime();
      return dateB - dateA;
    }).map(p => {
      const startDateStr = p.est_start || p.actual_start;
      const endDateStr = p.est_finish || p.actual_finish;
      const start = new Date(startDateStr!).getTime();
      const end = new Date(endDateStr!).getTime();
      
      const clampedStart = Math.max(start, windowStart);
      const clampedEnd = Math.min(end, windowEnd);
      
      const leftPercent = ((clampedStart - windowStart) / totalDuration) * 100;
      const widthPercent = ((clampedEnd - clampedStart) / totalDuration) * 100;

      const isDelayed = new Date() > end;

      return {
        id: p.id,
        name: p.shipname || p.idproject,
        code: p.idproject,
        startStr: startDateStr,
        endStr: endDateStr,
        left: Math.max(0, leftPercent),
        width: Math.max(0.5, widthPercent),
        color: isDelayed ? '#ef4444' : '#0ea5e9',
      };
    });

    return { headers, activeProjects };
  }, [projects, viewMode]);

  const getTitle = () => {
    if (viewMode === 'monthly') return 'Active Job Orders (13 Months)';
    if (viewMode === 'weekly') return 'Active Job Orders (13 Weeks)';
    return 'Active Job Orders (31 Days)';
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-full flex flex-col">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <h3 className="font-display font-bold text-slate-800">{getTitle()}</h3>
        <div className="flex flex-wrap items-center gap-4 text-xs font-medium">
          <div className="flex bg-slate-100 p-1 rounded-lg">
            <button 
              onClick={() => setViewMode('daily')} 
              className={\`px-3 py-1.5 rounded-md transition-colors \${viewMode === 'daily' ? 'bg-white shadow-sm font-bold text-slate-800' : 'text-slate-500 hover:text-slate-700'}\`}
            >
              Daily
            </button>
            <button 
              onClick={() => setViewMode('weekly')} 
              className={\`px-3 py-1.5 rounded-md transition-colors \${viewMode === 'weekly' ? 'bg-white shadow-sm font-bold text-slate-800' : 'text-slate-500 hover:text-slate-700'}\`}
            >
              Weekly
            </button>
            <button 
              onClick={() => setViewMode('monthly')} 
              className={\`px-3 py-1.5 rounded-md transition-colors \${viewMode === 'monthly' ? 'bg-white shadow-sm font-bold text-slate-800' : 'text-slate-500 hover:text-slate-700'}\`}
            >
              Monthly
            </button>
          </div>
          <div className="hidden sm:flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-[#0ea5e9]"></div>
              <span className="text-slate-600">On Track</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-red-500"></div>
              <span className="text-slate-600">Delayed</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-auto">
        <div className="min-w-[800px]">
          <div className="flex border-b border-slate-200 pb-2 mb-4 ml-40 relative">
            {chartData.headers.map((h, i) => (
              <div key={i} className="flex-1 text-center flex flex-col justify-end">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{h.label}</span>
                {h.labelSecondary && (
                  <span className="text-[10px] text-slate-400 mt-0.5">{h.labelSecondary}</span>
                )}
              </div>
            ))}
            
            <div className="absolute inset-0 flex top-full h-[400px] pointer-events-none opacity-20">
              {chartData.headers.map((_, i) => (
                <div key={i} className="flex-1 border-l border-slate-300"></div>
              ))}
            </div>
          </div>

          <div className="space-y-4 relative z-10 pb-4">
            {chartData.activeProjects.length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-400">
                No active projects found in this time window.
              </div>
            ) : (
              chartData.activeProjects.map(project => (
                <div key={project.id} className="flex items-center group relative">
                  <div className="w-40 shrink-0 pr-4 text-right">
                    <p className="text-xs font-bold text-slate-800 truncate" title={project.name}>{project.name}</p>
                    <p className="text-[10px] text-slate-400 truncate">{project.code}</p>
                  </div>
                  
                  <div className="flex-1 relative h-6 bg-slate-50 rounded-full">
                    <div 
                      className="absolute top-0 bottom-0 rounded-full shadow-sm flex items-center justify-center overflow-hidden transition-all duration-300 group-hover:brightness-110"
                      style={{ 
                        left: \`\${project.left}%\`, 
                        width: \`\${project.width}%\`,
                        backgroundColor: project.color
                      }}
                      title={\`\${project.name} (\${project.startStr} to \${project.endStr})\`}
                    >
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
