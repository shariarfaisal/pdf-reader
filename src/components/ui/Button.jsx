import React from 'react';
import { Loader2 } from 'lucide-react';

const VARIANTS = {
  primary:
    'bg-brand-500 hover:bg-brand-400 text-obsidian-950 font-semibold shadow-sm shadow-brand-500/20 active:scale-[0.98]',
  secondary:
    'bg-obsidian-800 hover:bg-obsidian-700 text-slate-200 border border-obsidian-700/80 hover:border-slate-600 active:scale-[0.98]',
  outline:
    'border border-slate-700 hover:border-brand-400/80 hover:text-brand-300 text-slate-300 bg-transparent active:scale-[0.98]',
  ghost:
    'text-slate-400 hover:text-slate-100 hover:bg-obsidian-800/80 active:scale-[0.98]',
  danger:
    'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:border-rose-500/50 active:scale-[0.98]',
  success:
    'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:border-emerald-500/50 active:scale-[0.98]'
};

const SIZES = {
  xs: 'h-7 px-2 text-xs rounded-md gap-1',
  sm: 'h-8 px-2.5 text-xs font-medium rounded-lg gap-1.5',
  md: 'h-9 px-3.5 text-sm font-medium rounded-lg gap-2',
  lg: 'h-10 px-4 text-sm font-medium rounded-xl gap-2.5',
  'icon-xs': 'h-7 w-7 rounded-md p-0 flex items-center justify-center',
  'icon-sm': 'h-8 w-8 rounded-lg p-0 flex items-center justify-center',
  icon: 'h-9 w-9 rounded-lg p-0 flex items-center justify-center',
  'icon-lg': 'h-10 w-10 rounded-xl p-0 flex items-center justify-center'
};

const ICON_SIZES = {
  xs: 'w-3.5 h-3.5',
  sm: 'w-3.5 h-3.5',
  md: 'w-4 h-4',
  lg: 'w-4.5 h-4.5',
  'icon-xs': 'w-3.5 h-3.5',
  'icon-sm': 'w-3.5 h-3.5',
  icon: 'w-4 h-4',
  'icon-lg': 'w-4.5 h-4.5'
};

export const Button = React.forwardRef(function Button(
  {
    children,
    variant = 'secondary',
    size = 'md',
    isLoading = false,
    disabled = false,
    icon: Icon,
    iconRight: IconRight,
    type = 'button',
    className = '',
    ...props
  },
  ref
) {
  const variantClass = VARIANTS[variant] || VARIANTS.secondary;
  const sizeClass = SIZES[size] || SIZES.md;
  const iconSizeClass = ICON_SIZES[size] || 'w-4 h-4';

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || isLoading}
      className={`inline-flex items-center justify-center transition-all duration-150 select-none whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/80 focus-visible:ring-offset-1 focus-visible:ring-offset-obsidian-950 disabled:opacity-50 disabled:pointer-events-none ${variantClass} ${sizeClass} ${className}`}
      {...props}
    >
      {isLoading ? (
        <Loader2 className={`${iconSizeClass} animate-spin text-current flex-shrink-0`} />
      ) : Icon ? (
        <Icon className={`${iconSizeClass} flex-shrink-0`} />
      ) : null}
      {children}
      {!isLoading && IconRight && (
        <IconRight className={`${iconSizeClass} flex-shrink-0`} />
      )}
    </button>
  );
});
