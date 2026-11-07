// ホーム用: 一覧のワークアイテムのイベントを購読して、変わったら読み直す。承認待ちのものは、何を待っているかを履歴から調べる
import type { WorkItem } from '@factory/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isTerminal } from '../../lib/format';
import { useServices } from '../../lib/services';
import { emptySession, pendingOf, reduceAll, type Pending } from '../../lib/session';

const TRIGGERS = new Set(['workitem.state', 'plan.proposed', 'plan.decided', 'approval.required', 'approval.resolved', 'stage.changed']);

export function useLiveReload(items: WorkItem[] | undefined, reload: () => void) {
  const { events } = useServices();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const ids = useMemo(() => (items ?? []).filter((i) => !isTerminal(i.state)).map((i) => i.id).sort().join(','), [items]);

  useEffect(() => {
    if (!ids) return;
    const offs = ids.split(',').map((id) =>
      events.subscribe(id, (e) => {
        if (!TRIGGERS.has(e.type)) return;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => reloadRef.current(), 250);
      }),
    );
    return () => offs.forEach((off) => off());
  }, [ids, events]);
}

/** 承認待ちのワークアイテムが、何の回答を待っているか */
export function usePending(items: WorkItem[] | undefined) {
  const { api } = useServices();
  const [pending, setPending] = useState<Record<string, Pending>>({});
  const targets = (items ?? []).filter((i) => i.state === 'awaiting_approval');
  const key = targets.map((i) => `${i.id}:${i.updatedAt}`).join(',');

  useEffect(() => {
    let alive = true;
    void Promise.all(
      targets.map(async (i) => {
        try {
          const page = await api.events(i.id);
          const p = pendingOf(reduceAll(emptySession(i.id), page.items));
          return p ? ([i.id, p] as const) : null;
        } catch {
          return null;
        }
      }),
    ).then((rows) => {
      if (alive) setPending(Object.fromEntries(rows.filter((r): r is NonNullable<typeof r> => r !== null)));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, api]);

  return pending;
}
