// すべての依頼（ADR-0010）: 絞り込み・検索つきの表。スマホではカードにする。サイドパネルの一覧で足りないときに使う
import type { Line, WorkItem } from '@factory/contracts';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Page } from '../../app/AppShell';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { Empty, ErrorBanner, Loading, Tag, TextInput } from '../../components/kit';
import { IconInbox, IconSearch } from '../../components/icons';
import { StageLine } from '../../components/StageLine';
import { duration, reasonLabel, relative, stateLabel, stateTone, usd } from '../../lib/format';
import { findLine, stepsFromItem } from '../../lib/line';
import { useApi } from '../../lib/services';
import type { Pending } from '../../lib/session';
import { narrow, useMediaQuery } from '../../lib/useMediaQuery';
import { useResource } from '../../lib/useResource';
import { useLiveReload, usePending } from '../home/useLive';
import s from './requests.module.css';

type Filter = 'all' | 'action' | 'running' | 'done' | 'ended' | 'archived';

const filters: Record<Exclude<Filter, 'archived'>, (i: WorkItem) => boolean> = {
  all: () => true,
  action: (i) => i.state === 'awaiting_approval',
  running: (i) => ['queued', 'planning', 'running', 'suspended'].includes(i.state),
  done: (i) => i.state === 'completed',
  ended: (i) => i.state === 'failed' || i.state === 'cancelled',
};

export function RequestsPage() {
  const api = useApi();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const list = useResource(() => api.listWorkItems({ limit: 100 }), [], { pollMs: 20_000 });
  const archived = useResource(() => api.listWorkItems({ archived: true, limit: 100 }), [filter], { enabled: filter === 'archived' });
  const lines = useResource(() => api.lines(), []);
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
      <h1 className={s.title}>すべての依頼</h1>
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
          {filter === 'all' && !query && <><Link to="/">新しい依頼</Link>から、最初の依頼を出してみましょう。</>}
        </Empty>
      ) : phone ? (
        <WorkItemCards items={shown} lines={lines.data} pending={pending} />
      ) : (
        <WorkItemTable items={shown} lines={lines.data} pending={pending} />
      )}
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

/** スマホの一覧: 表の代わりに、1件を1枚のカードにする */
function WorkItemCards({ items, lines, pending }: { items: WorkItem[]; lines: Line[] | undefined; pending: Record<string, Pending> }) {
  return (
    <ul className={s.cards} aria-label="依頼の一覧">
      {items.map((i) => {
        const line = findLine(lines, i.lineRef);
        const p = pending[i.id];
        return (
          <li key={i.id}>
            <Link to={`/w/${i.id}`} className={s.cardLink}>
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
                <Tag tone={stateTone[i.state]}>{p?.kind === 'approval' ? `${reasonLabel[p.approval.reason]}の承認待ち` : stateLabel[i.state]}</Tag>
                <StageLine size="xs" steps={stepsFromItem(line, i, p?.kind)} label={`${line?.title ?? i.lineRef} の進み具合`} />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
