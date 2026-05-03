'use client';

import React, { useMemo } from 'react';
import { useData } from '@/context/DataContext';

export default function ShipProjectGanttChart() {
  const { projects } = useData();

  // Get active projects and compute the 6-month window
  const chartData = useMemo(() => {
    // Generate the next 6 months for the header
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-11
    
    const months = [];
    for (let i = -6; i <= 6; i++) {
      const d = new Date(currentYear, currentMonth + i, 1);
      months.push({
        label: d.toLocaleString('default', { month: 'short', year: '2-digit' }),
        date: d,
        timestamp: d.getTime(),
      });
    }

    const windowStart = months[0].date.getTime();
    // End of the last month in the array (currentMonth + 6)
    const windowEnd = new Date(currentYear, currentMonth + 7, 0, 23, 59, 59).getTime();
    const totalDuration = windowEnd - windowStart;

    // Filter active projects that have valid dates
    const activeProjects = projects.filter(p => {
      const s = p.status?.toLowerCase() || 'active'; // Default to active if null
      const isActive = s === 'active' || s === 'in progress' || s === 'on going' || s === 'ongoing';
      if (!isActive) return false;
      const startDateStr = p.est_start || p.actual_start;
      const endDateStr = p.est_finish || p.actual_finish;
      if (!startDateStr || !endDateStr) return false;
      
      const start = new Date(startDateStr).getTime();
      const end = new Date(endDateStr).getTime();
      
      // Check if it overlaps with our 6-month window
      return start <= windowEnd && end >= windowStart;
    }).map(p => {
      const startDateStr = p.est_start || p.actual_start;
      const endDateStr = p.est_finish || p.actual_finish;
      const start = new Date(startDateStr!).getTime();
      const end = new Date(endDateStr!).getTime();
      
      // Calculate position percentages
      const clampedStart = Math.max(start, windowStart);
      const clampedEnd = Math.min(end, windowEnd);
      
      const leftPercent = ((clampedStart - windowStart) / totalDuration) * 100;
      const widthPercent = ((clampedEnd - clampedStart) / totalDuration) * 100;

      // Determine color based on progress or randomly
      const isDelayed = new Date() > end;

      return {
        id: p.id,
        name: p.shipname || p.idproject,
        code: p.idproject,
        startStr: startDateStr,
        endStr: endDateStr,
        left: Math.max(0, leftPercent),
        width: Math.max(2, widthPercent), // Minimum width for visibility
        color: isDelayed ? '#ef4444' : '#0ea5e9', // red if delayed, blue otherwise
      };
    });

    return { months, activeProjects };
  }, [projects]);

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-display font-bold text-slate-800">Active Job Orders Gantt (6 Months Before & After)</h3>
        <div className="flex items-center gap-4 text-xs font-medium">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-[#0ea5e9]"></div>
            <span className="text-slate-600">On Track</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-red-500"></div>
            <span className="text-slate-600">Delayed/Overdue</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-auto">
        <div className="min-w-[600px]">
          {/* Header row (Months) */}
          <div className="flex border-b border-slate-200 pb-2 mb-4 ml-40 relative">
            {chartData.months.map((m, i) => (
              <div key={i} className="flex-1 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">
                {m.label}
              </div>
            ))}
            
            {/* Grid lines */}
            <div className="absolute inset-0 flex top-full h-[300px] pointer-events-none opacity-20">
              {chartData.months.map((_, i) => (
                <div key={i} className="flex-1 border-l border-slate-300"></div>
              ))}
            </div>
          </div>

          {/* Project Rows */}
          <div className="space-y-4 relative z-10 pb-4">
            {chartData.activeProjects.length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-400">
                No active projects found in the 6-month window.
              </div>
            ) : (
              chartData.activeProjects.map(project => (
                <div key={project.id} className="flex items-center group relative">
                  {/* Label */}
                  <div className="w-40 shrink-0 pr-4 text-right">
                    <p className="text-xs font-bold text-slate-800 truncate" title={project.name}>{project.name}</p>
                    <p className="text-[10px] text-slate-400 truncate">{project.code}</p>
                  </div>
                  
                  {/* Track line */}
                  <div className="flex-1 relative h-6 bg-slate-50 rounded-full">
                    {/* Bar */}
                    <div 
                      className="absolute top-0 bottom-0 rounded-full shadow-sm flex items-center justify-center overflow-hidden transition-all duration-300 group-hover:brightness-110"
                      style={{ 
                        left: `${project.left}%`, 
                        width: `${project.width}%`,
                        backgroundColor: project.color
                      }}
                      title={`${project.name} (${project.startStr} to ${project.endStr})`}
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
