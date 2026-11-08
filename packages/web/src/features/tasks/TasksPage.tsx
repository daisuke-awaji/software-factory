// すべてのタスク（ADR-0010）: 絞り込み・検索つきの表。スマホではカードにする。サイドパネルの一覧で足りないときに使う
import type { Workflow, Task } from '@factory/contracts';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Page } from '../../app/AppShell';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { Empty, ErrorBanner, Tag, TextInput } from '../../components/kit';
import { Busy, Skeleton, SkeletonText } from '../../components/skeletons';
import { IconInbox, IconSearch } from '../../components/icons';
import { StepProgress } from '../../components/StepProgress';
import { duration, reasonLabel, relative, stateLabel, stateTone, usd } from '../../lib/format';
import { findWorkflow, progressFromTask } from '../../lib/workflow';
import { useApi } from '../../lib/services';
import type { Pending } from '../../lib/session';
import { narrow, useMediaQuery } from '../../lib/useMediaQuery';
import { useResource } from '../../lib/useResource';
import { useLiveReload, usePending } from '../home/useLive';
import s from './tasks.module.css';

type Filter = 'all' | 'action' | 'running' | 'done' | 'ended' | 'archived';

const filters: Record<Exclude<Filter, 'archived'>, (i: Task) => boolean> = {
  all: () => true,
  action: (i) => i.state === 'awaiting_approval',
  running: (i) => ['queued', 'planning', 'running', 'suspended'].includes(i.state),
  done: (i) => i.state === 'completed',
  ended: (i) => i.state === 'failed' || i.state === 'cancelled',
};

export function TasksPage() {
  const api = useApi();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const list = useResource(() => api.listTasks({ limit: 100 }), [], { pollMs: 20_000 });
  const archived = useResource(() => api.listTasks({ archived: true, limit: 100 }), [filter], { enabled: filter === 'archived' });
  const workflows = useResource(() => api.workflows(), []);
  useLiveReload(list.data?.items, () => void list.reload());
  const pending = usePending(list.data?.items);
  const phone = useMediaQuery(narrow.phone);

  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const shown = useMemo(() => {
    const base = filter === 'archived' ? (archived.data?.items ?? []) : items.filter(filters[filter]);
    const q = query.trim().toLowerCase();
    return q ? base.filter((i) => `${i.title} ${i.repo ? `${i.repo.owner}/${i.repo.name}` : ''}`.toLowerCase().includes(q)) : base;
  }, [items, archived.data, filter, query]);

  return (
    <Page wide>
      <h1 className={s.title}>すべてのタスク</h1>
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
          <span className="sr-only">タスクを検索</span>
          <TextInput type="search" placeholder="タイトルやリポジトリで探す" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      <ErrorBanner error={list.error} onRetry={() => void list.reload()} />
      {(filter === 'archived' ? !archived.data && !archived.error : !list.data && !list.error) ? (
        <TasksSkeleton phone={phone} />
      ) : shown.length === 0 ? (
        <Empty title={query ? '見つかりませんでした' : 'この条件のタスクはありません'} icon={<IconInbox />}>
          {filter === 'all' && !query && (
            <>
              <Link to="/">新しいタスク</Link>から、最初のタスクを作ってみましょう。
            </>
          )}
        </Empty>
      ) : phone ? (
        <TaskCards items={shown} workflows={workflows.data} pending={pending} />
      ) : (
        <TaskTable items={shown} workflows={workflows.data} pending={pending} />
      )}
    </Page>
  );
}

const HEAD = ['タスク', '状態', 'ワークフロー', '所要', '費用', '更新'] as const;
const TITLE_W = ['72%', '54%', '64%', '46%', '58%', '68%'];

/** 読み込み中の一覧。表（スマホではカード）の見出しと行の高さは本物と同じ */
function TasksSkeleton({ phone }: { phone: boolean }) {
  const rows = Array.from({ length: 6 }, (_, i) => TITLE_W[i] ?? '60%');
  if (phone)
    return (
      <Busy>
        <ul className={s.cards} aria-hidden="true">
          {rows.map((w, i) => (
            <li key={i}>
              <span className={s.cardLink}>
                <span className={s.cardTop}>
                  <span className={s.rowTitle}>
                    <SkeletonText size={13.5} width={w} />
                  </span>
                  <span className={s.cardTime}>
                    <SkeletonText size={12} width={36} />
                  </span>
                </span>
                <span className={s.rowSub}>
                  <SkeletonText size={12} width="45%" />
                </span>
                <span className={s.cardBottom}>
                  <Skeleton width={64} height={22} radius={999} />
                  <Skeleton width={72} height={10} />
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Busy>
    );
  return (
    <Busy>
      <div className={s.tableWrap}>
        <table className={s.table} aria-hidden="true">
          <thead>
            <tr>
              {HEAD.map((h, i) => (
                <th key={h} scope="col" className={i >= 3 ? s.num : undefined}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((w, i) => (
              <tr key={i}>
                <td>
                  <span className={s.rowTitle}>
                    <SkeletonText size={13.5} width={w} />
                  </span>
                  <span className={s.rowSub}>
                    <SkeletonText size={12} width="34%" />
                  </span>
                </td>
                <td>
                  <Skeleton width={64} height={22} radius={999} />
                </td>
                <td>
                  <span className={s.workflowCell}>
                    <Skeleton width={84} height={10} />
                    <span className={s.workflowName}>
                      <SkeletonText size={11.5} width={64} />
                    </span>
                  </span>
                </td>
                <td className={s.num}>
                  <SkeletonText size={13.5} width={40} end />
                </td>
                <td className={s.num}>
                  <SkeletonText size={13.5} width={40} end />
                </td>
                <td className={s.num}>
                  <SkeletonText size={13.5} width={44} end />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Busy>
  );
}

function TaskTable({ items, workflows, pending }: { items: Task[]; workflows: Workflow[] | undefined; pending: Record<string, Pending> }) {
  const navigate = useNavigate();
  return (
    <div className={s.tableWrap}>
      <table className={s.table} aria-label="タスクの一覧">
        <thead>
          <tr>
            <th scope="col">タスク</th>
            <th scope="col">状態</th>
            <th scope="col">ワークフロー</th>
            <th scope="col" className={s.num}>
              所要
            </th>
            <th scope="col" className={s.num}>
              費用
            </th>
            <th scope="col" className={s.num}>
              更新
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const workflow = findWorkflow(workflows, i.workflowRef);
            const p = pending[i.id];
            const done = i.state === 'completed' || i.state === 'failed' || i.state === 'cancelled';
            return (
              <tr key={i.id} onClick={() => void navigate(`/t/${i.id}`)} className={s.row}>
                <td>
                  <Link to={`/t/${i.id}`} className={s.rowTitle} onClick={(e) => e.stopPropagation()}>
                    {i.title}
                  </Link>
                  <span className={s.rowSub}>
                    {i.repo ? `${i.repo.owner}/${i.repo.name}` : 'リポジトリなし'}
                    {i.pullRequest && ` · PR #${i.pullRequest.number}`}
                  </span>
                </td>
                <td>
                  <Tag tone={stateTone[i.state]}>
                    {p?.kind === 'approval' ? `${reasonLabel[p.approval.reason]}の承認待ち` : stateLabel[i.state]}
                  </Tag>
                </td>
                <td>
                  <span className={s.workflowCell}>
                    <StepProgress
                      size="xs"
                      steps={progressFromTask(workflow, i, p?.kind)}
                      label={`${workflow?.title ?? i.workflowRef} の進み具合`}
                    />
                    <span className={s.workflowName}>{workflow?.title ?? i.workflowRef}</span>
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

/** スマホの一覧: 表の代わりに、1件を1枚のカードにする */
function TaskCards({ items, workflows, pending }: { items: Task[]; workflows: Workflow[] | undefined; pending: Record<string, Pending> }) {
  return (
    <ul className={s.cards} aria-label="タスクの一覧">
      {items.map((i) => {
        const workflow = findWorkflow(workflows, i.workflowRef);
        const p = pending[i.id];
        return (
          <li key={i.id}>
            <Link to={`/t/${i.id}`} className={s.cardLink}>
              <span className={s.cardTop}>
                <span className={s.rowTitle}>{i.title}</span>
                <span className={s.cardTime}>{relative(i.updatedAt)}</span>
              </span>
              <span className={s.rowSub}>
                {i.repo ? `${i.repo.owner}/${i.repo.name}` : 'リポジトリなし'}
                {i.pullRequest && ` · PR #${i.pullRequest.number}`}
                {i.costUsd != null && ` · ${usd(i.costUsd)}`}
              </span>
              <span className={s.cardBottom}>
                <Tag tone={stateTone[i.state]}>
                  {p?.kind === 'approval' ? `${reasonLabel[p.approval.reason]}の承認待ち` : stateLabel[i.state]}
                </Tag>
                <StepProgress
                  size="xs"
                  steps={progressFromTask(workflow, i, p?.kind)}
                  label={`${workflow?.title ?? i.workflowRef} の進み具合`}
                />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
