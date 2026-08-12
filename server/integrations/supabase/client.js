// server/integrations/supabase/client.js
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../../config/env.js';

const actualSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

// In-memory mock database tables for offline testing
const mockDb = {
  users: [],
  user_mt5_accounts: []
};

function createMockQueryBuilder(tableName) {
  if (!mockDb[tableName]) mockDb[tableName] = [];
  let queryState = {
    filters: [],
    limitVal: null,
    isMaybeSingle: false,
    isSingle: false,
    orderCol: null,
    orderAsc: true,
    isDelete: false
  };

  const builder = {
    select(fields) {
      return builder;
    },
    eq(field, value) {
      queryState.filters.push({ field, value });
      return builder;
    },
    neq(field, value) {
      return builder;
    },
    ilike(field, value) {
      return builder;
    },
    in(field, values) {
      return builder;
    },
    gte(field, value) {
      return builder;
    },
    lte(field, value) {
      return builder;
    },
    gt(field, value) {
      return builder;
    },
    lt(field, value) {
      return builder;
    },
    or(filters) {
      return builder;
    },
    range(from, to) {
      return builder;
    },
    maybeSingle() {
      queryState.isMaybeSingle = true;
      return builder;
    },
    single() {
      queryState.isSingle = true;
      return builder;
    },
    limit(val) {
      queryState.limitVal = val;
      return builder;
    },
    order(column, options = {}) {
      queryState.orderCol = column;
      queryState.orderAsc = options.ascending !== false;
      return builder;
    },
    insert(records) {
      const arr = Array.isArray(records) ? records : [records];
      const insertedRows = [];
      for (const record of arr) {
        const newRecord = {
          id: record.id || Math.random().toString(36).substring(2, 9),
          ...record,
          created_at: record.created_at || new Date().toISOString()
        };
        mockDb[tableName].push(newRecord);
        insertedRows.push(newRecord);
      }
      
      const builderSelect = {
        select(fields) {
          return builderSelect;
        },
        single() {
          return Promise.resolve({ data: insertedRows[0] || null, error: null });
        },
        maybeSingle() {
          return Promise.resolve({ data: insertedRows[0] || null, error: null });
        },
        then(onfulfilled, onrejected) {
          return Promise.resolve({ data: insertedRows, error: null }).then(onfulfilled, onrejected);
        }
      };
      return builderSelect;
    },
    upsert(records) {
      return builder.insert(records);
    },
    update(updates) {
      queryState.updates = updates;
      queryState.isUpdate = true;
      return builder;
    },
    delete() {
      queryState.isDelete = true;
      return builder;
    },
    then(onfulfilled, onrejected) {
      if (queryState.isDelete) {
        mockDb[tableName] = mockDb[tableName].filter(row => {
          return !queryState.filters.every(f => row[f.field] === f.value);
        });
        return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
      }
      if (queryState.isUpdate) {
        let updatedRows = [];
        mockDb[tableName] = mockDb[tableName].map(row => {
          const matches = queryState.filters.every(f => row[f.field] === f.value);
          if (matches) {
            const updatedRow = { ...row, ...queryState.updates };
            updatedRows.push(updatedRow);
            return updatedRow;
          }
          return row;
        });
        let data = queryState.isSingle || queryState.isMaybeSingle ? (updatedRows[0] || null) : updatedRows;
        return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
      }
      let result = [...mockDb[tableName]];
      
      // Apply filters
      for (const filter of queryState.filters) {
        result = result.filter(row => row[filter.field] === filter.value);
      }
      
      // Apply ordering
      if (queryState.orderCol) {
        result.sort((a, b) => {
          const valA = a[queryState.orderCol];
          const valB = b[queryState.orderCol];
          if (valA < valB) return queryState.orderAsc ? -1 : 1;
          if (valA > valB) return queryState.orderAsc ? 1 : -1;
          return 0;
        });
      }

      // Apply limit
      if (queryState.limitVal !== null) {
        result = result.slice(0, queryState.limitVal);
      }
      
      let data = result;
      if (queryState.isSingle || queryState.isMaybeSingle) {
        data = result.length > 0 ? result[0] : null;
      }
      
      return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
    }
  };

  return builder;
}

// Reset isi mock database (dipakai test otomasi supaya tiap skenario
// berjalan dari kondisi bersih). Hanya aktif saat bukan production.
export function resetMockDb(tables = ['users', 'user_mt5_accounts']) {
  if (isProduction) return;
  for (const t of tables) mockDb[t] = [];
}

// Production: use real Supabase for ALL tables (including users, user_mt5_accounts).
// Non-production (local dev / test): keep Mock Proxy so offline tests don't need a live DB.
const isProduction = process.env.NODE_ENV === 'production';

export const supabase = isProduction
  ? actualSupabase
  : new Proxy(actualSupabase, {
      get(target, prop) {
        if (prop === 'from') {
          return function (tableName) {
            return createMockQueryBuilder(tableName);
          };
        }
        return target[prop];
      }
    });
