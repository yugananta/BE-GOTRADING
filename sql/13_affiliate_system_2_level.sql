-- sql/13_affiliate_system_2_level.sql
-- 2-Level Affiliate System Migration Schema

-- 1. Transactions table (if not exists)
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  amount numeric(20,8) not null default 0,
  status text not null default 'completed',
  created_at timestamptz not null default now()
);

-- 2. Affiliate Profile
create table if not exists public.affiliate_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  referral_code text not null unique,
  is_active boolean not null default true,
  total_earned numeric(20,8) not null default 0,
  total_paid numeric(20,8) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Referral relationship (Level 1 & Level 2)
create table if not exists public.affiliate_referrals (
  id bigint generated always as identity primary key,
  sponsor_id uuid not null references public.users(id),
  referred_user_id uuid not null unique references public.users(id),
  level smallint not null,
  created_at timestamptz not null default now(),
  constraint valid_level check (level in (1,2)),
  constraint no_self_referral check (sponsor_id <> referred_user_id)
);

-- 4. Affiliate settings
create table if not exists public.affiliate_settings (
  id boolean primary key default true,
  level_1_rate numeric(8,5) not null default 0.10,
  level_2_rate numeric(8,5) not null default 0.05,
  updated_at timestamptz not null default now(),
  constraint valid_rates check (level_1_rate between 0 and 1 and level_2_rate between 0 and 1)
);

insert into public.affiliate_settings (level_1_rate, level_2_rate) 
values (0.10, 0.05)
on conflict (id) do nothing;

-- 5. Commissions
create table if not exists public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id),
  beneficiary_id uuid not null references public.users(id),
  source_user_id uuid not null references public.users(id),
  level smallint not null,
  base_amount numeric(20,8) not null,
  commission_rate numeric(8,5) not null,
  commission_amount numeric(20,8) not null,
  currency text not null default 'USD',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  constraint valid_commission_level check (level in (1,2)),
  constraint valid_commission_status check (status in ('pending','approved','paid','cancelled','reversed')),
  unique(transaction_id, beneficiary_id, level)
);

-- 6. Payouts
create table if not exists public.affiliate_payouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  amount numeric(20,8) not null,
  currency text not null default 'USD',
  status text not null default 'pending',
  payout_method text,
  payout_reference text,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references public.users(id),
  notes text,
  constraint valid_payout_status check (status in ('pending','processing','paid','rejected','cancelled'))
);
