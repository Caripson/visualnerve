import { iconLabel } from './editor-labels';
import { useI18n } from '../i18n';
import { useState } from 'react';
import {
  BriefcaseBusiness,
  Lightbulb,
  Users,
  GraduationCap,
  Cpu,
  Palette,
  Banknote,
  HeartPulse,
  Compass,
  House,
  CalendarDays,
  Target,
  Leaf,
  Music,
  Rocket,
  FlaskConical,
  X,
  Shapes,
  type LucideIcon,
} from 'lucide-react';
import type { Metadata } from '../model/types';
export const areaIcons: Record<string, { label: string; icon: LucideIcon; keywords: string }> = {
  work: { label: 'Work', icon: BriefcaseBusiness, keywords: 'arbete business projekt' },
  ideas: { label: 'Ideas', icon: Lightbulb, keywords: 'ideer tänka' },
  people: { label: 'People', icon: Users, keywords: 'personer team familj' },
  learning: { label: 'Learning', icon: GraduationCap, keywords: 'studier skola lärande' },
  technology: { label: 'Technology', icon: Cpu, keywords: 'teknik kod system' },
  design: { label: 'Design', icon: Palette, keywords: 'konst kreativ färg' },
  finance: { label: 'Finance', icon: Banknote, keywords: 'ekonomi pengar' },
  health: { label: 'Health', icon: HeartPulse, keywords: 'hälsa motion' },
  travel: { label: 'Travel', icon: Compass, keywords: 'resor semester' },
  home: { label: 'Home', icon: House, keywords: 'hem boende' },
  calendar: { label: 'Schedule', icon: CalendarDays, keywords: 'schema planering tid' },
  goals: { label: 'Goals', icon: Target, keywords: 'mål strategi' },
  nature: { label: 'Nature', icon: Leaf, keywords: 'natur miljö' },
  music: { label: 'Music', icon: Music, keywords: 'musik kultur' },
  launch: { label: 'Launch', icon: Rocket, keywords: 'lansering start' },
  research: { label: 'Research', icon: FlaskConical, keywords: 'forskning vetenskap' },
};
export function iconKey(metadata: Metadata): string {
  const settings = metadata.visualNerve;
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    const icon = (settings as Metadata).icon;
    if (typeof icon === 'string' && areaIcons[icon]) return icon;
  }
  return '';
}
export function withIcon(metadata: Metadata, icon: string): Metadata {
  const previous = metadata.visualNerve;
  return {
    ...metadata,
    visualNerve: {
      ...(previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {}),
      icon,
    },
  };
}
export function AreaIcon({
  metadata,
  fallback,
  size = 17,
  className,
}: {
  metadata: Metadata;
  fallback?: LucideIcon;
  size?: number;
  className?: string;
}) {
  const Icon = areaIcons[iconKey(metadata)]?.icon ?? fallback;
  return Icon ? (
    <Icon
      size={size}
      className={className}
      aria-hidden="true"
      data-area-icon={iconKey(metadata) || 'default'}
    />
  ) : null;
}
export function IconPicker({
  value,
  onChange,
  label,
  compact = false,
  fallback = Shapes,
}: {
  value: string;
  onChange: (icon: string) => void;
  label?: string;
  compact?: boolean;
  fallback?: LucideIcon;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const Icon = areaIcons[value]?.icon ?? fallback;
  return (
    <details className={`quick-picker ${compact ? 'compact-picker' : ''}`}>
      <summary
        aria-label={label ?? t('editor.icons.chooseIcon')}
        title={label ?? t('editor.icons.chooseIcon')}
      >
        <Icon size={17} />
        <span>{areaIcons[value] ? iconLabel(t, value) : t('editor.icons.genericLabel')}</span>
      </summary>
      <div
        className="picker-panel icon-picker"
        role="group"
        aria-label={t('editor.icons.areaIcons')}
      >
        <input
          aria-label={t('editor.icons.searchIcons')}
          placeholder={t('editor.icons.findAnArea')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="icon-grid">
          {Object.entries(areaIcons)
            .filter(([key, choice]) =>
              `${iconLabel(t, key)} ${choice.label} ${choice.keywords}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map(([key, choice]) => {
              const Choice = choice.icon;
              return (
                <button
                  key={key}
                  className={key === value ? 'active' : ''}
                  aria-label={t('editor.icons.icon', { iconLabel: iconLabel(t, key) })}
                  title={iconLabel(t, key)}
                  onClick={(e) => {
                    onChange(key);
                    e.currentTarget.closest('details')?.removeAttribute('open');
                  }}
                >
                  <Choice size={21} />
                  <span>{iconLabel(t, key)}</span>
                </button>
              );
            })}
        </div>
        <button
          className="full"
          onClick={(e) => {
            onChange('');
            e.currentTarget.closest('details')?.removeAttribute('open');
          }}
        >
          <X size={14} />
          {t('editor.icons.automaticIcon')}{' '}
        </button>
      </div>
    </details>
  );
}
