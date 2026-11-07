# Design System & UI Specification

## 1. Design Vision
The PDF Reader interface is designed for long, immersive reading and audiobook listening sessions. It balances information density with visual calm, supporting multilingual typography (Bengali, Arabic, English) with equal dignity and legibility.

## 2. Typography System

| Language / Script | Primary Font Family | Fallback Font Stack | Characteristics |
|---|---|---|---|
| **English & UI** | `Inter`, system-ui | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` | High x-height, clear tabular figures for page numbers and counters. |
| **Bengali (বাংলা)** | `Hind Siliguri`, `Noto Sans Bengali` | `Kalpurush, SolaimanLipi, sans-serif` | Excellent conjunct rendering, comfortable line height (1.75x) for prolonged reading. |
| **Arabic (العربية)** | `Amiri`, `Scheherazade New` | `Traditional Arabic, Tahoma, serif` | Classic Naskh proportions, full diacritics support, right-to-left directional handling. |
| **Monospace / Logs** | `JetBrains Mono`, `Fira Code` | `ui-monospace, SFMono-Regular, Menlo, monospace` | For pipeline inspector, token stats, timings, error traces. |

### Typography Scale
- **Display / Project Title**: 24px (1.5rem), semi-bold (600), line-height: 1.2
- **Section Heading**: 18px (1.125rem), medium (500), line-height: 1.3
- **Reading Body (Bengali/Arabic/EN)**: 19px (1.1875rem), regular (400), line-height: 1.85 (relaxed reading)
- **UI Labels & Controls**: 13px–14px, medium (500), line-height: 1.4
- **Captions & Metadata**: 11px–12px, regular (400), uppercase tracking where appropriate

## 3. Color Palette (Dark & Warm Slate Theme)

Designed to prevent eye strain during day or night reading on OLED / Liquid Retina displays:

- **Surface Background**: `#0b0f17` (Deep Obsidian Slate)
- **Elevated Surface (Cards, Panels)**: `#131b26` (Subtle Navy Slate)
- **Border & Dividers**: `#1e293b` (Slate 800)
- **Active / Primary Accent**: `#38bdf8` (Sky 400) / `#6366f1` (Indigo 500)
- **Success / Ready**: `#10b981` (Emerald 500)
- **Warning / Processing**: `#f59e0b` (Amber 500)
- **Error / Attention**: `#ef4444` (Rose 500)
- **Reading Active Highlight**: `rgba(56, 189, 248, 0.18)` with left border indicator

## 4. Component Architecture

To avoid markup duplication and maintain consistency, the UI is built strictly with reusable components:

1. **`Button`**:
   - Variants: `primary`, `secondary`, `outline`, `ghost`, `danger`.
   - Sizes: `sm`, `md`, `lg`, `icon`.
   - States: idle, loading (spinner), disabled.

2. **`Badge`**:
   - Status indicators for pipeline: `pending` (gray), `extracting` (blue pulse), `refining` (purple pulse), `synthesizing` (amber pulse), `ready` (green check), `error` (red).

3. **`Card` / `Panel`**:
   - Consistent rounded borders (`rounded-xl`), backdrop blur, subtle border highlight.

4. **`ProgressBar`**:
   - Multi-segment or smooth animated bar showing overall project extraction, refinement, and audio readiness.

5. **`AudioPlayerBar`**:
   - Floating persistent bottom bar with Play, Pause, Speed adjustment (0.75x, 1x, 1.25x, 1.5x, 2x), Skip Page, Volume, and progress scrub.

6. **`PipelineInspector`**:
   - Live stream of pipeline logs, stage transitions, per-page step trigger, and M2 Mac CPU/memory load indicators.
   - Every block (stages, narrator voices, system load, TTS backend, pages, logs) is a collapsible `Section`; open state persists per section id in `localStorage` (`pdf-reader.section.<id>`).

7. **`Section`** (`ui/Section.jsx`):
   - Collapsible inspector/form block: chevron toggle row, optional icon, `meta` summary that stays visible while collapsed, and header `action` buttons that never toggle the section.
   - Never add a section without `id` — the id keys the persisted open state.

8. **Per-page stage grid** (`inspector/PageGrid.jsx` + `lib/pageStages.js`):
   - A page carries four states derived from cached artifacts, not from one status column: nothing → **Text** (raw OCR, sky) → **Script** (refined narration, violet) → **Audio** (emerald, the only "done").
   - Each cell shows three micro bars, cell tint follows the furthest cached stage, and a spinner appears only while the engine reports that exact page and stage running (`activeRun` + stage state) — cached work never spins.
   - Filter tiles are non-overlapping buckets (Pending / Text / Script / Audio / Error) so the counts sum to the page total.

9. **`Modal`**:
   - Accessible dialog for Settings (API keys, provider URLs, model names, safe throttle delays) and New Project import.
