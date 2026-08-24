-- 14_fix_akun_id_bigint.sql
-- Mengubah tipe data akun_id menjadi bigint untuk mencegah integer overflow (22003)
-- saat user login menggunakan akun MT5 yang memiliki 10-11 digit angka.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'user_mt5_accounts' 
      AND column_name = 'akun_id' 
      AND data_type = 'integer'
  ) THEN
    RAISE NOTICE 'Altering user_mt5_accounts.akun_id from integer to bigint...';
    ALTER TABLE user_mt5_accounts ALTER COLUMN akun_id TYPE bigint USING akun_id::bigint;
  ELSE
    RAISE NOTICE 'user_mt5_accounts.akun_id is already bigint or does not exist.';
  END IF;
END $$;
