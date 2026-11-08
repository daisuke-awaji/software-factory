// サーバーの状態を読む小さなフック（キャッシュは持たない。Zustand には置かない: 実装計画 §5.2）
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './api';

export type Resource<T> = { data: T | undefined; error: string | null; loading: boolean; reload: () => Promise<void> };

export function useResource<T>(load: () => Promise<T>, deps: unknown[], opts: { pollMs?: number; enabled?: boolean } = {}): Resource<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(opts.enabled !== false);
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    const my = ++seq.current;
    try {
      const v = await loadRef.current();
      if (my === seq.current) {
        setData(v);
        setError(null);
      }
    } catch (e) {
      if (my === seq.current) setError(errorMessage(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (opts.enabled === false) return;
    setLoading(true);
    void reload();
    if (!opts.pollMs) return;
    const t = setInterval(() => void reload(), opts.pollMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, opts.enabled, opts.pollMs]);

  return { data, error, loading, reload };
}
