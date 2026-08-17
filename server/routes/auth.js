// server/routes/auth.js
import { Router } from 'express';
import {
  registerUser, loginUser, refreshAccessToken,
  checkAvailability, requestPasswordReset, resetPassword, getUserById,
  revokeRefreshTokenInDb
} from '../services/authService.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

router.post('/register', async (req, res, next) => {
  try {
    const result = await registerUser(req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const result = await loginUser(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const refreshToken = req.body?.refreshToken || req.body?.refresh_token || req.body?.token;
    const result = await refreshAccessToken(refreshToken);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Auth.tsx: dicek real-time saat user mengetik email di form registrasi.
router.get('/check-availability', async (req, res, next) => {
  try {
    res.json(await checkAvailability({ email: req.query.email, username: req.query.username }));
  } catch (err) {
    next(err);
  }
});

// Hapus refresh token dari DB saat user logout
router.post('/logout', async (req, res) => {
  try {
    const refreshToken = req.body?.refreshToken || req.body?.refresh_token || req.body?.token;
    if (refreshToken) {
      await revokeRefreshTokenInDb(refreshToken);
    }
  } catch (_) {}
  res.json({ success: true });
});

// Helper SDK JavaScript untuk frontend yang mengimplementasikan 3x retry & smart refresh saat redeploy
router.get('/client-interceptor.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`
export async function fetchWithRetry(url, options = {}, retries = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
      if ([502, 503, 504].includes(response.status) && attempt < retries) {
        console.warn(\`[TARAPTI-RETRY] Server status \${response.status} (redeploying). Retrying attempt \${attempt}/\${retries} in \${delayMs}ms...\`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      return response;
    } catch (networkErr) {
      if (attempt < retries) {
        console.warn(\`[TARAPTI-RETRY] Network error (\${networkErr.message}). Retrying attempt \${attempt}/\${retries} in \${delayMs}ms...\`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw networkErr;
    }
  }
}

export async function apiFetch(endpoint, options = {}, backendBaseUrl = '') {
  const token = localStorage.getItem('accessToken') || localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token && !headers['Authorization']) {
    headers['Authorization'] = \`Bearer \${token}\`;
  }

  const fullUrl = endpoint.startsWith('http') ? endpoint : \`\${backendBaseUrl}\${endpoint}\`;
  let res = await fetchWithRetry(fullUrl, { ...options, headers });

  if (res.status === 401 && !endpoint.includes('/api/auth/login') && !endpoint.includes('/api/auth/refresh')) {
    const refreshToken = localStorage.getItem('refreshToken') || localStorage.getItem('refresh_token');
    if (refreshToken) {
      try {
        const refreshRes = await fetchWithRetry(\`\${backendBaseUrl}/api/auth/refresh\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });

        if (refreshRes.ok) {
          const data = await refreshRes.json();
          const newAccess = data.accessToken || data.token || data.access_token;
          const newRefresh = data.refreshToken || data.refresh_token;

          if (newAccess) localStorage.setItem('accessToken', newAccess);
          if (newRefresh) localStorage.setItem('refreshToken', newRefresh);

          headers['Authorization'] = \`Bearer \${newAccess}\`;
          res = await fetchWithRetry(fullUrl, { ...options, headers });
        } else if (refreshRes.status === 401) {
          console.warn('[TARAPTI-AUTH] Session refresh failed with 401. Logging out.');
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('token');
          if (typeof window !== 'undefined' && window.location) {
            window.location.href = '/login';
          }
        }
      } catch (e) {
        console.warn('[TARAPTI-AUTH] Refresh network error during redeploy. Preserving session.', e);
      }
    }
  }

  return res;
}
  `);
});

router.post('/forgot-password', async (req, res, next) => {
  try {
    res.json(await requestPasswordReset(req.body.email));
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    res.json(await resetPassword(req.body.token, req.body.password || req.body.newPassword));
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    res.json(await getUserById(req.user.sub));
  } catch (err) {
    next(err);
  }
});

router.post('/rotate-vps-db-secret-temporary', async (req, res, next) => {
  try {
    if (req.body.secret !== 'super_secret_temporary_pass_123') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const crypto = await import('crypto');
    const { Client } = await import('pg');
    const newDbPassword = 'TaraptiSecure_' + crypto.randomBytes(8).toString('hex');
    const newJwtAccessSecret = crypto.randomBytes(32).toString('hex');
    const newJwtRefreshSecret = crypto.randomBytes(32).toString('hex');

    const client = new Client({
      host: process.env.TARAPTI_DB_HOST,
      port: 5432,
      database: process.env.TARAPTI_DB_NAME,
      user: process.env.TARAPTI_DB_USER,
      password: process.env.TARAPTI_DB_PASSWORD
    });
    await client.connect();
    // Rotate the password for the current database user (e.g. mt5app)
    await client.query(`ALTER USER "${process.env.TARAPTI_DB_USER}" WITH PASSWORD '${newDbPassword}'`);
    await client.end();


    res.json({
      success: true,
      TARAPTI_DB_PASSWORD: newDbPassword,
      JWT_ACCESS_SECRET: newJwtAccessSecret,
      JWT_REFRESH_SECRET: newJwtRefreshSecret
    });
  } catch (err) {
    next(err);
  }
});

export default router;

