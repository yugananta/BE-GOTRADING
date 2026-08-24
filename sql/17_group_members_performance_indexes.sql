-- Migration 17: Performance Indexes for Community Group Members and Profile Location Filtering

-- Index users by location for fast filtering
CREATE INDEX IF NOT EXISTS idx_users_city ON users (city);
CREATE INDEX IF NOT EXISTS idx_users_province ON users (province);
CREATE INDEX IF NOT EXISTS idx_users_country_province_city ON users (country, province, city);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);

-- Index user_mt5_accounts for fast batch joins
CREATE INDEX IF NOT EXISTS idx_user_mt5_accounts_user_id ON user_mt5_accounts (user_id);
CREATE INDEX IF NOT EXISTS idx_user_mt5_accounts_conn_status ON user_mt5_accounts (conn_status);

-- Index community groups for fast lookup by location
CREATE INDEX IF NOT EXISTS idx_community_groups_loc ON community_groups (country, province, city);

-- Index follows & connections for batch lookup
CREATE INDEX IF NOT EXISTS idx_follows_follower_following ON follows (follower_id, following_id);
CREATE INDEX IF NOT EXISTS idx_connections_users ON connections (requester_id, receiver_id, status);
