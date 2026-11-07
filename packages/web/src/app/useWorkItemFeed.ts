// サイドパネルの依頼の一覧（06_ui_spec.md §1.1）: 新しい順に PAGE 件ずつ読み、下までスクロールしたら続きを足す
import type { WorkItem } from '@factory/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../lib/api';
import { useServices } from '../lib/services';

export const PAGE = 30;

export type WorkItemFeed = {
  items: WorkItem[] | undefined;
  error: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  /** 先頭のページを読み直し、読み込み済みの続きと合わせる */
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
};

type State = { items: WorkItem[] | undefined; cursor: string | undefined; pages: number };

const byUpdated = (a: WorkItem, b: WorkItem) => b.updatedAt.localeCompare(a.updatedAt);

export function useWorkItemFeed(deps: unknown[], opts: { enabled: boolean; pollMs: number }): WorkItemFeed {
  const { api } = useServices();
  const [state, setState] = useState<State>({ items: undefined, cursor: undefined, pages: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const seq = useRef(0);
  const cursor = useRef<string | undefined>(undefined);
  cursor.current = state.cursor;
  const busy = useRef(false);

  const reload = useCallback(async () => {
    const my = ++seq.current;
    try {
      const page = await api.listWorkItems({ limit: PAGE });
      if (my !== seq.current) return;
      setError(null);
      setState((prev) => {
        if (!prev.items || prev.pages <= 1) return { items: page.items, cursor: page.nextCursor, pages: 1 };
        const ids = new Set(page.items.map((i) => i.id));
        return { ...prev, items: [...page.items, ...prev.items.filter((i) => !ids.has(i.id))].sort(byUpdated) };
      });
    } catch (e) {
      if (my === seq.current) setError(errorMessage(e));
    }
  }, [api]);

  const loadMore = useCallback(async () => {
    const at = cursor.current;
    if (!at || busy.current) return;
    busy.current = true;
    setLoadingMore(true);
    try {
      const page = await api.listWorkItems({ limit: PAGE, cursor: at });
      setState((prev) => {
        const have = new Set((prev.items ?? []).map((i) => i.id));
        return { items: [...(prev.items ?? []), ...page.items.filter((i) => !have.has(i.id))], cursor: page.nextCursor, pages: prev.pages + 1 };
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      busy.current = false;
      setLoadingMore(false);
    }
  }, [api]);

  useEffect(() => {
    if (!opts.enabled) return;
    void reload();
    const t = setInterval(() => void reload(), opts.pollMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, opts.enabled, opts.pollMs, reload]);

  return { items: state.items, error, hasMore: !!state.cursor, loadingMore, reload, loadMore };
}
