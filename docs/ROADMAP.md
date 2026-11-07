# Implementation Roadmap

This roadmap breaks down development into step-by-step verifiable phases.

---

## Phase 1: Planning, Documentation & Architecture (Current)
- [x] Product Requirements Document (`docs/PRD.md`)
- [x] Local Model Inventory & Reuse Rules (`docs/LOCAL_MODELS.md`)
- [x] High-Level System Architecture (`docs/ARCHITECTURE.md`)
- [x] Narration Pipeline Specification (`docs/NARRATION_PIPELINE.md`)
- [x] Agent Operational Guidelines (`AGENTS.md` / `agent.md`)

---

## Phase 2: Document Ingestion & PDF Viewer UI
- [ ] Select and scaffold frontend/app framework (e.g., Next.js / Electron / Tauri + PDF.js).
- [ ] Render both digital text PDFs and scanned bitmap image PDFs.
- [ ] Implement page navigation, thumbnail drawer, and zoom controls.
- [ ] Extract page text and bounding boxes (PyMuPDF for digital, local OCR / Apple Vision for scanned pages).

---

## Phase 3: Narration Cleaner & Language Planner
- [ ] Implement text noise filtering (strip headers, footers, page numbers, footnote references).
- [ ] Implement LLM-based prose restructuring (expand abbreviations, honorifics, natural pause markers).
- [ ] Build script detector (Bengali vs. Arabic vs. English Unicode segmentation).
- [ ] Unit tests with sample multilingual Islamic book passages.

---

## Phase 4: Local Baseline Synthesis (Tier A: MMS-TTS)
- [ ] Integrate Meta MMS-TTS for Bengali, Arabic, and English.
- [ ] Implement segment audio caching (`.audio_cache/`) with deterministic MD5 hashing.
- [ ] Stitch multi-language audio segments into continuous page audio with calibrated pause gaps.
- [ ] Verify low memory consumption on MacBook Air M2 (target: < 1.5 GB RAM).

---

## Phase 5: Zero-Shot Voice Cloning (Tier B: OmniVoice)
- [ ] Connect existing local OmniVoice model from `~/.cache/huggingface/hub/`.
- [ ] Implement voice profile creator: 10–30s reference WAV + transcript -> saved `.pt` prompt.
- [ ] Synthesize narration in user's cloned voice on Apple Silicon MPS / CPU.

---

## Phase 6: Cloud Batch Processing (Google Colab Notebook)
- [ ] Create standalone Google Colab notebook for long-form (300+ page) audiobook generation.
- [ ] Connect Google Drive storage for automated checkpointing (saving completed chunks every 5 pages).
- [ ] Assemble chapter-level MP3s with timing metadata (`manifest.json`).

---

## Phase 7: UI & Narration Synchronization
- [ ] Connect frontend audio player with backend synthesis pipeline.
- [ ] Synchronize real-time visual sentence/word highlighting on PDF canvas during playback.
- [ ] Add playback speed controls (0.75x, 1x, 1.25x, 1.5x) and audio export download.
