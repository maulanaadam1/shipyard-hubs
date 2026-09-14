import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkOrderHistory } from './wo-history.mjs';
const item = (price = 100, volume = 2) => ({ uniqcode: 'stable-id', path: '1.1', label: 'Pekerjaan', volume_cost_final: price, volume, modified_by: 48 });
const payload = items => ({ data: { id: 14800, repair_list: [{ material: items }] } });
test('baseline, unchanged sync, price and volume changes, removal and reappearance', () => {
  const store = new WorkOrderHistory(':memory:');
  try {
    store.observe(14800, payload([item()]));
    store.observe(14800, payload([item('100', '2')]));
    assert.equal(store.read(14800).length, 1);
    assert.equal(store.read(14800)[0].kind, 'baseline');
    store.observe(14800, payload([{ ...item(120), modified_by: 361 }]));
    const changed = store.read(14800)[0];
    assert.equal(changed.kind, 'changed');
    assert.equal(changed.before.total, 200);
    assert.equal(changed.after.total, 240);
    assert.equal(changed.after.modifiedBy, '361');
    store.observe(14800, payload([{ ...item(120), modified_by: 9, status_approval: 'approved' }]));
    assert.equal(store.read(14800).length, 2, 'metadata/approval alone must not create price events');
    store.observe(14800, payload([item(120, 0)]));
    assert.equal(store.read(14800)[0].after.total, 0);
    store.observe(14800, { id: 14800, repair_list: [] });
    assert.equal(store.read(14800)[0].kind, 'removed');
    store.observe(14800, payload([item()]));
    assert.equal(store.read(14800)[0].kind, 'added');
    assert.equal(store.read(999).length, 0);
  } finally { store.close(); }
});
test('invalid snapshots cannot erase baseline or manufacture deletions', () => {
  const store = new WorkOrderHistory(':memory:');
  try {
    store.observe(14800, payload([item()]));
    assert.throws(() => store.observe(14800, { id: 14800 }));
    assert.throws(() => store.observe(14800, { id: 999, repair_list: [] }));
    assert.throws(() => store.observe(14800, payload([item(), item()])));
    assert.throws(() => store.observe(14800, payload([{ volume: 2 }])));
    assert.equal(store.read(14800).length, 1);
  } finally { store.close(); }
});
