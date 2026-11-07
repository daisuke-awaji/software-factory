// ホーム（ADR-0007）: 新しい依頼の入力欄、依頼の一覧、対応が必要な項目（受け箱）
import type { Line, WorkItem } from '@factory/contracts';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Page } from '../../app/AppShell';
import { DecisionInbox, type Decision } from '../../components/ui/decision-inbox';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { Empty, ErrorBanner, Loading, Tag, TextInput } from '../../components/kit';
import { IconInbox, IconSearch } from '../../components/icons';
import { StageLine } from '../../components/StageLine';
import { errorMessage } from '../../lib/api';
import { duration, reasonLabel, relative, stateLabel, stateTone, usd } from '../../lib/format';
import { findLine, stepsFromItem } from '../../lib/line';
import { useApi } from '../../lib/services';
import type { Pending } from '../../lib/session';
import { useResource } from '../../lib/useResource';
import { useUi } from '../../stores/ui';
import { NewRequest } from './NewRequest';
import { useLiveReload, usePending } from './useLive';
import s from './home.module.css';

type Filter = 'all' | 'action' | 'running' | 'done' | 'ended' | 'archived';

const filters: Record<Exclude<Filter, 'archived'>, (i: WorkItem) => boolean> = {
  all: () => true,
  action: (i) => i.state === 'awaiting_approval',
  running: (i) => ['queued', 'planning', 'running', 'suspended'].includes(i.state),
  done: (i) => i.state === 'completed',
  ended: (i) => i.state === 'failed' || i.state === 'cancelled',
};

export function HomePage() {
  const api = useApi();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const list = useResource(() => api.listWorkItems({ limit: 100 }), [], { pollMs: 20_000 });
  const archived = useResource(() => api.listWorkItems({ archived: true, limit: 100 }), [filter], { enabled: filter === 'archived' });
  const lines = useResource(() => api.lines(), []);
  useLiveReload(list.data?.items, () => void list.reload());
  const pending = usePending(list.data?.items);

  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const shown = useMemo(() => {
    const base = filter === 'archived' ? (archived.data?.items ?? []) : items.filter(filters[filter]);
    const q = query.trim().toLowerCase();
    return q ? base.filter((i) => `${i.title} ${i.repo ? `${i.repo.owner}/${i.repo.name}` : ''}`.toLowerCase().includes(q)) : base;
  }, [items, archived.data, filter, query]);

  return (
    <Page wide>
      <div className={s.layout}>
        <div className={s.main}>
          <h1 className={s.greeting}>依頼</h1>
          <NewRequest lines={lines.data} />

          <div className={s.listHead}>
            <SegmentedControl<Filter>
              size="sm"
              aria-label="絞り込み"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'すべて', count: items.length },
                { value: 'action', label: '対応待ち', count: items.filter(filters.action).length },
                { value: 'running', label: '実行中', count: items.filter(filters.running).length },
                { value: 'done', label: '完了', count: items.filter(filters.done).length },
                { value: 'ended', label: '失敗・中止', count: items.filter(filters.ended).length },
                { value: 'archived', label: 'アーカイブ' },
              ]}
            />
            <label className={s.search}>
              <IconSearch />
              <span className="sr-only">依頼を検索</span>
              <TextInput type="search" placeholder="タイトルやリポジトリで探す" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          </div>

          <ErrorBanner error={list.error} onRetry={() => void list.reload()} />
          {list.loading && !list.data ? (
            <Loading />
          ) : shown.length === 0 ? (
            <Empty title={query ? '見つかりませんでした' : 'この条件の依頼はありません'} icon={<IconInbox />}>
              {filter === 'all' && !query && '上の入力欄から、最初の依頼を出してみましょう。'}
            </Empty>
          ) : (
            <WorkItemTable items={shown} lines={lines.data} pending={pending} />
          )}
        </div>

        <aside className={s.side} aria-label="対応が必要な項目と集計">
          <Inbox items={items} pending={pending} onDone={() => void list.reload()} />
          <WeekStats items={items} />
        </aside>
      </div>
    </Page>
  );
}

function WorkItemTable({ items, lines, pending }: { items: WorkItem[]; lines: Line[] | undefined; pending: Record<string, Pending> }) {
  const navigate = useNavigate();
  return (
    <div className={s.tableWrap}>
      <table className={s.table} aria-label="依頼の一覧">
        <thead>
          <tr>
            <th scope="col">依頼</th>
            <th scope="col">状態</th>
            <th scope="col">ライン</th>
            <th scope="col" className={s.num}>所要</th>
            <th scope="col" className={s.num}>費用</th>
            <th scope="col" className={s.num}>更新</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const line = findLine(lines, i.lineRef);
            const p = pending[i.id];
            const done = i.state === 'completed' || i.state === 'failed' || i.state === 'cancelled';
            return (
              <tr key={i.id} onClick={() => void navigate(`/w/${i.id}`)} className={s.row}>
                <td>
                  <Link to={`/w/${i.id}`} className={s.rowTitle} onClick={(e) => e.stopPropagation()}>
                    {i.title}
                  </Link>
                  <span className={s.rowSub}>
                    {i.repo ? `${i.repo.owner}/${i.repo.name}` : 'リポジトリなし'}
                    {i.pullRequest && ` · PR #${i.pullRequest.number}`}
                  </span>
                </td>
                <td>
                  <Tag tone={stateTone[i.state]}>{p?.kind === 'approval' ? `${reasonLabel[p.approval.reason]}の承認待ち` : stateLabel[i.state]}</Tag>
                </td>
                <td>
                  <span className={s.lineCell}>
                    <StageLine size="xs" steps={stepsFromItem(line, i, p?.kind)} label={`${line?.title ?? i.lineRef} の進み具合`} />
                    <span className={s.lineName}>{line?.title ?? i.lineRef}</span>
                  </span>
                </td>
                <td className={s.num}>{done ? duration(Date.parse(i.updatedAt) - Date.parse(i.createdAt)) : '—'}</td>
                <td className={s.num}>{usd(i.costUsd)}</td>
                <td className={s.num}>{relative(i.updatedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
