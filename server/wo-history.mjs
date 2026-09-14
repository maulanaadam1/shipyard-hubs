import { DatabaseSync } from 'node:sqlite';

const number = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const userId = value => value == null || value === 'null' ? null : String(typeof value === 'object' ? value.id : value);

export function flattenItems(items, result = new Map()) {
  for (const item of items) {
    if (item.material?.length) { flattenItems(item.material, result); continue; }
    if (item.group_flag || item.label?.toLowerCase() === 'grup') continue;
    const key = item.uniqcode || item.id;
    if (!key) throw new Error('Item tanpa ID tetap; riwayat tidak dicatat agar tidak salah menghubungkan item.');
    if (result.has(String(key))) throw new Error('ID item duplikat; riwayat tidak dicatat.');
    const price = number(item.volume_cost_final);
    const volume = number(item.volume);
    result.set(String(key), {
      key: String(key), path: item.path || '', label: (item.label || item.description || 'Item pekerjaan').replace(/<[^>]*>/g, ' ').trim(),
      price, volume, total: price === null || volume === null ? null : price * volume,
      modifiedBy: userId(item.modified_by), createdBy: userId(item.created_by),
      sourceUpdatedAt: item.updated_at || null, status: item.status_approval || null,
    });
  }
  return result;
}

export class WorkOrderHistory {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS snapshots (wo TEXT PRIMARY KEY, items TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, wo TEXT NOT NULL, item_key TEXT NOT NULL, kind TEXT NOT NULL, detected_at TEXT NOT NULL, before_json TEXT, after_json TEXT);
      CREATE INDEX IF NOT EXISTS events_wo ON events(wo, id);`);
  }
  observe(wo, payload) {
    const detail = payload?.data ?? payload;
    if (String(detail?.id) !== String(wo) || !Array.isArray(detail.repair_list)) throw new Error('Respons detail WO tidak lengkap atau ID tidak cocok.');
    const next = flattenItems(detail.repair_list);
    const detectedAt = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const saved = this.db.prepare('SELECT items FROM snapshots WHERE wo = ?').get(String(wo));
      const previous = saved ? new Map(JSON.parse(saved.items)) : new Map();
      const insert = this.db.prepare('INSERT INTO events (wo,item_key,kind,detected_at,before_json,after_json) VALUES (?,?,?,?,?,?)');
      for (const [key, item] of next) {
        const old = previous.get(key);
        const kind = !saved ? 'baseline' : !old ? 'added' : old.price !== item.price || old.volume !== item.volume ? 'changed' : null;
        if (kind) insert.run(String(wo), key, kind, detectedAt, old ? JSON.stringify(old) : null, JSON.stringify(item));
      }
      for (const [key, old] of previous) {
        if (!next.has(key)) insert.run(String(wo), key, 'removed', detectedAt, JSON.stringify(old), null);
      }
      this.db.prepare('INSERT INTO snapshots (wo,items) VALUES (?,?) ON CONFLICT(wo) DO UPDATE SET items=excluded.items').run(String(wo), JSON.stringify([...next]));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  read(wo) {
    return this.db.prepare('SELECT * FROM events WHERE wo = ? ORDER BY id DESC').all(String(wo)).map(row => ({
      id: row.id, itemKey: row.item_key, kind: row.kind, detectedAt: row.detected_at,
      before: row.before_json ? JSON.parse(row.before_json) : null,
      after: row.after_json ? JSON.parse(row.after_json) : null,
    }));
  }
  close() { this.db.close(); }
}

export function workOrderHistoryPlugin({ database, upstream }) {
  const history = new WorkOrderHistory(database);
  const queues = new Map();
  return {
    name: 'local-work-order-history',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = new URL(req.url, 'http://localhost').pathname;
        const detailMatch = path.match(/^\/api\/work-orders\/(\d+)\/(detail|sync)$/);
        const historyMatch = path.match(/^\/api\/local-wo-history\/(\d+)$/);
        if (!detailMatch && !historyMatch) return next();
        const wo = (detailMatch || historyMatch)[1];
        const allowed = historyMatch ? req.method === 'GET' : detailMatch[2] === 'detail' ? req.method === 'GET' : req.method === 'POST';
        if (!allowed) { res.writeHead(405); return res.end(); }
        if (!req.headers.authorization) { res.writeHead(401); return res.end(); }
        const previous = queues.get(wo) || Promise.resolve();
        const job = previous.catch(() => {}).then(async () => {
          // Recheck production access before returning any locally stored history.
          const target = historyMatch ? `/api/work-orders/${wo}/detail` : path;
          const response = await fetch(upstream + target, {
            method: historyMatch ? 'GET' : req.method,
            headers: { Authorization: req.headers.authorization, Accept: 'application/json' },
            signal: AbortSignal.timeout(60000),
          });
          const body = await response.text();
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          if (!response.ok) { res.writeHead(response.status); return res.end(body); }
          let warning = null;
          if (!historyMatch) {
            try { history.observe(wo, JSON.parse(body)); }
            catch (error) { warning = error.message; }
          }
          if (historyMatch) return res.end(JSON.stringify({ events: history.read(wo), storage: 'local' }));
          const json = JSON.parse(body);
          if (warning) (json.data ?? json).local_history_warning = warning;
          res.end(JSON.stringify(json));
        }).catch(error => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); });
        queues.set(wo, job);
        job.finally(() => { if (queues.get(wo) === job) queues.delete(wo); });
      });
      server.httpServer?.once('close', () => history.close());
    },
  };
}
