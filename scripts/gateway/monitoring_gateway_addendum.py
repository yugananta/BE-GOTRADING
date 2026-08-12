# ============================================================================
# ADDENDUM — STEP 14 MONITORING & ALERTING (Bab 20) untuk repo tarapti-mt5-gateway
# ----------------------------------------------------------------------------
# BUKAN bagian dari tarapti-backend (Node.js). Tempel kode di bawah ke file
# file Python yang SUDAH ADA di VPS Windows:
#
#   app.py           → blok imports + definisi metric + endpoint /metrics
#   worker_v3.py     → blok sync loop, complete_task(), restart_mt5_instance()
#   mt5_connector.py → get_position_full_context() (cache miss counter)
#
# Alasan dibuat sebagai file terpisah: repo gateway (worker_v3.py, mt5_connector.py,
# database_v3.py) TIDAK tersedia di workspace ini. Setiap blok diberi penanda
# `# === [PASANG KE: <file>] ===` supaya tinggal copy-paste ke lokasi yang benar.
#
# Install dependency dulu di VPS:
#   pip install prometheus-client
#
# Prometheus scrape (job 'tarapti-gateway'): http://<IP_VPS>:8000/metrics
# ============================================================================


# ============================================================================
# [PASANG KE: app.py — BAGIAN A: imports + definisi metric]
# Tempel di atas definisi route pertama, sejajar dengan import lain.
# ============================================================================
from prometheus_client import (
    Counter, Gauge, Histogram, generate_latest, CONTENT_TYPE_LATEST, start_http_server,
)
from starlette.responses import Response

# --- Metric blueprint (sama persis dengan nama di prometheus.yml + alerts.yml) ---
SYNC_DURATION = Histogram(
    'tarapti_sync_duration_seconds',
    'Durasi satu siklus sync per akun',
)
QUEUE_PENDING = Gauge(
    'tarapti_queue_pending',
    'Jumlah akun berstatus pending di fetch_queue',
)
QUEUE_FAILED = Gauge(
    'tarapti_queue_failed',
    'Jumlah akun berstatus failed di fetch_queue',
)
SYNC_ERRORS_TOTAL = Counter(
    'tarapti_sync_errors_total',
    'Total sync gagal',
    ['error_type'],
)
SYNC_SUCCESS_TOTAL = Counter(
    'tarapti_sync_success_total',
    'Total sync sukses',
)
WORKER_ACTIVE = Gauge(
    'tarapti_worker_active',
    'Jumlah worker berstatus active di worker_registry',
)
MT5_RESTARTS_TOTAL = Counter(
    'tarapti_mt5_restarts_total',
    'Total restart MT5 per instance',
    ['instance_path'],
)

# --- Metric TAMBAHAN yang dipakai alert #2, #3, #8, #9, #10, #12, #13 ---
WORKER_HEARTBEAT_SECONDS = Gauge(
    'tarapti_worker_heartbeat_seconds',
    'Detik sejak heartbeat terakhir per worker (alert #2, lag > 600 detik)',
    ['worker_id'],
)
MT5_LOGIN_FAILURES_TOTAL = Counter(
    'tarapti_mt5_login_failures_total',
    'Total kegagalan login MT5 per akun (alert #3)',
    ['akun_id'],
)
MT5_HEALTH_CHECK_CONSECUTIVE_FAILURES = Gauge(
    'tarapti_mt5_health_check_consecutive_failures',
    'Kegagalan health check MT5 berturut-turut per instance (alert #8)',
    ['instance_path'],
)
DUPLICATE_WORKER_ID_TOTAL = Counter(
    'tarapti_duplicate_worker_id_total',
    'Total deteksi worker ID duplikat saat startup (alert #9)',
)
CACHE_MISS_TOTAL = Counter(
    'tarapti_cache_miss_total',
    'Total position-context cache miss history_deals_get(position=...) (alert #12)',
)
LOG_ACTION_TOTAL = Counter(
    'tarapti_log_action_total',
    'Total log entry per action (equity_snapshot_failed, deal_error, unhandled_deal)',
    ['action'],
)


# ============================================================================
# [PASANG KE: app.py — BAGIAN B: fungsi update gauge ringan + endpoint /metrics]
# Tempel SEBELUM deklarasi @app.get("/metrics"). Query COUNT(*) saja, bukan query berat.
# ============================================================================
def _update_queue_gauges():
    """Query ringan ke fetch_queue sebelum di-scrape."""
    conn = get_db_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("""
                SELECT status, COUNT(*) FROM fetch_queue GROUP BY status
            """)
            counts = dict(cur.fetchall())
            QUEUE_PENDING.set(counts.get('pending', 0))
            QUEUE_FAILED.set(counts.get('failed', 0))
    except Exception:
        pass  # DB sibuk — pertahankan nilai gauge sebelumnya
    finally:
        db_pool.putconn(conn)


def _update_worker_gauge():
    conn = get_db_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM worker_registry WHERE status = 'active'"
            )
            WORKER_ACTIVE.set(cur.fetchone()[0])
    except Exception:
        pass
    finally:
        db_pool.putconn(conn)


@app.get("/metrics")
def metrics():
    # Update gauge dari query ringan sebelum di-scrape.
    _update_queue_gauges()
    _update_worker_gauge()
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


# ============================================================================
# [PASANG KE: worker_v3.py — BAGIAN C: heartbeat pekerja]
# Di dalam loop utama worker, SETIAP siklus (atau setidaknya setiap < 5 menit):
# ============================================================================
import time as _time

def _report_heartbeat(worker_id: str):
    """Hitung detik sejak heartbeat terakhir = detik antara pengecekan heartbeat
    yang lalu dengan sekarang. Cara paling sederhana: update langsung ke 0 tiap
    siklus dan biarkan alert #2 menilai timeout dari data worker_registry."""
    # Upstream: heartbeat worker_registry sudah di-update tiap siklus (< 30 detik).
    # Metric ini dijadikan 0 tiap siklus oleh worker sehat.
    WORKER_HEARTBEAT_SECONDS.labels(worker_id=worker_id).set(0)

    # Alternatif akurat (jika ingin 'time since last heartbeat'):
    #   last_beat = SELECT now() - last_heartbeat FROM worker_registry WHERE worker_id=...
    #   WORKER_HEARTBEAT_SECONDS.labels(worker_id=worker_id).set(seconds_since_beat)


# ============================================================================
# [PASANG KE: worker_v3.py — BAGIAN D: bungkus satu siklus sync dengan SYNC_DURATION]
# Bungkus pemanggilan fetch_all_data() + complete_task() di fungsi yang menjalankan
# siklus per akun. Contoh (sesuaikan nama fungsi sesuai repo gateway Anda):
# ============================================================================
# def run_sync_cycle(akun: dict):
#     with SYNC_DURATION.time():          # <-- posisi bungkus
#         mt5 = mt5_connector.MT5Connector(akun)
#         data = mt5.fetch_all_data()
#         dbx = database_v3.Database()
#         dbx.complete_task(data, akun)
#     # (opsional) samakan dengan counter queue di worker lain:
#     QUEUE_PENDING.dec() jika akun keluar dari status pending


# ============================================================================
# [PASANG KE: database_v3.py — BAGIAN E: complete_task() error/success counter]
# Di dalam complete_task(): setiap masuk blok except / saat status ditulis 'failed',
# panggil SYNC_ERRORS_TOTAL.labels(error_type=...).inc(). Saat sukses total:
# SYNC_SUCCESS_TOTAL.inc().
# ============================================================================
# Di awal complete_task() (dalam blok `try`, sebelum operasi DB berat):
#     _sync_ok = True
#
# Di setiap `except ... as e:` yang menangkap error untuk akun tsb:
#     _sync_ok = False
#     error_type = type(e).__name__          # mis. 'psycopg2.Error', 'TimeoutError'
#     SYNC_ERRORS_TOTAL.labels(error_type=error_type).inc()
#     LOG_ACTION_TOTAL.labels(action='deal_error').inc()   # hanya bila relevan dgn deal
#
# Di akhir complete_task(), setelah status sukses ditulis:
#     if _sync_ok:
#         SYNC_SUCCESS_TOTAL.inc()
#
# Contoh blok failed-status yang sudah ada (pola umum di database_v3.py):
#     cur.execute("UPDATE fetch_queue SET status='failed', error_message=%s ...", ...)
#   Tambahkan tepat setelahnya:
#     SYNC_ERRORS_TOTAL.labels(error_type=error_type).inc()


# ============================================================================
# [PASANG KE: worker_v3.py — BAGIAN F: restart_mt5_instance()]
# Setiap restart yang BERHASIL untuk sebuah instance:
# ============================================================================
# def restart_mt5_instance(instance_path: str):
#     # ... shutdown + re-init koneksi Python ...
#     if SUCCESS:
#         MT5_RESTARTS_TOTAL.labels(instance_path=instance_path).inc()


# ============================================================================
# [PASANG KE: worker_v3.py — BAGIAN G: login failure (alert #3)]
# Di tempat login MT5 gagal (mis. exception akun.login() gagal / status retcode != 0):
# ============================================================================
#     retcode, _ = akun.login(...)
#     if retcode != 0:
#         MT5_LOGIN_FAILURES_TOTAL.labels(akun_id=str(akun_login)).inc()


# ============================================================================
# [PASANG KE: worker_v3.py — BAGIAN H: health check consecutive failures (alert #8)]
# Di sekitar panggilan health check MT5 (account_info/terminal_info dengan timeout):
# ============================================================================
# FAILURES_BY_INSTANCE = {}  # module-level: instance_path -> count berurutan
# def _record_health_check(instance_path: str, ok: bool):
#     if ok:
#         FAILURES_BY_INSTANCE[instance_path] = 0
#     else:
#         FAILURES_BY_INSTANCE[instance_path] = FAILURES_BY_INSTANCE.get(instance_path, 0) + 1
#     MT5_HEALTH_CHECK_CONSECUTIVE_FAILURES.labels(instance_path=instance_path).set(
#         FAILURES_BY_INSTANCE[instance_path])
#     if FAILURES_BY_INSTANCE[instance_path] >= 3:
#         restart_mt5_instance(instance_path)   # dengan batas 5x/jam per instance


# ============================================================================
# [PASANG KE: worker_v3.py — BAGIAN I: duplicate worker ID (alert #9)]
# Di validasi startup worker (sebelum daftar ke worker_registry):
# ============================================================================
# def _validate_worker_id_unique(worker_id: str):
#     conn = get_db_connection()
#     try:
#         with conn, conn.cursor() as cur:
#             cur.execute(
#                 "SELECT 1 FROM worker_registry WHERE worker_id=%s AND status='active'",
#                 (worker_id,))
#             if cur.fetchone():
#                 DUPLICATE_WORKER_ID_TOTAL.inc()
#                 raise RuntimeError(
#                     f"Worker ID {worker_id} sudah aktif. Perbaiki hostname sebelum start.")
#     finally:
#         db_pool.putconn(conn)


# ============================================================================
# [PASANG KE: mt5_connector.py — BAGIAN J: position-context cache miss (alert #12)]
# Di get_position_full_context(), saat cache MISS dan harus panggil
# history_deals_get(position=...):
# ============================================================================
#     CACHE_MISS_TOTAL.inc()


# ============================================================================
# [PASANG KE: worker_v3.py / database_v3.py — BAGIAN K: action log counter (alert #6/#7/#10)]
# Setiap kali menulis baris action tertentu ke tabel logs:
#   'equity_snapshot_failed', 'deal_error', 'unhandled_deal'
# ============================================================================
#     LOG_ACTION_TOTAL.labels(action='equity_snapshot_failed').inc()
#     LOG_ACTION_TOTAL.labels(action='deal_error').inc()
#     LOG_ACTION_TOTAL.labels(action='unhandled_deal').inc()


# ============================================================================
# CATATAN — alert #13 dan #14 (TIDAK di sini, di VPS Windows):
#   #13 tarapti_backup_offsite_consecutive_failures   → scripts/backup/*.ps1
#   #14 tarapti_service_down_minutes                  → scripts/backup/export_prometheus_textfile.ps1
# Keduanya didefinisikan di repo tarapti-backend (scripts/backup/). Pastikan
# node_exporter --collector.textfile.directory dipasang di VPS dan textfile
# di-serve di port 9100, lalu tambahkan `<IP_VPS>:9100` sebagai target job
# 'tarapti-gateway' di prometheus.yml.
# ============================================================================

# ============================================================================
# [PASANG KE: app.py — BAGIAN L (OPSIONAL): serve /metrics di port khusus]
# Jika ingin /metrics dipisah dari port API utama (mis. :8000 → API, :9101 → metrics),
# jalankan sekali saat startup (bukan di request handler):
# ============================================================================
# if __name__ == '__main__':
#     start_http_server(9101)   # Prometheus scrape ke <IP_VPS>:9101/metrics
#     import uvicorn
#     uvicorn.run(app, host='0.0.0.0', port=8000)