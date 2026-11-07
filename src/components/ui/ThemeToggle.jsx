import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../../lib/theme';
import { Button } from './Button';

export function ThemeToggle({
  variant = 'ghost',
  size = 'icon-sm',
  className = '',
  showLabel = false
}) {
  const { theme, toggleTheme, isDark } = useTheme();

  return (
    <Button
      variant={variant}
      size={showLabel ? 'sm' : size}
      onClick={toggleTheme}
      title={isDark ? 'Switch to Light mode' : 'Switch to Dark mode'}
      aria-label={isDark ? 'Switch to Light mode' : 'Switch to Dark mode'}
      className={`relative text-slate-400 hover:text-brand-400 transition-colors ${className}`}
    >
      {isDark ? (
        <Sun className="w-4 h-4 text-amber-400 hover:text-amber-300 transition-transform hover:rotate-45" />
      ) : (
        <Moon className="w-4 h-4 text-slate-600 hover:text-brand-600 transition-transform hover:-rotate-12" />
      )}
      {showLabel && (
        <span className="text-xs font-medium ml-1.5">
          {isDark ? 'Light' : 'Dark'}
        </span>
      )}
    </Button>
  );
}
