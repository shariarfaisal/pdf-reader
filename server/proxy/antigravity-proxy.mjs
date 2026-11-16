#!/usr/bin/env node
/**
 * Antigravity Local AI Proxy Sidecar
 * 
 * Bridges Google Cloud Code Assist / Antigravity OAuth session from Pi Agent
 * to provide BOTH Gemini-compatible and OpenAI-compatible endpoints on localhost:8085.
 * 
 * Works with $0 API billing using ~/.pi/agent/auth.json
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const PORT = parseInt(process.env.PORT || '8085', 10);
const AUTH_FILE = path.join(os.homedir(), '.pi', 'agent', 'auth.json');

// Optionally hydrate environment variables from .env if present
try {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const k = trimmed.slice(0, eq).trim();
        const v = trimmed.slice(eq + 1).trim();
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
} catch {
  // Ignore missing/unreadable .env
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID || '';
const CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET || '';

const ENDPOINTS = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
];

const USER_AGENT =
  'antigravity/cli/1.2.4 (aidev_client; os_type=linux; arch=amd64; cl=982146307; auth_method=consumer)';

// Model Routing Map: public model IDs -> working Antigravity runtime IDs
const MODEL_MAPPING = {
  'gemini-3.8-flash-low': 'gemini-3.8-flash-low',
  'gemini-3.8-flash': 'gemini-3.8-flash-low',
  'gemini-3.7-flash-low': 'gemini-3.7-flash-low',
  'gemini-3.7-flash': 'gemini-3.7-flash-low',
  'gemini-3.6-flash-low': 'gemini-3.6-flash-low',
  'gemini-3.6-flash': 'gemini-3.6-flash-low',
  'gemini-3.5-flash-low': 'gemini-3.5-flash-low',
  'gemini-3.5-flash': 'gemini-3.5-flash-low',
  'gemini-3.5-flash-lite': 'gemini-3.5-flash-low',
  'gemini-3.1-pro-low': 'gemini-3.1-pro-low',
  'gemini-3.1-pro': 'gemini-3.1-pro-low',
  'gemini-2.5-flash': 'gemini-3.8-flash-low',
  'gemini-2.5-pro': 'gemini-3.1-pro-low',
  'gemini-2.0-flash': 'gemini-3.8-flash-low',
  'gemini-1.5-flash': 'gemini-3.8-flash-low',
  'gemini-1.5-pro': 'gemini-3.1-pro-low',
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  'gpt-4o': 'gemini-3.8-flash-low',
  'gpt-4o-mini': 'gemini-3.8-flash-low',
};

export function resolveRuntimeModel(requestedModel) {
  if (!requestedModel) return 'gemini-3.8-flash-low';
  const clean = requestedModel.replace(/^models\//, '');
  if (MODEL_MAPPING[clean]) return MODEL_MAPPING[clean];
  for (const [key, val] of Object.entries(MODEL_MAPPING)) {
    if (clean.startsWith(key)) return val;
  }
  return 'gemini-3.8-flash-low';
}

function loadCredentials() {
  if (!fs.existsSync(AUTH_FILE)) {
    throw new Error(`Auth file not found at ${AUTH_FILE}. Please run '/login antigravity' in Pi agent.`);
  }

  const raw = fs.readFileSync(AUTH_FILE, 'utf8');
  const auth = JSON.parse(raw);

  const creds = auth['antigravity'] || auth['antigravity-2'];
  if (!creds || (!creds.access && !creds.refresh)) {
    throw new Error('No valid antigravity credentials found in auth.json. Run /login antigravity first.');
  }

  return { creds, key: auth['antigravity'] ? 'antigravity' : 'antigravity-2', allAuth: auth };
}

export async function getValidToken() {
  const { creds, key, allAuth } = loadCredentials();
  const now = Date.now();

  if (creds.access && creds.expires && creds.expires > now + 5 * 60 * 1000) {
    return {
      token: creds.access,
      projectId: creds.projectId || 'spherical-iterator-g4vbx',
      email: creds.email,
    };
  }

  if (!creds.refresh) {
    if (creds.access) {
      return {
        token: creds.access,
        projectId: creds.projectId || 'spherical-iterator-g4vbx',
        email: creds.email,
      };
    }
    throw new Error('Refresh token missing for antigravity account.');
  }

  console.log(`[Antigravity Proxy] Refreshing OAuth token for ${creds.email || 'account'}...`);
  const refreshRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: creds.refresh,
      grant_type: 'refresh_token',
    }).toString(),
  });

  if (!refreshRes.ok) {
    const errText = await refreshRes.text();
    console.error('[Antigravity Proxy] Token refresh failed:', errText);
    if (creds.access) {
      return {
        token: creds.access,
        projectId: creds.projectId || 'spherical-iterator-g4vbx',
        email: creds.email,
      };
    }
    throw new Error(`Token refresh failed: ${errText}`);
  }

  const tokenData = await refreshRes.json();
  creds.access = tokenData.access_token;
  if (tokenData.refresh_token) creds.refresh = tokenData.refresh_token;
  creds.expires = now + tokenData.expires_in * 1000 - 5 * 60 * 1000;

  allAuth[key] = creds;
  try {
    fs.writeFileSync(AUTH_FILE, JSON.stringify(allAuth, null, 2), 'utf8');
    console.log('[Antigravity Proxy] Token refreshed and saved to auth.json.');
  } catch (err) {
    console.warn('[Antigravity Proxy] Could not persist refreshed token:', err.message);
  }

  return {
    token: creds.access,
    projectId: creds.projectId || 'spherical-iterator-g4vbx',
    email: creds.email,
  };
}

export async function forwardToAntigravity(body, runtimeModel, projectId, token) {
  const wirePayload = {
    project: projectId,
    model: runtimeModel,
    request: body,
    requestType: 'agent',
    userAgent: 'antigravity',
    requestId: crypto.randomUUID(),
  };

  let lastError = null;

  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(`${endpoint}/v1internal:generateContent`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify(wirePayload),
      });

      if (!res.ok) {
        const text = await res.text();
        lastError = new Error(`Antigravity ${endpoint} returned ${res.status}: ${text}`);
        if ([404, 429, 500, 502, 503].includes(res.status)) {
          continue;
        }
        throw lastError;
      }

      const json = await res.json();
      return json.response || json;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('All Antigravity endpoints failed.');
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-goog-api-key, x-goog-api-client',
  });
  res.end(JSON.stringify(data));
}

// Convert OpenAI Chat Completions payload into Gemini GenerateContent payload
function convertOpenAiToGemini(openaiBody) {
  const contents = [];
  let systemInstruction = null;

  for (const msg of openaiBody.messages || []) {
    if (msg.role === 'system') {
      systemInstruction = {
        parts: [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }]
      };
      continue;
    }

    const role = msg.role === 'assistant' ? 'model' : 'user';
    const parts = [];

    if (typeof msg.content === 'string') {
      parts.push({ text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const item of msg.content) {
        if (item.type === 'text') {
          parts.push({ text: item.text });
        } else if (item.type === 'image_url' && item.image_url?.url) {
          const url = item.image_url.url;
          if (url.startsWith('data:')) {
            const matches = url.match(/^data:([^;]+);base64,(.+)$/);
            if (matches) {
              parts.push({
                inlineData: {
                  mimeType: matches[1],
                  data: matches[2]
                }
              });
            }
          }
        }
      }
    }

    if (parts.length > 0) {
      contents.push({ role, parts });
    }
  }

  const geminiPayload = { contents };
  if (systemInstruction) {
    geminiPayload.systemInstruction = systemInstruction;
  }
  if (openaiBody.temperature !== undefined) {
    geminiPayload.generationConfig = { temperature: openaiBody.temperature };
  }

  return geminiPayload;
}

// Convert Gemini response to OpenAI format
function convertGeminiToOpenAi(geminiResponse, model) {
  const candidate = geminiResponse.candidates?.[0];
  const text = candidate?.content?.parts?.map(p => p.text).join('') || '';
  // Cloud Code Assist reports implicit-cache reads as cachedContentTokenCount.
  // Dropping it forced every caller to log cached_tokens = 0 even on a hit.
  const cachedTokens = geminiResponse.usageMetadata?.cachedContentTokenCount || 0;

  return {
    id: 'chatcmpl-' + crypto.randomUUID(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: text
        },
        finish_reason: candidate?.finishReason?.toLowerCase() || 'stop'
      }
    ],
    usage: {
      prompt_tokens: geminiResponse.usageMetadata?.promptTokenCount || 0,
      completion_tokens: geminiResponse.usageMetadata?.candidatesTokenCount || 0,
      total_tokens: geminiResponse.usageMetadata?.totalTokenCount || 0,
      prompt_tokens_details: { cached_tokens: cachedTokens }
    }
  };
}

export function createProxyServer() {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-goog-api-key, x-goog-api-client',
      });
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // Health check
    if (pathname === '/health' || pathname === '/') {
      try {
        const { email, projectId } = await getValidToken();
        sendJson(res, 200, {
          status: 'ok',
          provider: 'antigravity-proxy',
          account: email,
          projectId,
          supportedEndpoints: ['/v1/chat/completions', '/v1beta/models/:model:generateContent']
        });
      } catch (err) {
        sendJson(res, 500, { status: 'error', message: err.message });
      }
      return;
    }

    // OpenAI-compatible Chat Completions (/v1/chat/completions)
    if (req.method === 'POST' && (pathname === '/v1/chat/completions' || pathname === '/chat/completions')) {
      try {
        const body = await parseJsonBody(req);
        const requestedModel = body.model || 'gemini-2.5-flash';
        const runtimeModel = resolveRuntimeModel(requestedModel);

        const geminiBody = convertOpenAiToGemini(body);
        const { token, projectId } = await getValidToken();

        const startTime = Date.now();
        const geminiRes = await forwardToAntigravity(geminiBody, runtimeModel, projectId, token);
        const durationMs = Date.now() - startTime;

        console.log(`[Antigravity Proxy] Chat | ${requestedModel} -> ${runtimeModel} | ${durationMs}ms`);
        const openaiRes = convertGeminiToOpenAi(geminiRes, requestedModel);
        sendJson(res, 200, openaiRes);
      } catch (err) {
        console.error(`[Antigravity Proxy] Error:`, err.message);
        sendJson(res, 500, { error: { message: err.message } });
      }
      return;
    }

    // Gemini GenerateContent
    const matchGen = pathname.match(/\/(?:v1beta|v1)\/models\/([^:]+):(generateContent|streamGenerateContent)/);
    if (req.method === 'POST' && matchGen) {
      const rawModel = matchGen[1];
      const runtimeModel = resolveRuntimeModel(rawModel);

      try {
        const body = await parseJsonBody(req);
        const { token, projectId } = await getValidToken();

        const startTime = Date.now();
        const result = await forwardToAntigravity(body, runtimeModel, projectId, token);
        const durationMs = Date.now() - startTime;

        console.log(`[Antigravity Proxy] Gemini | ${rawModel} -> ${runtimeModel} | ${durationMs}ms`);
        sendJson(res, 200, result);
      } catch (err) {
        console.error(`[Antigravity Proxy] Error:`, err.message);
        sendJson(res, 500, { error: { code: 500, message: err.message } });
      }
      return;
    }

    // Models list
    if (req.method === 'GET' && (pathname === '/v1/models' || pathname === '/models')) {
      sendJson(res, 200, {
        object: 'list',
        data: Object.keys(MODEL_MAPPING).map(id => ({
          id,
          object: 'model',
          created: 1700000000,
          owned_by: 'google-antigravity'
        }))
      });
      return;
    }

    sendJson(res, 404, { error: { message: `Not found: ${pathname}` } });
  });

  return server;
}

if (process.argv[1] && process.argv[1].endsWith('antigravity-proxy.mjs')) {
  const server = createProxyServer();
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[Antigravity Proxy] Port ${PORT} already active.`);
    } else {
      console.error(err);
    }
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[Antigravity Proxy] Running on http://127.0.0.1:${PORT}`);
  });
}
