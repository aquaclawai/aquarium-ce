import { Router } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import type { ApiResponse } from '@aquarium/shared';

const router = Router();
router.use(requireAuth);

// ─── GitHub Copilot ───────────────────────────────────────────────────────────

// VS Code Copilot extension's public OAuth client ID — must be this exact value.
const COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';

interface GitHubDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface GitHubTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

router.post('/github/device-code', async (req, res) => {
  try {
    const response = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: COPILOT_CLIENT_ID,
        scope: 'read:user',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      res.status(502).json({ ok: false, error: `GitHub API error: ${text}` } satisfies ApiResponse);
      return;
    }

    const data = await response.json() as GitHubDeviceCodeResponse;
    res.json({
      ok: true,
      data: {
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        expiresIn: data.expires_in,
        interval: data.interval,
      },
    } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.post('/github/poll', async (req, res) => {
  try {
    const { deviceCode } = req.body as { deviceCode: string };
    if (!deviceCode) {
      res.status(400).json({ ok: false, error: 'Missing deviceCode' } satisfies ApiResponse);
      return;
    }

    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: COPILOT_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      res.status(502).json({ ok: false, error: `GitHub API error: ${text}` } satisfies ApiResponse);
      return;
    }

    const data = await response.json() as GitHubTokenResponse;

    if (data.error) {
      res.json({
        ok: true,
        data: {
          status: data.error,
          description: data.error_description,
        },
      } satisfies ApiResponse);
      return;
    }

    if (data.access_token) {
      res.json({
        ok: true,
        data: {
          status: 'success',
          accessToken: data.access_token,
          tokenType: data.token_type,
          scope: data.scope,
        },
      } satisfies ApiResponse);
      return;
    }

    res.json({
      ok: true,
      data: { status: 'unknown' },
    } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// ─── OpenAI Codex (Device Code → Token Exchange) ─────────────────────────────

const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

interface OpenAIDeviceCodeResponse {
  device_auth_id: string;
  user_code: string;
  interval: number;
}

interface OpenAIPollResponse {
  authorization_code?: string;
  code_challenge?: string;
  code_verifier?: string;
}

interface OpenAITokenResponse {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  expires_in: number;
}

router.post('/openai/device-code', async (req, res) => {
  try {
    const response = await fetch('https://auth.openai.com/api/accounts/deviceauth/usercode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: OPENAI_CLIENT_ID }),
    });

    if (!response.ok) {
      const text = await response.text();
      res.status(502).json({ ok: false, error: `OpenAI API error: ${text}` } satisfies ApiResponse);
      return;
    }

    const data = await response.json() as OpenAIDeviceCodeResponse;
    res.json({
      ok: true,
      data: {
        deviceAuthId: data.device_auth_id,
        userCode: data.user_code,
        verificationUri: 'https://auth.openai.com/codex/device',
        interval: data.interval || 5,
      },
    } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.post('/openai/poll', async (req, res) => {
  try {
    const { deviceAuthId, userCode } = req.body as { deviceAuthId: string; userCode: string };
    if (!deviceAuthId || !userCode) {
      res.status(400).json({ ok: false, error: 'Missing deviceAuthId or userCode' } satisfies ApiResponse);
      return;
    }

    const pollResponse = await fetch('https://auth.openai.com/api/accounts/deviceauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_auth_id: deviceAuthId,
        user_code: userCode,
      }),
    });

    // 403/404 means user hasn't authorized yet
    if (pollResponse.status === 403 || pollResponse.status === 404) {
      res.json({
        ok: true,
        data: { status: 'authorization_pending' },
      } satisfies ApiResponse);
      return;
    }

    if (!pollResponse.ok) {
      const text = await pollResponse.text();
      res.json({
        ok: true,
        data: { status: 'error', description: `OpenAI poll error (${pollResponse.status}): ${text}` },
      } satisfies ApiResponse);
      return;
    }

    const pollData = await pollResponse.json() as OpenAIPollResponse;

    if (!pollData.authorization_code || !pollData.code_verifier) {
      res.json({
        ok: true,
        data: { status: 'authorization_pending' },
      } satisfies ApiResponse);
      return;
    }

    const tokenResponse = await fetch('https://auth.openai.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: OPENAI_CLIENT_ID,
        code: pollData.authorization_code,
        code_verifier: pollData.code_verifier,
        redirect_uri: 'https://auth.openai.com/deviceauth/callback',
      }),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      res.json({
        ok: true,
        data: { status: 'error', description: `OpenAI token exchange error: ${text}` },
      } satisfies ApiResponse);
      return;
    }

    const tokenData = await tokenResponse.json() as OpenAITokenResponse;
    res.json({
      ok: true,
      data: {
        status: 'success',
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresIn: tokenData.expires_in,
      },
    } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// ─── Google Antigravity (Authorization Code + PKCE) ───────────────────────────

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

function getGoogleRedirectUri(): string {
  return process.env.GOOGLE_OAUTH_REDIRECT_URI || `${config.corsOrigin}/oauth/google/callback`;
}

function getSalevoiceRedirectUri(): string {
  return process.env.SALEVOICE_OAUTH_REDIRECT_URI || `${config.corsOrigin}/oauth/salevoice/callback`;
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// In-memory PKCE verifier store, keyed by state param. Entries auto-expire after 10 minutes.
const pkceStore = new Map<string, { verifier: string; createdAt: number }>();
const PKCE_TTL_MS = 10 * 60 * 1000;

function cleanupPkceStore(): void {
  const now = Date.now();
  for (const [key, entry] of pkceStore) {
    if (now - entry.createdAt > PKCE_TTL_MS) {
      pkceStore.delete(key);
    }
  }
}

/** Shared Google OAuth authorize handler -- parameterized by scopes */
function handleGoogleAuthorize(scopes: string, res: import('express').Response): void {
  try {
    cleanupPkceStore();

    const { verifier, challenge } = generatePKCE();
    const state = randomBytes(16).toString('hex');

    pkceStore.set(state, { verifier, createdAt: Date.now() });

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      response_type: 'code',
      redirect_uri: getGoogleRedirectUri(),
      scope: scopes,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    res.json({
      ok: true,
      data: { authUrl, state },
    } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
}

router.post('/google/authorize', async (_req, res) => {
  handleGoogleAuthorize(GOOGLE_SCOPES, res);
});

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  error?: string;
  error_description?: string;
}

/** Shared Google OAuth token exchange -- same client/secret for all Google variants */
async function handleGoogleTokenExchange(code: string, state: string, res: import('express').Response): Promise<void> {
  try {
    const entry = pkceStore.get(state);
    if (!entry) {
      res.status(400).json({ ok: false, error: 'Invalid or expired state parameter' } satisfies ApiResponse);
      return;
    }
    pkceStore.delete(state);

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: getGoogleRedirectUri(),
        code_verifier: entry.verifier,
      }),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      res.status(502).json({ ok: false, error: `Google token error: ${text}` } satisfies ApiResponse);
      return;
    }

    const tokenData = await tokenResponse.json() as GoogleTokenResponse;

    if (tokenData.error) {
      res.status(502).json({
        ok: false,
        error: `Google OAuth error: ${tokenData.error_description || tokenData.error}`,
      } satisfies ApiResponse);
      return;
    }

    res.json({
      ok: true,
      data: {
        status: 'success',
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || null,
        expiresIn: tokenData.expires_in,
      },
    } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
}

router.post('/google/token', async (req, res) => {
  const { code, state } = req.body as { code: string; state: string };
  if (!code || !state) {
    res.status(400).json({ ok: false, error: 'Missing code or state' } satisfies ApiResponse);
    return;
  }
  await handleGoogleTokenExchange(code, state, res);
});

// ─── Qwen (Device Code) ─────────────────────────────────────────────────────

const QWEN_CLIENT_ID = process.env.QWEN_CLIENT_ID || 'aquarium';

interface QwenDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
}

interface QwenTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

router.post('/qwen/device-code', async (_req, res) => {
  try {
    const response = await fetch('https://oauth.aliyun.com/v1/oauth2/device/code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: QWEN_CLIENT_ID,
        scope: 'qwen:api',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      res.status(502).json({ ok: false, error: `Qwen API error: ${text}` } satisfies ApiResponse);
      return;
    }

    const data = await response.json() as QwenDeviceCodeResponse;
    res.json({
      ok: true,
      data: {
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        interval: data.interval || 5,
      },
    } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.post('/qwen/poll', async (req, res) => {
  try {
    const { deviceCode } = req.body as { deviceCode: string };
    if (!deviceCode) {
      res.status(400).json({ ok: false, error: 'Missing deviceCode' } satisfies ApiResponse);
      return;
    }

    const response = await fetch('https://oauth.aliyun.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: QWEN_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    const data = await response.json() as QwenTokenResponse;

    // Handle pending state (error field indicates authorization_pending)
    if (data.error) {
      if (data.error === 'authorization_pending' || data.error === 'slow_down') {
        res.json({
          ok: true,
          data: {
            status: data.error,
            description: data.error_description,
          },
        } satisfies ApiResponse);
        return;
      }
      // Other errors (e.g., expired_token, access_denied)
      res.json({
        ok: true,
        data: {
          status: data.error,
          description: data.error_description,
        },
      } satisfies ApiResponse);
      return;
    }

    if (data.access_token) {
      res.json({
        ok: true,
        data: {
          status: 'success',
          accessToken: data.access_token,
          refreshToken: data.refresh_token || null,
          expiresIn: data.expires_in || null,
        },
      } satisfies ApiResponse);
      return;
    }

    res.json({
      ok: true,
      data: { status: 'unknown' },
    } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// ─── Google Gemini CLI (PKCE Redirect, Generative Language Scope) ────────────
// Reuses the same Google OAuth infrastructure (same client ID, same redirect URI)
// but requests the generative-language scope instead of cloud-platform.

const GEMINI_CLI_SCOPES = [
  'https://www.googleapis.com/auth/generativelanguage',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

router.post('/gemini-cli/authorize', async (_req, res) => {
  handleGoogleAuthorize(GEMINI_CLI_SCOPES, res);
});

router.post('/gemini-cli/token', async (req, res) => {
  const { code, state } = req.body as { code: string; state: string };
  if (!code || !state) {
    res.status(400).json({ ok: false, error: 'Missing code or state' } satisfies ApiResponse);
    return;
  }
  await handleGoogleTokenExchange(code, state, res);
});

// ─── MiniMax ─────────────────────────────────────────────────────────────────
// MiniMax requires a registered client ID and secret that is not publicly
// available (unlike GitHub Copilot or OpenAI). Users who need MiniMax should
// authenticate via API key. No OAuth routes are added at this time.

// ─── SaleVoice / GEO Platform (Authorization Code + PKCE) ─────────────────

router.post('/salevoice/authorize', async (_req, res) => {
  try {
    cleanupPkceStore();
    const { verifier, challenge } = generatePKCE();
    const state = randomBytes(16).toString('hex');
    pkceStore.set(state, { verifier, createdAt: Date.now() });

    const redirectUri = getSalevoiceRedirectUri();
    const params = new URLSearchParams({
      client_id: config.salevoice.clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });

    const authUrl = `${config.salevoice.apiUrl}/oauth/authorize?${params.toString()}`;
    res.json({ ok: true, data: { authUrl, state } } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

interface SalevoiceTokenResponse {
  access_token: string;
  token_type: string;
}

router.post('/salevoice/token', async (req, res) => {
  try {
    const { code, state } = req.body as { code: string; state: string };
    if (!code || !state) {
      res.status(400).json({ ok: false, error: 'Missing code or state' } satisfies ApiResponse);
      return;
    }

    const entry = pkceStore.get(state);
    if (!entry) {
      res.status(400).json({ ok: false, error: 'Invalid or expired state parameter' } satisfies ApiResponse);
      return;
    }
    pkceStore.delete(state);

    const redirectUri = getSalevoiceRedirectUri();
    const tokenResponse = await fetch(`${config.salevoice.apiUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: config.salevoice.clientId,
        redirect_uri: redirectUri,
        code,
        code_verifier: entry.verifier,
      }),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      res.status(502).json({ ok: false, error: `SaleVoice token error: ${text}` } satisfies ApiResponse);
      return;
    }

    const tokenData = await tokenResponse.json() as SalevoiceTokenResponse;
    res.json({
      ok: true,
      data: {
        status: 'success',
        accessToken: tokenData.access_token,
        tokenType: tokenData.token_type,
      },
    } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

export default router;
