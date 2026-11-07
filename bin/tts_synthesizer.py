#!/Users/macbookm2air/Desktop/personal-projects/voicestudio/.venv/bin/python
"""
Low-Memory Single-Process Audiobook TTS Synthesizer (Optimized for 8GB M2 MacBook Air)
Supports:
1. Local Zero-Shot Voice Cloning via k2-fsa/OmniVoice on Apple Silicon MPS:
   - Runs in a SINGLE Python process (no nested subprocesses).
   - Two-stage memory-split pipeline:
     * Stage 1: Loads ONLY the 1.16 GB FP16 LLM on MPS (`train=True, low_cpu_mem_usage=True`),
       generates compact audio token tensors chunk-by-chunk with batch_size=1 and `torch.mps.empty_cache()`,
       then completely unloads the LLM (`MPS_alloc -> 0 MB`).
     * Stage 2: Loads ONLY the CPU Audio Tokenizer (`HiggsAudioV2Tokenizer`) to decode tokens to 24kHz WAV.
   - Peak memory stays ~1.5-1.8 GB instead of ~4.5 GB, and never spawns duplicate Python servers.
2. Ultra-Realistic Neural Voices (Edge-TTS) alternative/fallback.
3. Native macOS System Fallback.
"""

import sys
import os
import re
import gc
import glob
import math
import json
import signal
import asyncio
import subprocess

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

# Ensure graceful termination on SIGTERM/SIGINT so no orphan process survives
def _handle_signal(signum, frame):
    sys.exit(130)

signal.signal(signal.SIGTERM, _handle_signal)
signal.signal(signal.SIGINT, _handle_signal)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(PROJECT_ROOT, 'data')
CUSTOM_AUDIO_M4A = os.path.join(DATA_DIR, 'custom-audio.m4a')
CUSTOM_VOICE_REF_WAV = os.path.join(DATA_DIR, 'custom-voice-ref.wav')
CUSTOM_VOICE_PROMPT_PT = os.path.join(DATA_DIR, 'custom-voice-prompt.pt')
CUSTOM_VOICE_REF_TEXT = 'যায়েদ আরো বর্ণনা করেন, আমরা যখন ঘুরে আসলাম, তখন আমি মনে মনে ভাবলাম।'

VOICES_DIR = os.path.expanduser('~/Library/Application Support/OmniVoice/voices')
VOICE_MANIFEST = os.path.join(DATA_DIR, 'voices', 'voices.json')


def _resolve_omnivoice_snapshot():
    env_path = (os.environ.get('PDFREADER_OMNIVOICE_PATH') or '').strip()
    if env_path and os.path.isdir(env_path):
        return env_path
    hub = os.path.expanduser(os.environ.get('HUGGINGFACE_HUB_CACHE') or '~/.cache/huggingface/hub')
    snaps = sorted(
        glob.glob(os.path.join(hub, 'models--k2-fsa--OmniVoice', 'snapshots', '*')),
        key=os.path.getmtime,
        reverse=True,
    )
    for s in snaps:
        if os.path.isdir(s):
            return s
    return os.path.expanduser(
        '~/.cache/huggingface/hub/models--k2-fsa--OmniVoice/snapshots/c5fdb5ccb189668d56333f77ba2629f4cd7535f4'
    )


HF_OMNIVOICE_SNAPSHOT = _resolve_omnivoice_snapshot()

BENGALI_RANGE = (0x0980, 0x09FF)
ARABIC_RANGE = (0x0600, 0x06FF)

# Delivery controls (speed / instruct tags / diffusion steps). Filled from the
# CLI arguments in main(); the synthesis path reads them from here.
DELIVERY = {'speed': 1.0, 'instruct': None, 'num_step': 16}

CUSTOM_VOICES = {
    'Custom Voice': {
        'file': CUSTOM_VOICE_REF_WAV if os.path.exists(CUSTOM_VOICE_REF_WAV) else CUSTOM_AUDIO_M4A,
        'prompt_pt': CUSTOM_VOICE_PROMPT_PT,
        'transcript': CUSTOM_VOICE_REF_TEXT,
    },
    'Sirah': {
        'file': CUSTOM_VOICE_REF_WAV if os.path.exists(CUSTOM_VOICE_REF_WAV) else os.path.join(VOICES_DIR, '798f4481.m4a'),
        'prompt_pt': CUSTOM_VOICE_PROMPT_PT,
        'transcript': CUSTOM_VOICE_REF_TEXT,
    },
    'Adam': {
        'file': os.path.join(VOICES_DIR, '454667eb.mp3'),
        'prompt_pt': os.path.join(DATA_DIR, 'voice_prompt_adam.pt'),
        'transcript': 'The people who are crazy enough to think they can change the world are the ones who do.',
    },
    'Jessica': {
        'file': os.path.join(VOICES_DIR, '5eabc57e.mp3'),
        'prompt_pt': os.path.join(DATA_DIR, 'voice_prompt_jessica.pt'),
        'transcript': 'Lamborghini seemed to view competition as an occupational hazard.',
    },
    'Demo Voice': {
        'file': os.path.join(VOICES_DIR, 'demo0001.wav'),
        'prompt_pt': os.path.join(DATA_DIR, 'voice_prompt_demo.pt'),
        'transcript': "Hey. I'm the VoiceStudio demo voice. I was made right here, on your machine.",
    }
}


# Built-in reference voices keep the legacy trimming behaviour; voices from the
# app's library are already normalized (24 kHz mono, <= 30 s) at upload time.
for _cfg in CUSTOM_VOICES.values():
    _cfg.setdefault('trim', True)


def _manifest_voices():
    """Voice library written by the Node server (data/voices/voices.json)."""
    try:
        with open(VOICE_MANIFEST, 'r', encoding='utf-8') as fh:
            data = json.load(fh)
    except Exception:
        return {}

    out = {}
    for item in data.get('voices', []):
        vid = item.get('id')
        if not vid:
            continue
        out[vid] = {
            'id': vid,
            'name': item.get('name') or vid,
            'file': item.get('file'),
            'prompt_pt': item.get('prompt_pt') or os.path.join(DATA_DIR, 'voices', vid, 'prompt.pt'),
            'transcript': (item.get('transcript') or '').strip() or None,
            'trim': False,
        }
    return out


def voice_config(voice_key):
    """Resolve a manifest voice id or a builtin key into a clone config."""
    manifest = _manifest_voices()
    if voice_key in manifest:
        return manifest[voice_key]
    return CUSTOM_VOICES.get(voice_key) or CUSTOM_VOICES['Custom Voice']


def detect_script(text):
    """Detect predominant script in a text segment: bengali, arabic, or english."""
    bn_count = 0
    ar_count = 0
    en_count = 0
    for ch in text:
        cp = ord(ch)
        if BENGALI_RANGE[0] <= cp <= BENGALI_RANGE[1]:
            bn_count += 1
        elif ARABIC_RANGE[0] <= cp <= ARABIC_RANGE[1]:
            ar_count += 1
        elif 'a' <= ch.lower() <= 'z':
            en_count += 1
    if bn_count >= ar_count and bn_count > 0 and bn_count >= en_count:
        return 'bengali'
    if ar_count > bn_count and ar_count >= en_count and ar_count > 0:
        return 'arabic'
    if bn_count > 0:
        return 'bengali'
    if ar_count > 0:
        return 'arabic'
    return 'english'


def detect_chunk_lang(text):
    """
    Return OmniVoice ISO language code ('bn', 'arb', 'en').
    """
    bn = sum(1 for ch in text if BENGALI_RANGE[0] <= ord(ch) <= BENGALI_RANGE[1])
    ar = sum(1 for ch in text if ARABIC_RANGE[0] <= ord(ch) <= ARABIC_RANGE[1])
    en = sum(1 for ch in text if 'a' <= ch.lower() <= 'z')
    if bn > 0 and bn >= ar and bn >= en:
        return 'bn'
    if ar > 0 and ar >= bn and ar >= en:
        return 'arb'
    return 'en'


# Pronunciation & orthographic normalization for clearer Bangla/Arabic/English articulation
PRONUNCIATION_MAP = [
    # Remove zero-width non-joiner/joiner mid-word that breaks BPE tokens (e.g. ইব্‌ন -> ইবনে)
    (r'ইব্\u200c?ন\b', 'ইবনে'),
    (r'[\u200c\u200d]', ''),
    # Remove transliteration apostrophes inside Bangla words (e.g. তা’বীল -> তাবীল, কুর’আন -> কুরআন)
    (r'(?<=[\u0980-\u09FF])[’\'ʼʻ](?=[\u0980-\u09FF])', ''),
    # Expand common Islamic honorific abbreviations in Bangla
    (r'\(সাঃ\)|\(সা\.\)', ' সাল্লাল্লাহু আলাইহি ওয়াসাল্লাম '),
    (r'\(রাঃ\)|\(রা\.\)', ' রাদিয়াল্লাহু আনহু '),
    (r'\(রহঃ\)|\(রহ\.\)', ' রহমাতুল্লাহি আলাইহি '),
    (r'\(আঃ\)|\(আ\.\)', ' আলাইহিস সালাম '),
    # Replace slash between Bangla words with ' বা ' (or) so TTS doesn't skip or garble
    (r'(?<=[\u0980-\u09FF])/(?=[\u0980-\u09FF])', ' বা '),
    # Strip decorative curly quotes that confuse pause timing
    (r'[‘’“”«»]', ' '),
]


def sanitize_text(text):
    if not text:
        return ''
    clean = re.sub(r'[\r\t\f\v]', ' ', text)
    for pattern, repl in PRONUNCIATION_MAP:
        clean = re.sub(pattern, repl, clean)
    clean = re.sub(r'[ \xa0]+', ' ', clean)
    clean = ''.join(c for c in clean if c.isprintable() or c in '\n ')
    return clean.strip()


def split_text_for_omnivoice(text, max_chars=280):
    """
    Split multilingual text (English, Bangla, Arabic) into natural sentence chunks
    up to `max_chars` without dropping any words or splitting tiny inline quotes.
    """
    clean = sanitize_text(text)
    if not clean:
        return []

    raw_parts = re.split(r'(?<=[.!?।॥؟۔\n])\s+', clean)
    sentences = []
    for part in raw_parts:
        part = part.strip()
        if not part:
            continue
        if len(part) <= max_chars:
            sentences.append(part)
        else:
            sub_parts = re.split(r'(?<=[,;،؛:])\s+', part)
            buf = ''
            for sp in sub_parts:
                sp = sp.strip()
                if not sp:
                    continue
                if len(buf) + len(sp) + 1 <= max_chars:
                    buf = f"{buf} {sp}".strip() if buf else sp
                else:
                    if buf:
                        sentences.append(buf)
                        buf = ''
                    if len(sp) <= max_chars:
                        buf = sp
                    else:
                        words = sp.split(' ')
                        wbuf = ''
                        for w in words:
                            if len(wbuf) + len(w) + 1 <= max_chars:
                                wbuf = f"{wbuf} {w}".strip() if wbuf else w
                            else:
                                if wbuf:
                                    sentences.append(wbuf)
                                wbuf = w[:max_chars]
                        buf = wbuf
            if buf:
                sentences.append(buf)

    grouped = []
    for sent in sentences:
        s_lang = detect_chunk_lang(sent)
        if grouped and grouped[-1]['lang'] == s_lang and (len(grouped[-1]['text']) + len(sent) + 1 <= max_chars):
            merged_text = f"{grouped[-1]['text']} {sent}"
            grouped[-1]['text'] = merged_text
        else:
            grouped.append({
                'text': sent,
                'lang': s_lang
            })

    return grouped


def resolve_custom_voice_key(voice_name):
    if not voice_name:
        return 'Custom Voice'

    manifest = _manifest_voices()
    name = voice_name.strip()
    if name in manifest:
        return name
    lowered = name.lower()
    for vid, cfg in manifest.items():
        if (cfg.get('name') or '').lower() == lowered:
            return vid

    vn_lower = lowered
    if any(k in vn_lower for k in ['custom', 'omnivoice', 'clone', 'voicestudio']):
        for key in CUSTOM_VOICES:
            if key.lower() in vn_lower:
                return key
        return 'Custom Voice'
    for key in CUSTOM_VOICES:
        if key.lower() == vn_lower:
            return key
    return None


def _ensure_voice_prompt(cfg):
    """Load pre-encoded VoiceClonePrompt or create & cache it once."""
    import torch
    import torchaudio
    from omnivoice import OmniVoice
    from omnivoice.models.omnivoice import VoiceClonePrompt
    from omnivoice.utils.audio import load_audio

    prompt_pt = cfg.get('prompt_pt')
    if prompt_pt and os.path.exists(prompt_pt):
        return VoiceClonePrompt.load(prompt_pt)

    ref_audio = cfg.get('file')
    if not ref_audio or not os.path.exists(ref_audio):
        if cfg.get('id'):
            raise FileNotFoundError(f"Voice sample missing for '{cfg.get('name')}': {ref_audio}")
    if (not ref_audio or not os.path.exists(ref_audio)) and os.path.exists(CUSTOM_AUDIO_M4A):
        wav = load_audio(CUSTOM_AUDIO_M4A, 24000)
        trimmed = wav[:, int(0.30 * 24000):int(5.25 * 24000)]
        torchaudio.save(CUSTOM_VOICE_REF_WAV, trimmed, 24000)
        ref_audio = CUSTOM_VOICE_REF_WAV
    elif cfg.get('trim', True):
        wav = load_audio(ref_audio, 24000)
        if wav.shape[-1] > int(8.0 * 24000):
            trimmed = wav[:, int(0.30 * 24000):int(5.25 * 24000)]
            ref_audio = (trimmed, 24000)

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    dtype = torch.float16 if device == "mps" else torch.float32
    model = OmniVoice.from_pretrained(HF_OMNIVOICE_SNAPSHOT, device_map=device, dtype=dtype)
    prompt = model.create_voice_clone_prompt(
        ref_audio=ref_audio,
        ref_text=cfg.get('transcript'),
        preprocess_prompt=True
    )
    if prompt_pt:
        os.makedirs(os.path.dirname(prompt_pt), exist_ok=True)
        prompt.save(prompt_pt)
    del model
    gc.collect()
    if device == "mps":
        torch.mps.empty_cache()
    return prompt


def synthesize_omnivoice_clone(text, out_path, voice_key):
    """
    Two-stage low-memory OmniVoice synthesis:
    Stage 1: Load ONLY the 1.16 GB FP16 LLM on MPS, generate token tensors per chunk, then unload LLM.
    Stage 2: Load ONLY the CPU Audio Tokenizer to decode token tensors into 24 kHz audio.
    """
    import torch
    import torchaudio
    from transformers import AutoTokenizer
    from omnivoice.models.omnivoice import (
        OmniVoice,
        OmniVoiceGenerationConfig,
        _audio_tokenizer_cls,
        _get_time_steps,
        _gumbel_sample,
    )
    from omnivoice.utils.duration import RuleDurationEstimator

    cfg = voice_config(voice_key)
    chunks = split_text_for_omnivoice(text, max_chars=280)
    if not chunks:
        raise ValueError("No speakable text after sanitization.")

    prompt = _ensure_voice_prompt(cfg)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    dtype = torch.float16 if device == "mps" else torch.float32

    # --- STAGE 1: LLM Token Generation Only (No Audio Tokenizer in RAM) ---
    model = OmniVoice.from_pretrained(
        HF_OMNIVOICE_SNAPSHOT,
        dtype=dtype,
        low_cpu_mem_usage=True,
        train=True
    ).to(device)
    model.text_tokenizer = AutoTokenizer.from_pretrained(HF_OMNIVOICE_SNAPSHOT)
    model.duration_estimator = RuleDurationEstimator()
    model.sampling_rate = 24000

    class _StubTokConfig:
        frame_rate = 25

    class _StubAudioTok:
        config = _StubTokConfig()

    model.audio_tokenizer = _StubAudioTok()
    model.eval()

    num_step = DELIVERY['num_step']
    cfg_steps = 8
    gen_config = OmniVoiceGenerationConfig(num_step=num_step, guidance_scale=2.0)
    no_cfg_config = OmniVoiceGenerationConfig(num_step=num_step, guidance_scale=0.0)
    pad_id = model.config.audio_mask_id
    layer_ids = torch.arange(model.config.num_audio_codebook, device=device).view(1, -1, 1)
    timesteps = _get_time_steps(0.0, 1.0, num_step + 1, gen_config.t_shift).tolist()

    generated_token_tensors = []
    ref_rms = float(prompt.ref_rms)

    with torch.inference_mode():
        for idx, item in enumerate(chunks):
            txt = item['text'].strip()
            if not txt:
                continue
            lang = item['lang']

            full_task = model._preprocess_all(
                text=txt,
                language=lang,
                ref_text=None,
                ref_audio=None,
                voice_clone_prompt=prompt,
                instruct=DELIVERY['instruct'],
                preprocess_prompt=True,
                speed=DELIVERY['speed'],
                duration=None,
            )
            inp = model._prepare_inference_inputs(
                full_task.texts[0],
                full_task.target_lens[0],
                full_task.ref_texts[0],
                full_task.ref_audio_tokens[0],
                full_task.langs[0],
                full_task.instructs[0],
                gen_config.denoise,
            )
            c_len = inp["input_ids"].size(2)
            t_len = full_task.target_lens[0]

            c_ids = inp["input_ids"].to(device)
            c_amask = inp["audio_mask"].to(device)
            c_attn = torch.ones((1, 1, c_len, c_len), dtype=torch.bool, device=device)

            u_ids = inp["input_ids"][..., -t_len:].clone().to(device)
            u_amask = inp["audio_mask"][..., -t_len:].clone().to(device)
            u_attn = torch.ones((1, 1, t_len, t_len), dtype=torch.bool, device=device)

            tokens = torch.full(
                (1, model.config.num_audio_codebook, t_len),
                pad_id,
                dtype=torch.long,
                device=device,
            )

            total_mask = t_len * model.config.num_audio_codebook
            rem = total_mask
            sched = []
            for step in range(num_step):
                num = (
                    rem
                    if step == num_step - 1
                    else min(math.ceil(total_mask * (timesteps[step + 1] - timesteps[step])), rem)
                )
                sched.append(int(num))
                rem -= int(num)

            for step in range(num_step):
                k = sched[step]
                if k <= 0:
                    continue
                c_logits = model(
                    input_ids=c_ids,
                    audio_mask=c_amask,
                    attention_mask=c_attn,
                ).logits[:, :, c_len - t_len : c_len, :].to(torch.float32)

                if step < cfg_steps:
                    u_logits = model(
                        input_ids=u_ids,
                        audio_mask=u_amask,
                        attention_mask=u_attn,
                    ).logits.to(torch.float32)
                    pred_tokens, scores = model._predict_tokens_with_scoring(c_logits, u_logits, gen_config)
                    del u_logits
                else:
                    pred_tokens, scores = model._predict_tokens_with_scoring(c_logits, None, no_cfg_config)

                del c_logits
                scores = scores - (layer_ids * gen_config.layer_penalty_factor)
                if gen_config.position_temperature > 0.0:
                    scores = _gumbel_sample(scores, gen_config.position_temperature)
                scores.masked_fill_(tokens != pad_id, -float("inf"))

                _, topk_idx = torch.topk(scores.view(1, -1), k=k, dim=-1)
                flat_tokens = tokens.view(1, -1)
                flat_preds = pred_tokens.view(1, -1)
                flat_tokens.scatter_(1, topk_idx, torch.gather(flat_preds, 1, topk_idx))
                tokens = flat_tokens.view_as(tokens)

                c_ids[:, :, c_len - t_len : c_len] = tokens
                if step + 1 < cfg_steps:
                    u_ids[:, :, :t_len] = tokens

            generated_token_tensors.append(tokens[0].detach().cpu())
            del c_ids, c_amask, c_attn, u_ids, u_amask, u_attn, tokens, inp, full_task
            if device == "mps":
                torch.mps.empty_cache()

    # Completely unload the 1.16 GB LLM before loading the CPU Audio Tokenizer!
    post_process_fn = model._post_process_audio
    del model, layer_ids
    gc.collect()
    if device == "mps":
        torch.mps.empty_cache()

    if not generated_token_tensors:
        raise RuntimeError("No audio tokens generated by OmniVoice.")

    # --- STAGE 2: CPU Audio Tokenizer Decode (0 MB MPS) ---
    audio_tokenizer_path = os.path.join(HF_OMNIVOICE_SNAPSHOT, "audio_tokenizer")
    audio_tokenizer = _audio_tokenizer_cls().from_pretrained(audio_tokenizer_path, device_map="cpu")

    wav_parts = []
    pause = torch.zeros((1, int(0.20 * 24000)), dtype=torch.float32)

    with torch.inference_mode():
        for tok in generated_token_tensors:
            raw_wav = audio_tokenizer.decode(tok.unsqueeze(0)).audio_values[0].cpu()
            clean_wav = post_process_fn(raw_wav, postprocess_output=True, ref_rms=ref_rms)
            wav_parts.append(clean_wav.detach().cpu().float())
            wav_parts.append(pause)

    del audio_tokenizer, generated_token_tensors
    gc.collect()

    full_wav = torch.cat(wav_parts[:-1], dim=-1)
    torchaudio.save(os.path.abspath(out_path), full_wav, 24000)
    return f"{voice_key} (OmniVoice Clone)"


def _resolve_mms_snapshot(script):
    lang_key = {'bengali': 'BEN', 'arabic': 'ARA', 'english': 'ENG'}.get(script, 'ENG')
    env_specific = (os.environ.get(f'PDFREADER_MMS_{lang_key}_PATH') or '').strip()
    if env_specific and os.path.isdir(env_specific):
        return env_specific
    env_generic = (os.environ.get('PDFREADER_TTS_PATH') or '').strip()
    if env_generic and os.path.isdir(env_generic):
        return env_generic
    repo_map = {
        'bengali': 'models--facebook--mms-tts-ben',
        'arabic': 'models--facebook--mms-tts-ara',
        'english': 'models--facebook--mms-tts-eng',
    }
    hub = os.path.expanduser(os.environ.get('HUGGINGFACE_HUB_CACHE') or '~/.cache/huggingface/hub')
    folder = repo_map.get(script, 'models--facebook--mms-tts-eng')
    snaps = sorted(glob.glob(os.path.join(hub, folder, 'snapshots', '*')), key=os.path.getmtime, reverse=True)
    for s in snaps:
        if os.path.isdir(s):
            return s
    return None


def synthesize_mms_tts(text, out_path):
    """Synthesize offline speech using Meta MMS-TTS (VitsModel) on CPU."""
    import torch
    import torchaudio
    from transformers import AutoTokenizer, VitsModel

    chunks = split_text_for_omnivoice(text, max_chars=280)
    if not chunks:
        raise ValueError("No speakable text after sanitization.")

    script = detect_script(text)
    snap = _resolve_mms_snapshot(script)
    if not snap or not os.path.isdir(snap):
        raise FileNotFoundError(f"MMS-TTS model for {script} is not installed locally.")

    tokenizer = AutoTokenizer.from_pretrained(snap)
    model = VitsModel.from_pretrained(snap).to("cpu")
    model.eval()
    sr = int(getattr(model.config, 'sampling_rate', 16000))

    wav_parts = []
    pause = torch.zeros((1, int(0.18 * sr)), dtype=torch.float32)

    with torch.inference_mode():
        for item in chunks:
            txt = item['text'].strip()
            if not txt:
                continue
            inputs = tokenizer(txt, return_tensors="pt")
            if inputs["input_ids"].shape[-1] == 0:
                continue
            waveform = model(**inputs).waveform.cpu().float()
            wav_parts.append(waveform)
            wav_parts.append(pause)

    del model, tokenizer
    gc.collect()

    if not wav_parts:
        raise RuntimeError("MMS-TTS produced no audio frames.")
    full_wav = torch.cat(wav_parts[:-1], dim=-1)
    torchaudio.save(os.path.abspath(out_path), full_wav, sr)
    return f"MMS-TTS ({script.capitalize()})"


async def synthesize_neural(text, out_path, voice_name=None):
    import edge_tts
    script = detect_script(text)
    clean = sanitize_text(text)

    friendly_map = {
        'Pradeep (Bengali Male)': 'bn-BD-PradeepNeural',
        'Nabanita (Bengali Female)': 'bn-BD-NabanitaNeural',
        'Christopher (Audiobook Narrator)': 'en-US-ChristopherNeural',
        'Guy (US Natural)': 'en-US-GuyNeural',
        'Jenny (US Warm Female)': 'en-US-JennyNeural',
        'Hamed (Arabic Classical)': 'ar-SA-HamedNeural',
        'Zariyah (Arabic Female)': 'ar-SA-ZariyahNeural',
    }

    if voice_name in friendly_map:
        voice_id = friendly_map[voice_name]
    elif script == 'bengali':
        voice_id = 'bn-BD-PradeepNeural'
    elif script == 'arabic':
        voice_id = 'ar-SA-HamedNeural'
    else:
        voice_id = 'en-US-ChristopherNeural'

    temp_mp3 = out_path if out_path.endswith('.mp3') else out_path + '.temp.mp3'
    communicate = edge_tts.Communicate(clean, voice_id)
    await communicate.save(temp_mp3)

    if temp_mp3 != out_path:
        subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEI16', temp_mp3, out_path], check=True)
        if os.path.exists(temp_mp3):
            os.remove(temp_mp3)

    return voice_id


def get_audio_duration(file_path):
    try:
        out = subprocess.run(['afinfo', file_path], capture_output=True, text=True).stdout
        m = re.search(r'estimated duration:\s*([0-9.]+)\s*sec', out)
        if m:
            return float(m.group(1))
    except Exception:
        pass
    return 0.0


def main():
    if len(sys.argv) < 3:
        print(json.dumps({'error': 'Usage: tts_synthesizer.py <out_path> <text> [voice_name]'}))
        sys.exit(1)

    out_path = sys.argv[1]
    text = sys.argv[2]
    voice_name = sys.argv[3] if len(sys.argv) > 3 else 'Custom Voice (OmniVoice Clone)'

    # Optional delivery controls (from the app's Narration Delivery settings).
    # argv[4] speed factor, argv[5] instruct tags, argv[6] diffusion steps.
    try:
        DELIVERY['speed'] = float(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] else 1.0
    except ValueError:
        DELIVERY['speed'] = 1.0
    DELIVERY['instruct'] = sys.argv[5].strip() if len(sys.argv) > 5 and sys.argv[5].strip() else None
    try:
        DELIVERY['num_step'] = int(sys.argv[6]) if len(sys.argv) > 6 and sys.argv[6] else 16
    except ValueError:
        DELIVERY['num_step'] = 16

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    preferred_engine = (os.environ.get('PDFREADER_TTS_ENGINE') or 'omnivoice').strip()

    # 0. If the user explicitly selected MMS-TTS in Model Manager, run MMS-TTS first
    if preferred_engine == 'mms-tts':
        try:
            used_voice = synthesize_mms_tts(text, out_path)
            duration = get_audio_duration(out_path)
            print(json.dumps({
                'success': True,
                'audioPath': out_path,
                'duration': duration,
                'voice': used_voice,
                'engine': 'mms-tts'
            }))
            return
        except Exception as mms_err:
            sys.stderr.write(f"[MMS-TTS Warn] Synthesis failed ({mms_err}), falling back.\n")

    # 1. Local OmniVoice Zero-Shot Voice Cloning (Default for Custom Voice / VoiceStudio profiles)
    custom_key = resolve_custom_voice_key(voice_name)
    if custom_key:
        try:
            used_voice = synthesize_omnivoice_clone(text, out_path, custom_key)
            duration = get_audio_duration(out_path)
            print(json.dumps({
                'success': True,
                'audioPath': out_path,
                'duration': duration,
                'voice': used_voice,
                'engine': 'omnivoice'
            }))
            return
        except Exception as clone_err:
            sys.stderr.write(f"[OmniVoice Warn] Clone synthesis failed ({clone_err}), falling back to neural.\n")

    # 1b. Try offline MMS-TTS if installed before network/system fallbacks
    try:
        used_voice = synthesize_mms_tts(text, out_path)
        duration = get_audio_duration(out_path)
        print(json.dumps({
            'success': True,
            'audioPath': out_path,
            'duration': duration,
            'voice': used_voice,
            'engine': 'mms-tts'
        }))
        return
    except Exception:
        pass

    # 2. Ultra-realistic Neural Voices (Edge-TTS)
    try:
        used_voice = asyncio.run(synthesize_neural(text, out_path, voice_name))
        duration = get_audio_duration(out_path)
        print(json.dumps({
            'success': True,
            'audioPath': out_path,
            'duration': duration,
            'voice': used_voice,
            'engine': 'neural'
        }))
        return
    except Exception as e:
        # 3. Fallback to native system voice
        try:
            temp_aiff = out_path + '.temp.aiff'
            script = detect_script(text)
            fallback_voice = 'Piya' if script == 'bengali' else ('Majed' if script == 'arabic' else 'Samantha')
            subprocess.run(['say', '-v', fallback_voice, '-o', temp_aiff, text], check=True)
            subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEI16', temp_aiff, out_path], check=True)
            if os.path.exists(temp_aiff):
                os.remove(temp_aiff)
            duration = get_audio_duration(out_path)
            print(json.dumps({
                'success': True,
                'audioPath': out_path,
                'duration': duration,
                'voice': fallback_voice,
                'engine': 'system_fallback'
            }))
        except Exception as fallback_err:
            print(json.dumps({'error': str(e), 'fallbackError': str(fallback_err)}))
            sys.exit(1)


if __name__ == '__main__':
    main()
