import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCurlUrls, parseCurlHeaders, configHosts, mergeHeaders, pickHeaderDonor } from './curl-headers.ts';

const curl = `curl 'https://api.example.test/v1/items?page=1' \\
  -H 'accept: application/json' \\
  -H 'authorization: Bearer new-token' \\
  -b 'session=new; xsrf=abc'`;

test('extracts URL and headers from a bash cURL', () => {
  assert.deepEqual(extractCurlUrls(curl), ['https://api.example.test/v1/items?page=1']);
  assert.deepEqual(parseCurlHeaders(curl), {
    accept: 'application/json',
    authorization: 'Bearer new-token',
    Cookie: 'session=new; xsrf=abc',
  });
});

test('a lowercase cookie header and -b end up in one key', () => {
  const h = parseCurlHeaders(`curl 'https://a.test' -H 'cookie: a=1' -b 'b=2'`);
  assert.deepEqual(h, { cookie: 'a=1; b=2' });
});

test('configHosts reads every line, including URL templates', () => {
  assert.deepEqual(
    configHosts('https://API.example.test/a\nhttps://other.test/b?x={{id}}\nnot a url'),
    ['api.example.test', 'other.test'],
  );
  assert.deepEqual(configHosts(''), []);
  assert.deepEqual(configHosts(null), []);
});

test('mergeHeaders replaces fresh keys case-insensitively and keeps the rest', () => {
  const stored = JSON.stringify({ Cookie: 'session=old', 'X-Custom': 'keep', Authorization: 'Bearer old' });
  assert.deepEqual(mergeHeaders(stored, { cookie: 'session=new', authorization: 'Bearer new' }), {
    'X-Custom': 'keep',
    cookie: 'session=new',
    authorization: 'Bearer new',
  });
});

test('mergeHeaders tolerates empty or broken stored headers', () => {
  assert.deepEqual(mergeHeaders('', { Cookie: 'a' }), { Cookie: 'a' });
  assert.deepEqual(mergeHeaders('{broken', { Cookie: 'a' }), { Cookie: 'a' });
  assert.deepEqual(mergeHeaders('[1]', { Cookie: 'a' }), { Cookie: 'a' });
});

test('pickHeaderDonor takes the latest synced config on the same host', () => {
  const configs = [
    { id: 'Old', url: 'https://siaga.test/a', headers: '{"Cookie":"a"}', last_sync: '2026-11-01 10:00:00' },
    { id: 'New', url: 'https://siaga.test/b', headers: '{"Cookie":"b"}', last_sync: '2026-11-07 10:00:00' },
    { id: 'Empty', url: 'https://siaga.test/c', headers: '', last_sync: '2026-11-08 10:00:00' },
    { id: 'Other', url: 'https://other.test/x', headers: '{"Cookie":"x"}', last_sync: '2026-11-09 10:00:00' },
  ];
  assert.equal(pickHeaderDonor(configs, ['https://siaga.test/new'])?.id, 'New');
  assert.equal(pickHeaderDonor(configs, ['https://siaga.test/new'], 'New')?.id, 'Old');
  assert.equal(pickHeaderDonor(configs, ['https://nowhere.test/'])?.id, undefined);
  assert.equal(pickHeaderDonor(configs, []), null);
});
