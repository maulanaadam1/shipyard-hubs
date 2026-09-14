import test from 'node:test';
import assert from 'node:assert/strict';
import { totalServiceCost } from './work-order-cost.ts';

test('WO26090016: nested services total 2,244,000 without counting parent prices', () => {
  assert.equal(totalServiceCost([{ volume: 1, volume_cost_final: 2244000, material: [
    { label: 'grup', material: [
      { volume: 6, volume_cost_final: 264000 },
      { volume: 5, volume_cost_final: 132000 },
    ] },
  ] }]), 2244000);
});

test('zero volume remains zero, numeric strings work, empty groups are ignored', () => {
  assert.equal(totalServiceCost([
    { volume: 0, volume_cost_final: 264000 },
    { volume: '5', volume_cost_final: '132000' },
    { group_flag: true, volume: 1, volume_cost_final: 999999 },
    { volume: 1, volume_cost_final: 'invalid' },
  ]), 660000);
});

test('distinguishes missing detail from a known zero total', () => {
  assert.equal(totalServiceCost(undefined), null);
  assert.equal(totalServiceCost([]), 0);
});
