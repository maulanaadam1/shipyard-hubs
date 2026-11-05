# Sinkron absensi ke ShipHub

Project Apps Script terpisah yang membaca sheet `Master_RawData` di spreadsheet absensi
dan mengirim barisnya ke `POST /api/ingest/<id sumber>`. Script bawaan spreadsheet
(menu "Sistem Absensi", `V3.js`) tidak diubah sama sekali; project ini hanya membaca.

Jadwal:
- `syncRecent` tiap 5 menit: absen 3 hari terakhir.
- `syncAll` tiap hari jam 02.00: seluruh sheet, sebagai cadangan.

Server menyimpan per `id` transaksi (upsert), jadi mengirim ulang tidak membuat data ganda.

## Pasang pertama kali

1. Di ShipHub, buka **Sumber Data Eksternal** (Admin), tambah sumber jenis
   **Absensi (fingerprint)**, lalu salin token yang muncul. Token hanya ditampilkan sekali;
   kalau hilang, pakai **Ganti token**.
2. Project sudah ada: **ShipHub Attendance Sync** di akun Google kantor (samudera.id) yang membuka spreadsheet absensi
   (scriptId di `.clasp.json`). Akun itu harus bisa membuka spreadsheet absensi.
   Kirim kode dari folder ini dengan `clasp push` (clasp login dengan akun yang sama).
   Catatan: `clasp create` menimpa `appsscript.json` dengan manifest bawaan; kembalikan
   dari git sebelum push.
3. `clasp open`, lalu di **Project Settings → Script properties** tambahkan:
   - `SYNC_URL` = `https://<domain-shiphub>/api/ingest/<id sumber>` (tertulis di halaman sumber)
   - `SYNC_TOKEN` = token dari langkah 1
4. Di editor, jalankan `checkConfig` (harus selesai tanpa error), lalu `setupTriggers`
   sekali dan setujui izin akses (baca spreadsheet, akses URL luar, kelola trigger).
   Spreadsheet dibaca lewat Sheets API (advanced service `Sheets`) supaya izinnya cukup
   baca-saja; `SpreadsheetApp.openById` mewajibkan izin baca-tulis.
5. Jalankan `syncAll` sekali untuk mengirim semua data lama.

## Mengubah kode

Edit `Code.js` di sini, lalu `clasp push`. Trigger selalu menjalankan versi terbaru.

## Melihat hasil

`GET /api/attendance/daily?from=2026-11-01&to=2026-11-30` (login Admin) memberi jam kerja per
karyawan per hari dan total per `nama_pt`. Parameter opsional: `source` (id sumber), `nama_pt`, `emp_code`,
`weekday_hours` (default 8), `saturday_hours` (default 4).

- `worked_minutes` hanya terisi bila absen masuk dan pulang ada (jam nyata).
- `estimated_minutes` mengisi absen yang hilang dengan 08.00 atau jam pulang standar,
  sama seperti Attendance Card di spreadsheet.
- Absen sebelum 05.00 dihitung ke shift hari sebelumnya.

## MasterOperation (data vendor dan operasional)

`MasterOperation.js` mengirim spreadsheet MasterOperation (vendor, anggota subkon, manpower,
proyek, progres, WBS, biaya dan material harian, master kapal/perusahaan/lokasi) sebagai satu
sumber **Data umum** dengan kolom kunci `_key`. Setiap tab dikirim utuh dengan `replace_sheet`,
jadi baris yang dihapus di sheet juga hilang di ShipHub. Daftar tab ada di `MASTER_SHEETS`.

Data pribadi tidak dikirim: NIK / no identitas, alamat, nomor BPJS, HP / WhatsApp, email, foto,
file dan nomor kartu absen (`MASTER_DROP_COLUMN`). Server juga menyaring nama kolom yang sama.

Pasang:
1. Di Sumber Data Eksternal, tambah sumber **Data umum** bernama MasterOperation dengan kolom
   kunci `_key`, lalu salin token dan URL-nya.
2. Script properties: `SYNC_URL_MASTER` dan `SYNC_TOKEN_MASTER`.
3. Jalankan `setupTriggers` lagi (menambah `syncMasterOperation` tiap jam), lalu
   `syncMasterOperation` sekali.

Di AI Asisten datanya terbaca sebagai sumber `mo_*` di `query_app_data`, dan anggota subkon
melengkapi nama PT / kepala subkon di perhitungan jam kerja (lewat `emp_code`).
