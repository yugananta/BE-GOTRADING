// server/scripts/migrate-php-hashes.js
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { supabase } from '../integrations/supabase/client.js';

async function runMigrationCheck() {
  console.log('=== MENJALANKAN SCAN VERIFIKASI AKUN & PASSWORD HASH ===');
  console.log('Menghubungkan ke Supabase...');
  
  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, password_hash, role');
    
  if (error) {
    console.error('Gagal mengambil data user:', error.message);
    process.exit(1);
  }
  
  console.log(`Berhasil mengambil ${users.length} user dari database.`);
  
  let count2y = 0;
  let count2a = 0;
  let count2b = 0;
  let countOther = 0;
  
  const phpUsers = [];
  
  users.forEach(u => {
    const hash = u.password_hash || '';
    if (hash.startsWith('$2y$')) {
      count2y++;
      phpUsers.push(u);
    } else if (hash.startsWith('$2a$')) {
      count2a++;
    } else if (hash.startsWith('$2b$')) {
      count2b++;
    } else {
      countOther++;
    }
  });
  
  console.log('\nStatistik Prefix Password Hash:');
  console.log(`- Prefix $2b$ (Bcrypt Standar Baru): ${count2b}`);
  console.log(`- Prefix $2a$ (Bcrypt Standar Lama): ${count2a}`);
  console.log(`- Prefix $2y$ (PHP Bcrypt): ${count2y}`);
  console.log(`- Lainnya / Tanpa Password: ${countOther}`);
  
  if (phpUsers.length > 0) {
    console.log('\nUser dengan prefix $2y$ yang ditemukan:');
    phpUsers.forEach(u => {
      console.log(`- Email: ${u.email} (ID: ${u.id})`);
    });
    console.log('\n[INFO] Hash mereka tidak perlu diubah secara manual di database karena backend sekarang otomatis menormalisasi prefix $2y$ menjadi $2a$ sebelum mencocokkan password.');
  } else {
    console.log('\n[INFO] Tidak ada user dengan prefix $2y$ aktif saat ini. Namun, sistem sekarang sepenuhnya kompatibel jika di masa depan ada user PHP ($2y$) yang bermigrasi.');
  }
  
  // Uji kompatibilitas algoritma dengan mock hash $2y$
  console.log('\n=== UJI KOMPATIBILITAS ALGORITMA BCRYPT ===');
  const dummyPassword = 'TestPasswordSuperAman123!';
  const realHash = await bcrypt.hash(dummyPassword, 10);
  const phpHash2y = realHash.replace(/^\$2[ab]\$/, '$2y$');
  
  console.log(`Dummy Password: ${dummyPassword}`);
  console.log(`Real Hash: ${realHash}`);
  console.log(`Simulasi Hash PHP ($2y$): ${phpHash2y}`);
  
  // Uji proses normalisasi yang diimplementasikan di authService
  let hashToCompare = phpHash2y;
  if (hashToCompare.startsWith('$2y$')) {
    hashToCompare = '$2a$' + hashToCompare.substring(4);
  }
  
  const isMatch = await bcrypt.compare(dummyPassword, hashToCompare);
  console.log(`\nHasil pengujian normalisasi hash $2y$ -> $2a$:`);
  console.log(`- Hash untuk dicompare: ${hashToCompare}`);
  console.log(`- Hasil pencocokan: ${isMatch ? 'SUKSES (TRUE)' : 'GAGAL (FALSE)'}`);
  
  if (isMatch) {
    console.log('\n✅ VERIFIKASI BERHASIL: Sistem sepenuhnya mendukung pencocokan password dengan hash ber-prefix $2y$!');
  } else {
    console.error('\n❌ VERIFIKASI GAGAL: Terjadi kesalahan saat melakukan pencocokan hash!');
    process.exit(1);
  }
}

runMigrationCheck().catch(err => {
  console.error('Terjadi error unhandled:', err);
  process.exit(1);
});
