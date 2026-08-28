// server/scripts/debug-login-blehkenzz.js
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { supabase } from '../integrations/supabase/client.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

async function runDebug() {
  console.log('=== DEBUG LOGIN BLEHKENZZ ===\n');

  // 1. Cek loading library bcrypt
  try {
    const bcryptPath = require.resolve('bcrypt');
    console.log(`[SYSTEM] Library bcrypt ter-load dari: ${bcryptPath}`);
    
    // Verifikasi apakah benar-benar native bcrypt (biasanya ada native binding atau native addon compiled)
    const isNative = !bcryptPath.includes('bcryptjs');
    console.log(`[SYSTEM] Jenis library: ${isNative ? 'Native C++ Binding (bcrypt)' : 'Pure JavaScript (bcryptjs)'}`);
  } catch (err) {
    console.log('[SYSTEM] Gagal memverifikasi path module bcrypt:', err.message);
  }

  // 2. Ambil argument password plaintext dari CLI
  const args = process.argv.slice(2);
  const inputPassword = args[0];

  if (!inputPassword) {
    console.log('\n❌ ERROR: Silakan masukkan password plaintext sebagai argument CLI!');
    console.log('Contoh penggunaan:');
    console.log('  node server/scripts/debug-login-blehkenzz.js "passwordAnda"\n');
    process.exit(1);
  }

  console.log(`\n[INPUT] Password Plaintext yang diuji: "${inputPassword}"`);

  // 3. Ambil data user dari Supabase
  const targetEmail = 'blehkenzz@gmail.com';
  console.log(`[DB] Mengambil data user untuk email: ${targetEmail}...`);
  
  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, password_hash, role')
    .eq('email', targetEmail)
    .maybeSingle();

  if (error) {
    console.error('❌ Gagal mengambil data dari Supabase:', error.message);
    process.exit(1);
  }

  if (!user) {
    console.error(`❌ User dengan email "${targetEmail}" tidak ditemukan di database!`);
    process.exit(1);
  }

  console.log('\n[DB] Data User Berhasil Ditemukan:');
  console.log(`- ID            : ${user.id}`);
  console.log(`- Email         : ${user.email}`);
  console.log(`- Password Hash : "${user.password_hash}"`);
  
  if (!user.password_hash) {
    console.error('❌ User tidak memiliki password_hash (mungkin eksternal auth / Google Auth).');
    process.exit(1);
  }

  const originalPrefix = user.password_hash.substring(0, 5);
  console.log(`- Prefix Hash   : "${originalPrefix}"`);

  // 4. Jalankan Normalisasi Prefix yang sama persis seperti di authService.js (loginUser)
  let hashToCompare = user.password_hash;
  let isNormalized = false;

  if (hashToCompare && hashToCompare.startsWith('$2y$')) {
    hashToCompare = '$2a$' + hashToCompare.substring(4);
    isNormalized = true;
  }

  console.log('\n[PROCESS] Menjalankan Logika Normalisasi:');
  console.log(`- Apakah normalisasi $2y$ -> $2a$ aktif? : ${isNormalized ? 'YA' : 'TIDAK (Hash tidak menggunakan prefix $2y$)'}`);
  console.log(`- Hash setelah normalisasi (untuk dicompare) : "${hashToCompare}"`);

  // 5. Jalankan Perbandingan (bcrypt.compare)
  console.log('\n[COMPARE] Memulai perbandingan dengan bcrypt.compare()...');
  
  try {
    const isMatch = await bcrypt.compare(inputPassword, hashToCompare);
    
    console.log('\n=== HASIL DEBUG ===');
    if (isMatch) {
      console.log('✅ LOGIN SUCCESS (Password Cocok / TRUE)');
      console.log('Logika normalisasi dan verifikasi password bekerja dengan sempurna untuk akun ini!');
    } else {
      console.log('❌ LOGIN FAILED (Password Salah / FALSE)');
      console.log('Password plaintext yang Anda masukkan tidak cocok dengan hash di database.');
    }
  } catch (err) {
    console.error('❌ Gagal melakukan komparasi password:', err.message);
    process.exit(1);
  }
}

runDebug().catch(err => {
  console.error('Unhandled error during debug:', err);
});
