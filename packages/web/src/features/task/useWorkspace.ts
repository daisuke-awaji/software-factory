// ワークスペースのデータ: タスク（REST）と、イベントを畳み込んだセッション（WebSocket + 履歴）
import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '../../lib/api';
import { findWorkflow } from '../../lib/workflow';
import { useServices } from '../../lib/services';
import { pendingOf } from '../../lib/session';
import { useResource } from '../../lib/useResource';
import { useSessionStore } from '../../stores/session';
import { useUi, type Tab } from '../../stores/ui';

export function useWorkspace(id: string) {
  const { api, events } = useServices();
  const item = useResource(() => api.getTask(id), [id]);
  const workflows = useResource(() => api.workflows(), []);
  const session = useSessionStore((st) => (st.session?.taskId === id ? st.session : null));
  const [historyError, setHistoryError] = useState<string | null>(null);

  // 先に購読してから履歴を読む（間に起きたイベントは eventId で重複を除く）
  useEffect(() => {
    useSessionStore.getState().open(id);
    const off = events.subscribe(id, (e) => useSessionStore.getState().applyEvent(e));
    let alive = true;
    setHistoryError(null);
    api.events(id).then(
      (page) => {
        if (!alive) return;
        useSessionStore.getState().applyHistory(page.items);
        const last = page.items.at(-1);
        if (last) events.markSeen(id, last.eventId);
      },
      (e: unknown) => alive && setHistoryError(errorMessage(e)),
    );
    return () => {
      alive = false;
      off();
      useSessionStore.getState().close();
      useUi.getState().resetTab(id);
    };
  }, [id, api, events]);

  // 状態が変わったら、タスク（PR・費用など）を読み直す
  const state = session?.state ?? item.data?.state ?? null;
  const reloadItem = item.reload;
  useEffect(() => {
    if (session?.state) void reloadItem();
  }, [session?.state, reloadItem]);
  // 実行中は費用の表示のために、ときどき読み直す
  useEffect(() => {
    if (state !== 'running' && state !== 'planning') return;
    const t = setInterval(() => void reloadItem(), 5000);
    return () => clearInterval(t);
  }, [state, reloadItem]);

  const workflow = findWorkflow(workflows.data, item.data?.workflowRef ?? '');
  const pending = session ? pendingOf(session) : null;

  // 06_ui_spec.md §3: 状態に合わせたタブ
  const desired: Tab = useMemo(() => {
    if (!state || state === 'queued' || state === 'planning') return 'plan';
    if (state === 'awaiting_approval') return pending?.kind === 'approval' ? 'log' : 'plan';
    if (state === 'running' || state === 'suspended' || state === 'failed' || state === 'cancelled') return session?.preview && state === 'running' ? 'preview' : 'log';
    return session?.preview ? 'preview' : 'changes';
  }, [state, pending?.kind, session?.preview]);
  const autoTab = useUi((u) => u.autoTab);
  const ready = !!session?.lastEventId;
  useEffect(() => {
    if (ready) autoTab(id, desired);
  }, [id, desired, autoTab, ready]);

  return { item, workflows, workflow, session, state, pending, historyError };
}
