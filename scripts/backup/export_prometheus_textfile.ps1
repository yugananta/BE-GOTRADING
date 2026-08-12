# export_prometheus_textfile.ps1
# STEP 14 — Ekspor metric state ke node_exporter textfile collector (alert #13 & #14)
#
# Menghasilkan file teks Prometheus di direktori textfile collector node_exporter:
#   C:\Program Files\node_exporter\textfile_collector\tarapti_ops.prom
#
# Metric yang diekspor:
#   tarapti_backup_offsite_consecutive_failures  (alert #13, dari backup_tarapti.ps1)
#   tarapti_service_down_minutes                 (alert #14, health worker_v3.py + app.py)
#
# Jadwalkan di Task Scheduler setiap 1 menit:
#   powershell.exe -NonInteractive -File "C:\Scripts\export_prometheus_textfile.ps1"
#
# Prasyarat (sekali saja):
#   - node_exporter di VPS Windows dengan flag:
#       node_exporter.exe --collector.textfile.directory="C:\Program Files\node_exporter\textfile_collector"
#   - Tambahkan target <IP_VPS>:9100 ke job 'tarapti-gateway' di monitoring/prometheus.yml
#     (node_exporter akan membaca file .prom ini otomatis saat di-scrape).

param(
    [string]$TextfileDir  = "C:\Program Files\node_exporter\textfile_collector",
    [string]$StateDir     = "C:\Scripts\state",
    [string]$OffsiteFailFile = "",  # default di-set di bawah
    [string]$DownSinceFile = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

if (-not $OffsiteFailFile) { $OffsiteFailFile = "$StateDir\backup_offsite_consecutive_failures.txt" }
if (-not $DownSinceFile)   { $DownSinceFile   = "$StateDir\service_down_since.txt" }

New-Item -ItemType Directory -Force -Path $TextfileDir | Out-Null
New-Item -ItemType Directory -Force -Path $StateDir   | Out-Null

# ---------------------------------------------------------------------------
# 1) tarapti_backup_offsite_consecutive_failures (alert #13)
# ---------------------------------------------------------------------------
$offsiteFail = 0
if (Test-Path $OffsiteFailFile) {
    $offsiteFail = [int](Get-Content $OffsiteFailFile | Select-Object -Last 1)
}

# ---------------------------------------------------------------------------
# 2) tarapti_service_down_minutes (alert #14)
#    Proses yang dicek: worker_v3.py dan app.py (python).
#    Logika: jika keduanya hidup → 0 detik down. Jika ada yang mati →
#    hitung menit sejak pertama kali terdeteksi down (state down_since).
# ---------------------------------------------------------------------------
function Test-ServiceUp {
    # Mencocokkan command line python yang memuat worker_v3.py atau app.py
    $running = Get-CimInstance Win32_Process -Filter "Name = 'python.exe' OR Name = 'pythonw.exe'" |
        Where-Object { $_.CommandLine -match 'worker_v3\.py|app\.py' }
    return [bool]$running
}

$downMinutes = 0
if (Test-ServiceUp) {
    $downMinutes = 0
    if (Test-Path $DownSinceFile) { Remove-Item -Force $DownSinceFile }
} else {
    $now = Get-Date
    if (Test-Path $DownSinceFile) {
        $downSince = [datetime](Get-Content $DownSinceFile | Select-Object -Last 1)
    } else {
        $downSince = $now
        Set-Content -Path $DownSinceFile -Value $downSince.ToString("o")
    }
    $downMinutes = [int]((($now - $downSince).TotalMinutes))
}

# ---------------------------------------------------------------------------
# Tulis file textfile Prometheus
# ---------------------------------------------------------------------------
$content = @(
  "# HELP tarapti_backup_offsite_consecutive_failures Jumlah hari berurutan gagal upload backup off-site (alert #13).",
  "# TYPE tarapti_backup_offsite_consecutive_failures gauge",
  "tarapti_backup_offsite_consecutive_failures $offsiteFail",
  "",
  "# HELP tarapti_service_down_minutes Menit service worker_v3.py/app.py mati tanpa restart otomatis (alert #14).",
  "# TYPE tarapti_service_down_minutes gauge",
  "tarapti_service_down_minutes $downMinutes"
) -join [Environment]::NewLine

$target = Join-Path $TextfileDir "tarapti_ops.prom"
Set-Content -Path $target -Value $content
Write-Host "Textfile ditulis: $target (offsite_fail=$offsiteFail, service_down_minutes=$downMinutes)"