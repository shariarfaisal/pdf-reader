# Product Requirements Document (PRD) — PDF Reader & Audio Narrator

## 1. Product Overview
**PDF Reader** is an application designed for reading and listening to books and documents, with a specialized focus on **scanned-image PDFs** (e.g. photos or scanned pages of physical books) and **multilingual literature** (specifically Bengali, Arabic, and English mixed texts like Islamic studies, textbooks, and translated literature).

Instead of mechanical, robotic screen reading that blindly reads header lines, page numbers, and footnotes, the system uses an intelligent narration processing pipeline to read texts like a human narrator.

---

## 2. Core Problem & User Needs
1. **Scanned Book Reading**: Many books are image-only PDFs (photographs or scans of paper books). Standard PDF readers cannot read them without OCR.
2. **Robotic vs. Human Narration**: Traditional text-to-speech tools read everything verbatim—including page numbers ("Page 142"), running headers, citation brackets (" [12] "), and footnotes—breaking reading immersion.
3. **Multilingual Code-Switching**: Islamic and South Asian literature frequently alternates between Bengali commentary, Arabic Quranic/Hadith text, and English terms. Standard single-language TTS fails on pronunciation.
4. **Custom Voice Preference**: Users want narration in a personalized, consistent, pleasant voice (zero-shot cloning from 10–30s audio sample).
5. **Hardware Constraints**: Must run reliably on a MacBook Air M2 with 8 GB RAM without freezing or crashing due to memory pressure.

---

## 3. Key Features & Specifications

### F1: PDF Viewer Interface
- Open and render PDF files (both vector/digital text and scanned bitmap images).
- Clean reading UI: Page thumbnail drawer, dual/single page view, zoom, smooth navigation.
- Highlight or visual indicator showing currently read paragraph or page.

### F2: Extraction & OCR Pipeline
- Digital PDF: Direct text layer extraction (via PyMuPDF / pdfplumber).
- Scanned PDF: Page image rendering + OCR (local Tesseract / Apple Vision framework / lightweight OCR or vision LLM API).
- Bounding box extraction to map spoken sentences to visual coordinates on the page.

### F3: LLM Narration Cleaner & Normalizer
- Filters out non-narration noise:
  - Running headers and footers
  - Page numbers and chapter stamp metadata
  - Footnote marks, citation superscripts, and editorial brackets
  - Publisher info, cataloging-in-publication data, copyright boilerplate
- Formats text for human-sounding delivery:
  - Expands abbreviations appropriately
  - Inserts natural pause indicators around dialogues and quotations
  - Separates sacred verses / quotes for specialized pronunciation

### F4: Multilingual Narration Planner (BN + AR + EN)
- **Language & Script Detection**:
  - Bengali (`bn`): Unicode `\u0980-\u09FF`
  - Arabic (`ar`): Unicode `\u0600-\u06FF`, `\u0750-\u077F`, `\u08A0-\u08FF`
  - English (`en`): Latin script
- **Context-Aware Rules**:
  - Bengali sentences with Arabic loanwords (e.g. আল্লাহ, রাসুলুল্লাহ, হাদিস) remain in the Bengali narrator's pronunciation.
  - Full Arabic Quranic verses / Hadith are routed to Arabic synthesis or authentic recitation profiles.
  - English technical terms and titles are handled smoothly without awkward tone breaks.

### F5: Text-to-Speech Engine & Voice Cloning
- **Local Tier A (MMS-TTS)**: Extremely lightweight (~36 MB per language, ~145 MB RAM) Meta MMS models for fast local CPU playback.
- **Local Voice Cloning (OmniVoice)**: Zero-shot voice cloning using existing local weights (`~/.cache/huggingface/hub/models--k2-fsa--OmniVoice`). Generates speech from a 10–30s reference voice sample.
- **Sequential Chunk Processing**: Synthesize audio in paragraph-sized chunks ahead of playback to prevent memory spikes on 8 GB RAM.

### F6: Dual Processing Modes (Local Preview vs. Colab Full-Book)
- **Local Mode (Mac M2 8 GB)**: Real-time interactive reading, page-by-page speech preview, immediate playback.
- **Batch Export Mode (Google Colab GPU)**: Process large 300+ page books in bulk using Colab GPU + Google Drive checkpoints, exporting full-chapter MP3s with timing manifests.

---

## 4. Non-Functional Requirements
- **Memory Footprint**: Active RAM usage on macOS must stay under 3 GB to preserve responsiveness on 8 GB machines.
- **Zero Storage Bloat**: No duplicate downloads of models already present in local HuggingFace cache.
- **Offline Capable**: Core reading and baseline TTS must work without internet connection.
- **Modularity**: Separation between UI, extraction, narration planning, and TTS backends.
