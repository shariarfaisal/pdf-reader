# Local Model Inventory & Reuse Guidelines

This document tracks all machine learning models already downloaded on this MacBook. **Do not re-download or duplicate these weights**, as storage and memory are constrained.

---

## 1. Local Disk Inventory

### Location: Hugging Face Cache (`~/.cache/huggingface/hub/`)
Total storage used: **~5.4 GB**

| Model Identifier | Parameter Size | Format & Precision | Capability | Published License | Exact Snapshot Path on Disk |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`k2-fsa/OmniVoice`** | 613M (~2.3 GiB fp32 / 3.0 GB disk) | PyTorch (`model.safetensors`, `audio_tokenizer`) | TTS + Zero-shot voice cloning, 600+ languages, 24 kHz | Code: Apache-2.0, Weights: CC-BY-NC | `~/.cache/huggingface/hub/models--k2-fsa--OmniVoice/snapshots/c5fdb5ccb189668d56333f77ba2629f4cd7535f4` |
| **`deepdml/faster-whisper-large-v3-turbo-ct2`** | 809M (~1.5 GB disk) | CTranslate2 | Multilingual ASR (99 languages), word timestamps | MIT (Whisper) | `~/.cache/huggingface/hub/models--deepdml--faster-whisper-large-v3-turbo-ct2/snapshots/a34493f3501a4e17ef9761f237efca51dd584347` |
| **`csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8`** | 0.6B (~640 MB disk) | ONNX int8 | Fast CPU ASR, English/EU | CC-BY-4.0 (NVIDIA) | `~/.cache/huggingface/hub/models--csukuangfj--sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/snapshots/ebcfb78f8b3fc63e8006b9bba47a960fbfaae673` |
| **`csukuangfj/sherpa-onnx-whisper-tiny`** | 39M (~245 MB disk) | ONNX | Multilingual ASR, low memory / draft | MIT | `~/.cache/huggingface/hub/models--csukuangfj--sherpa-onnx-whisper-tiny/snapshots/0c1752ab08e16be2c999b1a55b3a4f89d5350ca9` |

---

## 2. Models Not Reusable Locally

### FluidVoice / ALTIC (`~/Library/Application Support/`)
- **`Fluid-1 Mini 2B` (qwen35-2b base)**: 1.51 GB Q6 weights.
  - **Verdict**: ❌ Cannot be reused. Governed by ALTIC license restricting usage exclusively to official FluidVoice applications, and requires the proprietary compiled `FluidDecode` runtime.

---

## 3. How to Load Local Models Without Re-downloading

### Loading `k2-fsa/OmniVoice` Locally
Do not call `OmniVoice.from_pretrained("k2-fsa/OmniVoice")` without checking cache, or pass the local snapshot directory directly:

```python
import os
from pathlib import Path
import torch

OMNIVOICE_CACHE_DIR = Path.home() / ".cache/huggingface/hub/models--k2-fsa--OmniVoice/snapshots/c5fdb5ccb189668d56333f77ba2629f4cd7535f4"

def load_omnivoice(device="mps"):
    """Loads OmniVoice from existing local HF cache."""
    # Ensure offline mode to guarantee no network call or duplicate download
    os.environ["HF_HUB_OFFLINE"] = "1"
    
    # If using omnivoice package:
    from omnivoice import OmniVoice
    
    model_path = str(OMNIVOICE_CACHE_DIR) if OMNIVOICE_CACHE_DIR.exists() else "k2-fsa/OmniVoice"
    model = OmniVoice.from_pretrained(
        model_path,
        device_map=device if torch.backends.mps.is_available() else "cpu",
        dtype=torch.float16 if torch.backends.mps.is_available() else torch.float32
    )
    return model
```

### Loading `faster-whisper-large-v3-turbo-ct2` (for audio verification / alignment)
```python
from pathlib import Path
from faster_whisper import WhisperModel

WHISPER_CACHE_DIR = Path.home() / ".cache/huggingface/hub/models--deepdml--faster-whisper-large-v3-turbo-ct2/snapshots/a34493f3501a4e17ef9761f237efca51dd584347"

def load_whisper():
    return WhisperModel(
        str(WHISPER_CACHE_DIR),
        device="cpu", # or "auto"
        compute_type="int8"
    )
```

---

## 4. Lightweight TTS Addition: Meta MMS-TTS (Tier A Baseline)
For pure offline narration on M2 (8 GB RAM), Meta MMS-TTS models are ultra-compact:
- `facebook/mms-tts-ben` (Bengali, ~36.3 MB weights, ~145 MB RAM)
- `facebook/mms-tts-ara` (Arabic, ~36.3 MB weights, ~145 MB RAM)
- `facebook/mms-tts-eng` (English, ~36.3 MB weights, ~145 MB RAM)

Total disk space for all three: **~110 MB**.
Total memory budget: **~435 MB** (safe for 8 GB RAM).
