# Narration Pipeline Specification

This document details the exact logic and processing rules for converting noisy scanned book text into human-like audio narration.

---

## 1. Text Cleaning & Normalization Rules

### What to Omit (Noise Filter)
The cleaner eliminates any content that degrades the audio listening experience:
1. **Running Headers & Footers**: Discard text positioned in top or bottom 8% of page height if repeated or containing book/chapter titles.
2. **Page Numbers**: Discard standalone numbers at top/bottom corners or centers.
3. **Citation Markers & Superscripts**: Remove `[1]`, `[12]`, `(1)`, `*`, `†`, etc.
4. **Footnotes**: If footnote separator lines or footnote sections are detected at the bottom of the page, exclude them from standard narrative audio.
5. **Tables of Contents & Index Dot Leaders**: Remove repeated periods/dots (e.g., `Chapter 1 ............ 23`).
6. **Hyphenated Line Breaks**: Rejoin split words across line breaks (e.g., `trans- \n port` -> `transport`).

### What to Transform (Spoken Prose Polish)
1. **Abbreviations**: Expand common abbreviations contextually (e.g. "Dr." -> "Doctor", "vs." -> "versus", "পৃ." -> "পৃষ্ঠা").
2. **Religious Honorifics**:
   - (সা.) or ﷺ -> pronounced "সাল্লাল্লাহু আলাইহি ওয়া সাল্লাম" (or natural pauses depending on language mode).
   - (আ.) -> "আলাইহিস সালাম".
   - (রা.) -> "রাদিয়াল্লাহু আনহু".
3. **Punctuation & Pauses**:
   - Paragraph break -> 500 ms pause.
   - Colon / Dash introducing a quote -> 350 ms pause.
   - Comma / Dari (।) -> 250 ms pause.

---

## 2. Script Detection & Language Routing

### Unicode Boundaries
- **Bengali (`bn`)**: `\u0980-\u09FF`
- **Arabic (`ar`)**: `\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF`
- **English / Latin (`en`)**: `[A-Za-z]`

### Contextual Rules
- **Bengali with Arabic Loanwords**: Words such as `আল্লাহ`, `রাসূলুল্লাহ`, `নামাজ`, `রোজা`, `হাদিস` are written in Bengali script. They must be spoken by the **Bengali** TTS engine using standard Bengali phonology, **not** routed to the Arabic engine.
- **Direct Arabic Quotations**: Quranic passages or Hadith texts written in Arabic script are routed to the **Arabic** TTS engine.
- **English Terminology**: Technical terms, citations, or book titles written in Latin script are routed to the **English** TTS engine.

---

## 3. Voice Cloning with OmniVoice

### Reference Voice Requirements
- **Duration**: 10–30 seconds of clean, continuous speech.
- **Audio Format**: 24 kHz or 16 kHz WAV, mono, no background noise or music.
- **Profile Storage**: Create voice prompt profile once and reuse across chapters:
  ```
  voices/
    narrator_01/
      reference.wav
      reference.txt
      profile.pt
  ```

### Code Snippet for OmniVoice Prompt Caching
```python
import torch
from omnivoice import OmniVoice

def create_or_load_voice_profile(model, profile_dir, ref_wav, ref_text):
    profile_path = profile_dir / "profile.pt"
    if profile_path.exists():
        return torch.load(profile_path)
    
    voice = model.create_voice_clone_prompt(
        ref_audio=str(ref_wav),
        ref_text=ref_text
    )
    torch.save(voice, profile_path)
    return voice
```

---

## 4. Audio Stitching & Output Format
- Synthesize individual chunks as 24 kHz WAV.
- Match RMS loudness across language switches to avoid jarring volume jumps.
- Insert silent audio buffers matching the designated pause duration (`pause_after_ms`).
- Export finalized chapters as 128 kbps CBR MP3 with embedded chapter metadata.
