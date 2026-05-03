'use client';

import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useData } from '@/context/DataContext';
import { MapPin } from 'lucide-react';

const LOCATION_COLORS = [
  { bg: '#6366f1', light: '#eef2ff', text: '#4338ca' },
  { bg: '#0ea5e9', light: '#e0f2fe', text: '#0369a1' },
  { bg: '#10b981', light: '#d1fae5', text: '#065f46' },
  { bg: '#f59e0b', light: '#fef3c7', text: '#92400e' },
  { bg: '#ec4899', light: '#fce7f3', text: '#9d174d' },
  { bg: '#8b5cf6', light: '#ede9fe', text: '#6d28d9' },
  { bg: '#06b6d4', light: '#cffafe', text: '#155e75' },
  { bg: '#ef4444', light: '#fee2e2', text: '#991b1b' },
];

const LABEL_WIDTH = 160;
const ROW_HEIGHT = 36;
const BAR_HEIGHT = 20;
const BAR_OFFSET = (ROW_HEIGHT - BAR_HEIGHT) / 2; // vertical center of bar within row

export default function ShipProjectGanttChart() {
  const { projects } = useData();
  const [viewMode, setViewMode] = useState<'daily' | 'weekly' | 'monthly'>('monthly');
  const [hoveredProject, setHoveredProject] = useState<any>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [collapsedLocations, setCollapsedLocations] = useState<Set<string>>(new Set());
  const [selectedLocations, setSelectedLocations] = useState<Set<string>>(new Set(['__ALL__']));

  // Measure track width for SVG pixel calculations
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(600);
  useEffect(() => {
    if (!trackRef.current) return;
    const ro = new ResizeObserver(entries => {
      setTrackWidth(entries[0].contentRect.width);
    });
    ro.observe(trackRef.current);
    return () => ro.disconnect();
  }, []);

  const toggleLocation = (loc: string) => {
    setCollapsedLocations(prev => {
      const next = new Set(prev);
      if (next.has(loc)) next.delete(loc); else next.add(loc);
      return next;
    });
  };

  const toggleLocationFilter = (loc: string) => {
    if (loc === '__ALL__') {
      setSelectedLocations(new Set(['__ALL__']));
      return;
    }
    setSelectedLocations(prev => {
      const next = new Set(prev);
      next.delete('__ALL__');
      if (next.has(loc)) {
        next.delete(loc);
        if (next.size === 0) return new Set(['__ALL__']);
      } else {
        next.add(loc);
      }
      return next;
    });
  };;

  const chartData = useMemo(() => {
    const headers: { label: string; labelSecondary?: string; date: Date }[] = [];
    let windowStart = 0, windowEnd = 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);

    if (viewMode === 'monthly') {
      const cy = today.getFullYear(), cm = today.getMonth();
      for (let i = -6; i <= 6; i++) {
        const d = new Date(cy, cm + i, 1);
        headers.push({ label: d.toLocaleString('default', { month: 'short', year: '2-digit' }), date: d });
      }
      windowStart = headers[0].date.getTime();
      windowEnd = new Date(cy, cm + 7, 0, 23, 59, 59).getTime();
    } else if (viewMode === 'weekly') {
      const day = today.getDay();
      const sow = new Date(today); sow.setDate(today.getDate() - day + (day === 0 ? -6 : 1));
      const getWeek = (d: Date) => {
        const u = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const dn = u.getUTCDay() || 7; u.setUTCDate(u.getUTCDate() + 4 - dn);
        const ys = new Date(Date.UTC(u.getUTCFullYear(), 0, 1));
        return Math.ceil((((u.getTime() - ys.getTime()) / 86400000) + 1) / 7);
      };
      for (let i = -6; i <= 6; i++) {
        const d = new Date(sow); d.setDate(sow.getDate() + i * 7);
        headers.push({ label: 'W' + getWeek(d) + (i === 0 ? ' (Now)' : ''), labelSecondary: d.getDate() + ' ' + d.toLocaleString('default', { month: 'short' }), date: d });
      }
      windowStart = headers[0].date.getTime();
      const lw = headers[headers.length - 1].date;
      windowEnd = new Date(lw.getFullYear(), lw.getMonth(), lw.getDate() + 6, 23, 59, 59).getTime();
    } else {
      for (let i = -15; i <= 15; i++) {
        const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i);
        headers.push({ label: d.getDate().toString(), labelSecondary: d.toLocaleString('default', { month: 'short' }), date: d });
      }
      windowStart = headers[0].date.getTime();
      const ld = headers[headers.length - 1].date;
      windowEnd = new Date(ld.getFullYear(), ld.getMonth(), ld.getDate(), 23, 59, 59).getTime();
    }

    const totalDuration = windowEnd - windowStart;
    const todayPct = Math.max(0, Math.min(100, ((today.getTime() - windowStart) / totalDuration) * 100));

    const activeProjects = projects.filter(p => {
      const s = p.status?.toLowerCase() || '';
      if (!['active', 'in progress', 'on going', 'ongoing'].includes(s)) return false;
      const sd = p.est_start || p.actual_start;
      const ed = p.est_finish || p.actual_finish;
      if (!sd || !ed) return false;
      return new Date(sd).getTime() <= windowEnd && new Date(ed).getTime() >= windowStart;
    });

    const mapped = activeProjects.map(p => {
      const sd = p.est_start || p.actual_start!;
      const ed = p.est_finish || p.actual_finish!;
      const startMs = new Date(sd).getTime();
      const endMs = new Date(ed).getTime();
      const clampedStart = Math.max(startMs, windowStart);
      const clampedEnd = Math.min(endMs, windowEnd);
      const left = Math.max(0, ((clampedStart - windowStart) / totalDuration) * 100);
      const width = Math.max(0.5, ((clampedEnd - clampedStart) / totalDuration) * 100);
      return {
        id: p.id, name: p.shipname || p.idproject, code: p.idproject,
        location: p.location || '(No Location)', dockingType: p.docking_type || '',
        startDateStr: sd, endDateStr: ed, startMs, endMs,
        left, width, isDelayed: Date.now() > endMs,
      };
    });

    const grouped: Record<string, typeof mapped> = {};
    mapped.forEach(p => {
      if (!grouped[p.location]) grouped[p.location] = [];
      grouped[p.location].push(p);
    });
    Object.keys(grouped).forEach(loc => grouped[loc].sort((a, b) => a.startMs - b.startMs));

    // Sort: named locations first alphabetically, (No Location) last
    const sortedLocations = Object.keys(grouped).sort((a, b) => {
      if (a === '(No Location)') return 1;
      if (b === '(No Location)') return -1;
      return a.localeCompare(b);
    });

    return { headers, grouped, sortedLocations, todayPct, totalDuration };
  }, [projects, viewMode]);

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-full flex flex-col">
      {/* Title & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5 shrink-0">
        <div>
          <h3 className="font-display font-bold text-slate-800">Active Job Orders — by Location</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">Grouped by dock · sorted by start date</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex bg-slate-100 p-1 rounded-lg">
            {(['daily', 'weekly', 'monthly'] as const).map(m => (
              <button key={m} onClick={() => setViewMode(m)}
                className={'px-3 py-1.5 rounded-md capitalize transition-colors ' + (viewMode === m ? 'bg-white shadow-sm font-bold text-slate-800' : 'text-slate-500 hover:text-slate-700')}>
                {m}
              </button>
            ))}
          </div>
          <div className="hidden sm:flex items-center gap-3 font-medium">
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-sky-500" /><span className="text-slate-600">On Track</span></div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-red-500" /><span className="text-slate-600">Delayed</span></div>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 overflow-auto">
        <div style={{ minWidth: 800 }}>

          {/* Column headers */}
          <div className="flex border-b border-slate-100 pb-2 mb-3 sticky top-0 bg-white z-20" style={{ paddingLeft: LABEL_WIDTH }}>
            {chartData.headers.map((h, i) => (
              <div key={i} className="flex-1 text-center">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">{h.label}</span>
                {h.labelSecondary && <span className="text-[9px] text-slate-400">{h.labelSecondary}</span>}
              </div>
            ))}
          </div>

          {/* Location filter chips */}
          {chartData.sortedLocations.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3 shrink-0">
              <button
                onClick={() => toggleLocationFilter('__ALL__')}
                className={'px-3 py-1 rounded-full text-[10px] font-bold border transition-all ' +
                  (selectedLocations.has('__ALL__')
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400')}
              >
                All Locations
              </button>
              {chartData.sortedLocations.filter(l => l !== '(No Location)').map((loc, locIdx) => {
                const color = LOCATION_COLORS[locIdx % LOCATION_COLORS.length];
                const isActive = !selectedLocations.has('__ALL__') && selectedLocations.has(loc);
                return (
                  <button
                    key={loc}
                    onClick={() => toggleLocationFilter(loc)}
                    className={'px-3 py-1 rounded-full text-[10px] font-bold border transition-all'}
                    style={isActive
                      ? { backgroundColor: color.bg, color: '#fff', borderColor: color.bg }
                      : { backgroundColor: color.light, color: color.text, borderColor: color.light }}
                  >
                    {loc}
                  </button>
                );
              })}
              {chartData.sortedLocations.includes('(No Location)') && (
                <button
                  onClick={() => toggleLocationFilter('(No Location)')}
                  className={'px-3 py-1 rounded-full text-[10px] font-bold border transition-all ' +
                    (!selectedLocations.has('__ALL__') && selectedLocations.has('(No Location)')
                      ? 'bg-slate-600 text-white border-slate-600'
                      : 'bg-slate-100 text-slate-500 border-slate-100 hover:border-slate-300')}
                >
                  (No Location)
                </button>
              )}
            </div>
          )}

          {chartData.sortedLocations.length === 0 ? (
            <div className="text-center py-12 text-sm text-slate-400">No active projects with dates in this time window.</div>
          ) : (
            <div className="space-y-2 pb-4">
              {chartData.sortedLocations
                .filter(loc => selectedLocations.has('__ALL__') || selectedLocations.has(loc))
                .map((location, locIdx) => {
                const color = LOCATION_COLORS[locIdx % LOCATION_COLORS.length];
                const rows = chartData.grouped[location];
                const isCollapsed = collapsedLocations.has(location);
                const totalGroupHeight = rows.length * ROW_HEIGHT;

                return (
                  <div key={location} className="rounded-xl overflow-hidden border border-slate-100">

                    {/* Location header */}
                    <button onClick={() => toggleLocation(location)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:opacity-90 transition-opacity"
                      style={{ backgroundColor: color.light }}>
                      <MapPin className="w-3.5 h-3.5 shrink-0" style={{ color: color.bg }} />
                      <span className="text-xs font-bold" style={{ color: color.text }}>{location}</span>
                      <span className="ml-1 text-[10px] font-bold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: color.bg }}>
                        {rows.length}
                      </span>
                      <span className="ml-auto text-xs" style={{ color: color.text }}>{isCollapsed ? '▸' : '▾'}</span>
                    </button>

                    {/* Rows body — single flex layout */}
                    {!isCollapsed && (
                      <div className="flex bg-white" style={{ height: totalGroupHeight }}>

                        {/* Labels column */}
                        <div style={{ width: LABEL_WIDTH, minWidth: LABEL_WIDTH }} className="shrink-0 border-r border-slate-50 relative">
                          {rows.map((project, rowIdx) => (
                            <div key={project.id}
                              className="absolute w-full flex flex-col justify-center px-3 border-b border-slate-50"
                              style={{ top: rowIdx * ROW_HEIGHT, height: ROW_HEIGHT }}>
                              <p className="text-xs font-bold text-slate-800 truncate leading-tight" title={project.name}>{project.name}</p>
                              <p className="text-[10px] text-slate-400 truncate">{project.code}</p>
                            </div>
                          ))}
                        </div>

                        {/* Track area — single container for bars + SVG */}
                        <div
                          className="flex-1 relative"
                          ref={locIdx === 0 ? trackRef : undefined}
                          style={{ height: totalGroupHeight }}
                        >
                          {/* Column grid lines */}
                          <div className="absolute inset-0 flex pointer-events-none">
                            {chartData.headers.map((_, i) => (
                              <div key={i} className="flex-1 border-l border-slate-100 first:border-l-0" />
                            ))}
                          </div>

                          {/* Row separator lines */}
                          {rows.map((_, i) => i > 0 && (
                            <div key={i} className="absolute left-0 right-0 border-t border-slate-50 pointer-events-none"
                              style={{ top: i * ROW_HEIGHT }} />
                          ))}

                          {/* Today line */}
                          <div
                            className="absolute top-0 bottom-0 w-0.5 bg-orange-400 opacity-70 pointer-events-none z-10"
                            style={{ left: chartData.todayPct + '%' }}
                          />

                          {/* Bars (absolute positioned) */}
                          {rows.map((project, rowIdx) => (
                            <div
                              key={project.id}
                              className="absolute rounded-md shadow-sm cursor-pointer transition-all duration-150 hover:brightness-110 flex items-center justify-center overflow-hidden z-30"
                              style={{
                                left: project.left + '%',
                                width: Math.max(project.width, 0.8) + '%',
                                top: rowIdx * ROW_HEIGHT + BAR_OFFSET,
                                height: BAR_HEIGHT,
                                backgroundColor: project.isDelayed ? '#ef4444' : color.bg,
                                minWidth: 8,
                              }}
                              onMouseEnter={(e) => {
                                setHoveredProject({ ...project, color: project.isDelayed ? '#ef4444' : color.bg, location });
                                setMousePos({ x: e.clientX, y: e.clientY });
                              }}
                              onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
                              onMouseLeave={() => setHoveredProject(null)}
                            >
                              <span className="text-[9px] font-bold text-white/90 px-1.5 truncate select-none">{project.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Hover Tooltip */}
      {hoveredProject && (
        <div
          className="fixed z-[100] bg-slate-900 text-white p-4 rounded-2xl shadow-2xl pointer-events-none min-w-[260px]"
          style={{ left: mousePos.x, top: mousePos.y, transform: 'translate(-50%, calc(-100% - 16px))' }}
        >
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-slate-900 rotate-45" />
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">{hoveredProject.code}</p>
          <p className="font-display font-bold text-base leading-tight mb-1">{hoveredProject.name}</p>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-3">
            <MapPin className="w-3 h-3" /><span>{hoveredProject.location}</span>
          </div>
          <div className="space-y-1.5 bg-white/10 rounded-xl p-3">
            {hoveredProject.dockingType && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Type:</span>
                <span className="font-medium text-sky-300">{hoveredProject.dockingType}</span>
              </div>
            )}
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Start:</span>
              <span className="font-medium text-amber-300">{hoveredProject.startDateStr}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Finish:</span>
              <span className="font-medium text-amber-300">{hoveredProject.endDateStr}</span>
            </div>
            <div className="flex justify-between text-xs">
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
