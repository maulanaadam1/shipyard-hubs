import React, { useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { FileSpreadsheet, Table2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { ChartSpec, chartTable, formatShort, formatValue } from '@/lib/ai-chart';

// A chart from an AI Asisten answer (see lib/ai-chart.ts). Categorical hues in
// a fixed order, validated for colour-blind separation on white; three of
// them are under 3:1 contrast, so every chart has a data table one click away.
// Thin marks, recessive grid, one y-axis, hover tooltip with full values.

const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
const INK = '#475569'; // slate-600, axis text
const GRID = '#e2e8f0'; // slate-200

const toggle = 'inline-flex items-center gap-1 min-h-11 px-1 text-xs font-medium text-slate-600 hover:text-slate-900 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';

function downloadChart(spec: ChartSpec) {
  const { header, rows } = chartTable(spec);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows]), 'Data');
  XLSX.writeFile(wb, `ai-asisten-grafik-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// useNarrow: phone-width screens get shorter category labels and fewer ticks.
function useNarrow() {
  const query = '(max-width: 640px)';
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

export default function AIChart({ spec }: { spec: ChartSpec }) {
  const [showTable, setShowTable] = useState(false);
  const narrow = useNarrow();
  const data = spec.x.map((label, i) => {
    const row: Record<string, string | number | null> = { label };
    spec.series.forEach((s, j) => { row[`s${j}`] = s.values[i]; });
    return row;
  });
  const multi = spec.series.length > 1;
  const horizontal = spec.type === 'horizontal_bar';
  const stacked = spec.type === 'stacked_bar';
  // Narrow screens wrap long category labels onto more lines, so rows get taller.
  const height = horizontal ? Math.max(180, spec.x.length * (narrow ? 46 : 30) + 60) : 260;
  const short = (v: number) => formatShort(v, spec.unit);

  // Tooltip text stays in ink colours; a swatch beside each value carries
  // the series identity.
  const tooltip = (
    <Tooltip
      cursor={spec.type === 'line' ? { stroke: '#94a3b8', strokeWidth: 1 } : { fill: '#f1f5f9' }}
      content={({ active, label, payload }: any) => {
        if (!active || !payload?.length) return null;
        return (
          <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs shadow-sm">
            <p className="font-semibold text-slate-900 mb-1">{label}</p>
            {payload.map((p: any) => {
              const idx = Number(String(p.dataKey).slice(1));
              return (
                <p key={p.dataKey} className="flex items-center gap-1.5 text-slate-700">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: SERIES_COLORS[idx] }} aria-hidden="true" />
                  <span>{spec.series[idx]?.name}</span>
                  <span className="ml-auto pl-3 font-medium text-slate-900 tabular-nums">{formatValue(p.value ?? null, spec.unit)}</span>
                </p>
              );
            })}
          </div>
        );
      }}
    />
  );
  const legend = multi ? (
    <Legend wrapperStyle={{ fontSize: 12, color: INK }} formatter={(key: any) => spec.series[Number(String(key).slice(1))]?.name ?? key} />
  ) : null;
  const tick = { fontSize: 11, fill: INK };

  const { header, rows } = chartTable(spec);

  return (
    <figure className="flex flex-col gap-1.5 min-w-0">
      {spec.title && <figcaption className="text-sm font-semibold text-slate-900">{spec.title}</figcaption>}
      <div className="w-full" style={{ height }} role="img"
        aria-label={`${spec.title || 'Grafik'}: ${spec.series.map(s => s.name).join(', ')}. Data lengkap ada di tabel di bawah grafik.`}>
        <ResponsiveContainer width="100%" height="100%">
          {spec.type === 'line' ? (
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={12} />
              <YAxis tick={tick} tickLine={false} axisLine={false} tickFormatter={short} width={72} />
              {tooltip}
              {legend}
              {spec.series.map((s, j) => (
                // Straight segments: a smoothed curve suggests values between points.
                <Line key={j} type="linear" dataKey={`s${j}`} name={`s${j}`} stroke={SERIES_COLORS[j]} strokeWidth={2}
                  dot={{ r: 4, strokeWidth: 2, stroke: '#ffffff', fill: SERIES_COLORS[j] }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
              ))}
            </LineChart>
          ) : (
            <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} barCategoryGap="20%"
              margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={GRID} vertical={horizontal} horizontal={!horizontal} />
              {horizontal ? (
                <>
                  <XAxis type="number" tick={tick} tickLine={false} axisLine={false} tickFormatter={short} tickCount={narrow ? 3 : 5} />
                  <YAxis type="category" dataKey="label" tick={tick} tickLine={false} axisLine={{ stroke: GRID }} width={narrow ? 96 : 140} interval={0} />
                </>
              ) : (
                <>
                  <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={8} />
                  <YAxis tick={tick} tickLine={false} axisLine={false} tickFormatter={short} width={72} />
                </>
              )}
              {tooltip}
              {legend}
              {spec.series.map((s, j) => {
                // Rounded data end only on the outermost segment of a stack.
                const end = !stacked || j === spec.series.length - 1;
                const radius: [number, number, number, number] = end ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : [0, 0, 0, 0];
                return (
                  <Bar key={j} dataKey={`s${j}`} name={`s${j}`} fill={SERIES_COLORS[j]} stackId={stacked ? 'a' : undefined}
                    radius={radius} maxBarSize={36} stroke="#ffffff" strokeWidth={stacked || multi ? 1 : 0} isAnimationActive={false} />
                );
              })}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center gap-x-3">
        <button type="button" className={toggle} aria-expanded={showTable} onClick={() => setShowTable(v => !v)}>
          <Table2 size={13} aria-hidden="true" /> {showTable ? 'Sembunyikan tabel' : 'Lihat tabel'}
        </button>
        <button type="button" className={toggle} onClick={() => downloadChart(spec)}>
          <FileSpreadsheet size={13} aria-hidden="true" /> Unduh data (Excel)
        </button>
      </div>
      {showTable && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>{header.map((h, j) => <th key={j} scope="col" className="px-2.5 py-1.5 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, j) => (
                <tr key={j}>
                  {r.map((c, k) => (
                    <td key={k} className={`px-2.5 py-1.5 ${k > 0 ? 'text-right tabular-nums whitespace-nowrap' : ''}`}>
                      {k === 0 ? c : formatValue(c === '' ? null : Number(c), spec.unit)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}
