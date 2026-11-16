import React from 'react';
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  RefreshCw,
  Sparkles,
  Volume2,
  Pause
} from 'lucide-react';

const STATUS_CONFIG = {
  pending: {
    className: 'bg-obsidian-750 text-slate-400 border-obsidian-700/80',
    icon: Clock,
    label: 'Pending'
  },
  idle: {
    className: 'bg-obsidian-750 text-slate-400 border-obsidian-700/80',
    icon: Clock,
    label: 'Idle'
  },
  extracting: {
    className: 'status-pill-info border',
    icon: RefreshCw,
    spin: true,
    label: 'Extracting'
  },
  refining: {
    className: 'status-pill-info border',
    icon: Sparkles,
    spin: true,
    label: 'Preparing narration'
  },
  synthesizing: {
    className: 'status-pill-warning border',
    icon: Volume2,
    spin: true,
    label: 'Generating audio'
  },
  ready: {
    className: 'status-pill-success border',
    icon: CheckCircle2,
    label: 'Audio ready'
  },
  completed: {
    className: 'status-pill-success border',
    icon: CheckCircle2,
    label: 'Completed'
  },
  running: {
    className: 'status-pill-info border',
    icon: RefreshCw,
    spin: true,
    label: 'Running'
  },
  paused: {
    className: 'status-pill-warning border',
    icon: Pause,
    label: 'Paused'
  },
  error: {
    className: 'status-pill-error border',
    icon: AlertCircle,
    label: 'Failed'
  }
};

const TONES = {
  slate: 'bg-obsidian-750 text-slate-300 border-obsidian-700/80',
  brand: 'bg-indigo-500/10 text-indigo-400 dark:text-indigo-300 border-indigo-500/25',
  info: 'status-pill-info border',
  success: 'status-pill-success border',
  warning: 'status-pill-warning border',
  error: 'status-pill-error border',
  selected: 'is-selected-token border border-indigo-400/40'
};

const DOT_COLORS = {
  slate: 'bg-slate-400',
  brand: 'bg-indigo-500',
  info: 'bg-blue-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-rose-500',
  selected: 'bg-indigo-600 dark:bg-indigo-300'
};

const SIZES = {
  xs: 'h-5 px-1.5 text-[11px] gap-1',
  sm: 'h-6 px-2 text-xs gap-1.5',
  md: 'h-7 px-2.5 text-xs gap-1.5 font-medium'
};

const ICON_SIZES = {
  xs: 'w-3 h-3',
  sm: 'w-3.5 h-3.5',
  md: 'w-3.5 h-3.5'
};

/**
 * Universal Tag primitive for chips, categories, statuses, and badges.
 */
export function Tag({
  children,
  tone = 'slate',
  size = 'sm',
  icon: Icon,
  dot = false,
  className = '',
  ...props
}) {
  const toneClass = TONES[tone] || TONES.slate;
  const sizeClass = SIZES[size] || SIZES.sm;
  const iconSizeClass = ICON_SIZES[size] || 'w-3.5 h-3.5';
  const dotColorClass = DOT_COLORS[tone] || DOT_COLORS.slate;

  return (
    <span
      className={['inline-flex items-center font-medium rounded-full border whitespace-nowrap select-none', toneClass, sizeClass, className].filter(Boolean).join(' ')}
      {...props}
    >
      {dot && (
        <span
          className={['w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse', dotColorClass].join(' ')}
          aria-hidden={true}
        />
      )}
      {Icon && <Icon className={[iconSizeClass, 'flex-shrink-0'].join(' ')} aria-hidden={true} />}
      <span>{children}</span>
    </span>
  );
}

/**
 * Status badge with built-in icons and status semantics.
 */
export function Badge({
  status = 'pending',
  label,
  size = 'sm',
  showIcon = true,
  className = ''
}) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const Icon = config.icon;
  const displayLabel = label || config.label;
  const sizeClass = SIZES[size] || SIZES.sm;
  const iconSizeClass = ICON_SIZES[size] || 'w-3.5 h-3.5';
  const spinClass = config.spin ? 'animate-spin' : '';

  return (
    <span
      className={['inline-flex items-center font-medium rounded-full border whitespace-nowrap select-none', config.className, sizeClass, className].filter(Boolean).join(' ')}
    >
      {showIcon && Icon && (
        <Icon
          className={[iconSizeClass, 'flex-shrink-0', spinClass].filter(Boolean).join(' ')}
          aria-hidden={true}
        />
      )}
      <span>{displayLabel}</span>
    </span>
  );
}
