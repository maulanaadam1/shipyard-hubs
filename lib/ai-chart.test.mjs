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
