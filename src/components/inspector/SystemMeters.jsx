import React from 'react';
import { Activity, Cpu, HardDrive } from 'lucide-react';
import { Meter } from '../ui/Meter';
import { Section } from '../ui/Section';

export function SystemMeters({ systemHealth }) {
  const cores = Number(systemHealth?.cpuCount) || 8;
  const load = parseFloat(systemHealth?.load1m) || 0;
  const usedMB = Number(systemHealth?.usedMemMB) || 0;
  const totalMB = Number(systemHealth?.totalMemMB) || 8192;
  const memPercent = Number(systemHealth?.memPercent) || 0;
  // Pressure warning matters more than the raw number on an 8 GB M2.
  const memTone = memPercent >= 90 ? 'text-rose-300' : memPercent >= 78 ? 'text-amber-300' : 'text-slate-400';

  return (
    <Section
      id="inspector-system"
      icon={Activity}
      iconClassName="text-emerald-300"
      title="System load"
      meta={<span className={memTone}>{memPercent}% RAM</span>}
      bodyClassName="px-3 pt-1 pb-3"
    >
      <div className="grid grid-cols-2 gap-4">
        <Meter
          icon={Cpu}
          label="CPU load"
          value={`${load.toFixed(2)} / ${cores}`}
          detail="1-min avg · cores"
          percent={(load / cores) * 100}
        />
        <Meter
          icon={HardDrive}
          label="Unified RAM"
          value={`${memPercent}%`}
          detail={`${(usedMB / 1024).toFixed(1)} / ${(totalMB / 1024).toFixed(1)} GB`}
          percent={memPercent}
        />
      </div>
    </Section>
  );
}
