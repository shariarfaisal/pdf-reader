# AGENTS.md — PDF Reader & Intelligent Audiobook Narrator

## Identity & Objective
This workspace is for developing **PDF Reader**: an intelligent PDF and scanned-book reader application with natural, human-like voice narration.

### Key Tenets & User Requirements
- **Multi-Project Architecture**: Every PDF uploaded/imported is an independent "Project". Projects have independent page state, metadata, caching, and progress tracking.
- **Visual PDF Reader & Synchronized Playback**:
  - Open and display standard digital PDFs and scanned image pages (e.g. photos of book pages) with smooth navigation.
  - Side-by-side or synced view: PDF visual canvas alongside clean, refined readable text.
  - Synchronized narration highlight (sentence, paragraph, or page-level) as audio plays.
  - Smooth audio flow: Pre-buffers audio per page so playback is continuous and never stutters sentence-by-sentence.
- **Strict Checkpointing & No Redundant Work**:
  - Process is page-by-page.
  - **Every stage is persistently cached** in SQLite:
    1. Page rasterization / render image.
    2. Extracted raw text (digital or OCR).
    3. Refined readable narration script (LLM cleaned).
    4. Synthesized audio file & timing marks.
  - If the application is stopped, closed, or interrupted, it **resumes exactly where it left off**.
  - **Never re-run OCR, text refinement, or audio synthesis for a page that already has it stored**.
- **Tiered Extraction & OCR**:
  - **Bijoy / ANSI Font Auto-Decoding**: Many Bengali literature PDFs (e.g. *Tafsir Ibn Kathir*) are encoded with SutonnyMJ/Bijoy ANSI font mapping where glyphs appear as Latin gibberish (`Zvdmxi Be&b...`). The ingestion engine auto-detects Bijoy patterns and converts them instantly to clean UTF-8 Unicode Bengali (`বাংলা`) in 15ms.
  - **Tier 1 (Free & Local Native OCR)**:
    - **Local Tesseract OCR**: Configured with `bin/tessdata/` supporting Bengali (`ben`), Arabic (`ara`), and English (`eng`).
    - **Native macOS Apple Vision OCR** (`bin/macos_ocr`): Fast on Neural Engine for Latin and Arabic scripts. (Note: Apple Vision does not support Bengali `bn`).
  - **Tier 2 (Configurable Fallback LLM / Vision)**: When native OCR fails or high-accuracy cloud parsing is desired, falls back to configured Vision endpoint (Gemini, Antigravity, OpenAI, or remote SGLang hosting Baidu Unlimited-OCR).
  - **Baidu Unlimited-OCR Assessment**: `baidu/Unlimited-OCR` is a 3.3B parameter model built on SGLang with FlashAttention-3. It requires an NVIDIA CUDA GPU (Linux) and cannot run natively on Apple Silicon macOS MPS. It can be used via its OpenAI-compatible `/v1/chat/completions` API if hosted on a remote GPU server.
- **Natural Human-like Narration (Text Refiner)**:
  - LLM refiner strips noisy artifacts: headers, running footers, page numbers, footnotes, publisher copyright metadata.
  - Formats content into natural, conversational narrative flow while preserving core meaning and Quran/Hadith/multilingual citations.
- **Multilingual & Mixed-Script Support**:
  - Seamless handling of Bengali (বাংলা), Arabic (العربية), and English mixed content (e.g. Islamic literature, Quran/Hadith citations with Bengali translation/narration).
- **Zero-Shot Voice Cloning & TTS**:
  - Support custom narrator voices from short audio samples (10–30s) using locally available OmniVoice or Web Speech / lightweight TTS engines.
- **M2 MacBook Safety & Resource Discipline (8 GB RAM Constraint)**:
  - **Strictly sequential processing**: Never blast all pages in parallel. Run page-by-page.
  - **Pause / Start / Resume / Step controls**: User has full manual control over the pipeline.
  - **System load guard**: Monitor CPU / memory / temperature pressure and throttle gracefully between pages to prevent laptop overheating or freezing.
- **UI & Design System**:
  - Consistent design system with typography tailored for English (Inter), Arabic (Amiri / Scheherazade), and Bengali (Hind Siliguri / Noto Sans Bengali).
  - Reusable UI component architecture (Cards, Buttons, Progress, Player, Inspector).
  - Real-time pipeline status inspection panel showing live progress, stage transitions, and logs for evaluation.

---

## Local Hardware & Model Reuse Guidelines

### 1. Hardware Constraints
- **Host**: MacBook Air M2, 8 GB Unified Memory.
- **Rule**: Maximize efficiency. Run lightweight TTS (MMS-TTS, OmniVoice, or Web Speech) sequentially. Unload models from memory when idle. For full 300+ page books, offload heavy batch generation to Google Colab GPU with Google Drive checkpointing.

### 2. Local Model Inventory (Do Not Re-download!)
All existing weights reside in `~/.cache/huggingface/hub/`:
- **TTS & Voice Cloning**: `k2-fsa/OmniVoice` (~3.0 GB disk, PyTorch/MPS). Snapshot: `~/.cache/huggingface/hub/models--k2-fsa--OmniVoice/snapshots/c5fdb5ccb189668d56333f77ba2629f4cd7535f4`
- **ASR (Speech-to-Text)**:
  - `deepdml/faster-whisper-large-v3-turbo-ct2` (~1.5 GB, CTranslate2)
  - `csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8` (~640 MB, ONNX int8)
  - `csukuangfj/sherpa-onnx-whisper-tiny` (~245 MB, ONNX)
- **FluidVoice / CoreML Models** (`~/Library/Application Support/`):
  - `Fluid-1 Mini 2B` is locked to FluidVoice proprietary runtime. Do not attempt to run it standalone.

Refer to `docs/LOCAL_MODELS.md` for loader snippets and path configurations.

---

## Workflow & Coding Rules
1. **Step-by-Step Delivery**: Do not implement unverified speculative abstractions. Implement one layer at a time: UI viewer -> Extraction/OCR -> Narration cleaning -> Audio synthesis -> Sync.
2. **High Signal, Low Noise**: Filter out boilerplate, marketing fluff, and theoretical dead-ends. Focus strictly on working, runnable code and documentation.
3. **Terse Communication**: Caveman / high-density communication style per root `AGENTS.md`. No conversational filler.
4. **Verifiable Testing**: Verify code, test scripts, and build status before completing any phase.

