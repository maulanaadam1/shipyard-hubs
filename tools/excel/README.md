# Macro Excel untuk ShipHub

Dua modul VBA (hanya untuk Excel Windows):

- `ShipHubPersediaan.bas` mengirim file **Master Inventory** ke menu **Persediaan Material**.
- `ShipHub.bas` menarik dan mengirim tabel master ShipHub umum (vendors, equipment, dan sebagainya).

## Master Inventory → Persediaan Material

File Excel tetap menjadi tempat input dan perhitungan FIFO. Macro hanya mengirim isinya ke ShipHub supaya bisa dilihat dan dicari di web.

**Pasang (sekali saja)**

1. Buka `Master Inventory 2026.xlsx`, lalu **Save As → Excel Macro-Enabled Workbook (.xlsm)**. File `.xlsx` tidak bisa menyimpan macro.
2. Tekan `Alt+F11`, lalu **File → Import File…**, pilih `ShipHubPersediaan.bas`.
3. Agar data terkirim otomatis setiap kali file disimpan, buka **ThisWorkbook** di panel kiri dan tempel:

   ```vba
   Private Sub Workbook_AfterSave(ByVal Success As Boolean)
       If Success Then ShipHub_SetelahSimpan
   End Sub
   ```

4. Simpan file.

**Pakai** (`Alt+F8`)

| Macro | Fungsi |
|---|---|
| `ShipHub_SinkronPersediaan` | Mengirim 5 tabel sekarang: Master Material, Saldo Awal, Pembelian, Pemakaian, dan sheet Persediaan. |
| `ShipHub_AutoSinkron` | Menyalakan atau mematikan kirim otomatis setiap kali file disimpan (Ctrl+S). |
| `ShipHub_AturToken` | Memasang token sumber supaya kiriman tidak pernah meminta password (lihat di bawah). |
| `ShipHub_AturServer` | Mengganti alamat server atau email login. Pengaturan disimpan di file. |
| `ShipHub_Logout` | Menghapus login password. Token sumber tidak ikut terhapus. |

**Tanpa password: token sumber (disarankan untuk kirim otomatis)**

1. Di ShipHub, buka **Sumber Data Eksternal** (khusus Admin) → **Tambah sumber**. Beri nama, misalnya "Master Inventory Gudang", lalu pilih jenis **Persediaan Material (file Master Inventory)**.
2. Salin **URL tujuan** dan **token** (`shs_…`). Token hanya ditampilkan sekali.
3. Di Excel, tekan Alt+F8, jalankan `ShipHub_AturToken`, lalu tempel URL dan token. Keduanya disimpan di file.

Mulai saat itu, kiriman memakai token dan tidak pernah meminta login. Hal yang perlu diketahui:
- **Token hanya bisa mengirim data persediaan.** Token tidak bisa dipakai untuk login atau membaca data lain di ShipHub.
- **Nama pengirim di web adalah nama sumbernya**, misalnya "Disinkron … oleh Master Inventory Gudang".
- **Siapa pun yang memegang file .xlsm ini bisa mengirim data persediaan.** Kalau file dibagikan atau laptopnya hilang, klik **Ganti token** di Sumber Data Eksternal (token lama langsung tidak berlaku), atau **Nonaktifkan** sumbernya.
- **Untuk kembali ke login password**, jalankan `ShipHub_AturToken` lalu kosongkan URL-nya.

**Dengan login password**

- Tanpa token, login diminta sekali setiap kali Excel dibuka. Email diingat, password tidak.
- **Setiap pengiriman mengganti seluruh isi tabel di ShipHub** dengan isi file. Baris yang dihapus di Excel ikut hilang di ShipHub. Tabel yang kosong di Excel tidak dikirim, jadi data lama di ShipHub tetap ada.
- Yang dikirim adalah nilai hasil hitungan di sel, bukan rumusnya. File Excel tidak diubah, kecuali pengaturan server/email yang disimpan di properti file.
- Kalau nama kolom di tabel Excel diganti, pengiriman tabel itu gagal dengan pesan kolom mana yang tidak ditemukan. Ubah pemetaannya di fungsi `Datasets()` di dalam modul.
- Butuh izin **Persediaan Material: import** di Role Management. Admin selalu boleh.

## Tabel master umum (`ShipHub.bas`)

### Pasang

1. Buat workbook baru dan simpan sebagai **Excel Macro-Enabled Workbook (.xlsm)**.
2. Tekan `Alt+F11`, lalu **File → Import File…**, pilih `ShipHub.bas`.
3. Untuk mode realtime, buka **ThisWorkbook** di panel kiri VBA editor dan tempel:

   ```vba
   Private Sub Workbook_SheetChange(ByVal Sh As Object, ByVal Target As Range)
       ShipHub_OnChange Sh, Target
   End Sub
   ```

4. Tutup editor. Tekan `Alt+F8`, jalankan **ShipHub_Setup**, lalu isi email kamu di `Config!B2`.

### Pakai

| Macro | Fungsi |
|---|---|
| `ShipHub_Tarik` | Mengambil isi tabel ke sheet. Kalau sheet aktif bukan nama tabel, macro menanyakan nama tabel dan membuatkan sheet-nya. Isi sheet akan diganti. |
| `ShipHub_KirimSemua` | Mengirim semua baris di sheet aktif. Baris yang `id`-nya sudah ada di-update, baris tanpa `id` dibuat baru. |
| `ShipHub_Logout` | Menghapus token. Request berikutnya akan minta login lagi. |
| Realtime | Isi `Config!B3` dengan `ON`. Setiap edit sel langsung dikirim, dan hasilnya terlihat di status bar Excel. |

Aturan sheet:

- **Nama sheet = nama tabel**, misalnya `vendors`, `master_employees`, `equipment`.
- **Baris 1 = nama kolom database.** Cara termudah: jalankan `ShipHub_Tarik` dulu supaya header-nya benar.
- **Kolom `id` wajib ada** (`unique_id` untuk `deployment_records`). Kalau kosong, macro mengisinya dengan UUID baru, jadi kiriman berikutnya akan meng-update baris yang sama, bukan menggandakan data.
- **Warna sel `id`:** hijau berarti tersimpan, merah berarti gagal. Pesan error muncul di popup atau status bar.

### Batasan

- Menghapus baris di Excel **tidak** menghapus data di ShipHub.
- Sel kosong tidak dikirim saat `KirimSemua`. Untuk mengosongkan nilai di server, kosongkan selnya saat mode realtime aktif; macro akan mengirim `null`.
- Tabel user, role, permission, dan `sync_configs` tidak bisa diakses lewat macro. Data Work Order berasal dari sync dan juga tidak bisa dikirim.
- Hak akses mengikuti role akun yang login (permission add/edit di tabel tersebut).
- Password diketik di InputBox biasa (tidak disamarkan), lalu token disimpan di memori selama Excel terbuka. Jangan tulis password di sheet.
- Request bersifat sinkron, jadi Excel berhenti sebentar setiap kali mengirim. Paste lebih dari 5000 sel tidak dikirim realtime; pakai `KirimSemua` untuk itu.
