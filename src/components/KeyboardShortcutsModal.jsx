import React from 'react';
import { Modal } from './ui/Modal';
import { Keyboard, Play, SkipBack, SkipForward, Type, Palette, Sliders, Volume2 } from 'lucide-react';

const SHORTCUT_GROUPS = [
  {
    category: 'Playback & Audio',
    shortcuts: [
      { key: 'Space', desc: 'Play or pause page narration' },
      { key: 'M', desc: 'Mute / unmute audio' },
      { key: 'J / K', desc: 'Skip backward 10s / forward 10s' },
      { key: '0 – 9', desc: 'Seek to 0% – 90% of current track' }
    ]
  },
  {
    category: 'Navigation & Pages',
    shortcuts: [
      { key: '← / →', desc: 'Previous page / Next page' },
      { key: 'Home / End', desc: 'Jump to first page / last page' },
      { key: 'P', desc: 'Open page manager' }
    ]
  },
  {
    category: 'Reader & Appearance',
    shortcuts: [
      { key: '[ / ]', desc: 'Decrease / increase font size' },
      { key: 'T', desc: 'Cycle reading themes (Obsidian, Midnight, Sepia, OLED)' },
      { key: 'V', desc: 'Switch between Refined Narration and Raw OCR' },
      { key: 'I', desc: 'Toggle pipeline inspector drawer' },
      { key: '?', desc: 'Show this keyboard shortcuts guide' }
    ]
  }
];

export function KeyboardShortcutsModal({ isOpen, onClose }) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Keyboard Shortcuts"
      subtitle="Master the reader and pipeline with quick keystrokes"
      icon={Keyboard}
      maxWidth="max-w-lg"
    >
      <div className="space-y-5">
        {SHORTCUT_GROUPS.map((group) => (
          <div key={group.category} className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {group.category}
            </h4>
            <div className="rounded-xl border border-obsidian-700/70 bg-obsidian-950/60 divide-y divide-obsidian-800/80 overflow-hidden">
              {group.shortcuts.map((s) => (
                <div
                  key={s.key}
                  className="flex items-center justify-between px-3.5 py-2 text-xs"
                >
                  <span className="text-slate-300">{s.desc}</span>
                  <kbd className="inline-flex items-center justify-center font-mono text-[11px] font-semibold text-slate-200 bg-obsidian-800 border border-obsidian-700 px-2 py-0.5 rounded shadow-sm">
                    {s.key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
