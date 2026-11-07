import React from 'react';
import { Mic } from 'lucide-react';
import { VoiceSelect } from '../ui/VoiceSelect';
import { Section } from '../ui/Section';
import {
  VOICE_LANGUAGES,
  VOICE_LANGUAGE_LABELS,
  normalizeVoiceValue
} from '../../lib/voiceChoices';

const SELECT_CLASS =
  'w-full bg-obsidian-950 border border-obsidian-700 rounded-md px-2 h-7 text-[11px] text-slate-200 focus:outline-none focus:border-brand-400';

/**
 * Narrator selection inside the Pipeline Inspector — same per-language defaults
 * (tts_voice_bn/en/ar) as Settings → Narrator Voices, saved on change.
 */
export function NarrationVoicePanel({ voices = [], defaults = {}, onChange, isBusy = false, error = null }) {
  return (
    <Section
      id="inspector-narrator"
      icon={Mic}
      iconClassName="text-violet-300"
      title="Narrator voices"
      meta="saves instantly"
      bodyClassName="px-3 pt-1 pb-3"
    >
      <div className="space-y-1.5">
        {VOICE_LANGUAGES.map((language) => (
          <div key={language} className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-2">
            <span className="text-[10px] font-medium text-slate-400">{VOICE_LANGUAGE_LABELS[language]}</span>
            <VoiceSelect
              language={language}
              value={normalizeVoiceValue(defaults[language])}
              voices={voices}
              disabled={isBusy}
              ariaLabel={`Narrator voice for ${VOICE_LANGUAGE_LABELS[language]}`}
              className={SELECT_CLASS}
              onChange={(value) => onChange?.(language, value)}
            />
          </div>
        ))}
      </div>

      {error && <p className="mt-1.5 text-[10px] text-rose-300">{error}</p>}
      <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
        Pages already narrated keep their audio — start the Audio stage to apply a new voice.
      </p>
    </Section>
  );
}
