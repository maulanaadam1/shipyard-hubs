Attribute VB_Name = "ShipHub"
Option Explicit

' Excel <-> ShipHub
'
' Sheet "Config": B1 = URL server, B2 = email login, B3 = realtime (ON/OFF)
' Sheet data    : nama sheet = nama tabel ShipHub, baris 1 = nama kolom.
'                 Kolom "id" wajib ada ("unique_id" untuk deployment_records).
'
' Macro yang dijalankan user:
'   ShipHub_Setup      buat sheet Config
'   ShipHub_Tarik      ambil isi tabel ke sheet aktif (menimpa isi sheet)
'   ShipHub_KirimSemua kirim semua baris sheet aktif (upsert)
'   ShipHub_Logout     lupakan token, login ulang di request berikutnya
' Realtime: panggil ShipHub_OnChange dari Workbook_SheetChange (lihat README).

Private Type GUID_T
    Data1 As Long
    Data2 As Integer
    Data3 As Integer
    Data4(0 To 7) As Byte
End Type

#If VBA7 Then
Private Declare PtrSafe Function CoCreateGuid Lib "ole32" (ByRef g As GUID_T) As Long
#Else
Private Declare Function CoCreateGuid Lib "ole32" (ByRef g As GUID_T) As Long
#End If

Private Const DEFAULT_URL As String = "https://siaga.shipyard.my.id"
Private Const BATCH_SIZE As Long = 100
' Tabel user, role, permission dan sync_configs sengaja tidak dibuka untuk macro.
Private Const ALLOWED As String = "|equipment|loan_requests|deployment_records|vendors|companies|ships|projects|dropdown_configs|equipment_release|approval_workflow|notifications|master_locations|ship_movements|master_status_dock|vessel_layouts|master_services|master_employees|master_components|"

Private mToken As String

' ---------------------------------------------------------------- macro user

Public Sub ShipHub_Setup()
    Dim ws As Worksheet
    On Error Resume Next
    Set ws = ThisWorkbook.Sheets("Config")
    On Error GoTo 0
    If ws Is Nothing Then
        Set ws = ThisWorkbook.Sheets.Add(Before:=ThisWorkbook.Sheets(1))
        ws.Name = "Config"
    End If
    ws.Range("A1:A3").Value = Application.Transpose(Array("URL server", "Email", "Realtime (ON/OFF)"))
    If Len(ws.Range("B1").Value) = 0 Then ws.Range("B1").Value = DEFAULT_URL
    If Len(ws.Range("B3").Value) = 0 Then ws.Range("B3").Value = "OFF"
    ws.Columns("A:B").AutoFit
    ws.Activate
    MsgBox "Isi email di B2. Realtime aktif kalau B3 = ON.", vbInformation, "ShipHub"
End Sub

Public Sub ShipHub_Logout()
    mToken = ""
    MsgBox "Token dihapus. Request berikutnya akan minta login.", vbInformation, "ShipHub"
End Sub

Public Sub ShipHub_Tarik()
    Dim ws As Worksheet, tabel As String, status As Long, resp As String
    Dim data As Variant, c As Long
    On Error GoTo Gagal

    tabel = LCase(Trim(ActiveSheet.Name))
    If Not TabelDiizinkan(tabel) Then
        tabel = LCase(Trim(InputBox("Sheet ini bukan tabel ShipHub. Nama tabel yang mau ditarik:", "ShipHub", "vendors")))
        If tabel = "" Then Exit Sub
        If Not TabelDiizinkan(tabel) Then Err.Raise vbObjectError + 2, "ShipHub", "Tabel '" & tabel & "' tidak tersedia untuk macro."
        Set ws = SheetUntuk(tabel)
    Else
        Set ws = ActiveSheet
    End If

    If Application.WorksheetFunction.CountA(ws.Cells) > 0 Then
        If MsgBox("Isi sheet '" & ws.Name & "' akan diganti dengan data dari ShipHub. Lanjut?", vbYesNo + vbQuestion, "ShipHub") <> vbYes Then Exit Sub
    End If

    Application.StatusBar = "ShipHub: menarik " & tabel & "..."
    resp = Panggil("GET", "/api/export/" & tabel & "/csv?_=" & Format(Now, "yyyymmddhhnnss"), "", status)
    If status <> 200 Then Err.Raise vbObjectError + 3, "ShipHub", "HTTP " & status & ": " & Left(resp, 300)
    data = ParseCSV(resp)
    If IsEmpty(data) Then Err.Raise vbObjectError + 3, "ShipHub", "Server mengirim data kosong."

    Application.EnableEvents = False
    Application.ScreenUpdating = False
    ws.Cells.Clear
    With ws.Range("A1").Resize(UBound(data, 1), UBound(data, 2))
        .NumberFormat = "@"   ' teks, supaya kode seperti 0812 / 001 tidak berubah
        .Value = data
    End With
    ws.Rows(1).Font.Bold = True
    ws.Columns.AutoFit
    For c = 1 To UBound(data, 2)
        If ws.Columns(c).ColumnWidth > 50 Then ws.Columns(c).ColumnWidth = 50
    Next
    ws.Activate
    Application.ScreenUpdating = True
    MsgBox UBound(data, 1) - 1 & " baris ditarik dari " & tabel & ".", vbInformation, "ShipHub"

Keluar:
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    Application.StatusBar = False
    Exit Sub
Gagal:
    MsgBox "Gagal menarik data: " & Err.Description, vbExclamation, "ShipHub"
    Resume Keluar
End Sub

Public Sub ShipHub_KirimSemua()
    Dim ws As Worksheet, tabel As String, pk As Long, lastRow As Long, lastCol As Long
    Dim r As Long, body As String, daftar As Collection, errMsg As String
    Dim ok As Long, gagal As Long, pesanGagal As String
    On Error GoTo Gagal

    Set ws = ActiveSheet
    tabel = TabelDari(ws)
    lastCol = KolomTerakhir(ws)
    pk = KolomPK(ws, tabel, lastCol)
    lastRow = ws.UsedRange.Row + ws.UsedRange.Rows.Count - 1
    If lastRow < 2 Then Err.Raise vbObjectError + 5, "ShipHub", "Tidak ada data di bawah header."

    If MsgBox("Kirim " & lastRow - 1 & " baris ke tabel '" & tabel & "' di " & BaseUrl() & "?" & vbLf & _
              "Baris dengan id yang sudah ada akan di-update.", vbYesNo + vbQuestion, "ShipHub") <> vbYes Then Exit Sub

    Application.EnableEvents = False
    Set daftar = New Collection
    For r = 2 To lastRow
        If BarisAdaIsi(ws, r, lastCol) Then
            PastikanId ws, r, pk
            body = body & IIf(daftar.Count = 0, "", ",") & "{" & RowJson(ws, r, lastCol, Nothing) & "}"
            daftar.Add r
            If daftar.Count = BATCH_SIZE Or r = lastRow Then
                Application.StatusBar = "ShipHub: mengirim sampai baris " & r & " dari " & lastRow & "..."
                If KirimBaris(ws, tabel, pk, daftar, body, errMsg) Then
                    ok = ok + daftar.Count
                Else
                    gagal = gagal + daftar.Count
                    If pesanGagal = "" Then pesanGagal = errMsg
                End If
                Set daftar = New Collection
                body = ""
            End If
        End If
    Next
    If daftar.Count > 0 Then   ' sisa kalau baris terakhir kosong
        If KirimBaris(ws, tabel, pk, daftar, body, errMsg) Then
            ok = ok + daftar.Count
        Else
            gagal = gagal + daftar.Count
            If pesanGagal = "" Then pesanGagal = errMsg
        End If
    End If

    If gagal = 0 Then
        MsgBox ok & " baris terkirim ke " & tabel & ".", vbInformation, "ShipHub"
    Else
        MsgBox ok & " baris terkirim, " & gagal & " baris (merah) gagal." & vbLf & vbLf & pesanGagal & vbLf & vbLf & _
               "Aman dijalankan ulang: id sudah terisi, jadi tidak membuat data dobel.", vbExclamation, "ShipHub"
    End If

Keluar:
    Application.EnableEvents = True
    Application.StatusBar = False
    Exit Sub
Gagal:
    MsgBox "Gagal mengirim: " & Err.Description, vbExclamation, "ShipHub"
    Resume Keluar
End Sub

' Dipanggil dari ThisWorkbook.Workbook_SheetChange.
Public Sub ShipHub_OnChange(ByVal ws As Worksheet, ByVal Target As Range)
    Dim tabel As String, lastCol As Long, pk As Long, cell As Range
    Dim baris As Object, r As Variant, body As String, daftar As Collection, errMsg As String
    Dim v As Variant

    If UCase(ConfigValue("B3")) <> "ON" Then Exit Sub
    tabel = LCase(Trim(ws.Name))
    If Not TabelDiizinkan(tabel) Then Exit Sub
    If Target.Cells.CountLarge > 5000 Then
        Application.StatusBar = "ShipHub: perubahan terlalu besar untuk realtime, jalankan ShipHub_KirimSemua."
        Exit Sub
    End If

    On Error GoTo Gagal
    lastCol = KolomTerakhir(ws)
    pk = KolomPK(ws, tabel, lastCol)

    ' baris yang berubah -> kolom yang dikosongkan user (dikirim sebagai null)
    Set baris = CreateObject("Scripting.Dictionary")
    For Each cell In Target.Cells
        If cell.Row >= 2 And cell.Column <= lastCol Then
            If Not baris.Exists(cell.Row) Then baris.Add cell.Row, CreateObject("Scripting.Dictionary")
            v = cell.Value
            If Not IsError(v) Then
                If Len(CStr(v)) = 0 Then baris.Item(cell.Row).Item(cell.Column) = True
            End If
        End If
    Next
    If baris.Count = 0 Then Exit Sub

    Application.EnableEvents = False
    Set daftar = New Collection
    For Each r In baris.Keys
        If BarisAdaIsi(ws, CLng(r), lastCol) Then
            PastikanId ws, CLng(r), pk
            body = body & IIf(daftar.Count = 0, "", ",") & "{" & RowJson(ws, CLng(r), lastCol, baris.Item(r)) & "}"
            daftar.Add r
        End If
    Next
    Application.EnableEvents = True
    If daftar.Count = 0 Then Exit Sub

    If KirimBaris(ws, tabel, pk, daftar, body, errMsg) Then
        Application.StatusBar = "ShipHub: " & daftar.Count & " baris tersimpan (" & Format(Now, "hh:nn:ss") & ")"
    Else
        Application.StatusBar = "ShipHub GAGAL: " & errMsg
    End If
    Exit Sub
Gagal:
    Application.EnableEvents = True
    Application.StatusBar = "ShipHub GAGAL: " & Err.Description
End Sub

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

Private Function Token() As String
    If mToken = "" Then mToken = Login()
    Token = mToken
End Function

Private Function Login() As String
    Dim email As String, pw As String, http As Object, resp As String, p As Long
    email = ConfigValue("B2")
    If email = "" Then email = Trim(InputBox("Email ShipHub:", "ShipHub"))
    If email = "" Then Err.Raise vbObjectError + 1, "ShipHub", "Login dibatalkan."
    pw = InputBox("Password ShipHub untuk " & email & ":", "ShipHub")
    If pw = "" Then Err.Raise vbObjectError + 1, "ShipHub", "Login dibatalkan."

    Set http = CreateObject("MSXML2.XMLHTTP.6.0")
    http.Open "POST", BaseUrl() & "/api/auth/login", False
    http.setRequestHeader "Content-Type", "application/json"
    http.send "{""email"":""" & JsonEsc(email) & """,""password"":""" & JsonEsc(pw) & """}"
    resp = http.responseText
    p = InStr(resp, """token"":""")
    If http.Status <> 200 Or p = 0 Then Err.Raise vbObjectError + 1, "ShipHub", "Login gagal (HTTP " & http.Status & "): " & Left(resp, 200)
    p = p + Len("""token"":""")
    Login = Mid$(resp, p, InStr(p, resp, """") - p)
End Function

Private Function KirimBaris(ws As Worksheet, ByVal tabel As String, ByVal pk As Long, daftar As Collection, _
                            ByVal body As String, ByRef errMsg As String) As Boolean
    Dim status As Long, resp As String, item As Variant, warna As Long, sukses As Boolean
    resp = Panggil("POST", "/api/data/" & tabel & "?upsert=true", "[" & body & "]", status)
    sukses = (status = 200 Or status = 201)
    warna = IIf(sukses, RGB(198, 239, 206), RGB(255, 199, 206))
    For Each item In daftar
        ws.Cells(CLng(item), pk).Interior.Color = warna
    Next
    If Not sukses Then errMsg = "HTTP " & status & ": " & Left(resp, 300)
    KirimBaris = sukses
End Function

' ---------------------------------------------------------------- sheet helpers

Private Function ConfigValue(ByVal addr As String) As String
    On Error Resume Next
    ConfigValue = Trim(CStr(ThisWorkbook.Sheets("Config").Range(addr).Value))
End Function

Private Function BaseUrl() As String
    Dim v As String
    v = ConfigValue("B1")
    If v = "" Then v = DEFAULT_URL
    If Right(v, 1) = "/" Then v = Left(v, Len(v) - 1)
    BaseUrl = v
End Function

Private Function TabelDiizinkan(ByVal tabel As String) As Boolean
    TabelDiizinkan = Len(tabel) > 0 And InStr(ALLOWED, "|" & tabel & "|") > 0
End Function

Private Function TabelDari(ws As Worksheet) As String
    Dim t As String
    t = LCase(Trim(ws.Name))
    If Not TabelDiizinkan(t) Then
        Err.Raise vbObjectError + 2, "ShipHub", "Nama sheet '" & ws.Name & "' harus sama dengan nama tabel ShipHub (mis. vendors)."
    End If
    TabelDari = t
End Function

Private Function SheetUntuk(ByVal tabel As String) As Worksheet
    Dim ws As Worksheet
    On Error Resume Next
    Set ws = ThisWorkbook.Worksheets(tabel)
    On Error GoTo 0
    If ws Is Nothing Then
        Set ws = ThisWorkbook.Worksheets.Add(After:=ThisWorkbook.Sheets(ThisWorkbook.Sheets.Count))
        ws.Name = tabel
    End If
    Set SheetUntuk = ws
End Function

Private Function KolomTerakhir(ws As Worksheet) As Long
    KolomTerakhir = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column
End Function

Private Function KolomPK(ws As Worksheet, ByVal tabel As String, ByVal lastCol As Long) As Long
    Dim nama As String, c As Long
    nama = IIf(tabel = "deployment_records", "unique_id", "id")
    For c = 1 To lastCol
        If LCase(Trim(CStr(ws.Cells(1, c).Value))) = nama Then
            KolomPK = c
            Exit Function
        End If
    Next
    Err.Raise vbObjectError + 4, "ShipHub", "Kolom '" & nama & "' tidak ada di baris 1 sheet " & ws.Name & ". Tambahkan kolomnya (isinya boleh kosong)."
End Function

Private Function BarisAdaIsi(ws As Worksheet, ByVal r As Long, ByVal lastCol As Long) As Boolean
    BarisAdaIsi = Application.WorksheetFunction.CountA(ws.Range(ws.Cells(r, 1), ws.Cells(r, lastCol))) > 0
End Function

' Baris baru diberi UUID sekali, supaya kiriman berikutnya jadi update, bukan data dobel.
Private Sub PastikanId(ws As Worksheet, ByVal r As Long, ByVal pk As Long)
    If Len(CStr(ws.Cells(r, pk).Value)) = 0 Then
        ws.Cells(r, pk).NumberFormat = "@"
        ws.Cells(r, pk).Value = NewUUID()
    End If
End Sub

' ---------------------------------------------------------------- JSON / CSV

' nullCols: kolom yang dikosongkan user (dikirim null). Sel kosong lain tidak dikirim,
' jadi tidak menimpa nilai di server.
Private Function RowJson(ws As Worksheet, ByVal r As Long, ByVal lastCol As Long, nullCols As Object) As String
    Dim c As Long, v As Variant, key As String, s As String
    For c = 1 To lastCol
        key = Trim(CStr(ws.Cells(1, c).Value))
        If Len(key) > 0 Then
            v = ws.Cells(r, c).Value
            If IsError(v) Then
                ' sel #N/A, #REF! dll. dilewati
            ElseIf Len(CStr(v)) = 0 Then
                If Not nullCols Is Nothing Then
                    If nullCols.Exists(c) Then s = s & IIf(s = "", "", ",") & """" & JsonEsc(key) & """:null"
                End If
            Else
                s = s & IIf(s = "", "", ",") & """" & JsonEsc(key) & """:" & JsonVal(v)
            End If
        End If
    Next
    RowJson = s
End Function

Private Function JsonVal(ByVal v As Variant) As String
    Dim s As String
    Select Case VarType(v)
        Case vbBoolean
            JsonVal = IIf(v, "true", "false")
        Case vbDate
            If v = Int(v) Then
                JsonVal = """" & Format(v, "yyyy-mm-dd") & """"
            Else
                JsonVal = """" & Format(v, "yyyy-mm-dd hh:nn:ss") & """"
            End If
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

' CSV (RFC 4180) -> array 2D 1-based. Mendukung koma, kutip dan baris baru di dalam kutip.
Private Function ParseCSV(ByVal s As String) As Variant
    Dim semua As New Collection, baris As Collection, field As String
    Dim i As Long, n As Long, ch As String, inQ As Boolean
    Dim maxCols As Long, r As Long, c As Long, out() As Variant, item As Variant

    If Left(s, 1) = ChrW(&HFEFF) Then s = Mid(s, 2)
    Set baris = New Collection
    n = Len(s)
    i = 1
    Do While i <= n
        ch = Mid$(s, i, 1)
        If inQ Then
            If ch = """" Then
                If Mid$(s, i + 1, 1) = """" Then
                    field = field & """"
                    i = i + 1
                Else
                    inQ = False
                End If
            Else
                field = field & ch
            End If
        Else
            Select Case ch
                Case """"
                    inQ = True
                Case ","
                    baris.Add field
                    field = ""
                Case vbCr
                    ' diabaikan, akhir baris ditentukan oleh LF
                Case vbLf
                    baris.Add field
                    field = ""
                    semua.Add baris
                    Set baris = New Collection
                Case Else
                    field = field & ch
            End Select
        End If
        i = i + 1
    Loop
    If Len(field) > 0 Or baris.Count > 0 Then
        baris.Add field
        semua.Add baris
    End If
    If semua.Count = 0 Then Exit Function

    For Each item In semua
        If item.Count > maxCols Then maxCols = item.Count
    Next
    ReDim out(1 To semua.Count, 1 To maxCols)
    For r = 1 To semua.Count
        For c = 1 To semua(r).Count
            out(r, c) = semua(r)(c)
        Next
    Next
    ParseCSV = out
End Function

Private Function NewUUID() As String
    Dim g As GUID_T, i As Long, s As String
    CoCreateGuid g
    s = Right("0000000" & Hex(g.Data1), 8) & "-" & Right("000" & Hex(g.Data2), 4) & "-" & Right("000" & Hex(g.Data3), 4) & "-"
    For i = 0 To 1
        s = s & Right("0" & Hex(g.Data4(i)), 2)
    Next
    s = s & "-"
    For i = 2 To 7
        s = s & Right("0" & Hex(g.Data4(i)), 2)
    Next
    NewUUID = LCase(s)
End Function
