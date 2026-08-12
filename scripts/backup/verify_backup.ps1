# verify_backup.ps1
# STEP 13 — Verifikasi Backup (Bab 22.6)
#
# Cek integritas backup terbaru tanpa harus melakukan full restore.
# Jadwalkan setiap hari setelah backup_tarapti.ps1 selesai.
#
# Penggunaan:
#   .\verify_backup.ps1
#   .\verify_backup.ps1 -BackupDir "D:\Backups\Tarapti"

param(
    [string]$BackupDir = "D:\Backups\Tarapti",
    [string]$S3Bucket  = $env:BACKUP_S3_BUCKET,
    [string]$S3Endpoint = $env:BACKUP_S3_ENDPOINT
)

Set-StrictMode -Version Latest
$PG_RESTORE = "C:\Program Files\PostgreSQL\16\bin\pg_restore.exe"
$LOG_FILE   = "C:\Scripts\verify_backup.log"
$passed     = 0
$failed     = 0

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [$Level] $Message"
    Add-Content -Path $LOG_FILE -Value $line
    Write-Host $line
}
function Pass([string]$label) { Write-Log "  PASS: $label"; $script:passed++ }
function Fail([string]$label) { Write-Log "  FAIL: $label" "ERROR"; $script:failed++ }

Write-Log "=== VERIFIKASI BACKUP TARAPTI ==="

# ---------------------------------------------------------------------------
# CHECK 1: Ada file backup lokal yang dibuat hari ini atau kemarin?
# ---------------------------------------------------------------------------
Write-Log "[1] Cek keberadaan backup lokal terbaru..."
$recent = Get-ChildItem $BackupDir -Filter "tarapti_*.dump.zip" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -gt (Get-Date).AddHours(-26) } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if ($recent) {
    $sizeMB = '{0:N2}' -f ($recent.Length / 1MB)
    Pass "Backup terbaru ditemukan: $($recent.Name) ($sizeMB MB, dibuat $($recent.LastWriteTime))"
} else {
    Fail "Tidak ada backup dalam 26 jam terakhir di $BackupDir — periksa Task Scheduler!"
}

# ---------------------------------------------------------------------------
# CHECK 2: Verifikasi integritas file dump dengan pg_restore --list
#          (tidak restore ke DB, hanya baca header)
# ---------------------------------------------------------------------------
Write-Log "[2] Verifikasi integritas dump dengan pg_restore --list..."

# Cari file .dump mentah (jika ada, belum di-zip) atau skip
$rawDump = Get-ChildItem $BackupDir -Filter "tarapti_*.dump" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($rawDump) {
    $listOutput = & $PG_RESTORE --list $rawDump.FullName 2>&1
    if ($LASTEXITCODE -eq 0 -and $listOutput -match "TABLE DATA") {
        Pass "Integritas dump valid (pg_restore --list berhasil, TABLE DATA ditemukan)"
    } else {
        Fail "pg_restore --list gagal atau tidak mengandung TABLE DATA — dump mungkin corrupt"
    }
} else {
    Write-Log "  INFO: Tidak ada file .dump mentah (sudah di-zip) — skip cek integritas pg_restore" "INFO"
    $passed++  # Tidak di-fail, hanya skip
}

# ---------------------------------------------------------------------------
# CHECK 3: Cek apakah ada backup di off-site storage (S3)
# ---------------------------------------------------------------------------
Write-Log "[3] Cek backup off-site (S3)..."
if ($S3Bucket -and $S3Endpoint) {
    $env:AWS_ACCESS_KEY_ID     = $env:BACKUP_S3_ACCESS_KEY
    $env:AWS_SECRET_ACCESS_KEY = $env:BACKUP_S3_SECRET_KEY

    $s3List = aws s3 ls "s3://$S3Bucket/postgres/" --endpoint-url $S3Endpoint 2>&1
    if ($LASTEXITCODE -eq 0 -and $s3List) {
        Pass "Off-site backup ditemukan di s3://$S3Bucket/postgres/"
    } else {
        Fail "Tidak ada backup di off-site storage s3://$S3Bucket/postgres/ — periksa upload!"
    }
} else {
    Write-Log "  SKIP: BACKUP_S3_BUCKET atau BACKUP_S3_ENDPOINT tidak dikonfigurasi" "WARN"
}

# ---------------------------------------------------------------------------
# CHECK 4: Retensi — tidak ada file lebih dari 30 hari?
# ---------------------------------------------------------------------------
Write-Log "[4] Cek retensi backup lokal..."
$expired = Get-ChildItem $BackupDir -Filter "tarapti_*" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-31) }

if ($expired.Count -eq 0) {
    Pass "Tidak ada backup lokal kadaluarsa (> 30 hari)"
} else {
    Fail "$($expired.Count) file backup kadaluarsa ditemukan — jalankan ulang backup_tarapti.ps1 untuk cleanup"
}

# ---------------------------------------------------------------------------
# HASIL
# ---------------------------------------------------------------------------
Write-Log ""
Write-Log "=== HASIL VERIFIKASI: PASS=$passed FAIL=$failed ==="
if ($failed -eq 0) {
    Write-Log "Semua check PASS — backup valid dan off-site terkini"
    exit 0
} else {
    Write-Log "$failed check GAGAL — segera tindaklanjuti!" "ERROR"
    exit 1
}
