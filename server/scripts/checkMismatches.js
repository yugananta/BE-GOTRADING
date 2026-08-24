import pg from 'pg';
import { DIRECT_URL } from '../config/env.js';

async function check() {
  const pool = new pg.Pool({ connectionString: DIRECT_URL });
  
  const res = await pool.query(`
    SELECT id, email, country, province, city 
    FROM users 
    WHERE country IS NOT NULL AND city IS NOT NULL
  `);
  
  const users = res.rows;
  let mismatched = 0;
  
  for (const u of users) {
    const cRes = await pool.query('SELECT name FROM countries WHERE name = $1', [u.country]);
    if (cRes.rowCount === 0) {
      console.log(`Mismatch (Country): ${u.country} (User: ${u.email})`);
      mismatched++;
      continue;
    }
    
    const pRes = await pool.query('SELECT name FROM provinces WHERE name = $1', [u.province]);
    if (pRes.rowCount === 0) {
      console.log(`Mismatch (Province): ${u.province} (User: ${u.email})`);
      mismatched++;
      continue;
    }
    
    const ctRes = await pool.query('SELECT name FROM cities WHERE name = $1', [u.city]);
    if (ctRes.rowCount === 0) {
      console.log(`Mismatch (City): ${u.city} (User: ${u.email})`);
      mismatched++;
      continue;
    }
  }
  
  console.log(`\nTotal Mismatch: ${mismatched} users out of ${users.length}`);
  await pool.end();
}
check();
