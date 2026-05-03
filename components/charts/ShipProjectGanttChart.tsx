'use client';

import React, { useMemo, useState, useRef } from 'react';
import { useData } from '@/context/DataContext';
import { MapPin } from 'lucide-react';

// Color palette for locations
const LOCATION_COLORS = [
  { bg: '#0ea5e9', light: '#e0f2fe', text: '#0369a1' },
  { bg: '#8b5cf6', light: '#ede9fe', text: '#6d28d9' },
  { bg: '#10b981', light: '#d1fae5', text: '#065f46' },
  { bg: '#f59e0b', light: '#fef3c7', text: '#92400e' },
  { bg: '#ec4899', light: '#fce7f3', text: '#9d174d' },
  { bg: '#06b6d4', light: '#cffafe', text: '#155e75' },
  { bg: '#ef4444', light: '#fee2e2', text: '#991b1b' },
  { bg: '#6366f1', light: '#e0e7ff', text: '#3730a3' },
];

export default function ShipProjectGanttChart() {
  const { projects } = useData();
  const [viewMode, setViewMode] = useState<'daily' | 'weekly' | 'monthly'>('monthly');
  const [hoveredProject, setHoveredProject] = useState<any>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [collapsedLocations, setCollapsedLocations] = useState<Set<string>>(new Set());

  const toggleLocation = (loc: string) => {
    setCollapsedLocations(prev => {
      const next = new Set(prev);
      if (next.has(loc)) next.delete(loc);
      else next.add(loc);
      return next;
    });
  };

  const chartData = useMemo(() => {
    const headers: { label: string; labelSecondary?: string; date: Date }[] = [];
    let windowStart = 0;
    let windowEnd = 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (viewMode === 'monthly') {
      const currentYear = today.getFullYear();
      const currentMonth = today.getMonth();
      for (let i = -6; i <= 6; i++) {
        const d = new Date(currentYear, currentMonth + i, 1);
        headers.push({ label: d.toLocaleString('default', { month: 'short', year: '2-digit' }), date: d });
      }
      windowStart = headers[0].date.getTime();
      windowEnd = new Date(currentYear, currentMonth + 7, 0, 23, 59, 59).getTime();
    } else if (viewMode === 'weekly') {
      const day = today.getDay();
      const diff = today.getDate() - day + (day === 0 ? -6 : 1);
      const startOfWeek = new Date(new Date().setDate(diff));
      const getWeek = (date: Date) => {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
      };
      for (let i = -6; i <= 6; i++) {
        const d = new Date(startOfWeek);
        d.setDate(d.getDate() + (i * 7));
        headers.push({
          label: 'W' + getWeek(d) + (i === 0 ? ' (Now)' : ''),
          labelSecondary: d.getDate() + ' ' + d.toLocaleString('default', { month: 'short' }),
          date: d,
        });
      }
      windowStart = headers[0].date.getTime();
      const lastWeek = headers[headers.length - 1].date;
      windowEnd = new Date(lastWeek.getFullYear(), lastWeek.getMonth(), lastWeek.getDate() + 6, 23, 59, 59).getTime();
    } else {
      for (let i = -15; i <= 15; i++) {
        const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i);
        headers.push({ label: d.getDate().toString(), labelSecondary: d.toLocaleString('default', { month: 'short' }), date: d });
      }
      windowStart = headers[0].date.getTime();
      const lastDay = headers[headers.length - 1].date;
      windowEnd = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate(), 23, 59, 59).getTime();
    }

    const totalDuration = windowEnd - windowStart;

    // Filter active projects
    const activeProjects = projects.filter(p => {
      const s = p.status?.toLowerCase() || '';
      const isActive = s === 'active' || s === 'in progress' || s === 'on going' || s === 'ongoing';
      if (!isActive) return false;
      const startDateStr = p.est_start || p.actual_start;
      const endDateStr = p.est_finish || p.actual_finish;
      if (!startDateStr || !endDateStr) return false;
      const start = new Date(startDateStr).getTime();
      const end = new Date(endDateStr).getTime();
      return start <= windowEnd && end >= windowStart;
    });

    // Map to chart items with position
    const mappedProjects = activeProjects.map(p => {
      const startDateStr = p.est_start || p.actual_start!;
      const endDateStr = p.est_finish || p.actual_finish!;
      const start = new Date(startDateStr).getTime();
      const end = new Date(endDateStr).getTime();
      const clampedStart = Math.max(start, windowStart);
      const clampedEnd = Math.min(end, windowEnd);
      const leftPercent = ((clampedStart - windowStart) / totalDuration) * 100;
      const widthPercent = ((clampedEnd - clampedStart) / totalDuration) * 100;
      const isDelayed = Date.now() > end;

      return {
        id: p.id,
        name: p.shipname || p.idproject,
        code: p.idproject,
        location: p.location || '(No Location)',
        dockingType: p.docking_type || '',
        status: p.status || '',
        startDateStr,
        endDateStr,
        startMs: start,
        endMs: end,
        left: Math.max(0, leftPercent),
        width: Math.max(0.5, widthPercent),
        isDelayed,
        create_date: p.create_date,
      };
    });

    // Group by location, sort within each location by startMs (predecessor order)
    const grouped: Record<string, typeof mappedProjects> = {};
    mappedProjects.forEach(p => {
      if (!grouped[p.location]) grouped[p.location] = [];
      grouped[p.location].push(p);
    });
    Object.keys(grouped).forEach(loc => {
      grouped[loc].sort((a, b) => a.startMs - b.startMs);
    });

    const sortedLocations = Object.keys(grouped).sort();

    return { headers, grouped, sortedLocations };
  }, [projects, viewMode]);

  const LABEL_WIDTH = 160; // px

  const getTitle = () => {
    if (viewMode === 'monthly') return 'Active Job Orders by Location';
    if (viewMode === 'weekly') return 'Active Job Orders by Location (Weekly)';
    return 'Active Job Orders by Location (Daily)';
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-full flex flex-col">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5 shrink-0">
        <div>
          <h3 className="font-display font-bold text-slate-800">{getTitle()}</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">Grouped by dock location · Predecessor order within each location</p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs font-medium">
          <div className="flex bg-slate-100 p-1 rounded-lg">
            {(['daily', 'weekly', 'monthly'] as const).map(m => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={'px-3 py-1.5 rounded-md capitalize transition-colors ' + (viewMode === m ? 'bg-white shadow-sm font-bold text-slate-800' : 'text-slate-500 hover:text-slate-700')}
              >{m}</button>
            ))}
          </div>
          <div className="hidden sm:flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-sky-500"></div>
              <span className="text-slate-600">On Track</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-red-500"></div>
              <span className="text-slate-600">Delayed</span>
            </div>
          </div>
        </div>
      </div>

      {/* Chart body */}
      <div className="flex-1 overflow-auto">
        <div style={{ minWidth: 800 }}>
          {/* Time headers */}
          <div className="flex border-b border-slate-200 pb-2 mb-3 sticky top-0 bg-white z-20" style={{ paddingLeft: LABEL_WIDTH }}>
            {chartData.headers.map((h, i) => (
              <div key={i} className="flex-1 text-center flex flex-col justify-end">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{h.label}</span>
                {h.labelSecondary && <span className="text-[9px] text-slate-400 mt-0.5">{h.labelSecondary}</span>}
              </div>
            ))}
          </div>

          {/* Grid lines + rows */}
          {chartData.sortedLocations.length === 0 ? (
            <div className="text-center py-12 text-sm text-slate-400">
              No active projects with dates found in this time window.
            </div>
          ) : (
            <div className="space-y-2 pb-4">
              {chartData.sortedLocations.map((location, locIdx) => {
                const color = LOCATION_COLORS[locIdx % LOCATION_COLORS.length];
                const rows = chartData.grouped[location];
                const isCollapsed = collapsedLocations.has(location);

                return (
                  <div key={location} className="rounded-xl overflow-hidden border border-slate-100">
                    {/* Location header */}
                    <button
                      onClick={() => toggleLocation(location)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:brightness-95"
                      style={{ backgroundColor: color.light }}
                    >
                      <MapPin className="w-3.5 h-3.5 shrink-0" style={{ color: color.bg }} />
                      <span className="text-xs font-bold" style={{ color: color.text }}>{location}</span>
                      <span className="ml-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: color.bg, color: '#fff' }}>
                        {rows.length} job{rows.length !== 1 ? 's' : ''}
                      </span>
                      <span className="ml-auto text-[10px]" style={{ color: color.text }}>{isCollapsed ? '▸' : '▾'}</span>
                    </button>

                    {/* Rows */}
                    {!isCollapsed && (
                      <div className="bg-white relative">
                        {/* Grid lines behind bars */}
                        <div className="absolute inset-0 flex opacity-10 pointer-events-none" style={{ left: LABEL_WIDTH }}>
                          {chartData.headers.map((_, i) => (
                            <div key={i} className="flex-1 border-l border-slate-400"></div>
                          ))}
                        </div>

                        {rows.map((project, rowIdx) => (
                          <div key={project.id} className="flex items-center px-2 py-1.5 hover:bg-slate-50/80 relative group">
                            {/* Label */}
                            <div style={{ width: LABEL_WIDTH, minWidth: LABEL_WIDTH }} className="shrink-0 pr-3 text-right">
                              <p className="text-xs font-bold text-slate-800 truncate leading-tight" title={project.name}>{project.name}</p>
                              <p className="text-[10px] text-slate-400 truncate">{project.code}</p>
                            </div>

                            {/* Bar track */}
                            <div className="flex-1 relative" style={{ height: 24 }}>
                              {/* Predecessor connector line */}
                              {rowIdx > 0 && (() => {
                                const prev = rows[rowIdx - 1];
                                // Draw connector from prev bar end to current bar start
                                const connectorLeft = prev.left + prev.width;
                                const connectorWidth = Math.max(0, project.left - connectorLeft);
                                if (connectorWidth <= 0) return null;
                                return (
                                  <div
                                    className="absolute top-1/2 -translate-y-1/2 h-0.5 opacity-30 rounded-full"
                                    style={{
                                      left: connectorLeft + '%',
                                      width: connectorWidth + '%',
                                      backgroundColor: color.bg,
                                    }}
                                  >
                                    {/* Arrow head */}
                                    <div
                                      className="absolute right-0 top-1/2 -translate-y-1/2 w-0 h-0"
                                      style={{
                                        borderTop: '4px solid transparent',
                                        borderBottom: '4px solid transparent',
                                        borderLeft: '6px solid ' + color.bg,
                                        opacity: 0.5
                                      }}
                                    />
                                  </div>
                                );
                              })()}

                              {/* Today line */}
                              <div className="absolute top-0 bottom-0 w-px bg-orange-400 opacity-60 z-10 pointer-events-none"
                                style={{ left: ((() => {
                                  const today = new Date(); today.setHours(0,0,0,0);
                                  // recalculate today position
                                  const wStart = chartData.headers[0].date.getTime();
                                  const wEnd = chartData.headers[chartData.headers.length - 1].date.getTime() + (viewMode === 'monthly' ? 30 * 86400000 : viewMode === 'weekly' ? 6 * 86400000 : 86400000);
                                  const pct = ((today.getTime() - wStart) / (wEnd - wStart)) * 100;
                                  return Math.max(0, Math.min(100, pct));
                                })()) + '%' }}
                              />

                              {/* Bar */}
                              <div
                                className="absolute top-0.5 bottom-0.5 rounded-full shadow-sm cursor-pointer transition-all duration-200 group-hover:brightness-110 flex items-center justify-center overflow-hidden"
                                style={{
                                  left: project.left + '%',
                                  width: project.width + '%',
                                  backgroundColor: project.isDelayed ? '#ef4444' : color.bg,
                                  minWidth: 6,
                                }}
                                onMouseEnter={(e) => { setHoveredProject({...project, color: project.isDelayed ? '#ef4444' : color.bg, location }); setMousePos({ x: e.clientX, y: e.clientY }); }}
                                onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
                                onMouseLeave={() => setHoveredProject(null)}
                              >
                                <span className="text-[9px] font-bold text-white/90 px-1 truncate select-none">{project.name}</span>
                              </div>

                              {/* Predecessor badge */}
                              {rowIdx > 0 && (
                                <div
                                  className="absolute -top-1 text-[8px] font-bold px-1 rounded"
                                  style={{ left: project.left + '%', transform: 'translateX(-50%)', backgroundColor: color.light, color: color.text }}
                                >
                                  ►
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Floating Tooltip */}
      {hoveredProject && (
        <div
          className="fixed z-[100] bg-slate-900 text-white p-4 rounded-2xl shadow-2xl pointer-events-none min-w-[260px]"
          style={{ left: mousePos.x, top: mousePos.y, transform: 'translate(-50%, calc(-100% - 16px))' }}
        >
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-slate-900 rotate-45"></div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">{hoveredProject.code}</p>
          <p className="font-display font-bold text-base leading-tight mb-1">{hoveredProject.name}</p>
          {hoveredProject.location && (
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-3">
              <MapPin className="w-3 h-3" />
              <span>{hoveredProject.location}</span>
            </div>
          )}
          <div className="space-y-1.5 bg-white/10 rounded-xl p-3">
            {hoveredProject.dockingType && (
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-400">Type:</span>
                <span className="font-medium text-sky-300">{hoveredProject.dockingType}</span>
              </div>
            )}
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">Start:</span>
              <span className="font-medium text-amber-300">{hoveredProject.startDateStr}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">Finish:</span>
              <span className="font-medium text-amber-300">{hoveredProject.endDateStr}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">Status:</span>
              <span className={'font-bold ' + (hoveredProject.isDelayed ? 'text-red-400' : 'text-emerald-400')}>
                {hoveredProject.isDelayed ? '⚠ Delayed' : '✓ On Track'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
