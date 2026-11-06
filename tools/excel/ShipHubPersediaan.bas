Attribute VB_Name = "ShipHubPersediaan"
Option Explicit

' Kirim isi file Master Inventory ke ShipHub (menu Persediaan Material).
'
' Yang dikirim: tblMaterial, tblSaldoAwal, tblPembelian, tblPemakaian dan
' sheet Persediaan (hasil hitungan FIFO). Setiap kirim MENGGANTI seluruh isi
' tabel di ShipHub dengan isi file ini, jadi baris yang dihapus di Excel ikut
' hilang di ShipHub. Rumus dan perhitungan di file tidak diubah.
'
' Macro untuk user (Alt+F8):
'   ShipHub_SinkronPersediaan  kirim semua tabel sekarang
'   ShipHub_AutoSinkron        nyalakan/matikan kirim otomatis setiap file disimpan
'   ShipHub_AturToken          pasang token sumber (tanpa login password)
'   ShipHub_AturServer         ganti alamat server / email login
'   ShipHub_Logout             lupakan login password
' Kirim otomatis butuh kode Workbook_AfterSave di ThisWorkbook (lihat README).
'
' Dua cara masuk: token sumber dari menu Sumber Data Eksternal (jenis
' "Persediaan Material"), disimpan di file dan dipakai lebih dulu; atau email +
' password akun ShipHub, ditanya sekali setiap Excel dibuka.

Private Const DEFAULT_URL As String = "https://siaga.shipyard.my.id"
Private Const PROP_URL As String = "ShipHubURL"
Private Const PROP_EMAIL As String = "ShipHubEmail"
Private Const PROP_AUTO As String = "ShipHubAutoSync"
Private Const PROP_TOKEN As String = "ShipHubToken"
Private Const PROP_SOURCE As String = "ShipHubSumber"

Private mToken As String

' kunci | label | sumber | Header Excel=kolom ShipHub;...
' Sumber: nama tabel Excel (ListObject), atau "sheet:<nama>" untuk range biasa.
Private Function Datasets() As Variant
    Datasets = Array( _
        "material|Master Material|tblMaterial|Kode Material=kategori;Nama Material=nama;CODA=coda;Ukuran=ukuran;Satuan=satuan;Stok Minimum=stok_minimum;Aktif=aktif;Catatan=catatan;Status Data=status_data", _
        "saldo-awal|Saldo Awal|tblSaldoAwal|ID Saldo Awal=id_saldo_awal;Tanggal Cut Off=tanggal;Kode Material=kategori;Nama Material=nama;Proyek=proyek;Gudang=gudang;Qty Saldo Awal=qty;Satuan=satuan;Nilai Saldo Awal=nilai;Harga Unit=harga_unit;Qty Terpakai FIFO=qty_terpakai;Sisa Saldo FIFO=sisa_qty;Nilai Sisa FIFO=nilai_sisa;Ukuran=ukuran;Catatan=catatan", _
        "pembelian|Pembelian|tblPembelian|ID Pembelian=id_pembelian;Tanggal=tanggal;No. PO=no_po;Kode Material=kategori;Nama Material=nama;Ukuran=ukuran;Pemasok=pemasok;Proyek=proyek;Gudang=gudang;Qty=qty;Satuan=satuan;Harga Unit=harga_unit;Nilai Pembelian=nilai;Qty Terpakai FIFO=qty_terpakai;Sisa Lot FIFO=sisa_qty;Nilai Sisa Lot=nilai_sisa;Catatan=catatan", _
        "pemakaian|Pemakaian|tblPemakaian|ID Pemakaian=id_pemakaian;Tanggal=tanggal;No. Dokumen=no_dokumen;Kode Material=kategori;Nama Material=nama;Ukuran=ukuran;Proyek=proyek;Gudang=gudang;Qty=qty;Satuan=satuan;Pemakai/Bagian=pemakai;Biaya FIFO=biaya_fifo;Harga FIFO Rata-rata=harga_rata;Catatan=catatan", _
        "stok|Persediaan (stok)|sheet:Persediaan|Kode Material=kategori;Nama Material=nama;Ukuran=ukuran;Gudang=gudang;Satuan=satuan;ID Saldo Awal=id_saldo_awal;Tanggal Cut Off=tanggal_cutoff;Qty Saldo Awal=qty_saldo_awal;Nilai Saldo Awal=nilai_saldo_awal;Harga Unit Saldo Awal=harga_unit_saldo_awal;Qty Terpakai FIFO=qty_terpakai;Sisa Saldo FIFO=sisa_saldo;Nilai Sisa FIFO=nilai_sisa;Total Pembelian=total_pembelian;Total Pemakaian=total_pemakaian;Stok Akhir=stok_akhir;Stok Minimum=stok_minimum;Nilai Stok FIFO=nilai_stok;Harga FIFO Rata-rata=harga_rata;Status=status")
End Function

' ---------------------------------------------------------------- macro user

Public Sub ShipHub_SinkronPersediaan()
    Dim laporan As String
    On Error GoTo Gagal
    If MsgBox("Kirim semua tabel persediaan ke " & BaseUrl() & "?" & vbLf & _
              "Isi menu Persediaan Material di ShipHub akan diganti dengan isi file ini.", _
              vbYesNo + vbQuestion, "ShipHub") <> vbYes Then Exit Sub
    laporan = ShipHub_Sinkron()
    MsgBox laporan, IIf(InStr(laporan, "GAGAL") > 0, vbExclamation, vbInformation), "ShipHub"
    Exit Sub
Gagal:
    Application.StatusBar = False
    MsgBox "Sinkron dibatalkan: " & Err.Description, vbExclamation, "ShipHub"
End Sub

' Dipanggil dari ThisWorkbook.Workbook_AfterSave.
Public Sub ShipHub_SetelahSimpan()
    Dim laporan As String
    If UCase(Prop(PROP_AUTO, "OFF")) <> "ON" Then Exit Sub
    On Error GoTo Gagal
    laporan = ShipHub_Sinkron()
    If InStr(laporan, "GAGAL") > 0 Then
        MsgBox laporan, vbExclamation, "ShipHub"
    Else
        Application.StatusBar = "ShipHub: persediaan tersinkron " & Format(Now, "hh:nn")
    End If
    Exit Sub
Gagal:
    Application.StatusBar = False
    MsgBox "File tersimpan, tapi kirim ke ShipHub gagal: " & Err.Description, vbExclamation, "ShipHub"
End Sub

Public Sub ShipHub_AutoSinkron()
    If UCase(Prop(PROP_AUTO, "OFF")) = "ON" Then
        SetProp PROP_AUTO, "OFF"
        MsgBox "Kirim otomatis saat menyimpan: MATI.", vbInformation, "ShipHub"
    Else
        SetProp PROP_AUTO, "ON"
        MsgBox "Kirim otomatis saat menyimpan: NYALA." & vbLf & _
               "Setiap kali file disimpan (Ctrl+S), semua tabel dikirim ke ShipHub.", vbInformation, "ShipHub"
    End If
End Sub

Public Sub ShipHub_AturServer()
    Dim url As String, email As String
    url = InputBox("Alamat server ShipHub:", "ShipHub", BaseUrl())
    If url = "" Then Exit Sub
    email = InputBox("Email login ShipHub:", "ShipHub", Prop(PROP_EMAIL, ""))
    SetProp PROP_URL, Trim(url)
    If email <> "" Then SetProp PROP_EMAIL, Trim(email)
    mToken = ""
    MsgBox "Tersimpan di file ini. Login akan diminta saat kirim berikutnya.", vbInformation, "ShipHub"
End Sub

Public Sub ShipHub_Logout()
    mToken = ""
    MsgBox "Login password dilupakan." & IIf(PakaiToken(), " Token sumber tetap terpasang (hapus lewat ShipHub_AturToken).", ""), _
           vbInformation, "ShipHub"
End Sub

' Token dan URL tujuan disalin dari ShipHub: Sumber Data Eksternal, sumber
' berjenis "Persediaan Material". Kosongkan URL untuk kembali ke login password.
Public Sub ShipHub_AturToken()
    Dim url As String, token As String, p As Long
    url = Trim(InputBox("URL tujuan sumber (dari Sumber Data Eksternal)," & vbLf & _
                        "mis. https://siaga.shipyard.my.id/api/ingest/master-inventory" & vbLf & vbLf & _
                        "Kosongkan untuk menghapus token dan kembali ke login password.", _
                        "ShipHub", IIf(PakaiToken(), BaseUrl() & "/api/ingest/" & Prop(PROP_SOURCE, ""), "")))
    If url = "" Then
        If PakaiToken() Then
            HapusProp PROP_TOKEN
            HapusProp PROP_SOURCE
            MsgBox "Token dihapus. Kirim berikutnya memakai login email + password.", vbInformation, "ShipHub"
        End If
        Exit Sub
    End If
    p = InStr(1, url, "/api/ingest/", vbTextCompare)
    If p = 0 Or Len(url) <= p + Len("/api/ingest/") - 1 Then
        MsgBox "URL harus berbentuk https://.../api/ingest/<id-sumber>.", vbExclamation, "ShipHub"
        Exit Sub
    End If
    token = Trim(InputBox("Token sumber (diawali shs_):", "ShipHub"))
    If Left(token, 4) <> "shs_" Then
        MsgBox "Token harus diawali shs_. Tidak ada yang diubah.", vbExclamation, "ShipHub"
        Exit Sub
    End If
    SetProp PROP_URL, Left(url, p - 1)
    SetProp PROP_SOURCE, Replace(Mid(url, p + Len("/api/ingest/")), "/", "")
    SetProp PROP_TOKEN, token
    mToken = ""
    MsgBox "Token tersimpan di file ini. Kirim berikutnya tidak meminta password." & vbLf & _
           "Siapa pun yang memegang file ini bisa mengirim data persediaan; kalau file dibagikan, ganti token di ShipHub.", _
           vbInformation, "ShipHub"
End Sub

' Mengirim semua tabel; mengembalikan laporan per tabel. Error hanya untuk
' hal yang menghentikan semuanya (login dibatalkan / gagal).
Public Function ShipHub_Sinkron() As String
    Dim ds As Variant, laporan As String
    If Application.Calculation <> xlCalculationAutomatic Then Application.Calculate
    If PakaiToken() Then
        CekToken   ' sekali di depan: token ditolak = berhenti, bukan 5 kiriman gagal
    Else
        Token   ' login sekali di depan, bukan per tabel
    End If
    For Each ds In Datasets()
        laporan = laporan & SinkronSatu(CStr(ds)) & vbLf
    Next
    Application.StatusBar = False
    ShipHub_Sinkron = "Hasil kirim ke " & BaseUrl() & ":" & vbLf & vbLf & laporan
End Function

' ---------------------------------------------------------------- per tabel

Private Function SinkronSatu(ByVal spec As String) As String
    Dim bagian() As String, data As Variant, json As String, jumlah As Long
    Dim status As Long, resp As String, peringatan As Long
    bagian = Split(spec, "|")
    On Error GoTo Gagal

    Application.StatusBar = "ShipHub: membaca " & bagian(1) & "..."
    data = RangeSumber(bagian(2)).Value
    json = BuatJson(data, bagian(3), jumlah)
    If jumlah = 0 Then
        SinkronSatu = bagian(1) & ": kosong, tidak dikirim (data lama di ShipHub tetap)."
        Exit Function
    End If

    Application.StatusBar = "ShipHub: mengirim " & bagian(1) & " (" & jumlah & " baris)..."
    If PakaiToken() Then
        resp = KirimDenganToken("{""dataset"":""" & bagian(0) & """,""source"":""" & JsonEsc(ThisWorkbook.Name) & _
                                """,""rows"":[" & json & "]}", status)
    Else
        resp = Panggil("POST", "/api/inventory/sync/" & bagian(0), _
                       "{""source"":""" & JsonEsc(ThisWorkbook.Name) & """,""rows"":[" & json & "]}", status)
    End If
    If status = 401 And PakaiToken() Then
        SinkronSatu = bagian(1) & ": GAGAL token ditolak (diganti, atau sumber dinonaktifkan). Pasang ulang lewat ShipHub_AturToken."
        Exit Function
    End If
    If status <> 200 Then
        SinkronSatu = bagian(1) & ": GAGAL (HTTP " & status & ") " & PesanError(resp)
        Exit Function
    End If
    If PakaiToken() Then
        SinkronSatu = bagian(1) & ": " & AngkaDari(resp, "saved") & " baris terkirim"
        If InStr(resp, """problems"":[""") > 0 Then SinkronSatu = SinkronSatu & " (ada nilai bukan angka/tanggal yang dikosongkan; rinciannya di Sumber Data Eksternal)"
    Else
        SinkronSatu = bagian(1) & ": " & AngkaDari(resp, "rows") & " baris terkirim"
        peringatan = AngkaDari(resp, "warning_count")
        If peringatan > 0 Then SinkronSatu = SinkronSatu & " (" & peringatan & " nilai bukan angka/tanggal dikosongkan)"
    End If
    Exit Function
Gagal:
    SinkronSatu = bagian(1) & ": GAGAL " & Err.Description
End Function

' Range berisi baris header + data.
Private Function RangeSumber(ByVal sumber As String) As Range
    Dim ws As Worksheet, lo As ListObject, hdrRow As Long, namaCol As Long
    Dim lastRow As Long, lastCol As Long, r As Long, c As Long
    If Left(sumber, 6) = "sheet:" Then
        On Error Resume Next
        Set ws = ThisWorkbook.Worksheets(Mid(sumber, 7))
        On Error GoTo 0
        If ws Is Nothing Then Err.Raise vbObjectError + 10, "ShipHub", "Sheet '" & Mid(sumber, 7) & "' tidak ditemukan."
        ' baris header = baris pertama yang punya sel "Nama Material"
        For r = 1 To 20
            For c = 1 To 40
                If Not IsError(ws.Cells(r, c).Value) Then
                    If Trim(CStr(ws.Cells(r, c).Value)) = "Nama Material" Then
                        hdrRow = r
                        namaCol = c
                        Exit For
                    End If
                End If
            Next
            If hdrRow > 0 Then Exit For
        Next
        If hdrRow = 0 Then Err.Raise vbObjectError + 11, "ShipHub", "Header 'Nama Material' tidak ditemukan di sheet " & ws.Name & "."
        lastRow = ws.Cells(ws.Rows.Count, namaCol).End(xlUp).Row
        If lastRow <= hdrRow Then lastRow = hdrRow + 1
        lastCol = ws.Cells(hdrRow, ws.Columns.Count).End(xlToLeft).Column
        Set RangeSumber = ws.Range(ws.Cells(hdrRow, 1), ws.Cells(lastRow, lastCol))
        Exit Function
    End If
    For Each ws In ThisWorkbook.Worksheets
        For Each lo In ws.ListObjects
            If StrComp(lo.Name, sumber, vbTextCompare) = 0 Then
                Set RangeSumber = lo.Range
                Exit Function
            End If
        Next
    Next
    Err.Raise vbObjectError + 12, "ShipHub", "Tabel Excel '" & sumber & "' tidak ditemukan."
End Function

' data: array 2D, baris 1 = header. Mengembalikan objek JSON per baris,
' dipisah koma. Baris tanpa Nama Material dilewati.
Private Function BuatJson(data As Variant, ByVal peta As String, ByRef jumlah As Long) As String
    Dim pasangan() As String, n As Long, i As Long, j As Long, r As Long
    Dim kolIdx() As Long, kolom() As String, header As String, namaIdx As Long
    Dim baris() As String, s As String, v As Variant

    pasangan = Split(peta, ";")
    n = UBound(pasangan) + 1
    ReDim kolIdx(1 To n)
    ReDim kolom(1 To n)
    For i = 1 To n
        header = Split(pasangan(i - 1), "=")(0)
        kolom(i) = Split(pasangan(i - 1), "=")(1)
        For j = 1 To UBound(data, 2)
            If Not IsError(data(1, j)) Then
                If StrComp(Trim(CStr(data(1, j))), header, vbTextCompare) = 0 Then
                    kolIdx(i) = j
                    Exit For
                End If
            End If
        Next
        If kolIdx(i) = 0 Then Err.Raise vbObjectError + 13, "ShipHub", "kolom '" & header & "' tidak ditemukan (nama kolom diubah?)"
        If kolom(i) = "nama" Then namaIdx = kolIdx(i)
    Next

    jumlah = 0
    ReDim baris(1 To UBound(data, 1))
    For r = 2 To UBound(data, 1)
        v = data(r, namaIdx)
        If Not IsError(v) Then
            If Len(Trim(CStr(v))) > 0 Then
                s = ""
                For i = 1 To n
                    v = data(r, kolIdx(i))
                    If Not IsError(v) Then
                        If Len(CStr(v)) > 0 Then s = s & IIf(Len(s) = 0, "", ",") & """" & kolom(i) & """:" & JsonVal(v)
                    End If
                Next
                jumlah = jumlah + 1
                baris(jumlah) = "{" & s & "}"
            End If
        End If
    Next
    If jumlah = 0 Then Exit Function
    ReDim Preserve baris(1 To jumlah)
    BuatJson = Join(baris, ",")
End Function

' ---------------------------------------------------------------- HTTP

Private Function Panggil(ByVal method As String, ByVal path As String, ByVal body As String, ByRef status As Long) As String
    Dim http As Object, attempt As Long
    For attempt = 1 To 2
        Set http = CreateObject("MSXML2.XMLHTTP.6.0")
        http.Open method, BaseUrl() & path, False
        http.setRequestHeader "Authorization", "Bearer " & Token()
        http.setRequestHeader "Cache-Control", "no-cache"
        If Len(body) > 0 Then http.setRequestHeader "Content-Type", "application/json"
        http.send body
        status = http.Status
        If status <> 401 Then Exit For
        mToken = ""   ' token kedaluwarsa: login ulang sekali
    Next
    Panggil = http.responseText
End Function

Private Function PakaiToken() As Boolean
    PakaiToken = Len(Prop(PROP_TOKEN, "")) > 0 And Len(Prop(PROP_SOURCE, "")) > 0
End Function

' Token sumber: tanpa login, tanpa coba ulang (401 berarti token harus diganti).
Private Function KirimDenganToken(ByVal body As String, ByRef status As Long) As String
    Dim http As Object
    Set http = CreateObject("MSXML2.XMLHTTP.6.0")
    http.Open "POST", BaseUrl() & "/api/ingest/" & Prop(PROP_SOURCE, ""), False
    http.setRequestHeader "Authorization", "Bearer " & Prop(PROP_TOKEN, "")
    http.setRequestHeader "Content-Type", "application/json"
    http.send body
    status = http.Status
    KirimDenganToken = http.responseText
End Function

' Kiriman kecil tanpa dataset: server menjawab 400 kalau token benar, 401
' kalau salah. Tidak ada data yang berubah.
Private Sub CekToken()
    Dim status As Long, resp As String
    resp = KirimDenganToken("{""rows"":[]}", status)
    If status = 401 Then Err.Raise vbObjectError + 20, "ShipHub", _
        "token ditolak (sudah diganti, atau sumber dinonaktifkan). Pasang token baru lewat ShipHub_AturToken."
    If status = 404 Or status = 0 Then Err.Raise vbObjectError + 21, "ShipHub", _
        "server tidak bisa dihubungi atau URL sumber salah (" & BaseUrl() & "/api/ingest/" & Prop(PROP_SOURCE, "") & ")."
End Sub

Private Function Token() As String
    If mToken = "" Then mToken = Login()
    Token = mToken
End Function

Private Function Login() As String
    Dim email As String, pw As String, http As Object, resp As String, p As Long
    email = Prop(PROP_EMAIL, "")
    If email = "" Then
        email = Trim(InputBox("Email login ShipHub:", "ShipHub"))
        If email = "" Then Err.Raise vbObjectError + 1, "ShipHub", "Login dibatalkan."
        SetProp PROP_EMAIL, email
    End If
    pw = InputBox("Password ShipHub untuk " & email & ":", "ShipHub")
    If pw = "" Then Err.Raise vbObjectError + 1, "ShipHub", "Login dibatalkan."

    Set http = CreateObject("MSXML2.XMLHTTP.6.0")
    http.Open "POST", BaseUrl() & "/api/auth/login", False
    http.setRequestHeader "Content-Type", "application/json"
    http.send "{""email"":""" & JsonEsc(email) & """,""password"":""" & JsonEsc(pw) & """}"
    resp = http.responseText
    p = InStr(resp, """token"":""")
    If http.Status <> 200 Or p = 0 Then Err.Raise vbObjectError + 1, "ShipHub", "Login gagal (HTTP " & http.Status & ") " & PesanError(resp)
    p = p + Len("""token"":""")
    Login = Mid$(resp, p, InStr(p, resp, """") - p)
End Function

Private Function PesanError(ByVal resp As String) As String
    Dim p As Long, q As Long
    p = InStr(resp, """error"":""")
    If p = 0 Then
        PesanError = Left(resp, 200)
        Exit Function
    End If
    p = p + Len("""error"":""")
    q = InStr(p, resp, """")
    If q = 0 Then q = Len(resp) + 1
    PesanError = Mid$(resp, p, q - p)
End Function

Private Function AngkaDari(ByVal resp As String, ByVal kunci As String) As Long
    Dim p As Long
    p = InStr(resp, """" & kunci & """:")
    If p > 0 Then AngkaDari = Val(Mid$(resp, p + Len(kunci) + 3))
End Function

' ---------------------------------------------------------------- pengaturan di file

Private Function BaseUrl() As String
    Dim v As String
    v = Prop(PROP_URL, DEFAULT_URL)
    If Right(v, 1) = "/" Then v = Left(v, Len(v) - 1)
    BaseUrl = v
End Function

Private Function Prop(ByVal nama As String, ByVal bawaan As String) As String
    Prop = bawaan
    On Error Resume Next
    Prop = CStr(ThisWorkbook.CustomDocumentProperties(nama).Value)
End Function

Private Sub SetProp(ByVal nama As String, ByVal nilai As String)
    On Error Resume Next
    ThisWorkbook.CustomDocumentProperties(nama).Delete
    On Error GoTo 0
    ThisWorkbook.CustomDocumentProperties.Add Name:=nama, LinkToContent:=False, Type:=4, Value:=nilai
End Sub

Private Sub HapusProp(ByVal nama As String)
    On Error Resume Next
    ThisWorkbook.CustomDocumentProperties(nama).Delete
End Sub

' ---------------------------------------------------------------- JSON

Private Function JsonVal(ByVal v As Variant) As String
    Dim s As String
    Select Case VarType(v)
        Case vbBoolean
            JsonVal = IIf(v, "true", "false")
        Case vbDate
            JsonVal = """" & Format(v, "yyyy-mm-dd") & """"
        Case vbInteger, vbLong, vbSingle, vbDouble, vbCurrency, vbDecimal, vbByte
            s = Trim(Str(v))   ' Str selalu pakai titik desimal, tidak ikut setelan regional
            If Left(s, 1) = "." Then s = "0" & s
            If Left(s, 2) = "-." Then s = "-0" & Mid(s, 2)
            JsonVal = s
        Case Else
            JsonVal = """" & JsonEsc(CStr(v)) & """"
    End Select
End Function

Private Function JsonEsc(ByVal s As String) As String
    Dim i As Long, ch As String, code As Long, out As String
    For i = 1 To Len(s)
        ch = Mid$(s, i, 1)
        code = AscW(ch)
        Select Case code
            Case 34: out = out & "\"""
            Case 92: out = out & "\\"
            Case 10: out = out & "\n"
            Case 13: out = out & "\r"
            Case 9: out = out & "\t"
            Case 0 To 31: out = out & "\u" & Right("000" & Hex(code), 4)
            Case Else: out = out & ch
        End Select
    Next
    JsonEsc = out
End Function
