// Charts in AI Asisten answers. The model never draws: it writes a fenced
// ```chart block with JSON data taken from its tools, and the app draws it.
// This file reads and checks that JSON and formats its numbers; a block that
// does not pass is shown as text instead of a misleading chart.

export type ChartType = 'bar' | 'horizontal_bar' | 'stacked_bar' | 'line';
export type ChartUnit = 'rupiah' | 'jam' | 'angka' | 'persen';

export type ChartSeries = { name: string; values: (number | null)[] };

export type ChartSpec = {
  type: ChartType;
  title: string;
  unit: ChartUnit;
  x: string[];
  series: ChartSeries[];
  xLabel?: string;
  yLabel?: string;
};

export const CHART_TYPES: ChartType[] = ['bar', 'horizontal_bar', 'stacked_bar', 'line'];
export const CHART_UNITS: ChartUnit[] = ['rupiah', 'jam', 'angka', 'persen'];
// More points or series than this is no longer readable as one chart.
export const MAX_POINTS = 60;
export const MAX_SERIES = 6;

export type ChartParse = { ok: true; spec: ChartSpec } | { ok: false; error: string };

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function num(v: unknown): number | null | undefined {
  if (v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// parseChartSpec reads the body of a ```chart block.
export function parseChartSpec(body: string): ChartParse {
  let raw: any;
  try {
    raw = JSON.parse(body);
  } catch {
    return { ok: false, error: 'data grafik bukan JSON yang valid' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'data grafik harus objek JSON' };

  const type = (raw.type ?? 'bar') as ChartType;
  if (!CHART_TYPES.includes(type)) return { ok: false, error: `jenis grafik "${raw.type}" tidak didukung` };
  const unit = (raw.unit ?? 'angka') as ChartUnit;
  if (!CHART_UNITS.includes(unit)) return { ok: false, error: `satuan "${raw.unit}" tidak didukung` };

  if (!Array.isArray(raw.x) || raw.x.length === 0) return { ok: false, error: 'x (label sumbu) kosong' };
  if (raw.x.length > MAX_POINTS) return { ok: false, error: `terlalu banyak titik (${raw.x.length}, maksimal ${MAX_POINTS})` };
  const x = raw.x.map((v: unknown) => (typeof v === 'number' ? String(v) : text(v, 60)));

  if (!Array.isArray(raw.series) || raw.series.length === 0) return { ok: false, error: 'series kosong' };
  if (raw.series.length > MAX_SERIES) return { ok: false, error: `terlalu banyak seri (${raw.series.length}, maksimal ${MAX_SERIES})` };
  const series: ChartSeries[] = [];
  for (const [i, s] of raw.series.entries()) {
    if (!s || !Array.isArray(s.values)) return { ok: false, error: `seri ${i + 1} tidak punya values` };
    if (s.values.length !== x.length) return { ok: false, error: `seri ${i + 1} punya ${s.values.length} nilai untuk ${x.length} label` };
    const values = s.values.map(num);
    if (values.some((v: number | null | undefined) => v === undefined)) return { ok: false, error: `seri ${i + 1} berisi nilai yang bukan angka` };
    series.push({ name: text(s.name, 60) || (raw.series.length === 1 ? text(raw.title, 60) : `Seri ${i + 1}`), values });
  }
  if (series.every(s => s.values.every(v => v === null))) return { ok: false, error: 'semua nilai kosong' };

  return {
    ok: true,
    spec: {
      type, unit, x, series,
      title: text(raw.title, 120),
      xLabel: text(raw.x_label, 60) || undefined,
      yLabel: text(raw.y_label, 60) || undefined,
    },
  };
}

const id = (n: number, digits = 0) => n.toLocaleString('id-ID', { maximumFractionDigits: digits });

// formatValue: the full number, for tooltips and the data table.
export function formatValue(n: number | null, unit: ChartUnit): string {
  if (n === null) return '-';
  switch (unit) {
    case 'rupiah': return `Rp ${id(Math.round(n))}`;
    case 'jam': return `${id(n, 1)} jam`;
    case 'persen': return `${id(n, 1)}%`;
  }
  return id(n, 2);
}

// formatShort: compact axis and label text ("Rp 1,2 M", "Rp 950 rb").
export function formatShort(n: number, unit: ChartUnit): string {
  const abs = Math.abs(n);
  const scaled = (v: number, suffix: string) => `${id(v, v < 10 ? 1 : 0)} ${suffix}`;
  let core: string;
  if (abs >= 1e12) core = scaled(n / 1e12, 'T');
  else if (abs >= 1e9) core = scaled(n / 1e9, 'M');
  else if (abs >= 1e6) core = scaled(n / 1e6, 'jt');
  else if (abs >= 1e3 && unit === 'rupiah') core = scaled(n / 1e3, 'rb');
  else core = id(n, abs < 10 ? 1 : 0);
  switch (unit) {
    case 'rupiah': return `Rp ${core}`;
    case 'persen': return `${core}%`;
    case 'jam': return core;
  }
  return core;
}

// chartTable: the chart's data as rows, for the table view and Excel.
export function chartTable(spec: ChartSpec): { header: string[]; rows: (string | number)[][] } {
  return {
    header: [spec.xLabel || 'Label', ...spec.series.map(s => s.name)],
    rows: spec.x.map((label, i) => [label, ...spec.series.map(s => s.values[i] ?? '')]),
  };
}
