# backup_tarapti.ps1
# STEP 13 — BACKUP & DISASTER RECOVERY (Bab 22.2 + 22.2.1)
#
# Script backup harian PostgreSQL TARAPTI.
# Jalankan via Windows Task Scheduler: harian jam 02:00.
#   Action: powershell.exe -NonInteractive -File "C:\Scripts\backup_tarapti.ps1"
#
# WAJIB: set env var berikut di Task Scheduler atau di System Environment:
#   TARAPTI_DB_PASSWORD      = password user mt5app
#   BACKUP_ARCHIVE_PASSWORD  = password AES-256 untuk enkripsi .zip
#   BACKUP_S3_ACCESS_KEY     = access key object storage (Backblaze B2 / S3)
#   BACKUP_S3_SECRET_KEY     = secret key object storage
#   BACKUP_S3_BUCKET         = nama bucket (contoh: tarapti-backups)
#   BACKUP_S3_ENDPOINT       = endpoint URL (contoh: https://s3.us-west-002.backblazeb2.com)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# KONFIGURASI — sesuaikan dengan instalasi Anda
# ---------------------------------------------------------------------------
$DB_HOST     = "localhost"
$DB_PORT     = "5432"
$DB_USER     = "mt5app"
$DB_NAME     = "mt5_trading"
$PG_DUMP     = "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe"
$PG_RESTORE  = "C:\Program Files\PostgreSQL\16\bin\pg_restore.exe"
$SEVEN_ZIP   = "C:\Program Files\7-Zip\7z.exe"
$BACKUP_DIR  = "D:\Backups\Tarapti"
$LOG_FILE    = "C:\Scripts\backup_tarapti.log"
$ERROR_LOG   = "C:\Scripts\backup_error.log"
$KEEP_DAYS   = 30     # retensi lokal: 30 hari

# STEP 14 — state counter kegagalan upload off-site berturut-turut (alert #13).
# Nilai dibaca scripts/backup/export_prometheus_textfile.ps1 sebagai metric
# tarapti_backup_offsite_consecutive_failures untuk Prometheus.
$STATE_DIR      = "C:\Scripts\state"
$OFFSITE_FAIL_FILE = "$STATE_DIR\backup_offsite_consecutive_failures.txt"

# ---------------------------------------------------------------------------
# HELPER: tulis log dengan timestamp
# ---------------------------------------------------------------------------
function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [$Level] $Message"
    Add-Content -Path $LOG_FILE -Value $line
    Write-Host $line
}

# STEP 14 — update state counter kegagalan off-site (untuk alert #13)
function Update-OffsiteFailureState {
    param([int]$Value)
    New-Item -ItemType Directory -Force -Path $STATE_DIR | Out-Null
    Set-Content -Path $OFFSITE_FAIL_FILE -Value $Value
    Write-Log "Offsite consecutive-failure state di-update ke: $Value" "INFO"
}

# ---------------------------------------------------------------------------
# LANGKAH 1: Buat direktori backup jika belum ada
# ---------------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $BACKUP_DIR | Out-Null
Write-Log "=== BACKUP TARAPTI DIMULAI ==="

# ---------------------------------------------------------------------------
# LANGKAH 2: pg_dump (format custom -Fc, mendukung restore parsial)
# ---------------------------------------------------------------------------
$timestamp  = Get-Date -Format "yyyy-MM-dd_HHmm"
$dumpFile   = "$BACKUP_DIR\tarapti_$timestamp.dump"
$archiveFile = "$dumpFile.zip"

Write-Log "Menjalankan pg_dump ke: $dumpFile"
$env:PGPASSWORD = $env:TARAPTI_DB_PASSWORD

& $PG_DUMP `
    -h $DB_HOST `
    -p $DB_PORT `
    -U $DB_USER `
    -d $DB_NAME `
    -Fc `
    -f $dumpFile

if ($LASTEXITCODE -ne 0) {
    Write-Log "pg_dump GAGAL (exit code $LASTEXITCODE)" "ERROR"
    Add-Content -Path $ERROR_LOG -Value "$(Get-Date): pg_dump GAGAL untuk $dumpFile"
    exit 1
}
Write-Log "pg_dump selesai: $('{0:N2}' -f ((Get-Item $dumpFile).Length / 1MB)) MB"

# ---------------------------------------------------------------------------
# LANGKAH 3: Enkripsi dengan 7-Zip AES-256 sebelum upload off-site
# ---------------------------------------------------------------------------
Write-Log "Mengenkripsi dump dengan AES-256..."
& $SEVEN_ZIP a -tzip `
    -p"$env:BACKUP_ARCHIVE_PASSWORD" `
    -mem=AES256 `
    $archiveFile `
    $dumpFile

if ($LASTEXITCODE -ne 0) {
    Write-Log "Enkripsi 7-Zip GAGAL" "ERROR"
    exit 1
}
Write-Log "Enkripsi selesai: $('{0:N2}' -f ((Get-Item $archiveFile).Length / 1MB)) MB (compressed+encrypted)"

# Hapus file .dump mentah setelah berhasil di-zip
Remove-Item -Force $dumpFile
Write-Log "File dump mentah dihapus (sudah ter-zip)"

# ---------------------------------------------------------------------------
# LANGKAH 4: Upload off-site ke S3-compatible (Backblaze B2 / Wasabi / AWS)
# ---------------------------------------------------------------------------
Write-Log "Mengupload ke off-site storage: s3://$env:BACKUP_S3_BUCKET/postgres/"

$env:AWS_ACCESS_KEY_ID     = $env:BACKUP_S3_ACCESS_KEY
$env:AWS_SECRET_ACCESS_KEY = $env:BACKUP_S3_SECRET_KEY

aws s3 cp $archiveFile "s3://$env:BACKUP_S3_BUCKET/postgres/" `
    --endpoint-url $env:BACKUP_S3_ENDPOINT

if ($LASTEXITCODE -ne 0) {
    # Upload gagal — JANGAN hapus arsip lokal, catat ke error log
    $errMsg = "$(Get-Date): Upload off-site GAGAL untuk $archiveFile"
    Add-Content -Path $ERROR_LOG -Value $errMsg
    Write-Log "Upload off-site GAGAL — arsip lokal DIPERTAHANKAN sebagai fallback" "WARN"

    # STEP 14 (alert #13): naikkan counter kegagalan berturut-turut.
    # Hari ini = 1, dua hari berturut = 2 → memicu alert di Prometheus.
    $prevFail = 0
    if (Test-Path $OFFSITE_FAIL_FILE) { $prevFail = [int](Get-Content $OFFSITE_FAIL_FILE | Select-Object -Last 1) }
    Update-OffsiteFailureState ($prevFail + 1)
    # Lanjut (jangan exit 1) — backup lokal tetap valid
} else {
    Write-Log "Upload off-site BERHASIL"
    # Hapus arsip lokal setelah upload sukses — hemat disk VPS
    Remove-Item -Force $archiveFile
    Write-Log "Arsip lokal dihapus setelah upload sukses"

    # STEP 14 (alert #13): reset counter karena off-site berhasil
    Update-OffsiteFailureState 0
}

# ---------------------------------------------------------------------------
# LANGKAH 5: Retensi — hapus file .dump dan .zip lokal > $KEEP_DAYS hari
# ---------------------------------------------------------------------------
Write-Log "Menerapkan retensi: hapus backup lokal > $KEEP_DAYS hari"
Get-ChildItem $BACKUP_DIR -Filter "tarapti_*.dump" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KEEP_DAYS) } |
    ForEach-Object { Remove-Item -Force $_.FullName; Write-Log "Dihapus (expired): $($_.Name)" }

Get-ChildItem $BACKUP_DIR -Filter "tarapti_*.dump.zip" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KEEP_DAYS) } |
    ForEach-Object { Remove-Item -Force $_.FullName; Write-Log "Dihapus (expired): $($_.Name)" }

Write-Log "=== BACKUP TARAPTI SELESAI ===`n"
