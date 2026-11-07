# PDF Reader & Intelligent Audiobook Narrator

A dedicated PDF and scanned-book reader featuring human-like voice narration, designed specifically for multilingual literature (Bengali, Arabic, English) and zero-shot voice cloning.

## Key Capabilities
- **Scanned & Image PDF Support**: Reads photographed/scanned book pages as smoothly as native digital PDFs.
- **Natural Narration**: Strips document noise (headers, footers, page numbers, footnotes, ISBN boilerplate) to read naturally like a human.
- **Multilingual Code-Switching**: Handles mixed Bengali prose, Arabic Quran/Hadith passages, and English terminology without awkward pronunciations.
- **Voice Cloning**: Narrate books using a personalized voice cloned from a 10–30 second audio clip via locally cached OmniVoice.
- **Parallel Stage Lanes**: OCR, Script (LLM refiner) and Audio each run in their own lane, so a slow refiner call never blocks text extraction on the next page — start any stage mid-run and it picks up from the first page that still needs it.
- **Optimized for M2 MacBook (8 GB RAM)**: Extremely disciplined memory management; reuses existing local Hugging Face model weights without duplicate downloads.

## Documentation
- [AGENTS.md](AGENTS.md) — Operational instructions and constraints for AI agents.
- [docs/PRD.md](docs/PRD.md) — Product Requirements Document.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — System architecture and pipeline flow.
- [docs/LOCAL_MODELS.md](docs/LOCAL_MODELS.md) — Inventory of local machine learning models and reuse instructions.
- [docs/NARRATION_PIPELINE.md](docs/NARRATION_PIPELINE.md) — Text cleaning, script routing, and audio synthesis details.
- [docs/ROADMAP.md](docs/ROADMAP.md) — Phased development plan.

## Commands
```bash
npm run dev            # API + UI on http://localhost:4321
npm run build:frontend # Production bundle served by the API
npm run test:pipeline  # Stage-lane scheduler tests (OCR/LLM/TTS stubbed, temp DB)

# Narration sync: fill sentence timings for pages synthesized before the engine
# reported them (never re-synthesizes; reads the stored WAV + script).
python bin/backfill_timings.py           # only pages missing timings
python bin/backfill_timings.py --dry-run # report only
```
