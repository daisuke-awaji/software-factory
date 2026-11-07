// アプリの枠: 左のサイドパネルと、ページの中身（ADR-0010）。1280px 未満では、左上のロゴで左からサイドパネルを出す
import { useCallback, useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { Banner, ErrorBanner, Loading, Toasts } from '../components/kit';
import { useLiveReload } from '../features/home/useLive';
import { errorMessage } from '../lib/api';
import type { ConnectionState } from '../lib/events';
import { useServices } from '../lib/services';
import { narrow, useMediaQuery } from '../lib/useMediaQuery';
import { useMe } from '../stores/me';
import { useUi } from '../stores/ui';
import { LogoToggle } from './LogoToggle';
import { Sidebar } from './Sidebar';
import { useTaskFeed } from './useTaskFeed';
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
  const feed = useTaskFeed([location.pathname], { pollMs: 20_000, enabled: !!me });
  useLiveReload(feed.items, () => void feed.reload());

  const full = location.pathname.startsWith('/t/');
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

  const floating = overlayMode && overlay;

  return (
    <div className={s.app} data-full={full || undefined}>
      <a href="#main" className={s.skip}>本文へ移動</a>
      {!phone && (
        <aside className={s.side} aria-label="サイドパネル" inert={floating || undefined}>
          <Sidebar expanded={!overlayMode && pinned} feed={feed} conn={conn} mock={mock} onToggle={toggle} />
        </aside>
      )}
      {overlayMode && (
        <Drawer open={overlay} onClose={closeOverlay}>
          <Sidebar expanded floating feed={feed} conn={conn} mock={mock} onToggle={closeOverlay} />
        </Drawer>
      )}
      <div className={s.content} inert={floating || undefined}>
        {phone && !full && (
          <header className={s.bar}>
            <LogoToggle label="サイドパネルを開く" expanded={overlay} onClick={toggle} />
            <Link to="/" className={s.brand}>Software Factory</Link>
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

/** 1280px 未満で、サイドパネルを左から滑り込ませて重ねる。Esc・外側を押す・左へスワイプで閉じる */
function Drawer({ open, children, onClose }: { open: boolean; children: ReactNode; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number; dx: number; horizontal: boolean | null } | null>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>('nav a')?.focus({ preventScroll: true });
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
      prev?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);

  // 左へのスワイプ: 指に付いてきて、離したときに 1/4 以上動いていれば閉じる
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    if (t) touch.current = { x: t.clientX, y: t.clientY, dx: 0, horizontal: null };
  };
  const onTouchMove = (e: TouchEvent) => {
    const t = e.touches[0];
    const st = touch.current;
    if (!t || !st || !root.current) return;
    const dx = t.clientX - st.x;
    st.horizontal ??= Math.abs(dx) > 8 || Math.abs(t.clientY - st.y) > 8 ? Math.abs(dx) > Math.abs(t.clientY - st.y) : null;
    if (!st.horizontal) return;
    st.dx = Math.min(0, dx);
    root.current.style.transition = 'none';
    root.current.style.transform = `translateX(${st.dx}px)`;
  };
  const onTouchEnd = () => {
    const st = touch.current;
    touch.current = null;
    const el = root.current;
    if (!st || !el) return;
    el.style.transition = '';
    el.style.transform = '';
    if (st.horizontal && st.dx < -Math.min(80, el.offsetWidth / 4)) onClose();
  };

  return (
    <div className={s.drawerRoot} data-open={open || undefined}>
      <div className={s.backdrop} onClick={onClose} aria-hidden="true" />
      <div
        ref={root}
        className={s.drawer}
        role="dialog"
        aria-modal={open}
        aria-label="サイドパネル"
        aria-hidden={!open || undefined}
        inert={!open || undefined}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {children}
      </div>
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
