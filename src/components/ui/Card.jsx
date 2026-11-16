import React from 'react';

export function Card({ children, className = '', hover = false, ...props }) {
  return (
    <div
      className={`bg-obsidian-850 border border-obsidian-700/70 rounded-xl overflow-hidden transition-all duration-150 ${
        hover ? 'hover:border-obsidian-600 hover:shadow-xs' : ''
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
