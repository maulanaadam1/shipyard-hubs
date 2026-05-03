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

// SVG connector between rows within a location group
function PredecessorConnectors({
  rows,
  color,
  trackWidth,
}: {
  rows: any[];
  color: (typeof LOCATION_COLORS)[0];
  trackWidth: number;
}) {
  if (rows.length < 2 || trackWidth === 0) return null;

  const paths: React.ReactNode[] = [];

  for (let i = 0; i < rows.length - 1; i++) {
    const curr = rows[i];
    const next = rows[i + 1];

    const currEndX = (curr.left + curr.width) / 100 * trackWidth;
    const nextStartX = next.left / 100 * trackWidth;

    const currCenterY = i * ROW_HEIGHT + ROW_HEIGHT / 2;
    const nextCenterY = (i + 1) * ROW_HEIGHT + ROW_HEIGHT / 2;

    // Only draw when bars don't completely overlap in time
    if (nextStartX <= 0) continue;

    const bendX = Math.max(currEndX + 10, nextStartX - 2);

    // L-shaped path: right → down → right to bar start
    const d = `M ${currEndX} ${currCenterY} L ${bendX} ${currCenterY} L ${bendX} ${nextCenterY} L ${nextStartX} ${nextCenterY}`;

    paths.push(
      <g key={i}>
        <path
          d={d}
          fill="none"
          stroke={color.bg}
          strokeWidth={1.5}
          strokeDasharray="4 2"
          opacity={0.6}
        />
        {/* Arrowhead */}
        <polygon
          points={`${nextStartX},${nextCenterY} ${nextStartX - 7},${nextCenterY - 4} ${nextStartX - 7},${nextCenterY + 4}`}
          fill={color.bg}
          opacity={0.7}
        />
      </g>
    );
  }

  const totalHeight = rows.length * ROW_HEIGHT;

  return (
    <svg
      className="absolute pointer-events-none"
      style={{ left: 0, top: 0, width: trackWidth, height: totalHeight, overflow: 'visible', zIndex: 5 }}
      viewBox={`0 0 ${trackWidth} ${totalHeight}`}
    >
      <defs>
        <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill={color.bg} opacity="0.7" />
        </marker>
      </defs>
      {paths}
    </svg>
  );
}

export default function ShipProjectGanttChart() {
  const { projects } = useData();
  const [viewMode, setViewMode] = useState<'daily' | 'weekly' | 'monthly'>('monthly');
  const [hoveredProject, setHoveredProject] = useState<any>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [collapsedLocations, setCollapsedLocations] = useState<Set<string>>(new Set());

  // Measure track width for SVG connector drawing
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);
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

  const chartData = useMemo(() => {
    const headers: { label: string; labelSecondary?: string; date: Date }[] = [];
    let windowStart = 0;
    let windowEnd = 0;
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

    const activeProjects = projects.filter(p => {
      const s = p.status?.toLowerCase() || '';
      if (!['active','in progress','on going','ongoing'].includes(s)) return false;
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
        left, width, isDelayed: Date.now() > endMs, create_date: p.create_date,
      };
    });

    // Group by location, sort within group by startMs (predecessor order)
    const grouped: Record<string, typeof mapped> = {};
    mapped.forEach(p => {
      if (!grouped[p.location]) grouped[p.location] = [];
      grouped[p.location].push(p);
    });
    Object.keys(grouped).forEach(loc => grouped[loc].sort((a, b) => a.startMs - b.startMs));

    // Today line position (%)
    const todayPct = Math.max(0, Math.min(100, ((today.getTime() - windowStart) / totalDuration) * 100));

    return { headers, grouped, sortedLocations: Object.keys(grouped).sort(), todayPct };
  }, [projects, viewMode]);

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-full flex flex-col">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5 shrink-0">
        <div>
          <h3 className="font-display font-bold text-slate-800">Active Job Orders — by Location</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">Predecessor order within each location · Dashed lines show dependencies</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex bg-slate-100 p-1 rounded-lg">
            {(['daily','weekly','monthly'] as const).map(m => (
              <button key={m} onClick={() => setViewMode(m)}
                className={'px-3 py-1.5 rounded-md capitalize transition-colors ' + (viewMode === m ? 'bg-white shadow-sm font-bold text-slate-800' : 'text-slate-500 hover:text-slate-700')}>
                {m}
              </button>
            ))}
          </div>
          <div className="hidden sm:flex items-center gap-3 font-medium">
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-sky-500" /><span className="text-slate-600">On Track</span></div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-red-500" /><span className="text-slate-600">Delayed</span></div>
            <div className="flex items-center gap-1.5"><div className="w-8 border-t-2 border-dashed border-slate-400" /><span className="text-slate-600">Dependency</span></div>
          </div>
        </div>
      </div>

      {/* Chart body */}
      <div className="flex-1 overflow-auto">
        <div style={{ minWidth: 800 }}>

          {/* Time column headers */}
          <div className="flex border-b border-slate-100 pb-2 mb-3 sticky top-0 bg-white z-20" style={{ paddingLeft: LABEL_WIDTH }}>
            {chartData.headers.map((h, i) => (
              <div key={i} className="flex-1 text-center flex flex-col justify-end">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{h.label}</span>
                {h.labelSecondary && <span className="text-[9px] text-slate-400 mt-0.5">{h.labelSecondary}</span>}
              </div>
            ))}
          </div>

          {chartData.sortedLocations.length === 0 ? (
            <div className="text-center py-12 text-sm text-slate-400">No active projects with dates in this time window.</div>
          ) : (
            <div className="space-y-2 pb-4">
              {chartData.sortedLocations.map((location, locIdx) => {
                const color = LOCATION_COLORS[locIdx % LOCATION_COLORS.length];
                const rows = chartData.grouped[location];
                const isCollapsed = collapsedLocations.has(location);

                return (
                  <div key={location} className="rounded-xl overflow-hidden border border-slate-100">
                    {/* Location section header */}
                    <button onClick={() => toggleLocation(location)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:opacity-90"
                      style={{ backgroundColor: color.light }}>
                      <MapPin className="w-3.5 h-3.5 shrink-0" style={{ color: color.bg }} />
                      <span className="text-xs font-bold" style={{ color: color.text }}>{location}</span>
                      <span className="ml-1 text-[10px] font-bold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: color.bg }}>
                        {rows.length}
                      </span>
                      <span className="ml-auto text-xs" style={{ color: color.text }}>{isCollapsed ? '▸' : '▾'}</span>
                    </button>

                    {/* Job rows */}
                    {!isCollapsed && (
                      <div className="bg-white">
                        <div className="flex">
                          {/* Fixed label column */}
                          <div style={{ width: LABEL_WIDTH, minWidth: LABEL_WIDTH }} className="shrink-0 border-r border-slate-50">
                            {rows.map((project, rowIdx) => (
                              <div key={project.id} className="flex flex-col justify-center px-3 border-b border-slate-50 last:border-b-0"
                                style={{ height: ROW_HEIGHT }}>
                                <p className="text-xs font-bold text-slate-800 truncate leading-tight" title={project.name}>{project.name}</p>
                                <p className="text-[10px] text-slate-400 truncate">{project.code}</p>
                              </div>
                            ))}
                          </div>

                          {/* Track area with SVG connectors */}
                          <div className="flex-1 relative" ref={locIdx === 0 ? trackRef : undefined}>
                            {/* Grid column lines */}
                            <div className="absolute inset-0 flex pointer-events-none opacity-[0.06]">
                              {chartData.headers.map((_, i) => (
                                <div key={i} className="flex-1 border-l border-slate-500" />
                              ))}
                            </div>

                            {/* Today vertical line */}
                            <div className="absolute top-0 bottom-0 w-0.5 bg-orange-400 opacity-70 z-10 pointer-events-none"
                              style={{ left: chartData.todayPct + '%' }} />

                            {/* SVG predecessor connectors (L-shaped) */}
                            <PredecessorConnectors rows={rows} color={color} trackWidth={trackWidth} />

                            {/* Bars */}
                            {rows.map((project, rowIdx) => (
                              <div key={project.id} className="relative flex items-center border-b border-slate-50 last:border-b-0 hover:bg-slate-50/50 group"
                                style={{ height: ROW_HEIGHT }}>
                                <div
                                  className="absolute rounded-md shadow-sm cursor-pointer transition-all duration-150 group-hover:brightness-110 flex items-center justify-center overflow-hidden z-10"
                                  style={{
                                    left: project.left + '%',
                                    width: Math.max(project.width, 0.8) + '%',
                                    height: 20,
                                    backgroundColor: project.isDelayed ? '#ef4444' : color.bg,
                                    minWidth: 8,
                                  }}
                                  onMouseEnter={(e) => { setHoveredProject({ ...project, color: project.isDelayed ? '#ef4444' : color.bg, location }); setMousePos({ x: e.clientX, y: e.clientY }); }}
                                  onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
                                  onMouseLeave={() => setHoveredProject(null)}
                                >
                                  <span className="text-[9px] font-bold text-white/90 px-1.5 truncate select-none">{project.name}</span>
                                </div>
                              </div>
                            ))}
                          </div>
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
