// アプリの枠: 上部のナビゲーションと、ページの中身（ADR-0007）
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { ProfileMenu } from '../components/ui/profile-menu';
import { Avatar, Banner, ErrorBanner, FactoryMark, Loading, Toasts } from '../components/kit';
import { IconMoon, IconSettings, IconSun } from '../components/icons';
import { errorMessage } from '../lib/api';
import type { ConnectionState } from '../lib/events';
import { useServices } from '../lib/services';
import { isAdmin, useMe } from '../stores/me';
import { useUi } from '../stores/ui';
import s from './AppShell.module.css';

export function AppShell() {
  const { api, events, mock } = useServices();
  const me = useMe((m) => m.me);
  const setMe = useMe((m) => m.setMe);
  const [error, setError] = useState<string | null>(null);
  const [conn, setConn] = useState<ConnectionState>(events.state);
  const location = useLocation();

  const loadMe = () => {
    setError(null);
    api.me().then(setMe, (e: unknown) => setError(errorMessage(e)));
  };
  useEffect(loadMe, [api, setMe]);
  useEffect(() => events.onState(setConn), [events]);

  const full = location.pathname.startsWith('/w/');
  const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? s.active : undefined);

  return (
    <div className={s.app} data-full={full || undefined}>
      <a href="#main" className={s.skip}>本文へ移動</a>
      <header className={s.nav}>
        <Link to="/" className={s.brand} aria-label="Software Factory（ホーム）">
          <span className={s.mark}><FactoryMark size={15} /></span>
          <span className={s.brandText}>Software Factory</span>
        </Link>
        <nav className={s.links} aria-label="メイン">
          <NavLink to="/" end className={navClass}>依頼</NavLink>
          <NavLink to="/publications" className={navClass}>公開物</NavLink>
          <NavLink to="/images" className={navClass}>イメージ</NavLink>
          <NavLink to="/lines" className={navClass}>ライン</NavLink>
          {isAdmin(me) && <NavLink to="/admin" className={navClass}>管理</NavLink>}
        </nav>
        <div className={s.right}>
          {conn === 'reconnecting' && <span className={s.conn} role="status">再接続しています…</span>}
          {mock && <span className={s.mock} title="MSW がすべての API と WebSocket に応答しています">モック</span>}
          {me && <Profile />}
        </div>
      </header>
      <main className={s.main} id="main">
        {error ? (
          <div className={s.page}><ErrorBanner error={error} onRetry={loadMe} /></div>
        ) : !me ? (
          <Loading />
        ) : (
          <Outlet />
        )}
      </main>
      <Toasts />
    </div>
  );
}

function Profile() {
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
      <button type="button" className={s.avatarButton} aria-label="アカウント" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Avatar name={me.name} size={28} />
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

export function NotFound() {
  return (
    <div className={s.page}>
      <Banner>
        ページが見つかりません。<Link to="/">依頼の一覧に戻る</Link>
      </Banner>
    </div>
  );
}

/** 全幅でないページの入れ物 */
export function Page({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className={s.page} data-wide={wide || undefined}>
      {children}
    </div>
  );
}
