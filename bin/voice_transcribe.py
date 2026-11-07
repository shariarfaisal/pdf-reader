#!/usr/bin/env python3
"""Transcribe a short voice-clone reference sample.

Supports:
1. faster-whisper CT2 models (`faster-whisper-large-v3-turbo`, `faster-whisper-small`, etc.)
2. sherpa-onnx Whisper models (`csukuangfj/sherpa-onnx-whisper-tiny`)
3. sherpa-onnx NeMo Parakeet transducer models (`csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8`)

Usage: voice_transcribe.py <audio_path> [language_hint]
Environment:
  PDFREADER_ASR_PATH   - resolved directory containing model weights
  PDFREADER_ASR_ENGINE - 'faster-whisper' | 'sherpa-onnx-whisper' | 'sherpa-onnx-transducer'
Prints: {"text": "...", "language": "bn", "duration": 12.3, "model": "..."}
"""
import glob
import json
import os
import sys

LANG_MAP = {'bn': 'bn', 'en': 'en', 'ar': 'ar', 'auto': None}


def fail(message):
    print(json.dumps({'error': message}))
    sys.exit(1)


def find_default_model_dir():
    env_path = (os.environ.get('PDFREADER_ASR_PATH') or '').strip()
    if env_path and os.path.isdir(env_path):
        return env_path

    hub = os.path.expanduser(os.environ.get('HUGGINGFACE_HUB_CACHE') or '~/.cache/huggingface/hub')
    candidates = [
        'models--deepdml--faster-whisper-large-v3-turbo-ct2',
        'models--Systran--faster-whisper-small',
        'models--csukuangfj--sherpa-onnx-whisper-tiny',
        'models--csukuangfj--sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
    ]
    for folder in candidates:
        snaps = sorted(glob.glob(os.path.join(hub, folder, 'snapshots', '*')), key=os.path.getmtime, reverse=True)
        for s in snaps:
            if os.path.isdir(s):
                return s
    return None


def detect_engine(model_dir):
    env_engine = (os.environ.get('PDFREADER_ASR_ENGINE') or '').strip()
    if env_engine:
        return env_engine
    if os.path.exists(os.path.join(model_dir, 'model.bin')):
        return 'faster-whisper'
    if os.path.exists(os.path.join(model_dir, 'tiny-encoder.int8.onnx')):
        return 'sherpa-onnx-whisper'
    if os.path.exists(os.path.join(model_dir, 'encoder.int8.onnx')):
        return 'sherpa-onnx-transducer'
    return 'faster-whisper'


def transcribe_faster_whisper(model_dir, audio_path, lang_hint):
    try:
        from faster_whisper import WhisperModel
    except Exception as exc:
        fail(f'faster-whisper unavailable: {exc}')

    model = WhisperModel(model_dir, device='cpu', compute_type='int8', cpu_threads=4)
    segments, info = model.transcribe(
        audio_path,
        language=lang_hint,
        beam_size=5,
        vad_filter=True,
        condition_on_previous_text=False,
    )
    text = ' '.join(seg.text.strip() for seg in segments).strip()
    return {
        'text': text,
        'language': getattr(info, 'language', None),
        'duration': round(float(getattr(info, 'duration', 0.0)), 2),
    }


def transcribe_sherpa_onnx(model_dir, audio_path, lang_hint, engine):
    try:
        import sherpa_onnx
        import soundfile as sf
        import numpy as np
    except Exception as exc:
        fail(f'sherpa-onnx or soundfile unavailable: {exc}')

    samples, sample_rate = sf.read(audio_path, dtype='float32')
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    duration = len(samples) / float(sample_rate) if sample_rate else 0.0

    # Resample to 16kHz if needed
    if sample_rate != 16000:
        import torchaudio
        import torch
        wav_t = torch.from_numpy(samples).unsqueeze(0)
        wav_16k = torchaudio.functional.resample(wav_t, sample_rate, 16000)
        samples = wav_16k.squeeze(0).numpy()
        sample_rate = 16000

    if engine == 'sherpa-onnx-whisper':
        enc = os.path.join(model_dir, 'tiny-encoder.int8.onnx')
        dec = os.path.join(model_dir, 'tiny-decoder.int8.onnx')
        tok = os.path.join(model_dir, 'tiny-tokens.txt')
        recognizer = sherpa_onnx.OfflineRecognizer.from_whisper(
            encoder=enc,
            decoder=dec,
            tokens=tok,
            language=lang_hint or 'en',
            task='transcribe',
            num_threads=4,
        )
    else:
        enc = os.path.join(model_dir, 'encoder.int8.onnx')
        dec = os.path.join(model_dir, 'decoder.int8.onnx')
        joiner = os.path.join(model_dir, 'joiner.int8.onnx')
        tok = os.path.join(model_dir, 'tokens.txt')
        recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=enc,
            decoder=dec,
            joiner=joiner,
            tokens=tok,
            num_threads=4,
            model_type='nemo_transducer',
        )

    stream = recognizer.create_stream()
    stream.accept_waveform(sample_rate, samples)
    recognizer.decode_stream(stream)
    text = (stream.result.text or '').strip()
    return {
        'text': text,
        'language': lang_hint or 'en',
        'duration': round(float(duration), 2),
    }


def main():
    if len(sys.argv) < 2:
        fail('Usage: voice_transcribe.py <audio_path> [language_hint]')

    audio_path = sys.argv[1]
    lang_hint = LANG_MAP.get((sys.argv[2] if len(sys.argv) > 2 else 'auto').lower())

    if not os.path.exists(audio_path):
        fail(f'audio not found: {audio_path}')

    model_dir = find_default_model_dir()
    if not model_dir or not os.path.isdir(model_dir):
        fail('No local ASR model is installed. Open Model Manager to download or reference an ASR model.')

    engine = detect_engine(model_dir)
    if engine in ('sherpa-onnx-whisper', 'sherpa-onnx-transducer'):
        res = transcribe_sherpa_onnx(model_dir, audio_path, lang_hint, engine)
    else:
        res = transcribe_faster_whisper(model_dir, audio_path, lang_hint)

    print(json.dumps(res))


if __name__ == '__main__':
    main()
