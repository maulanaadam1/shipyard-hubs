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

// --- Tables to charts ---------------------------------------------------
// Any answer table with a label column and numeric columns can be shown as a
// chart, whether or not the model sent a ```chart block.

const stripMarks = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\*([^*]+)\*/g, '$1').trim();

// parseCellNumber: "Rp 1.234.567", "1.234,5", "12%", "1.107,5 jam" → number.
export function parseCellNumber(cell: string): number | null {
  const t = stripMarks(cell);
  const m = /^(?:Rp\.?\s*)?(-?[\d.]+(?:,\d+)?)\s*(?:%|jam)?$/i.exec(t);
  if (!m || !/\d/.test(m[1])) return null;
  const n = Number(m[1].replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function columnUnit(header: string, cells: string[]): ChartUnit {
  const h = header.toLowerCase();
  if (/rp|rupiah|nilai|biaya|tagihan|harga/.test(h) || cells.some(c => /^\s*\**rp/i.test(c))) return 'rupiah';
  if (/%|persen/.test(h) || cells.some(c => /%\s*\**$/.test(c))) return 'persen';
  if (/\bjam\b|lembur/.test(h) || cells.some(c => /jam\s*\**$/i.test(c))) return 'jam';
  return 'angka';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// shortDateLabel: "2026-10-03 s.d. 2026-10-09" → "3–9 Okt", "2026-10-03" →
// "3 Okt 2026", so date axes stay readable. Other labels are unchanged.
export function shortDateLabel(label: string): string {
  const range = /^(\d{4})-(\d{2})-(\d{2})\s*(?:s\.?d\.?|sampai|-|–)\s*(\d{4})-(\d{2})-(\d{2})$/i.exec(label.trim());
  if (range) {
    const [, y1, m1, d1, y2, m2, d2] = range;
    const mon1 = MONTHS[Number(m1) - 1], mon2 = MONTHS[Number(m2) - 1];
    if (!mon1 || !mon2) return label;
    const left = y1 !== y2 ? `${Number(d1)} ${mon1} ${y1}` : m1 !== m2 ? `${Number(d1)} ${mon1}` : `${Number(d1)}`;
    return `${left}–${Number(d2)} ${mon2}`;
  }
  const one = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label.trim());
  if (one && MONTHS[Number(one[2]) - 1]) return `${Number(one[3])} ${MONTHS[Number(one[2]) - 1]} ${one[1]}`;
  return label;
}

const TIME_LABEL = /(\d{4}-\d{2}(-\d{2})?)|(\d{1,2}\s*[-–]\s*\d{1,2}\s+\w{3})|\b(jan|feb|mar|apr|mei|jun|jul|agu|agt|sep|okt|nov|des)\w*\b|\bminggu\b|\bW\d+\b|\b(19|20)\d{2}\b/i;

// tableToChart: label = first column; series = the numeric columns sharing
// the first numeric column's unit (one axis), at most MAX_SERIES. Null when
// the table has no such column or too few rows to be worth a chart.
export function tableToChart(header: string[], rows: string[][], title = ''): ChartSpec | null {
  if (rows.length < 2 || rows.length > MAX_POINTS || header.length < 2) return null;
  // Total rows would dwarf the others.
  const body = rows.filter(r => !/^\s*\**\s*(total|jumlah)\b/i.test(r[0] ?? ''));
  if (body.length < 2) return null;
  const numeric: { col: number; unit: ChartUnit }[] = [];
  for (let c = 1; c < header.length; c++) {
    const cells = body.map(r => r[c] ?? '');
    const parsed = cells.map(parseCellNumber);
    const filled = cells.filter(v => stripMarks(v) !== '' && stripMarks(v) !== '-');
    if (filled.length === 0 || parsed.filter(v => v !== null).length < filled.length) continue;
    numeric.push({ col: c, unit: columnUnit(header[c], cells) });
  }
  if (numeric.length === 0) return null;
  const unit = numeric[0].unit;
  const cols = numeric.filter(n => n.unit === unit).slice(0, MAX_SERIES);
  const x = body.map(r => shortDateLabel(stripMarks(r[0] ?? '')).slice(0, 60));
  const timeLike = x.filter(l => TIME_LABEL.test(l)).length >= Math.ceil(x.length * 0.6);
  const longLabels = x.some(l => l.length > 14);
  const type: ChartType = timeLike && x.length >= 3 ? 'line' : (x.length > 6 || longLabels ? 'horizontal_bar' : 'bar');
  return {
    type, unit, title, x,
    xLabel: stripMarks(header[0]) || undefined,
    series: cols.map(({ col }) => ({ name: stripMarks(header[col]) || `Kolom ${col + 1}`, values: body.map(r => parseCellNumber(r[col] ?? '')) })),
  };
}
