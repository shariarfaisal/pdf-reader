import React from 'react';

export function Card({ children, className = '', hover = false, ...props }) {
  return (
    <div
      className={`bg-obsidian-850/90 backdrop-blur border border-obsidian-700/80 rounded-xl overflow-hidden shadow-lg shadow-black/20 transition-all duration-200 ${
        hover ? 'hover:border-slate-600 hover:shadow-black/40' : ''
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
