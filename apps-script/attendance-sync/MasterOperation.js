// Sends the yard's MasterOperation spreadsheet (vendors, subcontractor
// members, manpower, projects, progress, WBS, daily cost and material) to
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

const MASTER_MAX_ROWS = 5000; // one request per tab; the server's limit

function masterRows_(sheet) {
  const rows = readRows_(MASTER_SPREADSHEET_ID, sheet);
  return rows.map(function (row, i) {
    const out = { _sheet: sheet };
    Object.keys(row).forEach(function (h) {
      // Unnamed columns (blank header) and personal data are not sent.
      if (!h || MASTER_DROP_COLUMN.test(h.trim().toLowerCase().replace(/\s+/g, '_'))) return;
      out[h] = row[h];
    });
    // Key: the row's id when it has one, else its position in the tab.
    const id = row.id || row.id_siaga || '';
    out._key = sheet + ':' + (id !== '' ? id : 'row' + (i + 2));
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
    MASTER_SHEETS.forEach(function (sheet) {
      try {
        const out = postSheet_(cfg, sheet, masterRows_(sheet));
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
