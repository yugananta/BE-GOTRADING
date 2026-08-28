import 'dotenv/config';
import bcrypt from 'bcrypt';
import { supabase } from '../integrations/supabase/client.js';
import { loginUser } from '../services/authService.js';

async function main() {
  const targetEmail = 'admin@gotrading.id';
  const newPassword = 'GantiPasswordSaya123!';
  const saltRounds = 12;

  console.log(`[1] Generating hash for "${targetEmail}" using bcryptjs (saltRounds = ${saltRounds})...`);
  const passwordHash = await bcrypt.hash(newPassword, saltRounds);
  console.log(`Generated Hash: ${passwordHash} (length: ${passwordHash.length})`);

  console.log(`\n[2] Checking users table in database...`);
  const { data: existingUser, error: fetchErr } = await supabase
    .from('users')
    .select('id, email, role, status, verification_status, password_hash')
    .eq('email', targetEmail)
    .maybeSingle();

  if (fetchErr) {
    console.error('Error fetching target user:', fetchErr);
    process.exit(1);
  }

  let userId;
  if (!existingUser) {
    console.log(`User "${targetEmail}" tidak ditemukan di database. Melakukan INSERT akun admin baru...`);
    const { data: newUser, error: insertErr } = await supabase
      .from('users')
      .insert({
        email: targetEmail,
        password_hash: passwordHash,
        role: 'admin',
        status: 'active',
        verification_status: 'verified',
        full_name: 'Admin GoTrading',
        username: 'admin',
      })
      .select('id, email, role, status')
      .single();

    if (insertErr) {
      console.error('Error inserting admin user:', insertErr);
      process.exit(1);
    }
    userId = newUser.id;
    console.log(`User "${targetEmail}" berhasil dibuat dengan ID: ${userId}, Role: ${newUser.role}`);
  } else {
    console.log(`User "${targetEmail}" ditemukan (ID: ${existingUser.id}). Melakukan UPDATE password_hash & role...`);
    const { error: updateErr } = await supabase
      .from('users')
      .update({
        password_hash: passwordHash,
        role: 'admin',
        status: 'active',
        verification_status: 'verified',
      })
      .eq('email', targetEmail);

    if (updateErr) {
      console.error('Error updating user:', updateErr);
      process.exit(1);
    }
    userId = existingUser.id;
    console.log(`User "${targetEmail}" berhasil di-update ke password_hash baru & role 'admin'.`);
  }

  // Pastikan muhammadfasya578@gmail.com juga role admin
  console.log(`\n[3] Memastikan role admin untuk muhammadfasya578@gmail.com...`);
  await supabase
    .from('users')
    .update({ role: 'admin' })
    .eq('email', 'muhammadfasya578@gmail.com');
  console.log(`Role muhammadfasya578@gmail.com dipastikan 'admin'.`);

  // [4] Verifikasi: Ambil ulang dari database
  console.log(`\n[4] VERIFIKASI: Mengambil ulang data "${targetEmail}" dari database...`);
  const { data: verifyUser, error: verifyErr } = await supabase
    .from('users')
    .select('id, email, role, status, verification_status, password_hash')
    .eq('email', targetEmail)
    .single();

  if (verifyErr || !verifyUser) {
    console.error('Gagal mengambil data user untuk verifikasi:', verifyErr);
    process.exit(1);
  }

  console.log(`Data dari DB:`);
  console.log(`- Email: ${verifyUser.email}`);
  console.log(`- Role: ${verifyUser.role}`);
  console.log(`- Status: ${verifyUser.status}`);
  console.log(`- Stored Hash: ${verifyUser.password_hash}`);

  // [5] Compare password dengan hash dari DB
  console.log(`\n[5] Menjalankan bcrypt.compare("${newPassword}", stored_hash)...`);
  let hashToCompare = verifyUser.password_hash;
  if (hashToCompare && hashToCompare.startsWith('$2y$')) {
    hashToCompare = '$2a$' + hashToCompare.substring(4);
  }
  const isMatch = await bcrypt.compare(newPassword, hashToCompare);
  console.log(`Hasil Compare: ${isMatch ? 'TRUE' : 'FALSE'}`);

  if (!isMatch) {
    console.error('FATAL: Hasil compare FALSE!');
    process.exit(1);
  }

  // [6] Uji coba fungsi loginUser controller end-to-end
  console.log(`\n[6] Uji coba fungsi loginUser() backend end-to-end...`);
  const loginResult = await loginUser({ email: targetEmail, password: newPassword });
  console.log(`Login Sukses! User ID: ${loginResult.user.id}, Role: ${loginResult.user.role}, IsVerified: ${loginResult.user.isVerified}`);
  console.log(`Access Token terbit (prefix): ${loginResult.accessToken.substring(0, 25)}...`);
  console.log(`Refresh Token terbit (prefix): ${loginResult.refreshToken.substring(0, 25)}...`);

  console.log(`\n=== SEMUA TAHAP VERIFIKASI BERHASIL DENGAN HASIL TRUE ===`);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
