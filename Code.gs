/**
 * =======================================================
 * MONITORING KEYPOINT JARINGAN — Backend (Google Apps Script)
 * =======================================================
 * File ini adalah "jembatan" antara aplikasi web dan
 * Google Spreadsheet Anda. Tempel seluruh isi file ini ke
 * editor Apps Script (Extensions > Apps Script) pada
 * spreadsheet Anda, lalu Deploy sebagai Web App.
 *
 * Langkah lengkap ada di PANDUAN-SETUP.md
 *
 * Spreadsheet tujuan sudah dikunci ke ID di bawah ini, jadi
 * script ini akan selalu menulis ke spreadsheet yang benar
 * walaupun project Apps Script dibuat terpisah (standalone).
 * =======================================================
 */

const SPREADSHEET_ID = '18SQzbDUIpH7z3WJ7npzht5XFe7Wl8F3fJ4mGBhg0_es';
const SHEET_NAME = 'Data Keypoint';
const FOLDER_NAME = 'dashboard-monitoring-sistem';

// Urutan kolom di spreadsheet. ID diletakkan di akhir karena
// kolom-kolom di depan mengikuti urutan yang diminta pengguna.
const HEADERS = [
  'Timestamp', 'Nama Keypoint', 'Jam Lepas', 'Jam Normal',
  'Latitude', 'Longitude', 'Link Peta', 'Foto URL',
  'Keterangan', 'Status', 'ID'
];

/* ---------- util spreadsheet & folder ---------- */

function getSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 140);
    sheet.setColumnWidth(2, 180);
    sheet.setColumnWidth(8, 260);
    sheet.setColumnWidth(9, 220);
  }
  return sheet;
}

function getFolder_() {
  const folders = DriveApp.getFoldersByName(FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(FOLDER_NAME);
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function nowTimestamp_() {
  const tz = Session.getScriptTimeZone() || 'Asia/Jakarta';
  return Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ss");
}

/* ---------- entry point: GET (ambil semua data) ---------- */

function doGet(e) {
  try {
    const sheet = getSheet_();
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return jsonOutput_({ ok: true, data: [] });

    const headers = values[0];
    const rows = values.slice(1)
      .map(function (row) {
        const obj = {};
        headers.forEach(function (h, i) { obj[h] = row[i]; });
        return obj;
      })
      .filter(function (r) { return r['ID']; }); // lewati baris kosong

    return jsonOutput_({ ok: true, data: rows });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err) });
  }
}

/* ---------- entry point: POST (create / update / delete) ---------- */

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Tidak ada data yang dikirim ke server.');
    }
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;

    if (action === 'create') return jsonOutput_(createRecord_(payload));
    if (action === 'update') return jsonOutput_(updateRecord_(payload));
    if (action === 'delete') return jsonOutput_(deleteRecord_(payload));
    return jsonOutput_({ ok: false, error: 'Aksi tidak dikenal: ' + action });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- simpan foto base64 ke Drive ---------- */

function savePhoto_(base64DataUrl, idForName) {
  if (!base64DataUrl) return '';
  const match = base64DataUrl.match(/^data:(image\/\w+);base64,(.*)$/);
  if (!match) return '';

  const mimeType = match[1];
  const base64Data = match[2];
  const ext = mimeType.split('/')[1] || 'jpg';
  const bytes = Utilities.base64Decode(base64Data);
  const blob = Utilities.newBlob(bytes, mimeType, 'keypoint_' + idForName + '.' + ext);

  const folder = getFolder_();
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/file/d/' + file.getId() + '/view';
}

/* ---------- CREATE ---------- */

function createRecord_(payload) {
  if (!payload.namaKeypoint) return { ok: false, error: 'Nama Keypoint wajib diisi.' };

  const sheet = getSheet_();
  const id = 'KP' + new Date().getTime();
  const fotoUrl = savePhoto_(payload.foto, id);

  const lat = (payload.lat !== null && payload.lat !== undefined && payload.lat !== '') ? payload.lat : '';
  const lng = (payload.lng !== null && payload.lng !== undefined && payload.lng !== '') ? payload.lng : '';
  const linkPeta = (lat !== '' && lng !== '') ? ('https://www.google.com/maps?q=' + lat + ',' + lng) : '';

  sheet.appendRow([
    nowTimestamp_(),
    payload.namaKeypoint || '',
    payload.jamLepas || '',
    payload.jamNormal || '',
    lat,
    lng,
    linkPeta,
    fotoUrl,
    payload.keterangan || '',
    payload.status || '',
    id
  ]);

  return { ok: true, id: id };
}

/* ---------- cari nomor baris berdasar ID ---------- */

function findRowById_(sheet, id) {
  const values = sheet.getDataRange().getValues();
  const idColIndex = HEADERS.indexOf('ID');
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idColIndex]) === String(id)) return i + 1; // nomor baris 1-indexed
  }
  return -1;
}

/* ---------- UPDATE ---------- */

function updateRecord_(payload) {
  if (!payload.id) return { ok: false, error: 'ID data tidak ditemukan pada permintaan.' };

  const sheet = getSheet_();
  const rowNum = findRowById_(sheet, payload.id);
  if (rowNum === -1) return { ok: false, error: 'Data tidak ditemukan (mungkin sudah dihapus).' };

  const range = sheet.getRange(rowNum, 1, 1, HEADERS.length);
  const existing = range.getValues()[0];
  const timestampCol = HEADERS.indexOf('Timestamp');
  const idCol = HEADERS.indexOf('ID');

  let fotoUrl = payload.existingFotoUrl || '';
  if (payload.foto) {
    fotoUrl = savePhoto_(payload.foto, payload.id);
  }

  const lat = (payload.lat !== null && payload.lat !== undefined && payload.lat !== '') ? payload.lat : '';
  const lng = (payload.lng !== null && payload.lng !== undefined && payload.lng !== '') ? payload.lng : '';
  const linkPeta = (lat !== '' && lng !== '') ? ('https://www.google.com/maps?q=' + lat + ',' + lng) : '';

  const updatedRow = [
    existing[timestampCol], // waktu pencatatan asli tetap dipertahankan
    payload.namaKeypoint || '',
    payload.jamLepas || '',
    payload.jamNormal || '',
    lat,
    lng,
    linkPeta,
    fotoUrl,
    payload.keterangan || '',
    payload.status || '',
    existing[idCol]
  ];

  range.setValues([updatedRow]);
  return { ok: true, id: payload.id };
}

/* ---------- DELETE ---------- */

function deleteRecord_(payload) {
  if (!payload.id) return { ok: false, error: 'ID data tidak ditemukan pada permintaan.' };

  const sheet = getSheet_();
  const rowNum = findRowById_(sheet, payload.id);
  if (rowNum === -1) return { ok: false, error: 'Data tidak ditemukan (mungkin sudah dihapus).' };

  sheet.deleteRow(rowNum);
  return { ok: true };
}
