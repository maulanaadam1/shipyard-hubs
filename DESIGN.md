# DESIGN.md: ShipHub

Arah visual ShipHub. Dibaca sebelum membuat atau mengubah halaman.

- Disetujui pemilik produk: 7 Nov 2026.
- Pilihan pemilik: catat gaya yang ada lalu rapikan, satu warna aksi (kuning), tampilan padat untuk alat kerja, dan efek minimal.
- Temuan yang menjadi dasar aturan ini ada di `anti-slop/audit-003-2026-11-07.md`.

Dial: ENERGY 1 / RHYTHM 1 / MOTION 1

> Reading this as: aplikasi operasional internal galangan untuk staf kantor dan lapangan (desktop dan HP), dengan bahasa visual alat kerja yang padat dan tenang, dial ENERGY 1 / RHYTHM 1 / MOTION 1.

## Identitas

- **Kuning ShipHub `#FDB913`** adalah satu-satunya aksen. Kuning dipakai untuk tombol aksi utama, menu sidebar yang aktif, dan logo. Di luar itu tidak dipakai.
- **Huruf:**
  - Inter untuk teks.
  - Plus Jakarta Sans untuk judul halaman dan angka ringkasan.
  - Tidak ada font ketiga.
- **Kesan:** layar kerja yang dipakai seharian. Data lebih penting daripada hiasan.

## Warna

| Peran | Nilai | Catatan |
|---|---|---|
| Aksi utama (latar) | `#FDB913` | Teks di atasnya `slate-900`, kontras 10,3:1. |
| Aksi utama (hover) | `#e5a611` | Hanya untuk latar, tidak untuk teks. |
| Teks bernuansa kuning | `#92400E` (amber-800) | Kontras 7,1:1 di atas putih. Dipakai saat teks perlu terkait dengan brand. |
| Teks utama | `slate-900` / `slate-700` | |
| Teks sekunder | `slate-500` | Kontras 4,8:1 di atas putih. Jangan lebih terang dari ini untuk teks. |
| Garis dan pembatas | `slate-200` | |
| Latar halaman | `slate-50` | |
| Panel | putih | |
| Sukses | emerald | Selalu bersama teks atau ikon, tidak hanya warna. |
| Bahaya / hapus | red | Sama seperti di atas. |
| Peringatan | orange | Dipisahkan dari kuning brand supaya peringatan tidak terbaca sebagai aksi. |

Aturan:
- **Satu warna aksi.**
  - Tombol utama (Simpan, Tambah, Kirim) selalu kuning dengan teks `slate-900`, termasuk di dalam dialog.
  - Indigo tidak lagi dipakai untuk tombol. Sekarang masih tersisa di 41 tempat dan akan dipindahkan bertahap.
- **Kuning tidak boleh menjadi warna teks di atas putih atau latar terang.**
  - `#FDB913` di atas putih hanya mencapai 1,7:1. `#e5a611` hanya 2,1:1.
  - Sekarang masih tersisa 198 tempat, dan akan dipindahkan ke `#92400E` atau `slate-900`.
- **Tombol kedua:** putih dengan garis `slate-200` dan teks `slate-700`.
- **Tombol hapus:** teks atau garis merah. Hanya dialog konfirmasi hapus yang memakai latar merah.

### Token

Warna ditulis sebagai token di `src/globals.css` (`@theme`), bukan hex mentah di komponen:

```css
--color-brand: #FDB913;
--color-brand-hover: #e5a611;
--color-brand-ink: #92400E;
```

Di komponen, pakai `bg-brand`, `hover:bg-brand-hover`, dan `text-brand-ink`. Hex mentah yang sudah ada (749 kali `#FDB913`) dipindahkan bertahap. Saat menyentuh sebuah file, ganti juga hex di file itu.

## Huruf dan ukuran

- **Teks isi dan tabel:** `text-sm`. Info tambahan, label kecil, dan badge: `text-xs`. Tidak ada teks di bawah `text-xs` (`text-[9px]`, `text-[10px]`, `text-[11px]` dihapus bertahap).
- **Judul halaman:** `text-xl` sampai `text-2xl`, `font-display`, `font-bold`. Satu judul per halaman.
- **Angka ringkasan** (kartu statistik): `font-display`, `text-2xl`.
- **Huruf kapital dengan tracking lebar** (`uppercase tracking-wider`) hanya untuk judul kolom tabel. Label form, judul bagian, dan tombol memakai huruf biasa.

## Tata letak dan kepadatan

- **Padat:**
  - Padding halaman `p-4 md:p-6`.
  - Sel tabel `px-3 py-2`.
  - Jarak antarblok `gap-4`.
  - Lebih banyak baris yang terlihat lebih baik daripada kartu yang lega.
- **Satu titik fokus per layar.** Biasanya ini tabel atau isi utama halaman. Kartu ringkasan hanya dipakai kalau angkanya bisa ditindaklanjuti, dan yang bisa diklik dibedakan dari yang tidak.
- **Panel:** putih, garis `slate-200`, sudut `rounded-xl`.
- **Kontrol:** tombol, input, dan select memakai sudut `rounded-lg`. Tidak memakai `rounded-3xl`.
- **HP:**
  - Halaman tidak boleh bergeser ke samping. Tabel lebar dibungkus `overflow-x-auto`, dan baris tombol memakai `flex-wrap`.
  - Di layar sentuh, kontrol minimal 44px. Aturan ini sudah ada di `globals.css` (`pointer: coarse`).

## Elevasi dan efek

- **Bayangan:** hanya untuk lapisan yang melayang di atas halaman, yaitu dialog, dropdown, dan toast, dengan satu tingkat (`shadow-lg`). Panel dan kartu di halaman tidak memakai bayangan, cukup garis.
- **Tanpa blur** (`backdrop-blur`). Overlay dialog cukup `bg-slate-900/40`.
- **Tanpa glow** (bayangan berwarna seperti `shadow-indigo-500/30`).

## Gerak

- **MOTION 1:**
  - Yang bergerak hanya hover, buka/tutup dialog, dan buka/tutup menu.
  - Durasinya paling lama 150 ms, dengan opacity dan sedikit skala.
- **Tidak ada animasi** untuk daftar, kartu, angka, atau saat halaman dimuat.
- **Gerak dihormati sesuai preferensi:** kalau pengguna memilih `prefers-reduced-motion`, semua transisi dimatikan.
- Library `motion` dikurangi bertahap. Efek yang tersisa cukup dengan `tw-animate-css` (sudah terpasang) atau transisi CSS.

## Interaksi dan aksesibilitas

- **Dialog** memakai `useDialogKeyboard` (`hooks/use-dialog-keyboard.ts`), dengan `role="dialog"`, `aria-modal`, dan `aria-labelledby`.
- **Tombol ikon** wajib punya `aria-label` dalam bahasa halaman itu.
- **Tidak ada tombol tanpa aksi.** Fitur yang belum ada tidak ditampilkan di menu.
- **Setiap tampilan data punya tiga keadaan:** memuat, kosong, dan gagal. Pesan gagal tidak boleh terlihat seperti data kosong.

## Belum diputuskan

- **Bahasa antarmuka.** Sekarang ada halaman berbahasa Indonesia dan ada yang berbahasa Inggris. Pemilik produk belum memilih salah satunya. Sampai ada keputusan, setiap halaman mengikuti bahasa yang sudah dipakai di halaman itu.
