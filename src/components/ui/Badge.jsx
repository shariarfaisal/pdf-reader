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
    bg: 'bg-slate-800/80',
    text: 'text-slate-400',
    border: 'border-slate-700/80',
    icon: Clock,
    label: 'Pending'
  },
  idle: {
    bg: 'bg-slate-800/80',
    text: 'text-slate-400',
    border: 'border-slate-700/80',
    icon: Clock,
    label: 'Idle'
  },
  extracting: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-300',
    border: 'border-blue-500/30',
    icon: RefreshCw,
    spin: true,
    label: 'Extracting'
  },
  refining: {
    bg: 'bg-purple-500/10',
    text: 'text-purple-300',
    border: 'border-purple-500/30',
    icon: Sparkles,
    spin: true,
    label: 'Refining'
  },
  synthesizing: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-300',
    border: 'border-amber-500/30',
    icon: Volume2,
    spin: true,
    label: 'Synthesizing'
  },
  ready: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-300',
    border: 'border-emerald-500/30',
    icon: CheckCircle2,
    label: 'Ready'
  },
  completed: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-300',
    border: 'border-emerald-500/30',
    icon: CheckCircle2,
    label: 'Completed'
  },
  running: {
    bg: 'bg-sky-500/10',
    text: 'text-sky-300',
    border: 'border-sky-500/30',
    icon: RefreshCw,
    spin: true,
    label: 'Running'
  },
  paused: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-300',
    border: 'border-amber-500/30',
    icon: Pause,
    label: 'Paused'
  },
  error: {
    bg: 'bg-rose-500/10',
    text: 'text-rose-300',
    border: 'border-rose-500/30',
    icon: AlertCircle,
    label: 'Error'
  }
};

const TONES = {
  slate: 'bg-slate-800/80 text-slate-300 border-slate-700/80',
  brand: 'bg-brand-500/10 text-brand-300 border-brand-500/30',
  sky: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
  emerald: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  amber: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  rose: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
  purple: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
  violet: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
  indigo: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30'
};

const DOT_COLORS = {
  slate: 'bg-slate-400',
  brand: 'bg-brand-400',
  sky: 'bg-sky-400',
  emerald: 'bg-emerald-400',
  amber: 'bg-amber-400',
  rose: 'bg-rose-400',
  purple: 'bg-purple-400',
  violet: 'bg-violet-400',
  indigo: 'bg-indigo-400'
};

const SIZES = {
  xs: 'h-5 px-1.5 text-[10px] gap-1',
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
      className={['inline-flex items-center font-medium rounded-full border whitespace-nowrap select-none', config.bg, config.text, config.border, sizeClass, className].filter(Boolean).join(' ')}
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
