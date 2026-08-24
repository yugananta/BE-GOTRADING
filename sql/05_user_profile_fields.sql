-- tarapti-backend - Lengkapi profil user (nama, username) di tabel `users`
-- Jalankan setelah 04_ib_commission_schema.sql.
--
-- KENAPA: tabel `users` sebelumnya cuma punya email + lokasi + whatsapp --
-- cukup untuk auth, tapi kurang untuk sisi social media (feed butuh nama
-- tampilan, bukan cuma email). Frontend (AI Studio) sebelumnya punya
-- skema sendiri dengan firstName/lastName/username -- field di bawah
-- disamakan supaya satu sumber data.

ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;

CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
