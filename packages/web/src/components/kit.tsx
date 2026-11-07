// アプリで共通に使う小さな部品（AffectUI にないもの）。見た目は AffectUI のトレーとカードに揃える
import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import type { Tone } from '../lib/format';
import { useUi } from '../stores/ui';
import { IconClose, IconWarning } from './icons';
import s from './kit.module.css';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Tag({ tone, children, pulse = tone === 'run' }: { tone?: Tone; children: ReactNode; pulse?: boolean }) {
  return (
    <span className={s.tag} data-tone={tone} data-pulse={pulse || undefined}>
      {children}
    </span>
  );
}

export function Dot({ tone, label }: { tone?: Tone; label?: string }) {
  return <span className={s.dot} data-tone={tone} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

/** エージェントの印。AI らしさを抑えるため、きらきらではなく単純な幾何形にする（UI モックから引き継いだ） */
export function FactoryMark({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.2" fill="currentColor" />
      <rect x="9" y="1.5" width="5.5" height="5.5" rx="1.2" fill="currentColor" opacity=".45" />
      <rect x="1.5" y="9" width="5.5" height="5.5" rx="1.2" fill="currentColor" opacity=".45" />
      <rect x="9" y="9" width="5.5" height="5.5" rx="1.2" fill="currentColor" />
    </svg>
  );
}

export function Avatar({ name, kind = 'user', size = 28 }: { name?: string | undefined; kind?: 'user' | 'agent'; size?: number }) {
  return (
    <span className={s.avatar} data-kind={kind} style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">
      {kind === 'agent' ? <FactoryMark size={Math.round(size * 0.55)} /> : (name ?? '?').slice(0, 1)}
    </span>
  );
}

export function Tray({ head, right, children, className, label }: { head?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; label?: string }) {
  return (
    <section className={cx(s.tray, className)} aria-label={label}>
      {(head || right) && (
        <header className={s.trayHead}>
          {head}
          {right && <span className={s.trayRight}>{right}</span>}
        </header>
      )}
      <div className={s.card}>{children}</div>
    </section>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(s.card, className)}>{children}</div>;
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className={s.empty}>
      {icon && <span className={s.emptyIcon}>{icon}</span>}
      <p className={s.emptyTitle}>{title}</p>
      {children && <div className={s.emptyBody}>{children}</div>}
    </div>
  );
}

export function Spinner({ label = '読み込んでいます' }: { label?: string }) {
  return (
    <span className={s.spinnerWrap} role="status">
      <span className={s.spinner} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function Loading({ label = '読み込んでいます…' }: { label?: string }) {
  return (
    <div className={s.loading}>
      <span className={s.spinner} aria-hidden="true" /> <span className="muted" role="status">{label}</span>
    </div>
  );
}

export function Banner({ tone = 'info', children, action }: { tone?: 'info' | 'warn' | 'err' | 'ok'; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={s.banner} data-tone={tone} role={tone === 'err' ? 'alert' : 'status'}>
      {(tone === 'warn' || tone === 'err') && <IconWarning />}
      <div className={s.bannerBody}>{children}</div>
      {action}
    </div>
  );
}

export function ErrorBanner({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <Banner tone="err" action={onRetry && <button type="button" className={s.linkButton} onClick={onRetry}>再読み込み</button>}>
      {error}
    </Banner>
  );
}

export function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className={s.linkButton} onClick={onClick}>
      {children}
    </button>
  );
}

// ---------- フォーム ----------
export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string | undefined; children: ReactNode; htmlFor?: string }) {
  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <p className={s.fieldError} role="alert">{error}</p> : hint ? <p className={s.hint}>{hint}</p> : null}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(s.input, props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(s.input, s.textarea, props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(s.input, s.select, props.className)} />;
}

// ---------- ダイアログ（<dialog> を使う） ----------
export function Dialog({ open, onClose, title, children, footer, width = 520 }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: number }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
    if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={s.dialog}
      style={{ width }}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={title}
    >
      {open && (
        <>
          <header className={s.dialogHead}>
            <h2 className={s.dialogTitle}>{title}</h2>
            <button type="button" className={s.iconButton} onClick={onClose} aria-label="閉じる">
              <IconClose />
            </button>
          </header>
          <div className={s.dialogBody}>{children}</div>
          {footer && <footer className={s.dialogFoot}>{footer}</footer>}
        </>
      )}
    </dialog>
  );
}

// ---------- メニュー ----------
export type MenuItem = { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean };

export function Menu({ trigger, items, label, align = 'end' }: { trigger: ReactNode; items: MenuItem[]; label: string; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
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
    <div className={s.menuRoot} ref={root}>
      <button type="button" className={s.iconButton} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open && (
        <div className={s.menu} role="menu" data-align={align}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={s.menuItem}
              data-danger={it.danger || undefined}
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function IconButton({ label, onClick, children, disabled }: { label: string; onClick?: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" className={s.iconButton} aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Toasts() {
  const toasts = useUi((u) => u.toasts);
  const dismiss = useUi((u) => u.dismiss);
  return (
    <div className={s.toasts} aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={s.toast} data-tone={t.tone}>
          <span>{t.text}</span>
          <button type="button" className={s.iconButton} onClick={() => dismiss(t.id)} aria-label="閉じる">
            <IconClose />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Meter({ used, limit, label, format = (n) => n.toLocaleString('ja-JP') }: { used: number; limit: number; label: string; format?: (n: number) => string }) {
  const ratio = Math.min(1, used / limit);
  const tone = ratio > 0.85 ? 'err' : ratio > 0.6 ? 'alert' : 'ok';
  return (
    <div className={s.meter}>
      <div className={s.meterHead}>
        <span>{label}</span>
        <span className="muted">
          {format(used)} / {format(limit)}
        </span>
      </div>
      <div className={s.meterTrack} role="meter" aria-label={label} aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit}>
        <span className={s.meterFill} data-tone={tone} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className={s.pageHead}>
      <div>
        <h1 className={s.pageTitle}>{title}</h1>
        {description && <p className={s.pageDesc}>{description}</p>}
      </div>
      {actions && <div className={s.pageActions}>{actions}</div>}
    </header>
  );
}

/** 一覧の表（ホーム以外の画面で使う） */
export function Table({ head, children, label }: { head: ReactNode[]; children: ReactNode; label?: string }) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table} aria-label={label}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
