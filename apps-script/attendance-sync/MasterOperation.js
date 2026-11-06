// Sends the yard's MasterOperation spreadsheet (vendors, subcontractor
// members, manpower, projects, progress, WBS, daily cost and material), plus
// a few tabs of other spreadsheets (EXTRA_SHEETS: MasterHSE work permits), to
// ShipHub as one "records" source (Sumber Data Eksternal, key column _key).
// Each tab goes in one request with replace_sheet, so rows deleted in the
// sheet are removed in ShipHub too. Read-only, like the attendance sync.
//
// Script properties:
//   SYNC_URL_MASTER    https://<shiphub-domain>/api/ingest/<source id>
//   SYNC_TOKEN_MASTER  that source's token

const MASTER_SPREADSHEET_ID = '1kYRT9PvQHPmVn_LgxdVAXaGs0hQKJRkGtRvqaN-Lb_k';

// Tabs sent. Empty tabs (wbs_detail, project_moc), the attendance staging
// tab (bulk_zkteco) and the photo list (vendor_foto) are left out.
const MASTER_SHEETS = [
  'vendor', 'vendor_detail', 'wo_vendor', 'wo_mp_update',
  'project', 'progress', 'wbs_data', 'daily_cost', 'daily_material', 'wo_detail',
  'master_ship', 'master_company', 'master_location',
];

// Personal data never leaves Google: identity numbers, addresses, BPJS
// numbers, phone / WhatsApp, email, photos and files, fingerprint card
// numbers. The server drops these names too.
const MASTER_DROP_COLUMN = /identitas|^nik$|alamat|address|nomor_bpjs|bpjs_(no|number)|no_hp|phone|whats|whatapp|wa_number|email|photo|foto|picture|card_no|^file$|update_pdf|^print$/i;

const MASTER_MAX_ROWS = 10000; // one request per tab; the server's limit

// Tabs of other spreadsheets sent with MasterOperation to the same source.
//   required  column a row must have (default: the first column)
//   formats   date formats for columns dateFormat_ does not recognise
//   key       column for the record key; repeats get #2, #3, ...
//   drop      more columns left out (large or repeated text)
const EXTRA_SHEETS = [
  // Absensi ZKteco: the machine user list (department, position).
  { spreadsheetId: '1YAF5qBOvwcJtoA_n3rWMfBjAZKXb9uUk68PnjYdup_U', sheet: 'Personal-Data' },
  // MasterHSE: work permits. "no" is blank on newer rows; one permit number
  // can have several rows. wpclass repeats wpclass_1..6; pdf and file are
  // document paths.
  {
    spreadsheetId: '1kyqeUwNmXMM_fNh-FOBX1FJp4Uq1DWuGu3gzsRlzK28', sheet: 'workpermit',
    required: 'no_workpermit', key: 'no_workpermit', drop: /^(wpclass|pdf)$/i,
    formats: {
      create_date: 'yyyy-MM-dd HH:mm:ss', date_start: 'yyyy-MM-dd', date_finish: 'yyyy-MM-dd',
      time_start: 'HH:mm', time_end: 'HH:mm', period_month: 'yyyy-MM',
    },
  },
];

function masterRows_(sheet, tab) {
  tab = tab || {};
  const rows = readRows_(tab.spreadsheetId || MASTER_SPREADSHEET_ID, sheet, tab);
  const seen = {};
  return rows.map(function (row, i) {
    const out = { _sheet: sheet };
    Object.keys(row).forEach(function (h) {
      // Unnamed columns (blank header), personal data and dropped columns are not sent.
      const name = h.trim().toLowerCase().replace(/\s+/g, '_');
      if (!h || MASTER_DROP_COLUMN.test(name) || (tab.drop && tab.drop.test(name))) return;
      out[h] = row[h];
    });
    // Key: the tab's key column or the row's id, else its position in the tab.
    let id = String(tab.key ? row[tab.key] : (row.id || row.id_siaga || row.emp_code || '')).trim();
    if (id === '') id = 'row' + (i + 2);
    seen[id] = (seen[id] || 0) + 1;
    out._key = sheet + ':' + id + (seen[id] > 1 ? '#' + seen[id] : '');
    return out;
  });
}

function postSheet_(cfg, sheet, rows) {
  if (rows.length > MASTER_MAX_ROWS) {
    throw new Error('Tab ' + sheet + ' punya ' + rows.length + ' baris, lebih dari ' + MASTER_MAX_ROWS + ' per kiriman.');
  }
  const res = UrlFetchApp.fetch(cfg.url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + cfg.token },
    payload: JSON.stringify({ rows: rows, replace_sheet: sheet }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('ShipHub menolak tab ' + sheet + ' (HTTP ' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 500));
  }
  return JSON.parse(res.getContentText());
}

// Hourly (setupTriggers) and on demand from the editor.
function syncMasterOperation() {
  withLock_(function () {
    const cfg = config_('_MASTER');
    const failed = [];
    const tabs = MASTER_SHEETS.map(function (sheet) { return { sheet: sheet }; }).concat(EXTRA_SHEETS);
    tabs.forEach(function (tab) {
      const sheet = tab.sheet;
      try {
        const out = postSheet_(cfg, sheet, masterRows_(sheet, tab));
        console.log(sheet + ': ' + out.received + ' baris, ' + out.saved + ' baru/berubah, ' +
          (out.removed || 0) + ' dihapus, ' + out.skipped + ' dilewati.');
      } catch (e) {
        // One broken tab does not stop the others; the run still fails below.
        console.error(sheet + ': ' + e.message);
        failed.push(sheet);
      }
    });
    if (failed.length) throw new Error('Gagal: ' + failed.join(', '));
  });
}
