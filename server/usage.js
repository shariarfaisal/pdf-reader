/**
 * API usage metering: token accounting, cost estimation, and call logging.
 *
 * This module intentionally imports nothing so it can be used from refiner.js,
 * ocr.js and db.js without creating an import cycle. Persistence is injected:
 * server/db.js registers a sink via setUsageSink().
 */

/**
 * List price in USD per 1,000,000 tokens (cache-miss input, standard tier).
 *
 * Verified vendor list prices:
 * - Gemini 3 Flash: $0.50 in / $3.00 out (thinking output billed as output)
 * - Gemini 3.x Pro (<=200K ctx): $2.00 in / $12.00 out
 * - Gemini 2.5: flash $0.30/$2.50, pro $1.25/$10.00
 * - DeepSeek V4.1 Flash (peak, cache miss): $0.30 in / $1.20 out
 * - Claude Sonnet 4.6: $3.00 in / $15.00 out
 *
 * A model id with no published tier (e.g. an Antigravity alias like
 * `gemini-3.8-flash`) is priced through GEMINI_TIERS / FAMILY_PRICING instead of
 * silently costing $0; those matches are reported as `exact: false`.
 */
export const PRICING = {
  // Google Gemini
  'gemini-3.8-flash': { input: 0.5, output: 3.0 },
  'gemini-3.7-flash': { input: 0.5, output: 3.0 },
  'gemini-3.6-flash': { input: 0.5, output: 3.0 },
  'gemini-3.5-flash': { input: 0.5, output: 3.0 },
  'gemini-3.1-flash': { input: 0.5, output: 3.0 },
  'gemini-3-flash': { input: 0.5, output: 3.0 },
  'gemini-3.1-pro': { input: 2.0, output: 12.0 },
  'gemini-3-pro': { input: 2.0, output: 12.0 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-2.5-pro': { input: 1.25, output: 10.0 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'gemini-2.0-flash-lite': { input: 0.075, output: 0.3 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-1.5-pro': { input: 1.25, output: 5.0 },
  // OpenAI
  'gpt-5': { input: 1.25, output: 10.0 },
  'gpt-5-mini': { input: 0.25, output: 2.0 },
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'o4-mini': { input: 1.1, output: 4.4 },
  // Anthropic
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-sonnet-4': { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku': { input: 0.8, output: 4.0 },
  // DeepSeek
  'deepseek-v4.1-flash': { input: 0.3, output: 1.2 },
  'deepseek-v4-flash': { input: 0.3, output: 1.2 },
  'deepseek-chat': { input: 0.27, output: 1.1 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 }
};

/** Gemini tier prices per major version — used when the exact id is unpublished. */
const GEMINI_TIERS = {
  pro: (major) => (major >= 3 ? { input: 2.0, output: 12.0 } : { input: 1.25, output: 10.0 }),
  flash: (major) => (major >= 3 ? { input: 0.5, output: 3.0 } : { input: 0.3, output: 2.5 }),
  'flash-lite': () => ({ input: 0.1, output: 0.4 })
};

/** Non-Gemini families, most specific rule first. */
const FAMILY_PRICING = [
  { label: 'gpt-5-nano', re: /^gpt-5.*nano/, rate: { input: 0.05, output: 0.4 } },
  { label: 'gpt-5-mini', re: /^gpt-5.*mini/, rate: { input: 0.25, output: 2.0 } },
  { label: 'gpt-5', re: /^gpt-5/, rate: { input: 1.25, output: 10.0 } },
  { label: 'gpt-4.1-nano', re: /^gpt-4\.1.*nano/, rate: { input: 0.1, output: 0.4 } },
  { label: 'gpt-4.1-mini', re: /^gpt-4\.1.*mini/, rate: { input: 0.4, output: 1.6 } },
  { label: 'gpt-4.1', re: /^gpt-4\.1/, rate: { input: 2.0, output: 8.0 } },
  { label: 'gpt-4o-mini', re: /^gpt-4o.*mini/, rate: { input: 0.15, output: 0.6 } },
  { label: 'gpt-4o', re: /^gpt-4o/, rate: { input: 2.5, output: 10.0 } },
  { label: 'claude-opus', re: /^claude-.*opus/, rate: { input: 15.0, output: 75.0 } },
  { label: 'claude-sonnet', re: /^claude-.*sonnet/, rate: { input: 3.0, output: 15.0 } },
  { label: 'claude-haiku', re: /^claude-.*haiku/, rate: { input: 0.8, output: 4.0 } },
  { label: 'deepseek-lite', re: /^deepseek-.*lite/, rate: { input: 0.1, output: 0.3 } },
  { label: 'deepseek-flash', re: /^deepseek-.*(flash|chat)/, rate: { input: 0.3, output: 1.2 } },
  { label: 'deepseek-reasoner', re: /^deepseek-.*reason/, rate: { input: 0.55, output: 2.19 } }
];

/**
 * Resolve pricing for a model id.
 *
 * `exact: true` — the id (or it plus a dated/effort suffix such as `-001`,
 * `-low`, `-thinking`) is in the price list. `exact: false` with `priced: true`
 * means the rate was derived from the model family, so it is an estimate.
 */
export function getModelPricing(model = '') {
  const key = String(model).toLowerCase().trim();
  if (!key) return { input: 0, output: 0, priced: false, exact: false };
  if (PRICING[key]) return { ...PRICING[key], priced: true, exact: true };

  let match = null;
  for (const name of Object.keys(PRICING)) {
    if (key.startsWith(name) && (!match || name.length > match.length)) match = name;
  }
  // A smaller variant must never inherit its full-size sibling's price
  // (`gpt-5.2-mini` is not `gpt-5`, `gemini-3.5-flash-lite` is not `flash`).
  const TIER_MARKERS = ['lite', 'mini', 'nano', 'haiku'];
  const wrongTier =
    match && TIER_MARKERS.some((marker) => key.includes(marker) && !match.includes(marker));
  if (match && !wrongTier) return { ...PRICING[match], priced: true, exact: true };

  const gemini = key.match(/^gemini-(\d+(?:\.\d+)?)-(pro|flash-lite|flash)/);
  if (gemini) {
    const tier = GEMINI_TIERS[gemini[2]];
    return { ...tier(parseFloat(gemini[1])), priced: true, exact: false, family: `gemini-${gemini[2]}` };
  }

  for (const rule of FAMILY_PRICING) {
    if (rule.re.test(key)) return { ...rule.rate, priced: true, exact: false, family: rule.label };
  }

  return { input: 0, output: 0, priced: false, exact: false };
}

/** Cost in USD for a token count, rounded to 6 decimals to survive SQLite REAL. */
export function computeCost(model, inputTokens = 0, outputTokens = 0) {
  const price = getModelPricing(model);
  const cost =
    (Math.max(0, inputTokens) / 1_000_000) * price.input +
    (Math.max(0, outputTokens) / 1_000_000) * price.output;
  return Math.round(cost * 1e6) / 1e6;
}

export function isPricedModel(model) {
  return getModelPricing(model).priced;
}

/** True for loopback endpoints (local Antigravity proxy, self-hosted OCR). */
export function isLocalEndpoint(url = '') {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host.endsWith('.local');
  } catch {
    return false;
  }
}

/** Friendly provider label for a base URL. */
export function describeProvider(url = '') {
  if (isLocalEndpoint(url)) return 'local-proxy';
  try {
    const host = new URL(url).hostname;
    if (host.includes('google') || host.includes('generativelanguage')) return 'google';
    if (host.includes('openai')) return 'openai';
    if (host.includes('anthropic')) return 'anthropic';
    if (host.includes('deepseek')) return 'deepseek';
    return host;
  } catch {
    return 'unknown';
  }
}

/** Rough token estimate (~4 chars/token) for providers that omit usage data. */
export function estimateTokens(text = '') {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

/**
 * Normalize vendor usage payloads (OpenAI-compatible `usage`, Gemini
 * `usageMetadata`) into a single shape.
 */
export function normalizeUsage(json) {
  const usage = json?.usage || {};
  const meta = json?.usageMetadata || {};
  const inputTokens = Number(usage.prompt_tokens ?? meta.promptTokenCount ?? 0) || 0;
  const outputTokens = Number(usage.completion_tokens ?? meta.candidatesTokenCount ?? 0) || 0;
  const cachedTokens = Number(
    usage.prompt_tokens_details?.cached_tokens ?? meta.cachedContentTokenCount ?? 0
  ) || 0;
  const totalTokens = Number(usage.total_tokens ?? meta.totalTokenCount ?? inputTokens + outputTokens) || 0;
  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    totalTokens,
    reported: inputTokens > 0 || outputTokens > 0
  };
}

/** Extract assistant text from an OpenAI-compatible chat completion response. */
export function getCompletionText(json) {
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .join('')
      .trim();
  }
  // Gemini-native shape
  const parts = json?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) return parts.map((p) => p?.text || '').join('').trim();
  return '';
}

// ---------------------------------------------------------------------------
// Sink registry (persistence injected by db.js)
// ---------------------------------------------------------------------------

let sink = null;
let sinkFailureWarned = false;

export function setUsageSink(fn) {
  sink = typeof fn === 'function' ? fn : null;
}

/** Persist a normalized call record. Never throws — metering must not break the pipeline. */
export function recordApiCall(record) {
  if (!sink) return null;
  try {
    return sink(record);
  } catch (err) {
    if (!sinkFailureWarned) {
      sinkFailureWarned = true;
      console.warn(`[Usage] Failed to store API call log: ${err.message}`);
    }
    return null;
  }
}

function truncate(value, max) {
  if (!value) return null;
  const str = String(value);
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

/**
 * POST an OpenAI-compatible chat completion and meter it.
 * Always records a row (success or failure); rethrows only when throwOnError.
 * Loopback endpoints are free unless the caller opts in with billableLocal.
 */
export async function chatCompletion({
  url,
  apiKey = null,
  model,
  payload,
  headers: extraHeaders = {},
  stage = 'other',
  projectId = null,
  pageNumber = null,
  timeoutMs = 120_000,
  billableLocal = false,
  throwOnError = true
}) {
  const endpoint = url.endsWith('/chat/completions') ? url : `${url.replace(/\/+$/, '')}/chat/completions`;
  const provider = describeProvider(endpoint);
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const requestBody = JSON.stringify(payload);
  const promptChars = typeof payload?.messages === 'string'
    ? payload.messages.length
    : JSON.stringify(payload?.messages || '').length;
  const startedAt = Date.now();
  let responseText = '';

  const finish = (partial) => {
    const { inputTokens, outputTokens, cachedTokens, totalTokens, reported } = partial.usage;
    const listCost = computeCost(model, inputTokens, outputTokens);
    const billed = !isLocalEndpoint(endpoint) || billableLocal;
    recordApiCall({
      ts: startedAt,
      projectId,
      pageNumber,
      stage,
      provider,
      model: model || 'unknown',
      inputTokens,
      outputTokens,
      cachedTokens,
      totalTokens,
      costUsd: billed ? listCost : 0,
      listCostUsd: listCost,
      estimated: reported ? 0 : 1,
      latencyMs: Date.now() - startedAt,
      httpStatus: partial.httpStatus ?? null,
      status: partial.error ? 'error' : 'ok',
      error: truncate(partial.error, 500),
      requestChars: requestBody.length + promptChars,
      responseChars: responseText.length
    });
  };

  const fallbackUsage = (text) => {
    const usage = normalizeUsage(null);
    if (usage.reported) return usage;
    return {
      inputTokens: estimateTokens(requestBody),
      outputTokens: estimateTokens(text),
      cachedTokens: 0,
      totalTokens: estimateTokens(requestBody) + estimateTokens(text),
      reported: false
    };
  };

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: requestBody,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    finish({ usage: fallbackUsage(''), error: err.message, httpStatus: null });
    if (throwOnError) throw err;
    return { ok: false, status: 0, json: null, text: '', error: err.message };
  }

  if (!response.ok) {
    let errText = '';
    try {
      errText = await response.text();
    } catch {
      /* ignore body read failures */
    }
    const message = `HTTP ${response.status}: ${errText || response.statusText}`;
    finish({ usage: fallbackUsage(''), error: message, httpStatus: response.status });
    if (throwOnError) throw new Error(message);
    return { ok: false, status: response.status, json: null, text: '', error: message };
  }

  let json = null;
  try {
    json = await response.json();
  } catch (err) {
    finish({ usage: fallbackUsage(''), error: `Invalid JSON response: ${err.message}`, httpStatus: response.status });
    if (throwOnError) throw err;
    return { ok: false, status: response.status, json: null, text: '', error: err.message };
  }

  responseText = getCompletionText(json);
  const normalized = normalizeUsage(json);
  finish({
    usage: normalized.reported ? normalized : fallbackUsage(responseText),
    httpStatus: response.status
  });

  return { ok: true, status: response.status, json, text: responseText, error: null };
}
