// ホーム（ADR-0010）: 新しい依頼の入力欄、対応が必要な項目（受け箱）、この7日間の集計。依頼の一覧はサイドパネルと「すべての依頼」に移した
import type { WorkItem } from '@factory/contracts';
import { Link, useNavigate } from 'react-router';
import { Page } from '../../app/AppShell';
import { DecisionInbox, type Decision } from '../../components/ui/decision-inbox';
import { ErrorBanner } from '../../components/kit';
import { IconChevron } from '../../components/icons';
import { errorMessage } from '../../lib/api';
import { duration, reasonLabel, usd } from '../../lib/format';
import { useApi } from '../../lib/services';
import type { Pending } from '../../lib/session';
import { narrow, useMediaQuery } from '../../lib/useMediaQuery';
import { useResource } from '../../lib/useResource';
import { useUi } from '../../stores/ui';
import { NewRequest } from './NewRequest';
import { useLiveReload, usePending } from './useLive';
import s from './home.module.css';

export function HomePage() {
  const api = useApi();
  const list = useResource(() => api.listWorkItems({ limit: 100 }), [], { pollMs: 20_000 });
  const lines = useResource(() => api.lines(), []);
  useLiveReload(list.data?.items, () => void list.reload());
  const pending = usePending(list.data?.items);
  /** 1列のとき、判断が必要な項目があれば入力欄より先に出す（06_ui_spec.md §6） */
  const oneCol = useMediaQuery(narrow.home);

  const items = list.data?.items ?? [];
  const inboxFirst = oneCol && Object.keys(pending).length > 0;
  const inbox = <Inbox items={items} pending={pending} onDone={() => void list.reload()} />;

  return (
    <Page wide>
      <div className={s.layout}>
        <div className={s.main}>
          <h1 className={s.greeting}>新しい依頼</h1>
          {inboxFirst && <section className={s.inboxFirst} aria-label="対応が必要な項目">{inbox}</section>}
          <NewRequest lines={lines.data} />
          <ErrorBanner error={list.error} onRetry={() => void list.reload()} />
          {items.length > 0 && (
            <Link to="/requests" className={s.allLink}>
              すべての依頼（{items.length} 件）を見る <IconChevron />
            </Link>
          )}
        </div>

        <aside className={s.side} aria-label={inboxFirst ? '集計' : '対応が必要な項目と集計'}>
          {!inboxFirst && inbox}
          <WeekStats items={items} />
        </aside>
      </div>
    </Page>
  );
}

function Inbox({ items, pending, onDone }: { items: WorkItem[]; pending: Record<string, Pending>; onDone: () => void }) {
  const api = useApi();
  const navigate = useNavigate();
  const toast = useUi((u) => u.toast);
  const decisions: (Decision & { workItemId: string; pending: Pending })[] = items
    .filter((i) => pending[i.id])
    .map((i, idx) => {
      const p = pending[i.id]!;
      return p.kind === 'plan'
        ? {
            id: `${i.id}:plan:${p.version}`, workItemId: i.id, pending: p, collapsed: idx > 0,
            title: `計画の承認: ${i.title}`,
            detail: `${i.repo ? `${i.repo.owner}/${i.repo.name}` : 'リポジトリなし'} · ${p.plan.steps.length} ステップ · 見積もり ${p.plan.estimate.minutes}分・${usd(p.plan.estimate.usd)}`,
            primary: '承認して開始', secondary: '計画を見る',
          }
        : {
            id: `${i.id}:ap:${p.approval.id}`, workItemId: i.id, pending: p, collapsed: idx > 0,
            title: `${reasonLabel[p.approval.reason]}の承認: ${i.title}`,
            detail: p.approval.detail,
            primary: '許可する', secondary: '開いて確かめる',
          };
    });

  const decide = async (d: Decision, answer: 'primary' | 'secondary') => {
    const full = decisions.find((x) => x.id === d.id);
    if (!full) return;
    if (answer === 'secondary') return void navigate(`/w/${full.workItemId}`);
    try {
      if (full.pending.kind === 'plan') await api.approvePlan(full.workItemId, full.pending.version);
      else await api.answerApproval(full.workItemId, full.pending.approval.id, { decision: 'approve' });
      toast(full.pending.kind === 'plan' ? '計画を承認しました。作業を始めます。' : '許可しました。作業を続けます。', 'ok');
    } catch (e) {
      toast(errorMessage(e), 'err');
    }
    setTimeout(onDone, 1200);
  };

  return <DecisionInbox key={decisions.map((d) => d.id).join('|')} decisions={decisions} onDecide={(d, a) => void decide(d, a)} />;
}

function WeekStats({ items }: { items: WorkItem[] }) {
  const weekAgo = Date.now() - 7 * 24 * 3600_000;
  const week = items.filter((i) => Date.parse(i.createdAt) >= weekAgo);
  const done = week.filter((i) => i.state === 'completed');
  const avg = done.length ? done.reduce((sum, i) => sum + (Date.parse(i.updatedAt) - Date.parse(i.createdAt)), 0) / done.length : 0;
  const cost = week.reduce((sum, i) => sum + (i.costUsd ?? 0), 0);
  return (
    <section className={s.stats} aria-label="この7日間">
      <h2 className={s.statsTitle}>この7日間</h2>
      <dl className={s.statsList}>
        <div><dt>依頼</dt><dd>{week.length} 件</dd></div>
        <div><dt>完了</dt><dd>{done.length} 件</dd></div>
        <div><dt>平均の所要時間</dt><dd>{done.length ? duration(avg) : '—'}</dd></div>
        <div><dt>費用の合計</dt><dd>{usd(cost)}</dd></div>
      </dl>
    </section>
  );
}
