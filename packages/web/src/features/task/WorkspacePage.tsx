// タスクの画面（パターン B: ADR-0007）。左に会話、右に成果物のタブ、下にステータスバー
import type { Workflow, Task } from '@factory/contracts';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { Avatar, Banner, Dot, ErrorBanner, Menu, Tag } from '../../components/kit';
import { Busy, Skeleton, SkeletonLines, SkeletonText } from '../../components/skeletons';
import { IconBranch, IconChevron, IconExternal, IconMore, IconPR, IconRepo, IconSend } from '../../components/icons';
import { StepProgress } from '../../components/StepProgress';
import { errorMessage } from '../../lib/api';
import { saveFromUrl } from '../../lib/download';
import type { ConnectionState } from '../../lib/events';
import { isTerminal, reasonLabel, stepLabel, stateLabel, stateTone, tokens, usd } from '../../lib/format';
import { progressFromSession } from '../../lib/workflow';
import { useServices } from '../../lib/services';
import { currentRun, type Pending, type Session } from '../../lib/session';
import { narrow, useMediaQuery } from '../../lib/useMediaQuery';
import { useResource } from '../../lib/useResource';
import { LogoToggle } from '../../app/LogoToggle';
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
  const { item, workflow, session, state, pending, historyError } = useWorkspace(id);
  const tabState = useUi((u) => u.tabs[id]);
  const pickTab = useUi((u) => u.pickTab);
  /** 1024px 未満では、会話と成果物のどちらか一方を出す（06_ui_spec.md §6） */
  const [view, setView] = useState<'chat' | 'work'>('chat');
  const compact = useMediaQuery(narrow.tablet);
  const [dialog, setDialog] = useState<null | 'publish' | 'rename' | 'cancel'>(null);
  const diff = useResource(() => api.diff(id), [id, session?.fileVersion ?? 0, state === 'completed'], { enabled: !!item.data });
  const lastEntry = session?.timeline.at(-1);
  const scroller = useStickToBottom<HTMLDivElement>(`${session?.timeline.length ?? 0}:${lastEntry?.k === 'assistant' ? session?.messages[lastEntry.id]?.text.length : ''}:${lastEntry?.k === 'work' ? lastEntry.tools.length : ''}:${session?.state}`);

  useEffect(() => setView('chat'), [id]);

  if (item.error && !item.data) {
    return (
      <div style={{ padding: 28, maxWidth: 720, margin: '0 auto', display: 'grid', gap: 12 }}>
        <ErrorBanner error={item.error} onRetry={() => void item.reload()} />
        <Link to="/tasks">タスクの一覧に戻る</Link>
      </div>
    );
  }
  if (!item.data || !session) return <WorkspaceSkeleton id={id} />;
  const current = item.data;
  const tab: Tab = tabState?.tab ?? 'plan';
  const openTab = (t: Tab) => {
    pickTab(id, t);
    setView('work');
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
  const retry = (runId: string) => guard(() => api.retryStep(id, runId), 'やり直します');
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
  const tabOptions: TabOption[] = [
    { value: 'preview', label: 'プレビュー', ...(hint === 'preview' ? { badge: <Dot tone="run" label="新しい内容" /> } : {}) },
    { value: 'changes', label: '変更', ...(diff.data?.files.length ? { count: diff.data.files.length } : {}), ...(hint === 'changes' ? { badge: <Dot tone="run" label="新しい内容" /> } : {}) },
    { value: 'files', label: 'ファイル' },
    { value: 'plan', label: '計画', ...(hint === 'plan' ? { badge: <Dot tone="alert" label="対応が必要" /> } : {}) },
    { value: 'log', label: '実行ログ', ...(hint === 'log' ? { badge: <Dot tone="run" label="新しい内容" /> } : {}) },
  ];

  return (
    <div className={s.page}>
      <Header
        item={current}
        session={session}
        workflow={workflow}
        pending={pending}
        onRename={() => setDialog('rename')}
        onCancel={() => setDialog('cancel')}
        onArchive={() =>
          void guard(async () => {
            await api.updateTask(id, { archived: !current.archived });
            await item.reload();
          }, current.archived ? 'アーカイブから戻しました' : 'アーカイブしました')
        }
        onInterrupt={() => void guard(() => api.interrupt(id)).catch(() => undefined)}
      />
      {historyError && <Banner tone="err">イベントの履歴を読み込めませんでした: {historyError}</Banner>}
      {compact && (
        <div className={s.views}>
          <SegmentedControl<'chat' | 'work'>
            size="sm"
            kind="tabs"
            fullWidth
            aria-label="表示の切り替え"
            value={view}
            onChange={setView}
            options={[
              { value: 'chat', label: '会話', controls: 'view-chat' },
              {
                value: 'work',
                label: '成果物',
                controls: 'view-work',
                ...(hint ? { badge: <Dot tone={hint === 'plan' ? 'alert' : 'run'} label={hint === 'plan' ? '対応が必要' : '新しい内容'} /> } : {}),
              },
            ]}
          />
        </div>
      )}
      <div className={s.body} data-view={compact ? view : undefined}>
        <section className={s.chat} id="view-chat" aria-label="会話">
          <div className={s.chatScroll} ref={scroller}>
            <Conversation
              item={current}
              session={session}
              workflow={workflow}
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

        <section className={s.work} id="view-work" aria-label="成果物">
          <div className={s.tabs}>
            <SegmentedControl<Tab> variant="underline" kind="tabs" size="sm" aria-label="成果物の表示" value={tab} onChange={(v) => pickTab(id, v)} options={tabOptions.map((o) => ({ ...o, controls: `panel-${o.value}` }))} />
          </div>
          <div className={s.panel} id={`panel-${tab}`} role="tabpanel">
            {tab === 'preview' && <PreviewTab item={current} session={session} />}
            {tab === 'changes' && <ChangesTab diff={diff} />}
            {tab === 'files' && <FilesTab item={current} version={session.fileVersion} onPublish={() => setDialog('publish')} />}
            {tab === 'plan' && <PlanTab session={session} workflow={workflow} actions={planActions} />}
            {tab === 'log' && <LogTab item={current} session={session} workflow={workflow} onRetry={retry} />}
          </div>
        </section>
      </div>
      <StatusBar item={current} session={session} workflow={workflow} />

      <PublishDialog open={dialog === 'publish'} item={current} onClose={() => setDialog(null)} />
      <RenameDialog open={dialog === 'rename'} item={current} onClose={() => setDialog(null)} onSaved={() => void item.reload()} />
      <ConfirmDialog
        open={dialog === 'cancel'}
        title="ワークフロー全体を中止しますか？"
        body="動いている VM を止めて、このタスクを中止します。ここまでのファイルは残りますが、続きから再開することはできません。"
        confirm="中止する"
        danger
        onConfirm={() => guard(() => api.cancel(id), '中止しました').catch(() => undefined)}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}

type TabOption = { value: Tab; label: string; count?: number; badge?: React.ReactNode };
const TAB_LABELS: TabOption[] = [
  { value: 'preview', label: 'プレビュー' },
  { value: 'changes', label: '変更' },
  { value: 'files', label: 'ファイル' },
  { value: 'plan', label: '計画' },
  { value: 'log', label: '実行ログ' },
];

/**
 * 読み込み中のワークスペース。ヘッダー・会話・入力欄・タブ・ステータスバーを本物と同じ部品と大きさで先に出し、
 * 中身だけを枠にする（届いたときに位置がずれないように）
 */
export function WorkspaceSkeleton({ id }: { id?: string }) {
  const compact = useMediaQuery(narrow.tablet);
  const phone = useMediaQuery(narrow.phone);
  const openSidebar = useUi((u) => u.setSidebarOverlay);
  const tabState = useUi((u) => (id ? u.tabs[id] : undefined));
  const pickTab = useUi((u) => u.pickTab);
  const [view, setView] = useState<'chat' | 'work'>('chat');
  const tab: Tab = tabState?.tab ?? 'plan';
  return (
    <Busy className={s.page} label="タスクを読み込んでいます">
      <header className={s.head}>
        {phone && (
          <span className={s.back}><LogoToggle label="サイドパネルを開く" expanded={false} onClick={() => openSidebar(true)} /></span>
        )}
        <span className={s.crumbs}>
          {!compact && <><SkeletonText size={13} width={44} /><IconChevron /></>}
          <span className={s.title}><SkeletonText width={phone ? 140 : 220} /></span>
        </span>
        <span className={s.headTag}><Skeleton width={72} height={22} radius={999} /></span>
        <div className={s.headRight}>
          {!phone && <Skeleton width={128} height={32} radius={10} />}
          <Skeleton width={30} height={30} radius={9} />
        </div>
      </header>
      {compact && (
        <div className={s.views}>
          <SegmentedControl<'chat' | 'work'> size="sm" kind="tabs" fullWidth aria-label="表示の切り替え" value={view} onChange={setView} options={[{ value: 'chat', label: '会話' }, { value: 'work', label: '成果物' }]} />
        </div>
      )}
      <div className={s.body} data-view={compact ? view : undefined}>
        <section className={s.chat} aria-label="会話">
          <div className={s.chatScroll}>
            <div className={s.convo} aria-hidden="true">
              <MessageSkeleton lines={2} />
              <MessageSkeleton agent lines={3} />
              <div className={s.tray}>
                <div className={s.trayHead}><SkeletonText size={13} width={96} /></div>
                <div className={s.card}>
                  <SkeletonLines lines={2} size={14.5} last="70%" />
                  <SkeletonLines lines={3} size={13.5} last="45%" />
                </div>
              </div>
            </div>
          </div>
          <div className={s.chatComposer} aria-hidden="true">
            <div className={s.composer}>
              <div className={s.composerCard}>
                <textarea className={s.composerInput} rows={2} disabled tabIndex={-1} placeholder="読み込んでいます…" />
                <div className={s.composerBar}>
                  <Skeleton width={30} height={30} radius={9} />
                  <span className={s.spacer} />
                  <span className={s.kbd}>⌘ / Ctrl + Enter</span>
                  <Button size="sm" icon={<IconSend />} disabled tabIndex={-1}>送信</Button>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className={s.work} aria-label="成果物">
          <div className={s.tabs}>
            <SegmentedControl<Tab> variant="underline" kind="tabs" size="sm" aria-label="成果物の表示" value={tab} onChange={(v) => id && pickTab(id, v)} options={TAB_LABELS} />
          </div>
          <div className={s.panel} aria-hidden="true">
            <div className={s.skeletonPad}>
              <SkeletonText size={15} width="40%" />
              <SkeletonLines lines={4} size={13.5} />
              <SkeletonLines lines={3} size={13.5} last="35%" />
            </div>
          </div>
        </section>
      </div>
      <footer className={s.status} aria-hidden="true">
        <span><SkeletonText size={12} width={140} /></span>
        <span><SkeletonText size={12} width={120} /></span>
      </footer>
    </Busy>
  );
}

function MessageSkeleton({ agent = false, lines }: { agent?: boolean; lines: number }) {
  return (
    <div className={s.msg} style={{ animation: 'none' }}>
      {agent ? <Avatar kind="agent" size={28} /> : <Skeleton width={28} circle />}
      <div className={s.msgBody}>
        <span className={s.msgName}><SkeletonText size={12.5} width={agent ? 88 : 56} /></span>
        <SkeletonLines lines={lines} size={14} last={agent ? '55%' : '40%'} />
      </div>
    </div>
  );
}

function Header({ item, session, workflow, pending, onRename, onCancel, onArchive, onInterrupt }: {
  item: Task; session: Session; workflow: Workflow | undefined; pending: Pending | null;
  onRename: () => void; onCancel: () => void; onArchive: () => void; onInterrupt: () => void;
}) {
  const phone = useMediaQuery(narrow.phone);
  const openSidebar = useUi((u) => u.setSidebarOverlay);
  const pr = item.pullRequest;
  const state = session.state ?? item.state;
  const label = pending?.kind === 'approval' ? `${reasonLabel[pending.approval.reason]}の承認待ち` : stateLabel[state];
  return (
    <header className={s.head}>
      {phone && (
        <span className={s.back}><LogoToggle label="サイドパネルを開く" expanded={false} onClick={() => openSidebar(true)} /></span>
      )}
      <nav className={s.crumbs} aria-label="場所">
        <Link to="/tasks" className={s.crumb}>タスク</Link>
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
      </nav>
      <span className={s.headTag}><Tag tone={stateTone[state]}>{label}</Tag></span>
      <div className={s.headRight}>
        <div className={s.headLine}><StepProgress size="sm" steps={progressFromSession(workflow, session)} /></div>
        {phone ? null : item.pullRequest ? (
          <Button size="sm" variant="secondary" icon={<IconPR />} iconRight={<IconExternal />} onClick={() => window.open(item.pullRequest!.url, '_blank', 'noopener')}>
            PR #{item.pullRequest.number}
          </Button>
        ) : item.repo ? (
          <Button size="sm" variant="secondary" icon={<IconPR />} disabled>PR はまだありません</Button>
        ) : null}
        <Menu
          label="その他の操作"
          trigger={<IconMore />}
          items={[
            ...(phone && pr ? [{ label: `PR #${pr.number} を開く`, onSelect: () => void window.open(pr.url, '_blank', 'noopener') }] : []),
            { label: '名前を変更', onSelect: onRename },
            { label: item.archived ? 'アーカイブから戻す' : 'アーカイブ', onSelect: onArchive },
            { label: '作業を中断', onSelect: onInterrupt, disabled: !(state === 'running' || state === 'planning') },
            { label: 'ワークフロー全体を中止', onSelect: onCancel, danger: true, disabled: isTerminal(state) },
          ]}
        />
      </div>
    </header>
  );
}

/** 下のステータスバー: 動いている VM・通信・トークンと費用。VM が止まった後の合計や経過時間は出さない */
function StatusBar({ item, session, workflow }: { item: Task; session: Session; workflow: Workflow | undefined }) {
  const { events } = useServices();
  const [conn, setConn] = useState<ConnectionState>(events.state);
  useEffect(() => events.onState(setConn), [events]);
  const state = session.state ?? item.state;
  const terminal = isTerminal(state);
  const run = currentRun(session);
  const step = workflow?.steps.find((st) => st.id === run?.stepId);
  const vm =
    run?.state === 'running' && !terminal
      ? state === 'awaiting_approval' || state === 'suspended'
        ? <><Dot tone="alert" /> VM 待機中: {stepLabel(run.stepId)} · <span className="mono">{step?.image}</span></>
        : <><Dot tone="run" /> VM 実行中: {stepLabel(run.stepId)} · <span className="mono">{step?.image}</span></>
      : null;
  return (
    <footer className={s.status}>
      {vm && <span className={s.statusKeep}>{vm}</span>}
      <span>通信: {step?.network && !terminal ? <><span className="mono">{step.network}</span>（許可リストのみ）</> : '許可リストのみ'}</span>
      {session.blocked.length > 0 && <span data-tone="alert">止めた通信 {session.blocked.length} 件</span>}
      <span>トークン {tokens(session.usage.inputTokens + session.usage.outputTokens)} · {usd(item.costUsd)}</span>
      {conn !== 'open' && (
        <span className={`${s.statusRight} ${s.statusKeep}`} data-tone="alert">{conn === 'reconnecting' ? '再接続しています…' : '接続しています…'}</span>
      )}
    </footer>
  );
}
