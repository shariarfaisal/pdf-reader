/**
 * Narrator options shared by the Settings modal and the Pipeline Inspector.
 *
 * Cloned voices (the library in `data/voices`) are listed from the API on top of
 * these; `builtin` is the bundled reference sample.
 */
export const VOICE_OPTIONS = {
  bn: [
    ['Custom Voice (OmniVoice Clone)', 'Custom Audio Clone (OmniVoice)'],
    ['Sirah (VoiceStudio Custom)', 'Sirah (VoiceStudio Custom Clone)'],
    ['Pradeep (Bengali Male)', 'Pradeep (Neural Male)'],
    ['Nabanita (Bengali Female)', 'Nabanita (Neural Female)'],
    ['Piya', 'Piya (macOS Native)']
  ],
  en: [
    ['Custom Voice (OmniVoice Clone)', 'Custom Audio Clone (OmniVoice)'],
    ['Christopher (Audiobook Narrator)', 'Christopher (Audiobook Narrator)'],
    ['Guy (US Natural)', 'Guy (US Natural Male)'],
    ['Jenny (US Warm Female)', 'Jenny (US Warm Female)'],
    ['Adam (VoiceStudio Custom)', 'Adam (VoiceStudio Custom Clone)'],
    ['Jessica (VoiceStudio Custom)', 'Jessica (VoiceStudio Custom Clone)'],
    ['Demo Voice (VoiceStudio Low Cinematic)', 'Demo Voice (VoiceStudio Cinematic)'],
    ['Samantha', 'Samantha (macOS Native)']
  ],
  ar: [
    ['Custom Voice (OmniVoice Clone)', 'Custom Audio Clone (OmniVoice)'],
    ['Hamed (Arabic Classical)', 'Hamed (Classical Narrator)'],
    ['Zariyah (Arabic Female)', 'Zariyah (Warm Female)'],
    ['Majed', 'Majed (macOS Native)']
  ]
};

export const VOICE_LANGUAGES = ['bn', 'en', 'ar'];

export const VOICE_LANGUAGE_LABELS = {
  bn: 'বাংলা',
  en: 'English',
  ar: 'العربية'
};

/** Legacy installs stored a display label where a voice id now belongs. */
export function normalizeVoiceValue(value) {
  if (!value) return 'builtin';
  if (value === 'Custom Voice (OmniVoice Clone)') return 'builtin';
  return value;
}
