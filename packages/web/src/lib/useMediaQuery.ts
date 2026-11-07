// 画面の幅で、描く部品そのものを変えるときに使う（見た目だけの違いは CSS の @media で書く: 06_ui_spec.md §6）
import { useSyncExternalStore } from 'react';

/** 06_ui_spec.md §6 の幅。CSS の @media の値と合わせる */
export const narrow = {
  /** 1280px 未満: サイドパネルはアイコンの列にし、広げるときは重ねて出す */
  sidebar: '(max-width: 1279px)',
  /** 1024px 未満: 会話と成果物を切り替えて出す */
  tablet: '(max-width: 1023px)',
  /** 720px 未満: スマホ */
  phone: '(max-width: 719px)',
} as const;

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const m = window.matchMedia(query);
      m.addEventListener('change', notify);
      return () => m.removeEventListener('change', notify);
    },
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  );
}
