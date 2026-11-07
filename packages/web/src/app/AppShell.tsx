// アプリの枠: 左のサイドパネルと、ページの中身（ADR-0010）。スマホでは上の細いバーと、左から出すサイドパネル
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { Banner, ErrorBanner, FactoryMark, Loading, Toasts } from '../components/kit';
import { IconMenu } from '../components/icons';
import { useLiveReload } from '../features/home/useLive';
import { errorMessage } from '../lib/api';
import type { ConnectionState } from '../lib/events';
import { useServices } from '../lib/services';
import { narrow, useMediaQuery } from '../lib/useMediaQuery';
import { useResource } from '../lib/useResource';
import { useMe } from '../stores/me';
import { useUi } from '../stores/ui';
import { Sidebar } from './Sidebar';
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

  // サイドパネルの依頼の一覧。画面を移ったとき（新しい依頼を出したときなど）と、状態が変わったときに読み直す
  const list = useResource(() => api.listWorkItems({ limit: 100 }), [location.pathname], { pollMs: 20_000, enabled: !!me });
  useLiveReload(list.data?.items, () => void list.reload());

  const full = location.pathname.startsWith('/w/');
  const overlayMode = useMediaQuery(narrow.sidebar);
  const phone = useMediaQuery(narrow.phone);
  const pinned = useUi((u) => u.sidebarPinned);
  const setPinned = useUi((u) => u.setSidebarPinned);
  const overlay = useUi((u) => u.sidebarOverlay);
  const setOverlay = useUi((u) => u.setSidebarOverlay);
  const toggle = useCallback(() => {
    if (overlayMode) setOverlay(!useUi.getState().sidebarOverlay);
    else setPinned(!useUi.getState().sidebarPinned);
  }, [overlayMode, setOverlay, setPinned]);
  const closeOverlay = useCallback(() => setOverlay(false), [setOverlay]);

  useEffect(() => setOverlay(false), [location.pathname, overlayMode, setOverlay]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'b' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        toggle();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggle]);

  const items = list.data?.items;
  const floating = overlayMode && overlay;

  return (
    <div className={s.app} data-full={full || undefined}>
      <a href="#main" className={s.skip}>本文へ移動</a>
      {!phone && (
        <aside className={s.side} aria-label="サイドパネル" inert={floating || undefined}>
          <Sidebar expanded={!overlayMode && pinned} items={items} conn={conn} mock={mock} onToggle={toggle} />
        </aside>
      )}
      {floating && (
        <Drawer onClose={closeOverlay}>
          <Sidebar expanded floating items={items} conn={conn} mock={mock} onToggle={closeOverlay} />
        </Drawer>
      )}
      <div className={s.content} inert={floating || undefined}>
        {phone && !full && (
          <header className={s.bar}>
            <button type="button" className={s.menuButton} aria-label="サイドパネルを開く" aria-expanded={overlay} onClick={toggle}>
              <IconMenu />
            </button>
            <Link to="/" className={s.brand} aria-label="Software Factory（ホーム）">
              <span className={s.mark}><FactoryMark size={14} /></span>
              <span>Software Factory</span>
            </Link>
            {conn === 'reconnecting' && <span className={s.conn} role="status">再接続しています…</span>}
            {mock && <span className={s.mock}>モック</span>}
          </header>
        )}
        <main className={s.main} id="main">
          {error ? (
            <div className={s.page}><ErrorBanner error={error} onRetry={loadMe} /></div>
          ) : !me ? (
            <Loading />
          ) : (
            <Outlet />
          )}
        </main>
      </div>
      <Toasts />
    </div>
  );
}

/** 1280px 未満で、サイドパネルを重ねて出す。Esc か外側を押すと閉じる */
function Drawer({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>('nav a')?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <>
      <div className={s.backdrop} onClick={onClose} aria-hidden="true" />
      <div ref={root} className={s.drawer} role="dialog" aria-modal="true" aria-label="サイドパネル">{children}</div>
    </>
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
