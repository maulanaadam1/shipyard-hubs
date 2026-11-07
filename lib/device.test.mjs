import test from 'node:test';
import assert from 'node:assert/strict';
import { describeDevice } from './device.ts';

test('describeDevice names kind, browser and OS', () => {
  assert.equal(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'), 'Desktop · Chrome · Windows');
  assert.equal(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'), 'HP · Safari · iOS');
  assert.equal(describeDevice('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'), 'HP · Chrome · Android');
  assert.equal(describeDevice('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'), 'Tablet · Chrome · Android');
  assert.equal(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0'), 'Desktop · Edge · macOS');
  assert.equal(describeDevice(''), 'Desktop · Browser lain · OS lain');
});
