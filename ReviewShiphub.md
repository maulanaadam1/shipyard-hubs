New Loan Request
1. Request Loan harus melalui PIC atau Layek
2. Maksimal peminjaman alat 7 hari kerja, tidak boleh lebih (coba lock dari input field kalender)
3. Quantity stock equipment mengambil referensi ketersediaan stok dari equipment,
meskipun belum bisa mengetahui equipment mana yang akan di pinjamkan
4. Tambah button reject di approval
5. Pastikan requeiremnt input data saat create loan
6. Saat save as draft tidak bisa langsung muncul di dalam table, harus di refresh dulu (perbaiki)
7. Saat status request draft ketika di update untuk di ajukan , statusnya tidak berubah pending
8. Diberikan batasan akses approval berdasarkan PIC masing-masing alat di master equipment

Release Equipment
1. Seharusnya dalam release bisa dilakukan secara terpisah (satu satu), tidak sekaligus dalam satu kali . Kenapa sekarang tidak bisa melakukan itu, sebelumnya sudah ada .make sure
2. Pastikan hanya equipment yang statusnya available yang bisa di release
3. Pastikan ada field siapa yang mengambil alat tersebut
4. Release equipment harus dilakukan oleh PIC yang sama dengan PIC Approval pada saat loan (Pastikan)

Return Equipment
1. Sebelum dilakukan return equiment pastikan dilakukan pengecekan terlebih dahulu, jika oke dilakukan pembersihan, pengecekan, dan ketika alat siap maka bisa dilakukan return . Cek list pengecekan apakah diperlukan 
2. Jika terdapat kerusakan saat pengecekan maka akan dibuatkan laporan tersendiri 
dan jika kerusakan di sebabkan oleh subkon itu sendiri maka perlu di service oleh subkon
3. Return harus dilakukan oleh PIC yang sama dengan PIC pada saat release
4. Pending return dimunculkan berdasarkan PIC (Pastikan) dan tadi sudah dicek tapi masih belum muncul ketika sudah melakukan release equipment
5. Pastikan ada status alat ready atau downtime. Jika downtime akan ke menu maintenance atau MNR

Maintenance & Repair
1. Dibuatkan kategori terpisah untuk Maintenance dan Repair dalam bentuk tab
2. Buatkan form terpisah untuk Maintenance dan Repair

Equipment Working Hours Used
1. Untuk equipment selain dari equipment release, maka perlu dibuatkan inputan manual atau dibuatkan dalam log aktivitas
2. Sebelum memunculkan log aktivitas perlu dilakukan form isian seperti pengecekan sebelum digunakan seperti BBM, oli, dan lain sebagainya . Pastikan equipment dalam keadaan baik saat akan digunakan


Dashboard By PIC berdasarkan alat-alat yang dimiliki