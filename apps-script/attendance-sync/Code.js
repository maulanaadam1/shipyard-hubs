// Sends the attendance spreadsheet's Master_RawData rows to ShipHub
// (POST /api/attendance/sync). Standalone project: it only reads the
// spreadsheet and never touches the spreadsheet's own script (V3.js).
//
// Script properties (Project Settings > Script properties):
//   SYNC_URL    https://<shiphub-domain>/api/attendance/sync
//   SYNC_TOKEN  same value as ATTENDANCE_SYNC_TOKEN on the server

const SPREADSHEET_ID = '1YAF5qBOvwcJtoA_n3rWMfBjAZKXb9uUk68PnjYdup_U';
const SHEET_NAME = 'Master_RawData';
const CHUNK_SIZE = 2000; // server accepts up to 5000 rows per request
const RECENT_DAYS = 3;   // syncRecent resends this many days back

function config_() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SYNC_URL');
  const token = props.getProperty('SYNC_TOKEN');
  if (!url || !token) {
    throw new Error('Isi Script properties SYNC_URL dan SYNC_TOKEN dulu.');
  }
  return { url: url, token: token };
}

// Rows as objects keyed by the sheet header. Date cells are sent as text in
// the spreadsheet's time zone, so the server gets the wall-clock punch time.
function readRows_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Sheet ' + SHEET_NAME + ' tidak ditemukan.');
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const tz = ss.getSpreadsheetTimeZone();
  const header = values[0].map(function (h) { return String(h).trim(); });
  const formats = header.map(function (h) {
    const key = h.toLowerCase();
    if (key === 'date') return 'yyyy-MM-dd';
    if (key === 'time') return 'HH:mm:ss';
    return 'yyyy-MM-dd HH:mm:ss';
  });

  return values.slice(1)
    .filter(function (row) { return row[0] !== '' && row[0] !== null; })
    .map(function (row) {
      const obj = {};
      header.forEach(function (h, i) {
        if (!h) return;
        const v = row[i];
        obj[h] = v instanceof Date ? Utilities.formatDate(v, tz, formats[i]) : v;
      });
      return obj;
    });
}

function rowDay_(row) {
  const pt = String(row.punch_time || row.date || '');
  return pt.slice(0, 10);
}

function post_(rows) {
  const cfg = config_();
  let saved = 0;
  let skipped = 0;
  // At least one request, so checkConfig can test the URL and token.
  for (let i = 0; i === 0 || i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const res = UrlFetchApp.fetch(cfg.url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Sync-Token': cfg.token },
      payload: JSON.stringify({ rows: chunk }),
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code !== 200) {
      // Throwing marks the run as failed, so Google emails the trigger owner.
      throw new Error('ShipHub menolak kiriman (HTTP ' + code + '): ' + res.getContentText().slice(0, 500));
    }
    const out = JSON.parse(res.getContentText());
    saved += out.saved;
    skipped += out.skipped;
    if (out.problems && out.problems.length) console.warn('Baris dilewati: ' + out.problems.join('; '));
  }
  console.log('Terkirim ' + rows.length + ' baris: ' + saved + ' tersimpan, ' + skipped + ' dilewati.');
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    console.log('Sinkron sebelumnya masih berjalan, dilewati.');
    return;
  }
  try {
    fn();
  } finally {
    lock.releaseLock();
  }
}

// Every 5 minutes: punches of the last few days (the server upserts by id,
// so resending is harmless and picks up rows added late).
function syncRecent() {
  withLock_(function () {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RECENT_DAYS);
    const since = Utilities.formatDate(cutoff, 'Asia/Jakarta', 'yyyy-MM-dd');
    const rows = readRows_().filter(function (r) { return rowDay_(r) >= since; });
    if (rows.length) post_(rows);
    else console.log('Tidak ada absen sejak ' + since + '.');
  });
}

// Nightly: the whole sheet, in case a 5-minute run failed or rows were edited.
function syncAll() {
  withLock_(function () {
    post_(readRows_());
  });
}

// Run once from the editor after the first push. Safe to run again: it
// replaces this project's triggers instead of adding duplicates.
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncRecent').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('syncAll').timeBased().everyDays(1).atHour(2).create();
  console.log('Trigger dipasang: syncRecent tiap 5 menit, syncAll tiap hari jam 02.');
}

// Checks the URL and token without sending data.
function checkConfig() {
  post_([]);
}
