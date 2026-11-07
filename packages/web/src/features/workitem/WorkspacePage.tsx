// ワークアイテムの画面（パターン B: ADR-0007）。左に会話、右に成果物のタブ、下にステータスバー
import type { Line, WorkItem } from '@factory/contracts';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { Banner, Dot, ErrorBanner, IconButton, Loading, Menu, Tag } from '../../components/kit';
import { IconBranch, IconChevron, IconClose, IconExternal, IconMore, IconPanel, IconPR, IconRepo } from '../../components/icons';
import { StageLine } from '../../components/StageLine';
import { errorMessage } from '../../lib/api';
import { saveFromUrl } from '../../lib/download';
import type { ConnectionState } from '../../lib/events';
import { duration, isTerminal, reasonLabel, stageLabel, stateLabel, stateTone, tokens, usd } from '../../lib/format';
import { stepsFromSession } from '../../lib/line';
import { useServices } from '../../lib/services';
import { currentRun, type Pending, type Session } from '../../lib/session';
import { useResource } from '../../lib/useResource';
import { useMe } from '../../stores/me';
import { useUi, type Tab } from '../../stores/ui';
import type { PlanActions } from './Cards';
import { Composer } from './Composer';
import { Conversation, useStickToBottom } from './Conversation';
import { ConfirmDialog, PublishDialog, RenameDialog } from './Dialogs';
import { ChangesTab, FilesTab, LogTab, PlanTab, PreviewTab } from './tabs/Tabs';
import { useWorkspace } from './useWorkspace';
import s from './workspace.module.css';

export function WorkspacePage() {
  const { id = '' } = useParams();
  const { api } = useServices();
  const me = useMe((m) => m.me)!;
  const toast = useUi((u) => u.toast);
  const { item, line, session, state, pending, historyError } = useWorkspace(id);
  const tabState = useUi((u) => u.tabs[id]);
  const pickTab = useUi((u) => u.pickTab);
  const [panelOpen, setPanelOpen] = useState(false);
  const [dialog, setDialog] = useState<null | 'publish' | 'rename' | 'cancel'>(null);
  const diff = useResource(() => api.diff(id), [id, session?.fileVersion ?? 0, state === 'completed'], { enabled: !!item.data });
  const lastEntry = session?.timeline.at(-1);
  const scroller = useStickToBottom<HTMLDivElement>(`${session?.timeline.length ?? 0}:${lastEntry?.k === 'assistant' ? session?.messages[lastEntry.id]?.text.length : ''}:${lastEntry?.k === 'work' ? lastEntry.tools.length : ''}:${session?.state}`);

  useEffect(() => setPanelOpen(false), [id]);

  if (item.error && !item.data) {
    return (
      <div style={{ padding: 28, maxWidth: 720, margin: '0 auto', display: 'grid', gap: 12 }}>
        <ErrorBanner error={item.error} onRetry={() => void item.reload()} />
        <Link to="/">依頼の一覧に戻る</Link>
      </div>
    );
  }
  if (!item.data || !session) return <Loading />;
  const wi = item.data;
  const tab: Tab = tabState?.tab ?? 'plan';
  const openTab = (t: Tab) => {
    pickTab(id, t);
    setPanelOpen(true);
  };

  const guard = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok, 'ok');
    } catch (e) {
      toast(errorMessage(e), 'err');
      throw e;
    }
  };
  const planActions: PlanActions = {
    approve: () => guard(() => api.approvePlan(id, session.latestPlan!), '計画を承認しました。作業を始めます。'),
    requestChanges: (c) => guard(() => api.requestChanges(id, session.latestPlan!, c)),
    reject: () => guard(() => api.rejectPlan(id, session.latestPlan!)),
  };
  const answerApproval = (aid: string, d: 'approve' | 'deny') => guard(() => api.answerApproval(id, aid, { decision: d }));
  const retry = (runId: string) => guard(() => api.retryStage(id, runId), 'やり直します');
  const download = async () => {
    try {
      const d = await api.download(id, { format: 'zip' });
      await saveFromUrl(d.url, d.fileName);
    } catch (e) {
      toast(errorMessage(e), 'err');
    }
  };
  const send = async (text: string, attachments: string[]) => {
    if (pending?.kind === 'plan') await api.requestChanges(id, pending.version, text);
    else await api.postMessage(id, text, attachments);
  };

  const hint = tabState?.hint ?? null;
  const tabOptions: { value: Tab; label: string; count?: number; badge?: React.ReactNode }[] = [
    { value: 'preview', label: 'プレビュー', ...(hint === 'preview' ? { badge: <Dot tone="run" label="新しい内容" /> } : {}) },
    { value: 'changes', label: '変更', ...(diff.data?.files.length ? { count: diff.data.files.length } : {}), ...(hint === 'changes' ? { badge: <Dot tone="run" label="新しい内容" /> } : {}) },
    { value: 'files', label: 'ファイル' },
    { value: 'plan', label: '計画', ...(hint === 'plan' ? { badge: <Dot tone="alert" label="対応が必要" /> } : {}) },
    { value: 'log', label: '実行ログ', ...(hint === 'log' ? { badge: <Dot tone="run" label="新しい内容" /> } : {}) },
  ];

  return (
    <div className={s.page}>
      <Header
        item={wi}
        session={session}
        line={line}
        pending={pending}
        onTogglePanel={() => setPanelOpen((o) => !o)}
        onRename={() => setDialog('rename')}
        onCancel={() => setDialog('cancel')}
        onArchive={() =>
          void guard(async () => {
            await api.updateWorkItem(id, { archived: !wi.archived });
            await item.reload();
          }, wi.archived ? 'アーカイブから戻しました' : 'アーカイブしました')
        }
        onInterrupt={() => void guard(() => api.interrupt(id)).catch(() => undefined)}
      />
      {historyError && <Banner tone="err">イベントの履歴を読み込めませんでした: {historyError}</Banner>}
      <div className={s.body}>
        <section className={s.chat} aria-label="会話">
          <div className={s.chatScroll} ref={scroller}>
            <Conversation
              item={wi}
              session={session}
              line={line}
              me={me.name}
              planActions={planActions}
              answerApproval={answerApproval}
              openTab={openTab}
              onPublish={() => setDialog('publish')}
              onDownload={download}
              onRetry={retry}
            />
          </div>
          <div className={s.chatComposer}>
            <Composer state={state} pending={pending} onSend={send} onInterrupt={async () => { await api.interrupt(id); }} upload={(f) => api.upload(f, id)} />
          </div>
        </section>

        <section className={s.work} data-open={panelOpen || undefined} aria-label="成果物">
          <div className={s.tabs}>
            <SegmentedControl<Tab> variant="underline" kind="tabs" size="sm" aria-label="成果物の表示" value={tab} onChange={(v) => pickTab(id, v)} options={tabOptions.map((o) => ({ ...o, controls: `panel-${o.value}` }))} />
            <span className={s.panelClose}>
              <IconButton label="閉じる" onClick={() => setPanelOpen(false)}><IconClose /></IconButton>
            </span>
          </div>
          <div className={s.panel} id={`panel-${tab}`} role="tabpanel">
            {tab === 'preview' && <PreviewTab item={wi} session={session} />}
            {tab === 'changes' && <ChangesTab diff={diff} />}
            {tab === 'files' && <FilesTab item={wi} version={session.fileVersion} onPublish={() => setDialog('publish')} />}
            {tab === 'plan' && <PlanTab session={session} line={line} actions={planActions} />}
            {tab === 'log' && <LogTab item={wi} session={session} line={line} onRetry={retry} />}
          </div>
        </section>
      </div>
      <StatusBar item={wi} session={session} line={line} />

      <PublishDialog open={dialog === 'publish'} item={wi} onClose={() => setDialog(null)} />
      <RenameDialog open={dialog === 'rename'} item={wi} onClose={() => setDialog(null)} onSaved={() => void item.reload()} />
      <ConfirmDialog
        open={dialog === 'cancel'}
        title="ライン全体を中止しますか？"
        body="動いている VM を止めて、この依頼を中止します。ここまでのファイルは残りますが、続きから再開することはできません。"
        confirm="中止する"
        danger
        onConfirm={() => guard(() => api.cancel(id), '中止しました').catch(() => undefined)}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}

function Header({ item, session, line, pending, onTogglePanel, onRename, onCancel, onArchive, onInterrupt }: {
  item: WorkItem; session: Session; line: Line | undefined; pending: Pending | null;
  onTogglePanel: () => void; onRename: () => void; onCancel: () => void; onArchive: () => void; onInterrupt: () => void;
}) {
  const { api } = useServices();
  const navigate = useNavigate();
  const recent = useResource(() => api.listWorkItems({ limit: 8 }), []);
  const state = session.state ?? item.state;
  const label = pending?.kind === 'approval' ? `${reasonLabel[pending.approval.reason]}の承認待ち` : stateLabel[state];
  return (
    <header className={s.head}>
      <nav className={s.crumbs} aria-label="場所">
        <Link to="/" className={s.crumb}>依頼</Link>
        <IconChevron />
        {item.repo && (
          <>
            <span className={s.crumb}><IconRepo /> {item.repo.owner}/{item.repo.name}</span>
            <IconChevron />
          </>
        )}
        {item.branch && (
          <>
            <span className={`${s.crumb} mono`}><IconBranch /> {item.branch}</span>
            <IconChevron />
          </>
        )}
        <h1 className={s.title} title={item.title}>{item.title}</h1>
        <Menu
          label="ほかの依頼に切り替える"
          align="start"
          trigger={<IconChevron />}
          items={(recent.data?.items ?? []).filter((w) => w.id !== item.id).map((w) => ({ label: `${w.title}（${stateLabel[w.state]}）`, onSelect: () => void navigate(`/w/${w.id}`) }))}
        />
      </nav>
      <Tag tone={stateTone[state]}>{label}</Tag>
      <div className={s.headRight}>
        <div className={s.headLine}><StageLine size="sm" steps={stepsFromSession(line, session)} /></div>
        {item.pullRequest ? (
          <Button size="sm" variant="secondary" icon={<IconPR />} iconRight={<IconExternal />} onClick={() => window.open(item.pullRequest!.url, '_blank', 'noopener')}>
            PR #{item.pullRequest.number}
          </Button>
        ) : item.repo ? (
          <Button size="sm" variant="secondary" icon={<IconPR />} disabled>PR はまだありません</Button>
        ) : null}
        <span className={s.panelToggle}>
          <Button size="sm" variant="secondary" icon={<IconPanel />} onClick={onTogglePanel}>成果物</Button>
        </span>
        <Menu
          label="その他の操作"
          trigger={<IconMore />}
          items={[
            { label: '名前を変更', onSelect: onRename },
            { label: item.archived ? 'アーカイブから戻す' : 'アーカイブ', onSelect: onArchive },
            { label: '作業を中断', onSelect: onInterrupt, disabled: !(state === 'running' || state === 'planning') },
            { label: 'ライン全体を中止', onSelect: onCancel, danger: true, disabled: isTerminal(state) },
          ]}
        />
      </div>
    </header>
  );
}

function StatusBar({ item, session, line }: { item: WorkItem; session: Session; line: Line | undefined }) {
  const { events } = useServices();
  const [conn, setConn] = useState<ConnectionState>(events.state);
  const [now, setNow] = useState(Date.now());
  useEffect(() => events.onState(setConn), [events]);
  const state = session.state ?? item.state;
  const terminal = isTerminal(state);
  useEffect(() => {
    if (terminal) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [terminal]);
  const run = currentRun(session);
  const stage = line?.stages.find((st) => st.id === run?.stageId);
  const vmCount = session.runs.filter((r) => line?.stages.find((st) => st.id === r.stageId)?.image).length;
  const vm =
    run?.state === 'running' && !terminal
      ? state === 'awaiting_approval' || state === 'suspended'
        ? <><Dot tone="alert" /> VM 待機中: {stageLabel(run.stageId)} · <span className="mono">{stage?.image}</span></>
        : <><Dot tone="run" /> VM 実行中: {stageLabel(run.stageId)} · <span className="mono">{stage?.image}</span></>
      : vmCount
        ? <><Dot tone="ok" /> VM はすべて停止しました（{vmCount} 台 · 合計 {duration(session.usage.vmSeconds * 1000)}）</>
        : <><Dot /> VM は起動していません</>;
  const end = terminal ? Date.parse(item.updatedAt) : now;
  return (
    <footer className={s.status}>
      <span>{vm}</span>
      <span>通信: {stage?.network && !terminal ? <><span className="mono">{stage.network}</span>（許可リストのみ）</> : '許可リストのみ'}</span>
      {session.blocked.length > 0 && <span data-tone="alert">止めた通信 {session.blocked.length} 件</span>}
      <span>トークン {tokens(session.usage.inputTokens + session.usage.outputTokens)} · {usd(item.costUsd)}</span>
      <span className={s.statusRight}>
        {conn !== 'open' && <span data-tone="alert">{conn === 'reconnecting' ? '再接続しています… ' : '接続しています… '}</span>}
        経過 {duration(end - Date.parse(item.createdAt))}
      </span>
    </footer>
  );
}
