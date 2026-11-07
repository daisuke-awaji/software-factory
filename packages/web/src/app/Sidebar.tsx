// 左のサイドパネル（ADR-0010）: 新しいタスク、画面の移動、タスクの一覧、アカウント。畳むとアイコンの列になる
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router';
import { ProfileMenu } from '../components/ui/profile-menu';
import { Avatar, Dot, FactoryMark } from '../components/kit';
import { IconClose, IconCompose, IconGlobe, IconImage, IconWorkflow, IconList, IconMoon, IconSearch, IconSettings, IconShield, IconSidebar, IconSun } from '../components/icons';
import type { ConnectionState } from '../lib/events';
import { relative, stateLabel, stateTone } from '../lib/format';
import { isAdmin, useMe } from '../stores/me';
import { useUi } from '../stores/ui';
import { LogoToggle, sidebarShortcut } from './LogoToggle';
import type { TaskFeed } from './useTaskFeed';
import s from './Sidebar.module.css';

const RUNNING = new Set(['queued', 'planning', 'running', 'suspended']);
const DAY = 86_400_000;

/** 終わったタスクを、更新した日で分ける（今日・昨日・過去7日間・それより前） */
export function dayBucket(updatedAt: string, now = new Date()): 'today' | 'yesterday' | 'week' | 'older' {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = new Date(updatedAt).getTime();
  if (t >= today) return 'today';
  if (t >= today - DAY) return 'yesterday';
  if (t >= today - 6 * DAY) return 'week';
  return 'older';
}
const BUCKETS = [
  { key: 'today', title: '今日' },
  { key: 'yesterday', title: '昨日' },
  { key: 'week', title: '過去7日間' },
  { key: 'older', title: 'それより前' },
] as const;

export type SidebarProps = {
  /** false = アイコンの列 */
  expanded: boolean;
  /** 重ねて出しているとき（1280px 未満）。閉じるボタンを出す */
  floating?: boolean;
  feed: TaskFeed;
  conn: ConnectionState;
  mock: boolean;
  onToggle: () => void;
};

export function Sidebar({ expanded, floating = false, feed, conn, mock, onToggle }: SidebarProps) {
  const me = useMe((m) => m.me);
  const items = feed.items;
  const toggleLabel = floating ? 'サイドパネルを閉じる' : expanded ? 'サイドパネルを畳む' : 'サイドパネルを広げる';
  const attention = (items ?? []).filter((i) => i.state === 'awaiting_approval').length;
  const links: { to: string; label: string; icon: ReactNode; end?: boolean; badge?: number }[] = [
    { to: '/tasks', label: 'すべてのタスク', icon: <IconList />, ...(attention ? { badge: attention } : {}) },
    { to: '/publications', label: '公開物', icon: <IconGlobe /> },
    { to: '/images', label: 'イメージ', icon: <IconImage /> },
    { to: '/workflows', label: 'ワークフロー', icon: <IconWorkflow /> },
    ...(isAdmin(me) ? [{ to: '/admin', label: '管理', icon: <IconShield /> }] : []),
  ];
  const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? s.active : undefined);

  return (
    <div className={s.panel} data-expanded={expanded || undefined} data-floating={floating || undefined}>
      <div className={s.head}>
        {expanded ? (
          <>
            <Link to="/" className={s.brand} aria-label="Software Factory（ホーム）">
              <span className={s.mark}><FactoryMark size={14} /></span>
              <span>Software Factory</span>
            </Link>
            <button type="button" className={s.iconButton} aria-label={toggleLabel} title={`${toggleLabel}（${sidebarShortcut()}）`} aria-keyshortcuts="Meta+B Control+B" onClick={onToggle}>
              {floating ? <IconClose /> : <IconSidebar />}
            </button>
          </>
        ) : (
          <LogoToggle label={toggleLabel} expanded={false} onClick={onToggle} />
        )}
      </div>

      <nav className={s.nav} aria-label="メイン">
        <NavLink to="/" end className={({ isActive }) => `${s.newTask} ${isActive ? s.active : ''}`} title={expanded ? undefined : '新しいタスク'}>
          <IconCompose />
          {expanded ? <span>新しいタスク</span> : <span className="sr-only">新しいタスク</span>}
        </NavLink>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} className={navClass} title={expanded ? undefined : l.label}>
            {l.icon}
            {expanded ? <span className={s.label}>{l.label}</span> : <span className="sr-only">{l.label}</span>}
            {l.badge ? <span className={s.badge} aria-label={`対応が必要 ${l.badge} 件`}>{l.badge}</span> : null}
          </NavLink>
        ))}
      </nav>

      {expanded ? <Sessions feed={feed} /> : <div className={s.spacer} />}

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

/** タスクの一覧: 対応が必要 → 実行中 → 終わったもの（日付で分ける）。下までスクロールしたら続きを読む */
function Sessions({ feed }: { feed: TaskFeed }) {
  const { items, hasMore, loadingMore, loadMore, error, reload } = feed;
  const { id: current } = useParams();
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = (items ?? []).filter((i) => !q || `${i.title} ${i.repo ? `${i.repo.owner}/${i.repo.name}` : ''}`.toLowerCase().includes(q));
    const rest = all.filter((i) => i.state !== 'awaiting_approval' && !RUNNING.has(i.state));
    const now = new Date();
    return [
      { key: 'action', title: '対応が必要', items: all.filter((i) => i.state === 'awaiting_approval') },
      { key: 'running', title: '実行中', items: all.filter((i) => RUNNING.has(i.state)) },
      ...BUCKETS.map((b) => ({ key: b.key, title: b.title, items: rest.filter((i) => dayBucket(i.updatedAt, now) === b.key) })),
    ].filter((g) => g.items.length > 0);
  }, [items, query]);

  // 下の印が見えたら続きを読む（読んでもまだ見えていれば、また読む。検索中は、見つかるまで読み進める）
  const scroller = useRef<HTMLElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    // 失敗したときは自動では読み直さない（「続きを読み込む」を押してもらう）
    if (!el || !hasMore || loadingMore || error || typeof IntersectionObserver !== 'function') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { root: scroller.current, rootMargin: '120px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadingMore, loadMore, error, items]);

  return (
    <div className={s.sessions}>
      <label className={s.search}>
        <IconSearch />
        <span className="sr-only">タスクを探す</span>
        <input type="search" placeholder="タスクを探す" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <nav ref={scroller} className={s.scroll} aria-label="タスク">
        {!items ? (
          error ? (
            <p className={s.empty}>読み込めませんでした。<button type="button" className={s.retry} onClick={() => void reload()}>もう一度</button></p>
          ) : (
            <p className={s.empty}>読み込んでいます…</p>
          )
        ) : groups.length === 0 && !hasMore ? (
          <p className={s.empty}>{query ? '見つかりませんでした' : 'まだタスクはありません'}</p>
        ) : (
          groups.map((g) => (
            <section key={g.key} className={s.group} aria-labelledby={`sb-${g.key}`}>
              <h2 className={s.groupTitle} id={`sb-${g.key}`}>{g.title}</h2>
              <ul className={s.list}>
                {g.items.map((i) => (
                  <li key={i.id}>
                    <Link to={`/t/${i.id}`} className={s.item} aria-current={i.id === current ? 'page' : undefined} title={i.title}>
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
        {items && hasMore && (
          <div ref={sentinel} className={s.loadMore}>
            {loadingMore ? <span role="status">読み込んでいます…</span> : <button type="button" className={s.retry} onClick={() => void loadMore()}>続きを読み込む</button>}
          </div>
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
