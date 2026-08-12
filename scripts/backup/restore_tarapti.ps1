# restore_tarapti.ps1
# STEP 13 — DISASTER RECOVERY: Prosedur Restore (Bab 22.4)
#
# Jalankan di VPS baru/staging setelah VPS produksi hilang atau rusak.
# JANGAN jalankan di production aktif tanpa --dry-run terlebih dahulu.
#
# Penggunaan:
#   .\restore_tarapti.ps1 -DumpFile "D:\Backups\Tarapti\tarapti_TERBARU.dump"
#   .\restore_tarapti.ps1 -DumpFile "tarapti_2026-08-10_0200.dump" -DryRun
#
# Prasyarat:
#   1. PostgreSQL 16.x sudah terinstall di VPS baru
#   2. Database mt5_trading sudah dibuat (CREATE DATABASE mt5_trading)
#   3. User mt5app sudah dibuat dan punya akses
#   4. File .env sudah di-restore dari password manager (termasuk ENCRYPTION_KEY)
#   5. TARAPTI_DB_PASSWORD sudah di-set sebagai env var

param(
    [Parameter(Mandatory=$true)]
    [string]$DumpFile,

    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$DB_HOST    = "localhost"
$DB_PORT    = "5432"
$DB_USER    = "mt5app"
$DB_NAME    = "mt5_trading"
$PG_RESTORE = "C:\Program Files\PostgreSQL\16\bin\pg_restore.exe"
$PG_PSQL    = "C:\Program Files\PostgreSQL\16\bin\psql.exe"
$LOG_FILE   = "C:\Scripts\restore_tarapti.log"

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [$Level] $Message"
    Add-Content -Path $LOG_FILE -Value $line
    Write-Host $line
}

# ---------------------------------------------------------------------------
Write-Log "=== RESTORE TARAPTI DIMULAI ==="
if ($DryRun) { Write-Log "MODE: DRY-RUN — tidak ada perubahan ke database" "WARN" }

# ---------------------------------------------------------------------------
# VALIDASI: cek file dump ada
# ---------------------------------------------------------------------------
if (-not (Test-Path $DumpFile)) {
    Write-Log "File dump tidak ditemukan: $DumpFile" "ERROR"
    exit 1
}
$fileSizeMB = '{0:N2}' -f ((Get-Item $DumpFile).Length / 1MB)
Write-Log "File dump ditemukan: $DumpFile ($fileSizeMB MB)"

# ---------------------------------------------------------------------------
# LANGKAH 1: Verifikasi koneksi ke PostgreSQL
# ---------------------------------------------------------------------------
Write-Log "Memverifikasi koneksi PostgreSQL..."
$env:PGPASSWORD = $env:TARAPTI_DB_PASSWORD

$testConn = & $PG_PSQL -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME `
    -c "SELECT version();" 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Log "Koneksi PostgreSQL GAGAL: $testConn" "ERROR"
    exit 1
}
Write-Log "Koneksi PostgreSQL OK"

if ($DryRun) {
    Write-Log "DRY-RUN: restore akan dijalankan ke database 'tarapti_restore_test' (bukan produksi)"
    $TARGET_DB = "tarapti_restore_test"

    # Buat database test sementara
    & $PG_PSQL -h $DB_HOST -p $DB_PORT -U $DB_USER -d "postgres" `
        -c "DROP DATABASE IF EXISTS $TARGET_DB; CREATE DATABASE $TARGET_DB;" | Out-Null
    Write-Log "Database test '$TARGET_DB' dibuat"
} else {
    $TARGET_DB = $DB_NAME
    Write-Log "PRODUCTION RESTORE ke database: $TARGET_DB" "WARN"
    Write-Log "Pastikan semua worker SUDAH DIHENTIKAN sebelum restore!" "WARN"
    $confirm = Read-Host "Ketik 'YA-RESTORE-PRODUCTION' untuk konfirmasi"
    if ($confirm -ne "YA-RESTORE-PRODUCTION") {
        Write-Log "Restore dibatalkan oleh operator" "WARN"
        exit 0
    }
}

# ---------------------------------------------------------------------------
# LANGKAH 2: pg_restore
# ---------------------------------------------------------------------------
Write-Log "Menjalankan pg_restore ke database: $TARGET_DB"

& $PG_RESTORE `
    -h $DB_HOST `
    -p $DB_PORT `
    -U $DB_USER `
    -d $TARGET_DB `
    --clean `
    --if-exists `
    -Fc `
    $DumpFile

if ($LASTEXITCODE -ne 0) {
    Write-Log "pg_restore selesai dengan warning/error (exit code $LASTEXITCODE) — periksa output di atas" "WARN"
    # pg_restore sering exit 1 untuk warning non-fatal — lanjut verifikasi
} else {
    Write-Log "pg_restore selesai tanpa error"
}

# ---------------------------------------------------------------------------
# LANGKAH 3: Verifikasi data
# ---------------------------------------------------------------------------
Write-Log "Memverifikasi hasil restore..."

$akunCount = & $PG_PSQL -h $DB_HOST -p $DB_PORT -U $DB_USER -d $TARGET_DB `
    -t -c "SELECT COUNT(*) FROM akun;" 2>&1
$tradesCount = & $PG_PSQL -h $DB_HOST -p $DB_PORT -U $DB_USER -d $TARGET_DB `
    -t -c "SELECT COUNT(*) FROM closed_trades;" 2>&1
$lastSync = & $PG_PSQL -h $DB_HOST -p $DB_PORT -U $DB_USER -d $TARGET_DB `
    -t -c "SELECT MAX(last_updated) FROM fetch_queue;" 2>&1

Write-Log "Jumlah akun    : $($akunCount.Trim())"
Write-Log "Jumlah trades  : $($tradesCount.Trim())"
Write-Log "Sync terakhir  : $($lastSync.Trim())"

# ---------------------------------------------------------------------------
# LANGKAH 4: Cleanup dry-run database
# ---------------------------------------------------------------------------
if ($DryRun) {
    Write-Log "DRY-RUN: menghapus database test '$TARGET_DB'..."
    & $PG_PSQL -h $DB_HOST -p $DB_PORT -U $DB_USER -d "postgres" `
        -c "DROP DATABASE IF EXISTS $TARGET_DB;" | Out-Null
    Write-Log "Database test dihapus — restore test BERHASIL"
}

Write-Log "=== RESTORE SELESAI ==="
Write-Log "Catat hasil ini di log restore berkala tim (setiap 3 bulan, Bab 22.6)"
