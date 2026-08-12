# TARAPTI — Monitoring & Alerting Produksi (STEP 14 / Bab 20)

Dokumen ini menjelaskan arsitektur monitoring TARAPTI, peta metric -> sumber
data, cara deploy Prometheus + Grafana, serta bagian yang masih butuh
konfigurasi infrastruktur agar semua alert benar-benar aktif.

---

## 1. Arsitektur

```
[ Railway - tarapti-backend (Node.js) ]
  GET /metrics
    tarapti_queue_pending, tarapti_queue_failed
    tarapti_worker_active
    tarapti_equity_snapshots_size_bytes
    tarapti_sync_duration_seconds / sync_errors / sync_success
    tarapti_http_* / tarapti_gateway_* / tarapti_node_*
        |
        | scrape (job 'tarapti-backend', 30s)
        v
[ Prometheus ]  (monitoring/prometheus.yml + monitoring/alerts.yml)
  14 alert rules -> Alertmanager (opsional) -> Slack/Telegram/email
        |                          |
        | scrape                   | scrape (job 'tarapti-gateway')
        v                          v
[ VPS MT5 Gateway ]          [ VPS node_exporter :9100 ]
  app.py:8000/metrics          textfile collector:
  worker_v3.py metrics          tarapti_backup_offsite_consecutive_failures
  (addendum gateway)            tarapti_service_down_minutes

Dashboard Grafana: monitoring/grafana-dashboard.json (4 panel).
```

---

## 2. Peta Metric -> Sumber Data (tidak ada metric palsu)

### Di-export backend Node (AKTIF, file: server/monitoring/metrics.js)

| Metric | Sumber |
|--------|--------|
| `tarapti_queue_pending` / `tarapti_queue_failed` | query ringan `SELECT status, COUNT(*) FROM fetch_queue GROUP BY status` tiap /metrics di-scrape |
| `tarapti_worker_active` | query `worker_registry WHERE status='active'` |
| `tarapti_equity_snapshots_size_bytes` | `pg_total_relation_size` tabel + seluruh partisi equity_snapshots |
| `tarapti_sync_duration_seconds` | histogram durasi operasi sync yang DIPICU backend (register_account, resync) |
| `tarapti_sync_errors_total` | counter error gateway (`gateway_timeout`, `gateway_unavailable`, `http_*`) |
| `tarapti_sync_success_total` | counter sukses gateway (2xx) |
| `tarapti_http_requests_total` / `tarapti_http_duration_seconds` | middleware `server/middleware/httpMetrics.js` |
| `tarapti_node_*` | default metrics Node.js (prom-client) |

### Di-export Gateway Python di VPS (BELUM AKTIF - butuh addendum)
Blok siap-tempel: **`scripts/gateway/monitoring_gateway_addendum.py`**
(tempel ke `worker_v3.py`, `app.py`, `mt5_connector.py` di repo
`tarapti-mt5-gateway`, yang TIDAK tersedia di workspace ini).

| Metric | Sumber (file gateway) |
|--------|------------------------|
| `tarapti_sync_duration_seconds` (full sync-cycle) | bungkus `fetch_all_data()` + `complete_task()` |
| `tarapti_mt5_restarts_total{instance_path}` | `restart_mt5_instance()` |
| `tarapti_mt5_login_failures_total` | saat login MT5 gagal |
| `tarapti_mt5_health_check_consecutive_failures` | health check MT5 (timeout) |
| `tarapti_worker_heartbeat_seconds` | loop heartbeat worker |
| `tarapti_duplicate_worker_id_total` | validasi startup worker |
| `tarapti_cache_miss_total` | `get_position_full_context()` (cache miss) |
| `tarapti_log_action_total{action}` | menulis aksi `equity_snapshot_failed`, `deal_error`, `unhandled_deal` |

### Di-export node_exporter textfile di VPS (BELUM AKTIF)
| Metric | Sumber |
|--------|--------|
| `tarapti_backup_offsite_consecutive_failures` | state dari `backup_tarapti.ps1` -> `export_prometheus_textfile.ps1` |
| `tarapti_service_down_minutes` | `export_prometheus_textfile.ps1` (cek proses worker_v3.py/app.py) |

---

## 3. Status 14 Alert

Semua 14 rule SUDAH ditulis di `monitoring/alerts.yml`. Status aktif tergantung
metric-nya sudah tersedia di Prometheus:

1. Queue pending/failed > 500 — AKTIF (backend)
2. Worker lag (heartbeat) > 10 menit — MENUNGGU addendum gateway
3. MT5 login failures > 20/jam — MENUNGGU addendum gateway
4. equity_snapshots > 50GB — AKTIF (backend)
5. Retry rate > 80%/jam — AKTIF (backend, counter error/success)
6. `equity_snapshot_failed` — MENUNGGU addendum gateway
7. `deal_error` — MENUNGGU addendum gateway
8. Health check MT5 gagal 3x berturut — MENUNGGU addendum gateway
9. Worker ID duplikat — MENUNGGU addendum gateway
10. `unhandled_deal` per hari — MENUNGGU addendum gateway
11. MT5 restart limit 5x/jam/instance — MENUNGGU addendum gateway
12. Cache miss position-context — MENUNGGU addendum gateway
13. Backup off-site gagal 2 hari — MENUNGGU textfile exporter + node_exporter
14. Service down > 5 menit — MENUNGGU textfile exporter + node_exporter

---

## 4. Deploy

### Prometheus (monitoring server terpisah)

```bash
docker run -d -p 9090:9090 \
  -v $(pwd)/monitoring/prometheus.yml:/etc/prometheus/prometheus.yml \
  -v $(pwd)/monitoring/alerts.yml:/etc/prometheus/alerts.yml \
  prom/prometheus
```

Sesuaikan placeholder di `prometheus.yml`:
- `tarapti-backend` targets: hostname Railway (HTTPS 443)
- `tarapti-gateway` targets: `<IP_VPS>:8000` (API gateway) dan `<IP_VPS>:9100`
  (node_exporter). Jangan ekspos ke internet publik.

### node_exporter di VPS Windows (untuk alert #13 & #14)

```powershell
node_exporter.exe --collector.textfile.directory="C:\Program Files\node_exporter\textfile_collector"
```

Jadwalkan `export_prometheus_textfile.ps1` tiap 1 menit via Task Scheduler.

### Grafana

Import `monitoring/grafana-dashboard.json`, pilih datasource Prometheus.
4 panel: pending/failed queue, durasi sync (histogram p50/p95), error/success
rate, dan jumlah restart MT5 per instance.

---

## 5. Yang MASIH butuh konfigurasi infrastruktur (TIDAK mengklaim PASS penuh)

1. Repo `tarapti-mt5-gateway` (Python: worker_v3.py, app.py, mt5_connector.py)
   TIDAK ada di workspace ini -> blok instrumentasi disediakan sebagai addendum
   `scripts/gateway/monitoring_gateway_addendum.py`, belum bisa diuji runtime.
2. Prometheus + Grafana belum dijalankan (belum ada server monitoring aktif).
   prometheus.yml memakai placeholder `<RAILWAY_BACKEND_HOST>` / `<IP_VPS>`.
3. Saat ini query `fetch_queue`/`worker_registry` ke TARAPTI DB memakai fallback
   mock `pool.js` bila DB tak terjangkau -> gauge jadi 0. Di produksi, TARAPTI DB
   harus dapat diakses backend (READ-ONLY user).
4. node_exporter textfile collector + Task Scheduler di VPS Windows belum dipasang.
5. Verifikasi end-to-end tidak bisa dilakukan karena /metrics di-scrape hanya
   bila Prometheus berjalan dan network ke VPS tersedia.