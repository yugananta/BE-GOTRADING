# ============================================================
# ADDENDUM untuk repo tarapti-mt5-gateway (BUKAN bagian dari tarapti-backend)
#
# Endpoint ini BELUM ADA di app.py TARAPTI MT5 Gateway yang sudah kamu
# punya. Admin panel butuh ini untuk tombol "Resync manual" per akun.
# Tempel ke app.py, di bawah endpoint get_account_status yang sudah ada.
# ============================================================

@app.post("/accounts/{akun_id}/resync", dependencies=[Depends(verify_api_key)])
@limiter.limit("20/minute")
async def resync_account(request: Request, akun_id: int):
    """Paksa akun kembali ke status 'pending' supaya worker sync ulang
    di siklus poll berikutnya, tanpa menunggu jadwal 30 detik normal."""
    conn = get_db_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("""
                UPDATE fetch_queue
                SET status = 'pending', next_retry_at = NULL, error_message = NULL
                WHERE akun_id = %s AND status != 'processing'
                RETURNING akun_id
            """, (akun_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=409,
                    detail="Akun sedang diproses worker, atau tidak ditemukan. Coba lagi sebentar."
                )
        return {"akun_id": akun_id, "status": "pending"}
    finally:
        db_pool.putconn(conn)
