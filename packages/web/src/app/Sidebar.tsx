// 左のサイドパネル（ADR-0010）: 新しい依頼、画面の移動、依頼の一覧、アカウント。畳むとアイコンの列になる
import type { WorkItem } from '@factory/contracts';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router';
import { ProfileMenu } from '../components/ui/profile-menu';
import { Avatar, Dot, FactoryMark } from '../components/kit';
import { IconClose, IconCompose, IconGlobe, IconImage, IconLine, IconList, IconMoon, IconSearch, IconSettings, IconShield, IconSidebar, IconSun } from '../components/icons';
import type { ConnectionState } from '../lib/events';
import { relative, stateLabel, stateTone } from '../lib/format';
import { isAdmin, useMe } from '../stores/me';
import { useUi } from '../stores/ui';
import s from './Sidebar.module.css';

const RUNNING = new Set(['queued', 'planning', 'running', 'suspended']);
/** 「最近」に出す件数。残りは「すべての依頼」で見る */
const RECENT = 20;

export type SidebarProps = {
  /** false = アイコンの列 */
  expanded: boolean;
  /** 重ねて出しているとき（1280px 未満）。閉じるボタンを出す */
  floating?: boolean;
  items: WorkItem[] | undefined;
  conn: ConnectionState;
  mock: boolean;
  onToggle: () => void;
};

export function Sidebar({ expanded, floating = false, items, conn, mock, onToggle }: SidebarProps) {
  const me = useMe((m) => m.me);
  const toggleLabel = floating ? 'サイドパネルを閉じる' : expanded ? 'サイドパネルを畳む' : 'サイドパネルを広げる';
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘B' : 'Ctrl+B';
  const attention = (items ?? []).filter((i) => i.state === 'awaiting_approval').length;
  const links: { to: string; label: string; icon: ReactNode; end?: boolean; badge?: number }[] = [
    { to: '/requests', label: 'すべての依頼', icon: <IconList />, ...(attention ? { badge: attention } : {}) },
    { to: '/publications', label: '公開物', icon: <IconGlobe /> },
    { to: '/images', label: 'イメージ', icon: <IconImage /> },
    { to: '/lines', label: 'ライン', icon: <IconLine /> },
    ...(isAdmin(me) ? [{ to: '/admin', label: '管理', icon: <IconShield /> }] : []),
  ];
  const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? s.active : undefined);

  return (
    <div className={s.panel} data-expanded={expanded || undefined} data-floating={floating || undefined}>
      <div className={s.head}>
        {expanded && (
          <Link to="/" className={s.brand} aria-label="Software Factory（ホーム）">
            <span className={s.mark}><FactoryMark size={14} /></span>
            <span>Software Factory</span>
          </Link>
        )}
        <button type="button" className={s.iconButton} aria-label={toggleLabel} title={`${toggleLabel}（${shortcut}）`} aria-keyshortcuts="Meta+B Control+B" onClick={onToggle}>
          {floating ? <IconClose /> : <IconSidebar />}
        </button>
      </div>

      <nav className={s.nav} aria-label="メイン">
        <NavLink to="/" end className={({ isActive }) => `${s.newRequest} ${isActive ? s.active : ''}`} title={expanded ? undefined : '新しい依頼'}>
          <IconCompose />
          {expanded ? <span>新しい依頼</span> : <span className="sr-only">新しい依頼</span>}
        </NavLink>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} className={navClass} title={expanded ? undefined : l.label}>
            {l.icon}
            {expanded ? <span className={s.label}>{l.label}</span> : <span className="sr-only">{l.label}</span>}
            {l.badge ? <span className={s.badge} aria-label={`対応が必要 ${l.badge} 件`}>{l.badge}</span> : null}
          </NavLink>
        ))}
      </nav>

      {expanded ? <Sessions items={items} /> : <div className={s.spacer} />}

      <div className={s.foot}>
        {expanded && (conn === 'reconnecting' || mock) && (
          <div className={s.badges}>
            {conn === 'reconnecting' && <span className={s.conn} role="status">再接続しています…</span>}
            {mock && <span className={s.mock} title="MSW がすべての API と WebSocket に応答しています">モック</span>}
          </div>
        )}
        {me && <Profile expanded={expanded} />}
      </div>
    </div>
  );
}

/** 依頼の一覧: 対応が必要 → 実行中 → 最近 の順に出す */
function Sessions({ items }: { items: WorkItem[] | undefined }) {
  const { id: current } = useParams();
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = (items ?? []).filter((i) => !q || `${i.title} ${i.repo ? `${i.repo.owner}/${i.repo.name}` : ''}`.toLowerCase().includes(q));
    const action = all.filter((i) => i.state === 'awaiting_approval');
    const running = all.filter((i) => RUNNING.has(i.state));
    const rest = all.filter((i) => i.state !== 'awaiting_approval' && !RUNNING.has(i.state));
    return [
      { key: 'action', title: '対応が必要', items: action },
      { key: 'running', title: '実行中', items: running },
      { key: 'recent', title: '最近', items: q ? rest : rest.slice(0, RECENT) },
    ].filter((g) => g.items.length > 0);
  }, [items, query]);

  return (
    <div className={s.sessions}>
      <label className={s.search}>
        <IconSearch />
        <span className="sr-only">依頼を探す</span>
        <input type="search" placeholder="依頼を探す" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <nav className={s.scroll} aria-label="依頼">
        {!items ? (
          <p className={s.empty}>読み込んでいます…</p>
        ) : groups.length === 0 ? (
          <p className={s.empty}>{query ? '見つかりませんでした' : 'まだ依頼はありません'}</p>
        ) : (
          groups.map((g) => (
            <section key={g.key} className={s.group} aria-labelledby={`sb-${g.key}`}>
              <h2 className={s.groupTitle} id={`sb-${g.key}`}>{g.title}</h2>
              <ul className={s.list}>
                {g.items.map((i) => (
                  <li key={i.id}>
                    <Link to={`/w/${i.id}`} className={s.item} aria-current={i.id === current ? 'page' : undefined} title={i.title}>
                      <Dot tone={stateTone[i.state]} label={stateLabel[i.state]} />
                      <span className={s.itemTitle}>{i.title}</span>
                      <span className={s.itemTime}>{relative(i.updatedAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        {items && items.length > 0 && !query && (
          <Link to="/requests" className={s.more}>すべての依頼を見る</Link>
        )}
      </nav>
    </div>
  );
}

function Profile({ expanded }: { expanded: boolean }) {
  const me = useMe((m) => m.me)!;
  const theme = useUi((u) => u.theme);
  const setTheme = useUi((u) => u.setTheme);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const dark = document.documentElement.dataset['theme'] === 'dark';
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className={s.profile} ref={root}>
      <button type="button" className={s.account} aria-label="アカウント" aria-expanded={open} title={expanded ? undefined : me.name} onClick={() => setOpen((o) => !o)}>
        <Avatar name={me.name} size={28} />
        {expanded && <span className={s.accountName}>{me.name}</span>}
      </button>
      {open && (
        <div className={s.popover}>
          <ProfileMenu
            name={me.name}
            email={me.email}
            avatar={<Avatar name={me.name} size={40} />}
            items={[
              {
                id: 'theme',
                label: dark ? 'ライトモードにする' : 'ダークモードにする',
                icon: dark ? <IconSun /> : <IconMoon />,
                ...(theme === 'system' ? { badge: '自動' } : {}),
                onSelect: () => setTheme(dark ? 'light' : 'dark'),
              },
              {
                id: 'settings',
                label: '設定',
                icon: <IconSettings />,
                onSelect: () => {
                  setOpen(false);
                  void navigate('/settings');
                },
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
