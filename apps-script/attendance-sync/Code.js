// Sends the attendance spreadsheet's Master_RawData rows to ShipHub
// (POST /api/ingest/<source>). Standalone project: it only reads the
// spreadsheet and never touches the spreadsheet's own script (V3.js).
//
// Script properties (Project Settings > Script properties):
//   SYNC_URL    https://<shiphub-domain>/api/ingest/<source id>
//   SYNC_TOKEN  the source's token from Sumber Data Eksternal (shs_...)
// MasterOperation.js sends the vendor/operations spreadsheet with its own
// SYNC_URL_MASTER and SYNC_TOKEN_MASTER.

const SPREADSHEET_ID = '1YAF5qBOvwcJtoA_n3rWMfBjAZKXb9uUk68PnjYdup_U';
const SHEET_NAME = 'Master_RawData';
const CHUNK_SIZE = 2000; // server accepts up to 5000 rows per request
const RECENT_DAYS = 3;   // syncRecent resends this many days back

// config_('') reads SYNC_URL / SYNC_TOKEN, config_('_MASTER') the
// MasterOperation pair.
function config_(suffix) {
  suffix = suffix || '';
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SYNC_URL' + suffix);
  const token = props.getProperty('SYNC_TOKEN' + suffix);
  if (!url || !token) {
    throw new Error('Isi Script properties SYNC_URL' + suffix + ' dan SYNC_TOKEN' + suffix + ' dulu.');
  }
  return { url: url, token: token };
}

// Format for a date/time column, by header name; '' for other columns.
function dateFormat_(header) {
  const key = header.toLowerCase();
  if (key === 'date') return 'yyyy-MM-dd';
  if (key === 'time') return 'HH:mm:ss';
  if (/(^|_)(time|date)$/.test(key) || /_at$/.test(key)) return 'yyyy-MM-dd HH:mm:ss';
  return '';
}

// A Sheets date serial (days since 1899-12-30, wall-clock time of the
// spreadsheet) as text, e.g. 46331.33 -> "2026-11-05 07:55:12".
function serialToText_(serial, format) {
  const ms = Math.round((serial - 25569) * 86400000);
  return Utilities.formatDate(new Date(ms), 'UTC', format);
}

// Rows as objects keyed by the sheet header. Read through the Sheets API
// (advanced service), which works with the read-only spreadsheets scope;
// SpreadsheetApp.openById would need full read-write access to every sheet
// the account can open. Date cells come back as serial numbers and are sent
// as wall-clock text, so the server gets the punch time as the sheet shows it.
function readRows_(spreadsheetId, sheetName) {
  const res = Sheets.Spreadsheets.Values.get(spreadsheetId || SPREADSHEET_ID, sheetName || SHEET_NAME, {
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });
  const values = res.values || [];
  if (values.length < 2) return [];

  const header = values[0].map(function (h) { return String(h).trim(); });
  const formats = header.map(dateFormat_);

  return values.slice(1)
    .filter(function (row) { return row[0] !== '' && row[0] !== undefined && row[0] !== null; })
    .map(function (row) {
      const obj = {};
      header.forEach(function (h, i) {
        if (!h) return;
        let v = row[i];
        if (v === undefined || v === null) v = ''; // the API trims empty trailing cells
        if (formats[i] && typeof v === 'number') v = serialToText_(v, formats[i]);
        obj[h] = v;
      });
      return obj;
    });
}

function rowDay_(row) {
  const pt = String(row.punch_time || row.date || '');
  return pt.slice(0, 10);
}

// post_ sends rows in chunks. extra is merged into each request body (e.g.
// replace_sheet); cfg defaults to the attendance source.
function post_(rows, cfg, extra) {
  cfg = cfg || config_();
  let saved = 0;
  let unchanged = 0;
  let skipped = 0;
  // At least one request, so checkConfig can test the URL and token.
  for (let i = 0; i === 0 || i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const res = UrlFetchApp.fetch(cfg.url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + cfg.token },
      payload: JSON.stringify(Object.assign({ rows: chunk }, extra || {})),
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code !== 200) {
      // Throwing marks the run as failed, so Google emails the trigger owner.
      throw new Error('ShipHub menolak kiriman (HTTP ' + code + '): ' + res.getContentText().slice(0, 500));
    }
    const out = JSON.parse(res.getContentText());
    saved += out.saved;
    unchanged += out.unchanged;
    skipped += out.skipped;
    if (out.problems && out.problems.length) console.warn('Baris dilewati: ' + out.problems.join('; '));
  }
  console.log('Terkirim ' + rows.length + ' baris: ' + saved + ' baru/berubah, ' + unchanged +
    ' sudah ada, ' + skipped + ' dilewati.');
  return { saved: saved, unchanged: unchanged, skipped: skipped };
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
  ScriptApp.newTrigger('syncMasterOperation').timeBased().everyHours(1).create();
  console.log('Trigger dipasang: syncRecent tiap 5 menit, syncAll tiap hari jam 02, syncMasterOperation tiap jam.');
}

// Checks the URL and token without sending data.
function checkConfig() {
  post_([]);
}
