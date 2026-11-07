// 画面の状態（テーマ、右のタブ、通知）。サーバーの状態はここに置かない
import { create } from 'zustand';

export type Theme = 'light' | 'dark' | 'system';
export type Tab = 'preview' | 'changes' | 'files' | 'plan' | 'log';
export type Toast = { id: number; text: string; tone?: 'ok' | 'err' };

type UiState = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** ワークアイテムごとの右のタブ。manual = ユーザーが自分で選んだ（06_ui_spec.md §3） */
  tabs: Record<string, { tab: Tab; manual: boolean; hint: Tab | null }>;
  autoTab: (workItemId: string, tab: Tab) => void;
  pickTab: (workItemId: string, tab: Tab) => void;
  resetTab: (workItemId: string) => void;
  toasts: Toast[];
  toast: (text: string, tone?: Toast['tone']) => void;
  dismiss: (id: number) => void;
};

export function applyTheme(t: Theme) {
  const dark = t === 'dark' || (t === 'system' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
  document.documentElement.classList.toggle('dark', dark);
}

const storedTheme = (): Theme => {
  try {
    const t = localStorage.getItem('sf.theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
};

let toastSeq = 0;

export const useUi = create<UiState>()((set, get) => ({
  theme: storedTheme(),
  setTheme: (theme) => {
    try {
      if (theme === 'system') localStorage.removeItem('sf.theme');
      else localStorage.setItem('sf.theme', theme);
    } catch {
      // 保存できなくてもテーマは切り替える
    }
    applyTheme(theme);
    set({ theme });
  },
  tabs: {},
  autoTab: (id, tab) => {
    const cur = get().tabs[id];
    if (cur?.manual) {
      // 自分で選んだ後は切り替えず、印だけを付ける
      if (cur.tab !== tab && cur.hint !== tab) set({ tabs: { ...get().tabs, [id]: { ...cur, hint: tab } } });
      return;
    }
    if (cur?.tab !== tab) set({ tabs: { ...get().tabs, [id]: { tab, manual: false, hint: null } } });
  },
  pickTab: (id, tab) => {
    const cur = get().tabs[id];
    set({ tabs: { ...get().tabs, [id]: { tab, manual: true, hint: cur?.hint === tab ? null : (cur?.hint ?? null) } } });
  },
  resetTab: (id) => {
    const { [id]: _drop, ...rest } = get().tabs;
    void _drop;
    set({ tabs: rest });
  },
  toasts: [],
  toast: (text, tone) => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, text, ...(tone ? { tone } : {}) }] });
    setTimeout(() => get().dismiss(id), 4200);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
