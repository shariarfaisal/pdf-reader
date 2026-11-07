# System Architecture & Technical Design

## 1. High-Level Architecture Overview

The system is built as a responsive, local-first web and desktop application designed specifically for the Apple Silicon M2 MacBook Air (8 GB Unified RAM):

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          1. Presentation & Viewer Layer                     │
│   - Split-view: Original PDF Page / Scanned Image <-> Clean Reading Canvas  │
│   - Synchronized audio player controls (Play, Pause, Speed, Seek, Skip)     │
│   - Real-time sentence/paragraph highlighting synchronized with narration   │
│   - Pipeline Inspector: Live stage indicators, log stream, manual Step/Pause│
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ REST / SSE API
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       2. Multi-Project & Pipeline Engine                    │
│   - 1 PDF = 1 Project (independent caching, status, audio, and pages)       │
│   - Page-by-Page Sequential Worker Queue (strictly 1 page at a time)        │
│   - Start / Pause / Resume / Step Page controls                             │
│   - Hardware guard: M2 CPU & memory throttle check between pages            │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Checkpoint & Cache
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       3. Persistent Storage (SQLite)                        │
│   - Embedded `node:sqlite` database (`data/pdf_reader.db`)                  │
│   - Page rasterized images (`data/projects/:id/pages/page_:n.png`)          │
│   - Extracted raw text (Digital PDF / Mac Vision OCR / LLM Vision OCR)      │
│   - Refined narration text (LLM cleaned, noise removed)                     │
│   - Synthesized audio files (`data/projects/:id/audio/page_:n.mp3/.wav`)    │
│   - Absolute idempotence: already-generated stages are never re-executed    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
┌─────────────────────────────────────┐ ┌─────────────────────────────────────┐
│   4. Dual-Tier Extraction Engine    │ │   5. LLM Narration Refiner & TTS    │
│  - Tier 1: Digital PDF text layer   │ │  - Configurable LLM Refinement API  │
│  - Tier 2a (Free): Apple Vision OCR │ │    (Base URL, API Key, Model Name)  │
│    Native macOS Neural Engine       │ │    Strips headers, footers, notes   │
│  - Tier 2b (Fallback): LLM Vision   │ │  - TTS Synthesis & Audio Buffer     │
│    (Bengali / Arabic / complex text)│ │    (Continuous seamless buffer,     │
│    Antigravity / Gemini / OpenAI    │ │     OmniVoice / Web Speech Engine)  │
└─────────────────────────────────────┘ └─────────────────────────────────────┘
```

## 2. Multi-Project Data Schema (SQLite)

### Table: `projects`
- `id` (TEXT PRIMARY KEY)
- `name` (TEXT)
- `pdf_path` (TEXT)
- `page_count` (INTEGER)
- `active_page` (INTEGER DEFAULT 0)
- `status` (TEXT: 'idle' | 'running' | 'paused' | 'completed' | 'error')
- `created_at` (INTEGER)
- `updated_at` (INTEGER)

### Table: `pages`
- `id` (TEXT PRIMARY KEY: stable row id; artifacts for new rows are named `page_<id>.png` / `page_<id>.wav`)
- `project_id` (TEXT REFERENCES projects(id))
- `page_number` (INTEGER) - display position / playback order (0-based, compacted on delete)
- `page_type` (TEXT: 'pdf' | 'custom')
- `source_page` (INTEGER) - physical PDF page index for `pdf` rows; `NULL` for `custom` rows
- `render_path` (TEXT) - Rendered 2x PNG of the PDF page
- `raw_text` (TEXT) - Extracted digital text or raw OCR (for `custom` rows: the pasted text)
- `ocr_source` (TEXT: 'digital' | 'mac_vision' | 'llm_vision' | 'custom' | 'none')
- `refined_text` (TEXT) - LLM-cleaned narration script (`custom` rows: verbatim pasted text)
- `audio_path` (TEXT) - Path to synthesized audio file
- `audio_duration` (REAL) - Seconds
- `status` (TEXT: 'pending' | 'extracting' | 'refining' | 'synthesizing' | 'ready' | 'error')
- `error_message` (TEXT)
- `updated_at` (INTEGER)

Unique index: `(project_id, page_number)`. All queries key on that pair, never on `id`.

### Page Management (insert / delete)
- `page_number` is the display position; `source_page` keeps the PDF binding, so inserting or deleting a page shifts positions only. Caches (render / text / refined / audio) stay attached to their own rows and are **never** re-derived for untouched pages.
- Custom text pages (`page_type = 'custom'`) store their pasted text directly and are expected to skip render + OCR. The pipeline narrates the text verbatim (no LLM refiner pass) and only synthesizes audio.
- Deleting a page removes its rows plus its render/audio files and compacts the remaining positions. The source PDF is never modified.
- **Bulk delete**: `DELETE /api/projects/:id/pages` with `{ pageIds: [...] }` (or `pageNumbers`) removes many rows, artifacts and re-indexes the numbering **once**, inside a single SQLite transaction, so a partial failure can never leave gaps. The page manager exposes per-row checkboxes with shift-click range selection, select-all, and a two-step confirm bar ("Delete selected" → "Delete N").
- Any page mutation stops an in-flight job for that project first (`haltPipelineForPageEdit`), then leaves the project `idle` — processing only restarts when the user presses Start.
- **Preview before destructive action**: `GET /api/projects/:id/pages/:n/preview` renders the page on demand at scale 1.4 as JPEG into `data/projects/:id/previews/page_<source_page>.jpg` (or reuses the pipeline raster). Renders run through a single-slot serialized queue so a scrolling page list can never spawn a burst of render processes. The page manager shows a thumbnail per row and a confirmation dialog with the full page image (custom pages show their text), so a delete is never blind.
- `bin/pdf_tool` accepts an optional trailing `scale` argument (default `2.0`) and encodes JPEG when the output path ends in `.jpg`/`.jpeg`.

### Table: `settings`
- `key` (TEXT PRIMARY KEY)
- `value` (TEXT)
  - `ocr_provider_url`, `ocr_api_key`, `ocr_model`
  - `refiner_provider_url`, `refiner_api_key`, `refiner_model`
  - `throttle_delay_ms` (Default: 500ms between pages)
  - `pipeline_local_parallel` (Default: `0`) — `0` gates the two local heavy
    stages (OCR render/extract and TTS) so only one runs at a time, always OCR
    first; `1` lets them overlap on machines with more headroom.
  - `tts_voice`, `tts_speed`

## 3. Strict Resumption & Idempotence

**No auto-start.** Opening a project (or the app) never begins processing. The server resets any project left in `running`/`paused` from a previous process to `idle` on boot, and only an explicit `POST /api/projects/:id/start` (Inspector → Start) runs the queue.

When processing starts or resumes for a project, every stage runs in its **own lane** (`pipeline.runStageLane`), and the lanes run concurrently:

1. Each lane walks the pages sorted by `page_number` and picks the first page that still needs *its* artifact and whose input already exists.
   - **OCR lane**: page needs `raw_text`. Digital text layer first (`pdf_tool extract-text`); if empty or <20 chars, render the page and run `macos_ocr`; if the OCR output lacks the expected script (e.g. Bengali 0980-09FF) and an LLM fallback is configured, call the Vision LLM. Persists `raw_text` + `ocr_source`.
   - **Script lane**: page has `raw_text` but no `refined_text`. Sends it to the Refiner (custom LLM or rule-based normalizer), applies text rules, persists `refined_text`.
   - **Audio lane**: page has `refined_text` but no `audio_path`. Synthesizes, persists `audio_path` + `audio_duration`, marks the page `ready`.
2. Lanes do **not** take turns per page: OCR keeps walking the book while the Script lane refines behind it and the Audio lane synthesizes behind that. A slow LLM call therefore never blocks OCR on the next page — which is why starting Script mid-OCR (or Audio mid-Script) simply processes from the first page that is still missing that artifact.
3. A lane whose input is not available yet waits (`'wait'`) while its producer lane is still working, and settles to `idle` (`'blocked'`) when the producer is paused, stopped or stalled — so stalls cascade down and can never deadlock the run.
4. Pages already carrying the artifact are skipped instantly in every lane (strict checkpointing; a cached page is never redone).
5. A page that fails is marked `error` and skipped for the rest of that run; the other lanes/pages keep going.
6. `pipeline_local_parallel = 0` puts OCR and TTS behind one gate (`StageGate`, OCR has priority so text extraction is never starved by a synthesis); `1` removes the gate. Per-stage throttle (`throttle_delay_ms`) is read fresh after every page to protect a fanless M2.
7. Stop/release: `stop()` bumps the run token, which is what every lane checks — an in-flight OCR page still finishes and caches its result, TTS is killed outright, and the engine is free for the next project immediately after.

**Live settings (no restart, no re-start).** Settings are never snapshotted for the run: `pipeline.pullSettings()` re-reads the `settings` table before every page **and** before every stage of the page in flight, then logs which keys changed (`Settings updated (refiner_model, tts_voice_en) — applying for Page 7.`). Editing the refiner model/prompt, extra instructions, delivery notes, TTS backend/voice/speed/num_step, OCR provider or `throttle_delay_ms` therefore takes effect on the very next unit of work — whether the run was paused first or not. Artifacts already stored with the old settings are untouched (strict checkpointing); use Regenerate to re-run completed pages.

## 5. Continuous Playback Model
- The book is presented as ONE long track: page audio files stay per-page on disk (cheap checkpointing), but the player owns a book timeline built from the persisted `audio_duration` values.
- When a page ends, the player advances to the next page that has audio and keeps playing without a click, until the user pauses.
- The next page's audio is pre-buffered in a hidden element, and inline audio responses are cached briefly (`private, max-age=600`) with a `v=<updated_at>` cache-buster so a regenerated page replaces the track in place.
- Audio pages are streamed through `GET /api/projects/:id/pages/:n/audio?inline=1` (resolved from the row's `audio_path`), so reordering / id-based filenames never break playback.

- **Delivery controls (how it speaks)**: OmniVoice has no free-form style prompt — `generate()` only accepts a closed `instruct` vocabulary (gender/age/pitch/whisper/accent), a numeric `speed`, and inline non-verbal tags (`[sigh]`, `[laughter]`, `[question-en]`, …). The app therefore exposes three direct knobs plus one indirect one: `tts_instruct`, `tts_speed` and `tts_num_step` reach `model.generate()` on both backends, while free-form `tts_style_notes` is appended to the refiner system prompt and shapes the script (sentence length, pauses, emphasis). Unknown instruct tokens are rejected by the model; the worker returns its exact suggestion list as a 400.

## 6. Voice Library (zero-shot cloning)

Every cloned voice is a row in `voices` plus a normalized sample on disk — not a hardcoded name in the synthesizer.

- **Storage**: `data/voices/<id>/sample.wav` (24 kHz mono, leading silence trimmed, capped at **15 s**) and a lazily built `prompt.pt` (local `VoiceClonePrompt` cache). `data/voices/voices.json` is the manifest the Python synthesizer reads, so the local path resolves a voice id without touching SQLite. Sample audio is streamed by `GET /api/voices/:id/audio`.
- **Why 15 s**: OmniVoice aligns a supplied transcript against the *whole* clip and rejects pairings past 20 s (`[clone_ref_too_long]`), advising a 3–10 s passage. The upload is cut to 15 s and then transcribed *from that cut*, so audio and transcript always match; the SDK's no-transcript auto-window path (15 s windows) stays unused.
- **Upload flow** (`POST /api/voices`, multipart): ffmpeg normalize → optional local faster-whisper `large-v3-turbo` CT2 transcription of the trimmed sample (editable afterwards, `POST /api/voices/:id/transcribe` to redo) → row insert → manifest rewrite → background push to a warm Colab worker.
- **Selection**: `tts_voice_bn|en|ar` now hold a voice **id** (or the `builtin` sentinel); `resolveVoiceForText()` in `tts.js` matches id → name → legacy label so old settings keep working. `tts_voice_override` renders a single preview with a specific voice.
- **Backends**: the Colab worker keeps `VOICE_PROMPTS[voice_id]` warm (`POST /voices` uploads the sample, `DELETE /voices/{id}` drops it, `/tts` takes `voice_id`); a 409 means the sample is not on the VM yet, so the controller uploads and retries instead of restarting the worker. Local synthesis resolves the same id through the manifest and caches `prompt.pt` per voice. Both paths therefore share one library, one transcript, one clone prompt per page-run.
- **Deletion** removes the row, the sample dir (including `prompt.pt`), rewrites the manifest, drops the worker's copy and resets any `tts_voice_*` default pointing at it to `builtin`.
- **UI**: `/voices` (`src/components/VoiceStudio.jsx`) — upload form, per-language defaults, library list with sample playback, inline rename/transcript edit, Whisper re-transcribe, clone preview and delete. Settings → Voice & Delivery pulls the same library into its per-language selects.

## 7. Remote GPU TTS (Google Colab) — optional backend

The local Mac stays the source of truth; synthesis can run on a rented Colab GPU.

- **Switch**: `tts_backend` = `auto` (Colab first, local fallback) | `colab` (remote only) | `local` (this Mac). `tts.js` routes stage 4 accordingly; SQLite per-page caching is unchanged, so an interrupted remote run resumes exactly where it stopped.
- **Worker**: `server/remote/colab_worker.py` (FastAPI) runs on the VM: `/health` + `/tts` (text → WAV, chunks long pages on sentence boundaries). OmniVoice is loaded once and kept warm (~2.1 GB VRAM on a T4).
- **Controller**: `server/remote/colab.js` provisions the session once (`colab new --gpu <T4|L4|A100>`), uploads worker + voice-clone reference, installs deps and prefetches weights behind a `/content/.pdfreader/ready` marker, launches the worker, then opens a single `ssh -L` tunnel via `colab ssh --proxy-mode`. All of that is paid **once per session**, not per page.
- **Lifecycle**: idle auto-stop (`colab_idle_stop_min`, default 20, `0` = never), 60 s heartbeat with restart-on-next-page, failure cooldown so an unavailable runtime is not hammered per page, and `SIGINT/SIGTERM` cleanup that stops the runtime so compute units are never left burning.
- **Measured on a T4**: model ready 13-17 s, Bengali RTF ~1.0 → 0.5, a scanned 3-page book end-to-end (OCR + refine + TTS) in ~50 s, ~1.2 CU/hr.
- **Gotchas**: the SSH key must be passed to *both* `ssh -i` and the ProxyCommand's `colab ssh -i`; a Colab account may only hold one or two concurrent GPU runtimes (allocation is refused otherwise); runtimes created outside the local `sessions.json` cannot be stopped by the CLI and are reclaimed by Colab's idle policy.

## 8. Resource & Thermal Discipline (8 GB M2)
- One page at a time.
- Heavy models are never loaded together.
- Images rendered at high quality (2x DPI) are stored on disk and immediately released from Node process RAM.
- Throttling pause (default 500ms) between pages prevents thermal runaway.

## 9. Frontend Routing (URL is the state)

The SPA is deep-linkable without a router dependency (`src/lib/router.js`, ~60 lines over the History API).

| Path | View |
| --- | --- |
| `/` | Library (project list) |
| `/projects/:id/pages/:n` | Workspace for project `:id`, 1-based page `n` |
| `/usage` | API usage & cost dashboard |

- **Refresh-proof**: the project and its page live in the URL, so reload / bookmark / share reopens the exact page. `/projects/:id` normalizes to an explicit `/pages/:n` once the project loads (page = URL page ?? persisted `projects.active_page`, clamped to the page count).
- **Page turns use `replaceState`** so a 300-page read does not spam browser history; navigation between library / project / usage uses `pushState` so Back returns to the previous view.
- **Backend**: the Express server already falls back to `dist/index.html` for any non-`/api`, non-`/data` GET, and Vite's dev server does the same — no extra server config needed.
- **Data loading**: project detail is fetched once per project route (a ref holds the current route), so turning pages never refetches the book. Unknown project IDs and unknown paths replace the URL with `/` instead of rendering a stale view.
