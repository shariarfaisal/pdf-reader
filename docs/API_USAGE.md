# API Usage & Cost Tracking

Every metered LLM/API call (Vision OCR, narration refiner, and anything else routed through
`service/usage.js`) is persisted to the `api_calls` SQLite table with tokens, cost, latency,
and status. The **API Usage** dashboard reads that table through three REST endpoints.

## What gets recorded

| Field | Meaning |
| --- | --- |
| `ts` | Call start (epoch ms) |
| `project_id`, `page_number` | Owning project / page (nullable for non-page calls) |
| `stage` | `ocr`, `refiner`, `tts`, `other` |
| `provider` | `local-proxy`, `google`, `openai`, host name |
| `model` | Requested model id |
| `input_tokens` / `output_tokens` / `cached_tokens` / `total_tokens` | Provider-reported usage (`usage` or `usageMetadata`) |
| `cost_usd` | Billed cost (0 for free local endpoints by default) |
| `list_cost_usd` | What the call would cost at published API rates |
| `estimated` | 1 when the provider omitted usage and tokens were estimated from text |
| `latency_ms`, `http_status`, `status`, `error` | Transport/HTTP outcome |
| `request_chars`, `response_chars` | Payload sizes, useful for sanity checks |

Failures are logged too (`status = 'error'`), so quota/rate-limit spikes are visible.

## Pricing

`PRICING` in `server/usage.js` is a list price table in **USD per 1M tokens** (cache-miss input,
standard tier). Resolution order for a requested model id:

1. **exact** — the id is in the table.
2. **prefix** — the id plus a dated/effort suffix (`-001`, `-low`, `-thinking`) reuses the base
   row (`gemini-3.8-flash-low` → `gemini-3.8-flash`). Smaller variants (`lite`, `mini`, `nano`,
   `haiku`) never inherit the full-size price.
3. **family** — an unpublished version is priced from its tier (`GEMINI_TIERS` for
   `gemini-<version>-pro|flash|flash-lite`, `FAMILY_PRICING` for gpt / claude / deepseek) and is
   reported as `exact: false`, shown with a `≈` prefix in the dashboard. An honest estimate beats
   a silent $0.
4. Only a genuinely unknown family resolves to 0 and shows as `unpriced`.

Rates were taken from vendor list prices: Gemini 3 Flash $0.50/$3.00, Gemini 3.x Pro $2.00/$12.00
(≤200K ctx), DeepSeek V4.1 Flash $0.30/$1.20 (peak, cache miss), Claude Sonnet $3.00/$15.00.
Update the table when a vendor changes rates.

Previously logged rows are re-priced once on boot (`usage_repriced_at` in `settings`) so calls
recorded before a model was added show their real value instead of $0. Delete that settings key to
force another re-price pass after editing the table.

## Free local endpoints

The Antigravity proxy on `127.0.0.1:8085` is free, so loopback endpoints record
`cost_usd = 0` while still recording `list_cost_usd`. The dashboard shows the billed amount in the
Cost columns, and where billing was zero it shows the **list-price value** in amber with a `LIST`
tag (tooltip explains it), so real usage never looks free. Set **Settings → API Usage & Cost
Tracking → Local proxy usage = Billable** (`usage_free_local = '0'`) to charge local calls at API
rates — i.e. to make “Total spend” itself carry the list price.

## Endpoints

```
GET  /api/usage/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&projectId=&stage=&model=&status=&q=
GET  /api/usage/logs?<same filters>&limit=50&offset=0
GET  /api/usage/pricing
GET  /api/usage/export.csv?<same filters>
DELETE /api/usage/logs?all=1            # wipe the log
DELETE /api/usage/logs?before=<epochMs> # prune old rows
```

`from`/`to` accept `YYYY-MM-DD` (inclusive local days) or epoch milliseconds.
`summary` returns `totals`, `byDay`, `byModel`, `byStage`, and `byProject`.

## Cache reads

Provider-side cache reads are reported, not implemented. The upstream returns how much of a
request it served from its own cache; the Antigravity proxy forwards
`usageMetadata.cachedContentTokenCount` as `usage.prompt_tokens_details.cached_tokens`, and the
dashboard shows it as **Cache reads** with a hit rate (`cachedTokens / inputTokens`).

Measured behaviour on the Cloud Code Assist lane: caching is **exact-request only** — an identical
request repeats at ~73% cached tokens, the same prefix with a different tail scores 0%, and prompts
under ~1,024 tokens never cache. Every page body is unique, so a normal page-by-page refiner run
records 0. Nothing to configure; it is informational.

## Dashboard

`src/components/ApiUsageDashboard.jsx`, reachable from **API Usage** in the library header and
the activity icon in the reader toolbar:

- date presets (today / 7d / 30d / 90d / all / custom) plus project, stage, model, status, and
  free-text filters
- KPI cards: spend (billed), list-price value, calls, input/output tokens, cache reads (with hit
  rate), avg latency, error rate
- daily spend chart (billed, else list price) and by-model / by-stage / by-project breakdowns
- paginated call log (50/page) and CSV export of the current filter

## Adding a new metered call site

```js
import { chatCompletion } from './usage.js';

const { ok, json, text, error } = await chatCompletion({
  url: settings.some_url,
  apiKey: settings.some_key,
  model,
  payload,
  stage: 'other',            // becomes the dashboard stage filter
  projectId,
  pageNumber,
  billableLocal: settings.usage_free_local === '0',
  throwOnError: false        // or true to propagate transport/HTTP failures
});
```

Never call `fetch` directly for an LLM endpoint — it would bypass metering.
