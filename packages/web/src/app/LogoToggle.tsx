// 左上のロゴ。押すとサイドパネルを開く（ADR-0010）。カーソルを乗せると、サイドパネルのアイコンに変わる
import { FactoryMark } from '../components/kit';
import { IconSidebar } from '../components/icons';
import s from './LogoToggle.module.css';

export const sidebarShortcut = () => (/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘B' : 'Ctrl+B');

export function LogoToggle({ label, expanded, onClick }: { label: string; expanded: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={s.logo}
      aria-label={label}
      aria-expanded={expanded}
      aria-keyshortcuts="Meta+B Control+B"
      title={`${label}（${sidebarShortcut()}）`}
      onClick={onClick}
    >
      <span className={s.mark}><FactoryMark size={14} /></span>
      <span className={s.hover} aria-hidden="true"><IconSidebar /></span>
    </button>
  );
}
