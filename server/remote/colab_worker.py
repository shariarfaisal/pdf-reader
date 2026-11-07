#!/usr/bin/env python3
"""
Colab GPU TTS worker for PDF Reader.

Runs on a Google Colab VM (CUDA) and exposes OmniVoice zero-shot cloning over
HTTP, so the local Node pipeline can synthesize one page at a time through an
`ssh -L` tunnel opened by `colab ssh --proxy-mode`.

Design notes:
- The model is loaded ONCE at startup and kept warm for the whole session, so a
  book of hundreds of pages pays the load cost a single time.
- Long pages are chunked on sentence boundaries and concatenated, matching the
  local synthesizer's behavior and keeping VRAM flat (~2.4 GB on a T4).
- Only inference happens here; all caching/checkpointing stays in the local
  SQLite database.

Endpoints:
  GET  /health  -> { ok, model_loaded, gpu, vram_allocated_gb }
  POST /tts     -> audio/wav body, X-Audio-Seconds / X-Synth-Seconds headers
"""

import io
import os
import re
import time

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import numpy as np

try:
    import torch
except Exception as exc:  # pragma: no cover - surfaced through /health
    torch = None
    TORCH_ERROR = str(exc)
else:
    TORCH_ERROR = None

from fastapi import FastAPI, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

MODEL_ID = os.environ.get("OMNIVOICE_MODEL", "k2-fsa/OmniVoice")
REF_AUDIO = os.environ.get("TTS_REF_AUDIO", "/content/pdfreader_ref.wav")
VOICES_DIR = os.environ.get("TTS_VOICES_DIR", "/content/pdfreader_voices")
DEFAULT_REF_TEXT = os.environ.get(
    "TTS_REF_TEXT",
    "যায়েদ আরো বর্ণনা করেন, আমরা যখন ঘুরে আসলাম, তখন আমি মনে মনে ভাবলাম।",
)
SAMPLE_RATE = 24000
MAX_CHUNK_CHARS = 280
GAP_SECONDS = 0.12

app = FastAPI(title="PDF Reader Colab TTS Worker")
model = None
# voice_id -> pre-encoded VoiceClonePrompt. Encoding the reference clip costs a
# few seconds, so it is done once per voice per session, never per page.
VOICE_PROMPTS = {}


def log(message: str) -> None:
    print(f"[worker] {message}", flush=True)


def chunk_text(text: str, limit: int = MAX_CHUNK_CHARS):
    """Split narration into sentence-sized chunks (Bengali/Arabic/Latin punctuation)."""
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    if not cleaned:
        return []
    sentences = re.split(r"(?<=[।!?\.\u061F])\s+", cleaned)
    chunks, current = [], ""
    for sentence in sentences:
        if not sentence:
            continue
        if len(current) + len(sentence) + 1 <= limit:
            current = f"{current} {sentence}".strip()
        else:
            if current:
                chunks.append(current)
            current = sentence if len(sentence) <= limit else ""
            if len(sentence) > limit:
                # Hard-wrap a single huge sentence on word boundaries.
                words, line = sentence.split(" "), ""
                for word in words:
                    if len(line) + len(word) + 1 <= limit:
                        line = f"{line} {word}".strip()
                    else:
                        chunks.append(line)
                        line = word
                if line:
                    chunks.append(line)
    if current:
        chunks.append(current)
    return chunks


class TTSRequest(BaseModel):
    text: str
    ref_text: str | None = None
    ref_audio: str | None = None
    # Voice library id (see POST /voices). When present the worker uses the
    # uploaded sample + transcript and a warm VoiceClonePrompt.
    voice_id: str | None = None
    # Delivery controls. `instruct` accepts only OmniVoice's fixed tag
    # vocabulary (female, male, low pitch, whisper, british accent, ...);
    # free-form style sentences are rejected by the model itself.
    instruct: str | None = None
    speed: float | None = None
    num_step: int | None = None


@app.on_event("startup")
def load_model():
    global model
    if torch is None:
        log(f"torch import failed: {TORCH_ERROR}")
        return

    started = time.time()
    from omnivoice import OmniVoice

    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device.startswith("cuda") else torch.float32
    model = OmniVoice.from_pretrained(MODEL_ID, device_map=device, dtype=dtype)
    log(
        "MODEL_READY device=%s gpu=%s load_s=%.1f vram_gb=%.2f"
        % (
            device,
            torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
            time.time() - started,
            (torch.cuda.max_memory_allocated() / 1e9) if torch.cuda.is_available() else 0.0,
        )
    )


@app.get("/health")
def health():
    import soundfile  # noqa: F401 - proves the audio stack is importable

    return {
        "ok": True,
        "model_loaded": model is not None,
        "device": "cuda" if (torch is not None and torch.cuda.is_available()) else "cpu",
        "gpu": torch.cuda.get_device_name(0) if (torch is not None and torch.cuda.is_available()) else "cpu",
        "vram_allocated_gb": round((torch.cuda.max_memory_allocated() / 1e9), 2)
        if (torch is not None and torch.cuda.is_available())
        else 0.0,
    }


def voice_path(voice_id: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_-]", "", voice_id)
    return os.path.join(VOICES_DIR, f"{safe}.wav")


def get_voice_prompt(voice_id: str, ref_text: str | None):
    """Return a cached VoiceClonePrompt, encoding the sample on first use."""
    cached = VOICE_PROMPTS.get(voice_id)
    if cached is not None:
        return cached
    path = voice_path(voice_id)
    if not os.path.exists(path):
        raise FileNotFoundError(f"voice not uploaded: {voice_id}")
    prompt = model.create_voice_clone_prompt(
        ref_audio=path,
        ref_text=(ref_text or "").strip() or None,
        preprocess_prompt=True,
    )
    VOICE_PROMPTS[voice_id] = prompt
    log(f"voice ready: {voice_id} (cached prompts: {len(VOICE_PROMPTS)})")
    return prompt


class VoiceUpload(BaseModel):
    id: str
    name: str | None = None
    ref_text: str | None = None
    audio_b64: str


@app.post("/voices")
def upload_voice(req: VoiceUpload):
    import base64

    os.makedirs(VOICES_DIR, exist_ok=True)
    path = voice_path(req.id)
    with open(path, "wb") as fh:
        fh.write(base64.b64decode(req.audio_b64))
    VOICE_PROMPTS.pop(req.id, None)
    log(f"voice uploaded: {req.id} ({os.path.getsize(path)} bytes)")
    return {"ok": True, "id": req.id, "bytes": os.path.getsize(path)}


@app.get("/voices")
def list_voices():
    if not os.path.isdir(VOICES_DIR):
        return {"voices": []}
    return {
        "voices": [
            {"id": os.path.splitext(name)[0], "warm": os.path.splitext(name)[0] in VOICE_PROMPTS}
            for name in sorted(os.listdir(VOICES_DIR))
            if name.endswith(".wav")
        ]
    }


@app.delete("/voices/{voice_id}")
def delete_voice(voice_id: str):
    VOICE_PROMPTS.pop(voice_id, None)
    path = voice_path(voice_id)
    if os.path.exists(path):
        os.remove(path)
    return {"ok": True}


@app.post("/tts")
def synthesize(req: TTSRequest):
    import soundfile as sf

    if model is None:
        return JSONResponse({"error": "model not loaded"}, status_code=503)

    text = (req.text or "").strip()
    if not text:
        return JSONResponse({"error": "empty text"}, status_code=400)

    ref_audio = req.ref_audio or REF_AUDIO
    voice_prompt = None
    if req.voice_id:
        try:
            voice_prompt = get_voice_prompt(req.voice_id, req.ref_text)
        except FileNotFoundError as exc:
            return JSONResponse({"error": str(exc)}, status_code=409)
        except Exception as exc:  # encoding failure = bad sample/transcript pair
            return JSONResponse({"error": f"voice prompt failed: {exc}"}, status_code=400)
    elif not os.path.exists(ref_audio):
        return JSONResponse({"error": f"reference audio missing: {ref_audio}"}, status_code=400)
    ref_text = req.ref_text or DEFAULT_REF_TEXT

    instruct = (req.instruct or "").strip() or None
    speed = req.speed if isinstance(req.speed, (int, float)) else None
    if speed is not None:
        speed = max(0.5, min(2.0, float(speed)))
    num_step = req.num_step if isinstance(req.num_step, int) else None
    if num_step is not None:
        num_step = max(8, min(64, num_step))

    generation_kwargs = {}
    if speed is not None:
        generation_kwargs["speed"] = speed
    if num_step is not None:
        generation_kwargs["num_step"] = num_step

    started = time.time()
    pieces = []
    generate_kwargs = dict(generation_kwargs)
    generate_kwargs["instruct"] = instruct
    if voice_prompt is not None:
        generate_kwargs["voice_clone_prompt"] = voice_prompt
    else:
        generate_kwargs["ref_audio"] = ref_audio
        generate_kwargs["ref_text"] = ref_text

    for chunk in chunk_text(text):
        try:
            audio = model.generate(text=chunk, **generate_kwargs)
        except ValueError as exc:
            # Unsupported instruct tag — surface the model's own message verbatim
            # so the UI can show exactly which token was rejected.
            return JSONResponse({"error": f"instruct rejected: {exc}"}, status_code=400)
        pieces.append(np.asarray(audio[0], dtype=np.float32))

    if not pieces:
        return JSONResponse({"error": "no audio generated"}, status_code=500)

    gap = np.zeros(int(SAMPLE_RATE * GAP_SECONDS), dtype=np.float32)
    combined = pieces[0]
    for piece in pieces[1:]:
        combined = np.concatenate([combined, gap, piece])

    buffer = io.BytesIO()
    sf.write(buffer, combined, SAMPLE_RATE, format="WAV")
    synth_seconds = time.time() - started
    audio_seconds = len(combined) / SAMPLE_RATE
    log(
        "tts chars=%d chunks=%d dur=%.2fs synth=%.2fs rtf=%.2f instruct=%s speed=%s steps=%s"
        % (
            len(text),
            len(pieces),
            audio_seconds,
            synth_seconds,
            synth_seconds / max(audio_seconds, 0.01),
            instruct or "-",
            speed if speed is not None else "-",
            num_step if num_step is not None else "-",
        )
    )

    return Response(
        content=buffer.getvalue(),
        media_type="audio/wav",
        headers={
            "X-Audio-Seconds": f"{audio_seconds:.2f}",
            "X-Synth-Seconds": f"{synth_seconds:.2f}",
            "X-Chunks": str(len(pieces)),
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.environ.get("WORKER_PORT", "8790")),
        log_level="warning",
    )
