import React from 'react';
import { VOICE_OPTIONS, normalizeVoiceValue } from '../../lib/voiceChoices';

/**
 * Per-language narrator picker: cloned voices from the library first, then the
 * neural / native engines. Shared by SettingsModal and the Pipeline Inspector so
 * both always offer the same options.
 */
export function VoiceSelect({
  language,
  value,
  voices = [],
  onChange,
  className = '',
  disabled = false,
  ariaLabel
}) {
  const cloned = voices.filter(
    (voice) => !voice.language || voice.language === 'auto' || voice.language === language
  );
  const stored = normalizeVoiceValue(value);
  const known = stored === 'builtin' || voices.some((voice) => voice.id === stored);
  const options = VOICE_OPTIONS[language] || [];

  return (
    <select
      value={known ? stored : 'builtin'}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      disabled={disabled}
      aria-label={ariaLabel}
      title={known ? undefined : 'The saved voice no longer exists — using the built-in sample.'}
    >
      <optgroup label="Cloned voices (library)">
        <option value="builtin">Built-in reference voice</option>
        {cloned.map((voice) => (
          <option key={voice.id} value={voice.id}>
            {voice.name}
            {voice.language && voice.language !== 'auto' ? ` · ${voice.language.toUpperCase()}` : ''}
          </option>
        ))}
      </optgroup>
      <optgroup label="Neural / native engines">
        {options
          .filter(([optionValue]) => optionValue !== 'Custom Voice (OmniVoice Clone)')
          .map(([optionValue, label]) => (
            <option key={optionValue} value={optionValue}>
              {label}
            </option>
          ))}
      </optgroup>
    </select>
  );
}
