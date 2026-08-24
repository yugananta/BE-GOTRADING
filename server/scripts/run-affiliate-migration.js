// server/scripts/run-affiliate-migration.js
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

const { Client } = pg;

async function runAffiliateMigration() {
  console.log('=== STARTING 2-LEVEL AFFILIATE SYSTEM MIGRATION ===');

  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('❌ DIRECT_URL or DATABASE_URL environment variable is missing.');
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database successfully.');

    // 1. Execute DDL
    console.log('Executing DDL schema from sql/13_affiliate_system_2_level.sql...');
    const sqlPath = path.resolve('sql/13_affiliate_system_2_level.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    await client.query(sqlContent);
    console.log('✅ DDL schema executed successfully.');

    // 2. Data Migration: Populate affiliate_profiles
    console.log('Migrating affiliate_profiles from users...');
    const profileResult = await client.query(`
      insert into public.affiliate_profiles (user_id, referral_code, created_at, updated_at)
      select id, referral_code, created_at, now()
      from public.users
      where referral_code is not null and referral_code <> ''
      on conflict (user_id) do update 
      set referral_code = EXCLUDED.referral_code;
    `);
    console.log(`✅ Migrated affiliate_profiles: ${profileResult.rowCount || 'completed'}`);

    // 3. Data Migration: Populate affiliate_referrals Level 1
    console.log('Migrating Level 1 referrals from users.referred_by...');
    const l1Result = await client.query(`
      insert into public.affiliate_referrals (sponsor_id, referred_user_id, level, created_at)
      select referred_by as sponsor_id, id as referred_user_id, 1 as level, created_at
      from public.users
      where referred_by is not null and referred_by <> id
      on conflict (referred_user_id) do nothing;
    `);
    console.log(`✅ Migrated Level 1 referrals: ${l1Result.rowCount || 'completed'}`);

    // 4. Data Migration: Populate affiliate_referrals Level 2
    console.log('Migrating Level 2 referrals (grand-sponsor chain)...');
    const l2Result = await client.query(`
      insert into public.affiliate_referrals (sponsor_id, referred_user_id, level, created_at)
      select l1.sponsor_id as sponsor_id, l2.referred_user_id as referred_user_id, 2 as level, l2.created_at
      from public.affiliate_referrals l2
      join public.affiliate_referrals l1 on l2.sponsor_id = l1.referred_user_id
      where l1.sponsor_id <> l2.referred_user_id
      on conflict (referred_user_id) do nothing;
    `);
    console.log(`✅ Migrated Level 2 referrals: ${l2Result.rowCount || 'completed'}`);

    // 5. Verification Summary
    const profilesCount = await client.query('select count(*) from public.affiliate_profiles');
    const l1Count = await client.query('select count(*) from public.affiliate_referrals where level = 1');
    const l2Count = await client.query('select count(*) from public.affiliate_referrals where level = 2');
    const settingsCheck = await client.query('select * from public.affiliate_settings limit 1');

    console.log('\n=== MIGRATION SUMMARY & VERIFICATION ===');
    console.log(`- Total Affiliate Profiles: ${profilesCount.rows[0].count}`);
    console.log(`- Level 1 Referrals: ${l1Count.rows[0].count}`);
    console.log(`- Level 2 Referrals: ${l2Count.rows[0].count}`);
    console.log(`- Affiliate Settings (L1 Rate: ${settingsCheck.rows[0]?.level_1_rate}, L2 Rate: ${settingsCheck.rows[0]?.level_2_rate})`);
    console.log('🎉 2-Level Affiliate System Migration Completed Successfully!');

  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runAffiliateMigration();
