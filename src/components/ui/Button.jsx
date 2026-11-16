import React from 'react';
import { Loader2 } from 'lucide-react';

const VARIANTS = {
  primary:
    'btn-primary-token font-medium shadow-xs active:scale-[0.98]',
  secondary:
    'bg-obsidian-800 hover:bg-obsidian-750 text-slate-100 border border-obsidian-700 hover:border-obsidian-600 active:scale-[0.98]',
  outline:
    'bg-transparent hover:bg-obsidian-800/60 text-slate-200 border border-obsidian-700 hover:border-obsidian-600 active:scale-[0.98]',
  ghost:
    'bg-transparent hover:bg-obsidian-800/60 text-slate-400 hover:text-slate-100 active:scale-[0.98]',
  danger:
    'status-pill-error border hover:brightness-95 active:scale-[0.98]',
  success:
    'status-pill-success border hover:brightness-95 active:scale-[0.98]'
};

const SIZES = {
  xs: 'h-7 px-2 text-xs rounded-lg gap-1',
  sm: 'h-8 px-2.5 text-xs font-medium rounded-lg gap-1.5',
  md: 'h-9 px-3.5 text-sm font-medium rounded-lg gap-2',
  lg: 'h-10 px-4 text-sm font-medium rounded-lg gap-2.5',
  'icon-xs': 'h-7 w-7 rounded-lg p-0 flex items-center justify-center',
  'icon-sm': 'h-8 w-8 rounded-lg p-0 flex items-center justify-center',
  icon: 'h-9 w-9 rounded-lg p-0 flex items-center justify-center',
  'icon-lg': 'h-10 w-10 rounded-lg p-0 flex items-center justify-center'
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
      className={`inline-flex items-center justify-center transition-all duration-150 select-none whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/70 focus-visible:ring-offset-1 disabled:opacity-40 disabled:pointer-events-none cursor-pointer ${variantClass} ${sizeClass} ${className}`}
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

export const IconButton = React.forwardRef(function IconButton(
  { icon: Icon, size = 'icon-sm', variant = 'ghost', label, title, className = '', ...props },
  ref
) {
  return (
    <Button
      ref={ref}
      size={size}
      variant={variant}
      title={title || label}
      aria-label={label || title}
      icon={Icon}
      className={className}
      {...props}
    />
  );
});
