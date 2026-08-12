# DISASTER RECOVERY — TARAPTI (Bab 22)

> Dokumen ini adalah panduan operasional singkat untuk tim engineering.
> Baca seluruh **Bab 22** di `TARAPTI_StepByStep_FINAL.md` untuk konteks lengkap.

---

## RTO / RPO Target

| Metrik | Target |
|--------|--------|
| **RPO** (Recovery Point Objective) | Maksimal 24 jam (sesuai jadwal backup harian) |
| **RTO** (Recovery Time Objective) | Maksimal 4 jam untuk restore penuh ke VPS baru |

---

## Arsitektur Backup

```
VPS Windows (TARAPTI MT5 Gateway)
  └─ 02:00 setiap hari
       ├─ pg_dump -Fc → tarapti_YYYY-MM-DD_HHmm.dump
       ├─ 7-Zip AES-256 → tarapti_YYYY-MM-DD_HHmm.dump.zip
       ├─ aws s3 cp → s3://{BACKUP_S3_BUCKET}/postgres/
       └─ Retensi lokal 30 hari
```

**Kebijakan retensi:**
- Harian: 30 hari (di VPS lokal)
- Mingguan: 12 minggu (di object storage off-site)
- Bulanan: 12 bulan (di cloud storage terenkripsi)

---

## Script Tersedia

| Script | Lokasi | Fungsi |
|--------|--------|--------|
| `backup_tarapti.ps1` | `scripts/backup/` | Backup harian + upload off-site |
| `restore_tarapti.ps1` | `scripts/backup/` | Restore dari dump (production + dry-run) |
| `verify_backup.ps1` | `scripts/backup/` | Verifikasi integritas backup terbaru |

### Setup di VPS (sekali saja)

```powershell
# 1. Salin scripts ke VPS
Copy-Item scripts/backup/*.ps1 "C:\Scripts\"

# 2. Set env vars di System Properties > Environment Variables:
#    TARAPTI_DB_PASSWORD, BACKUP_ARCHIVE_PASSWORD,
#    BACKUP_S3_BUCKET, BACKUP_S3_ENDPOINT,
#    BACKUP_S3_ACCESS_KEY, BACKUP_S3_SECRET_KEY

# 3. Jadwalkan backup harian via Task Scheduler:
#    Trigger: Daily 02:00
#    Action : powershell.exe -NonInteractive -File "C:\Scripts\backup_tarapti.ps1"

# 4. Jadwalkan verifikasi (setelah backup):
#    Trigger: Daily 03:00
#    Action : powershell.exe -NonInteractive -File "C:\Scripts\verify_backup.ps1"
```

---

## Prosedur DR — VPS Hilang/Rusak Total

Urutan langkah (dari nol ke VPS baru):

1. **Provision** VPS Windows Server baru
2. **Restore `.env`** dari password manager — **JANGAN generate `ENCRYPTION_KEY` baru**
3. **Install PostgreSQL 16.x**, buat database `mt5_trading` dan user `mt5app`
4. **Download backup terbaru** dari off-site storage:
   ```powershell
   aws s3 ls s3://{BUCKET}/postgres/ --endpoint-url {ENDPOINT}
   aws s3 cp s3://{BUCKET}/postgres/tarapti_TERBARU.dump.zip . --endpoint-url {ENDPOINT}
   # Dekripsi:
   & "C:\Program Files\7-Zip\7z.exe" e tarapti_TERBARU.dump.zip -p{BACKUP_ARCHIVE_PASSWORD}
   ```
5. **Restore database**:
   ```powershell
   .\restore_tarapti.ps1 -DumpFile "tarapti_TERBARU.dump"
   ```
6. **Install MT5 multi-instance** + Python + libraries (lihat STEP 3-4 blueprint)
7. **Deploy backend** dari Git (Railway auto-deploy jika Railway dipakai)
8. **Dry-run test** ke 1 akun sebelum aktifkan semua worker
9. **Verifikasi**: bandingkan jumlah akun aktif & jumlah `closed_trades` sebelum insiden

---

## Backup ENCRYPTION_KEY (Prioritas Tertinggi)

> ⚠️ Jika `ENCRYPTION_KEY` hilang, **seluruh password investor yang terenkripsi tidak bisa didekripsi selamanya**.

- Simpan `ENCRYPTION_KEY` + seluruh isi `.env` di **password manager terenkripsi** (Bitwarden / 1Password)
- Minimal **2 orang** berbeda memegang salinan
- Update backup `.env` **setiap kali ada perubahan** (rotasi API key, ganti DB password, dll)
- **JANGAN** simpan di email, Slack, atau repository Git

---

## Rotasi ENCRYPTION_KEY (Jika Terpaksa)

> ⚠️ Jangan hanya ganti nilai di `.env` — data lama tidak bisa dibaca.

Prosedur:
1. Buat `ENCRYPTION_KEY_NEW`
2. Jalankan job migrasi: dekripsi semua `password_investor` dengan key lama → enkripsi ulang dengan key baru
3. Verifikasi beberapa akun bisa login MT5
4. Ganti `ENCRYPTION_KEY` di `.env` ke nilai baru di semua worker
5. Simpan key lama selama 30 hari sebagai fallback

---

## Uji Restore Berkala (Wajib — Setiap 3 Bulan)

```powershell
# Restore ke database sementara (TIDAK menyentuh produksi)
.\restore_tarapti.ps1 -DumpFile "tarapti_TERBARU.dump" -DryRun
```

**Catat di log tim:**
- Tanggal uji
- Hasil (PASS / FAIL)
- Waktu restore (bandingkan dengan target RTO 4 jam)
- Masalah yang ditemukan

| Tanggal | Hasil | Durasi | Catatan |
|---------|-------|--------|---------|
| _(isi setelah uji pertama)_ | | | |

---

## Checklist Verifikasi Harian (Otomatis)

`verify_backup.ps1` menjalankan 4 check otomatis:
- [ ] Ada backup terbaru (< 26 jam)
- [ ] Integritas dump valid (`pg_restore --list`)
- [ ] Backup tersedia di off-site storage
- [ ] Tidak ada file kadaluarsa (> 30 hari) yang tertinggal

---

*Dokumen ini bagian dari STEP 13 — Backup & Disaster Recovery (Bab 22) blueprint TARAPTI.*
