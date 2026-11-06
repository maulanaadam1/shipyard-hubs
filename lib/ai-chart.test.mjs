import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChartSpec, formatValue, formatShort, chartTable, MAX_POINTS } from './ai-chart.ts';

const ok = (spec) => {
  const r = parseChartSpec(JSON.stringify(spec));
  assert.equal(r.ok, true, r.error);
  return r.spec;
};
const bad = (body, part) => {
  const r = parseChartSpec(typeof body === 'string' ? body : JSON.stringify(body));
  assert.equal(r.ok, false);
  assert.match(r.error, part);
};

test('a bar chart with defaults', () => {
  const s = ok({ title: 'Tagihan per minggu', unit: 'rupiah', x: ['W1', 'W2'], series: [{ name: 'Approved', values: [1500000, 2500000] }] });
  assert.equal(s.type, 'bar');
  assert.deepEqual(s.x, ['W1', 'W2']);
  assert.deepEqual(s.series[0].values, [1500000, 2500000]);
});

test('numeric strings, nulls and numeric labels are accepted; a lone unnamed series takes the title', () => {
  const s = ok({ type: 'line', title: 'Jam kerja', unit: 'jam', x: [2024, 2025], series: [{ values: ['12.5', null] }] });
  assert.deepEqual(s.x, ['2024', '2025']);
  assert.deepEqual(s.series[0].values, [12.5, null]);
  assert.equal(s.series[0].name, 'Jam kerja');
});

test('broken or unreadable data is refused with a reason', () => {
  bad('{"x": [1,', /JSON/);
  bad([1, 2], /objek/);
  bad({ type: 'pie', x: ['a'], series: [{ values: [1] }] }, /pie/);
  bad({ unit: 'dolar', x: ['a'], series: [{ values: [1] }] }, /dolar/);
  bad({ x: [], series: [{ values: [] }] }, /kosong/);
  bad({ x: ['a', 'b'], series: [{ values: [1] }] }, /1 nilai untuk 2 label/);
  bad({ x: ['a'], series: [{ values: ['satu'] }] }, /bukan angka/);
  bad({ x: ['a'], series: [{ values: [null] }] }, /kosong/);
  bad({ x: Array.from({ length: MAX_POINTS + 1 }, (_, i) => `p${i}`), series: [{ values: Array(MAX_POINTS + 1).fill(1) }] }, /terlalu banyak titik/);
  bad({ x: ['a'], series: Array.from({ length: 7 }, (_, i) => ({ name: `s${i}`, values: [i] })) }, /terlalu banyak seri/);
});

test('full numbers in Indonesian format', () => {
  assert.equal(formatValue(1234567.4, 'rupiah'), 'Rp 1.234.567');
  assert.equal(formatValue(1234.56, 'jam'), '1.234,6 jam');
  assert.equal(formatValue(12.25, 'persen'), '12,3%');
  assert.equal(formatValue(null, 'angka'), '-');
});

test('short axis labels', () => {
  assert.equal(formatShort(950000, 'rupiah'), 'Rp 950 rb');
  assert.equal(formatShort(1250000, 'rupiah'), 'Rp 1,3 jt');
  assert.equal(formatShort(145751144, 'rupiah'), 'Rp 146 jt');
  assert.equal(formatShort(1312600000, 'rupiah'), 'Rp 1,3 M');
  assert.equal(formatShort(4028.2, 'jam'), '4.028');
  assert.equal(formatShort(0, 'angka'), '0');
});

test('the data table mirrors the chart', () => {
  const s = ok({ title: 'X', x_label: 'Vendor', x: ['A', 'B'], series: [{ name: 'Jam', values: [10, null] }, { name: 'Lembur', values: [2, 1] }] });
  assert.deepEqual(chartTable(s), { header: ['Vendor', 'Jam', 'Lembur'], rows: [['A', 10, 2], ['B', '', 1]] });
});

test('cell numbers in Indonesian formats', async () => {
  const { parseCellNumber } = await import('./ai-chart.ts');
  assert.equal(parseCellNumber('Rp 145.751.144'), 145751144);
  assert.equal(parseCellNumber('**Rp 1.234,5**'), 1234.5);
  assert.equal(parseCellNumber('1.107,5 jam'), 1107.5);
  assert.equal(parseCellNumber('12%'), 12);
  assert.equal(parseCellNumber('PT Maju'), null);
  assert.equal(parseCellNumber('-'), null);
});

test('a weekly billing table becomes a line chart; the total row is left out', async () => {
  const { tableToChart } = await import('./ai-chart.ts');
  const spec = tableToChart(['Minggu tagihan', 'Nilai approved', 'Perubahan'],
    [['2026-10-03 s.d. 2026-10-09', 'Rp 358.156.584', '-'], ['2026-10-10 s.d. 2026-10-16', 'Rp 132.595.555', '↓ 63%'],
     ['2026-10-17 s.d. 2026-10-23', 'Rp 132.019.248', '↓ 0,4%'], ['**Total**', '**Rp 622.771.387**', '']], 'Tagihan');
  assert.equal(spec.type, 'line');
  assert.equal(spec.unit, 'rupiah');
  assert.deepEqual(spec.series.map(s => s.name), ['Nilai approved']); // "↓ 63%" is not a number column
  assert.deepEqual(spec.series[0].values, [358156584, 132595555, 132019248]);
  assert.equal(spec.x.length, 3);
});

test('vendors become a horizontal bar chart; columns of another unit are left out', async () => {
  const { tableToChart } = await import('./ai-chart.ts');
  const rows = Array.from({ length: 7 }, (_, i) => [`PT Vendor Nomor ${i + 1}`, `${1000 - i * 50},5`, `${100 - i}`, `Rp ${i + 1}.000.000`]);
  const spec = tableToChart(['Vendor', 'Jam kerja', 'Lembur (jam)', 'Nilai WO'], rows);
  assert.equal(spec.type, 'horizontal_bar');
  assert.equal(spec.unit, 'jam');
  assert.deepEqual(spec.series.map(s => s.name), ['Jam kerja', 'Lembur (jam)']);
});

test('tables without numbers or with one row give no chart', async () => {
  const { tableToChart } = await import('./ai-chart.ts');
  assert.equal(tableToChart(['WO', 'Vendor'], [['WO1', 'A'], ['WO2', 'B']]), null);
  assert.equal(tableToChart(['Vendor', 'Jam'], [['A', '10']]), null);
  const few = tableToChart(['Status', 'Jumlah WO'], [['Waiting', '23'], ['Level 5', '63']]);
  assert.equal(few.type, 'bar');
  assert.equal(few.unit, 'angka');
});

test('date labels are shortened for the axis', async () => {
  const { shortDateLabel, tableToChart } = await import('./ai-chart.ts');
  assert.equal(shortDateLabel('2026-10-03 s.d. 2026-10-09'), '3–9 Okt');
  assert.equal(shortDateLabel('2026-10-31 s.d. 2026-11-06'), '31 Okt–6 Nov');
  assert.equal(shortDateLabel('2025-12-27 - 2026-01-02'), '27 Des 2025–2 Jan');
  assert.equal(shortDateLabel('2026-11-05'), '5 Nov 2026');
  assert.equal(shortDateLabel('PT Maju'), 'PT Maju');
  const spec = tableToChart(['Minggu', 'Nilai'], [['2026-10-03 s.d. 2026-10-09', 'Rp 1.000'], ['2026-10-10 s.d. 2026-10-16', 'Rp 2.000'], ['2026-10-17 s.d. 2026-10-23', 'Rp 3.000']]);
  assert.deepEqual(spec.x, ['3–9 Okt', '10–16 Okt', '17–23 Okt']);
  assert.equal(spec.type, 'line');
});
