// 会話（左の列）。イベントを畳み込んだタイムラインを、発言・計画・承認・作業のまとめ・成果物として並べる
import type { Workflow, Task } from '@factory/contracts';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Button } from '../../components/ui/button';
import { MessageActions } from '../../components/ui/message-actions';
import { ThinkingLoader } from '../../components/ui/thinking-loader';
import { Avatar, Dot } from '../../components/kit';
import { IconBlock, IconClip, IconDownload, IconExternal, IconEye, IconGlobe, IconPR, IconStop } from '../../components/icons';
import { duration, stepLabel, time, usd } from '../../lib/format';
import type { Entry, Session, ToolState } from '../../lib/session';
import type { Tab } from '../../stores/ui';
import { useUi } from '../../stores/ui';
import { ApprovalCard, PlanCard, type PlanActions } from './Cards';
import s from './workspace.module.css';

export type ConversationProps = {
  item: Task;
  session: Session;
  workflow: Workflow | undefined;
  me: string;
  planActions: PlanActions;
  answerApproval: (approvalId: string, d: 'approve' | 'deny') => Promise<void>;
  openTab: (t: Tab) => void;
  onPublish: () => void;
  onDownload: () => Promise<void>;
  onRetry: (runId: string) => Promise<void>;
};

export function Conversation(p: ConversationProps) {
  const { session } = p;
  const last = session.timeline.at(-1);
  const lastAssistant = [...session.timeline].reverse().find((e) => e.k === 'assistant');
  const streaming = last?.k === 'assistant' && !session.messages[last.id]?.done;
  const toolRunning = Object.values(session.tools).some((t) => t.endedAt === undefined);
  const thinking = !streaming && !toolRunning && (session.state === 'queued' || session.state === 'planning' || session.state === 'running');
  const terminal = session.state === 'completed' || session.state === 'failed' || session.state === 'cancelled';

  return (
    <div className={s.convo}>
      {session.timeline.map((e, i) => (
        <EntryView key={keyOf(e, i)} entry={e} {...p} showActions={terminal && e === lastAssistant} />
      ))}
      {thinking && (
        <div className={s.thinking}>
          <ThinkingLoader
            size="sm"
            variant="plain"
            loop
            interval={1200}
            phases={session.state === 'running' ? ['次の手順を考えています', '結果を確かめています'] : ['タスクを読んでいます', '関係するファイルを確かめています', '計画を立てています']}
          />
        </div>
      )}
      {session.state === 'suspended' && (
        <div className={s.event} data-tone="alert">
          <IconStop /> 中断しています。下の欄から指示を送ると、続きから再開します。
        </div>
      )}
    </div>
  );
}

const keyOf = (e: Entry, i: number) => ('id' in e ? `${e.k}:${e.id}` : e.k === 'plan' ? `plan:${e.version}` : `${e.k}:${i}`);

function EntryView({ entry, showActions, ...p }: ConversationProps & { entry: Entry; showActions: boolean }) {
  const { session } = p;
  switch (entry.k) {
    case 'user': {
      const m = session.messages[entry.id]!;
      return (
        <Msg who="user" name={m.author ?? p.me} at={m.at}>
          <div className={s.msgText}>{m.text}</div>
          {m.attachments && m.attachments.length > 0 && (
            <ul className={s.attachments} aria-label="添付">
              {m.attachments.map((a) => (
                <li key={a}><IconClip /> {a}</li>
              ))}
            </ul>
          )}
        </Msg>
      );
    }
    case 'assistant': {
      const m = session.messages[entry.id]!;
      return (
        <Msg who="agent" at={m.at} actions={showActions && m.done ? m.text : undefined}>
          <div className={s.msgText} aria-live={m.done ? undefined : 'polite'}>
            {m.text}
            {!m.done && <span className={s.caret} aria-hidden="true" />}
          </div>
        </Msg>
      );
    }
    case 'plan': {
      const plan = session.plans[entry.version]!;
      const latest = entry.version === session.latestPlan;
      const actionable = latest && session.state === 'awaiting_approval' && !plan.decision;
      return (
        <div style={{ marginLeft: 38 }}>
          <PlanCard plan={plan} latest={latest} actionable={actionable} actions={p.planActions} />
        </div>
      );
    }
    case 'approval': {
      const a = session.approvals[entry.id]!;
      return (
        <div style={{ marginLeft: 38 }}>
          <ApprovalCard approval={a} actionable={session.state === 'awaiting_approval' && !a.resolved} onAnswer={(d) => p.answerApproval(a.id, d)} />
        </div>
      );
    }
    case 'egress':
      return (
        <div className={s.event} data-tone="alert">
          <IconBlock /> <span><code>{entry.host}</code> への通信を、許可リストで止めました · {time(entry.at)}</span>
        </div>
      );
    case 'work':
      return <WorkRows tools={entry.tools.map((t) => session.tools[t]!).filter(Boolean)} {...p} />;
    case 'end':
      if (entry.state === 'completed') return <Deliverables {...p} />;
      if (entry.state === 'failed') return <Failure {...p} />;
      return (
        <div className={s.event}>
          <IconStop /> {time(entry.at)} に中止しました
        </div>
      );
  }
}

function Msg({ who, name, at, children, actions }: { who: 'user' | 'agent'; name?: string; at: number; children: ReactNode; actions?: string | undefined }) {
  const toast = useUi((u) => u.toast);
  return (
    <div className={s.msg} data-ui-message="">
      <Avatar kind={who === 'agent' ? 'agent' : 'user'} name={name} />
      <div className={s.msgBody}>
        <div className={s.msgName}>
          {who === 'agent' ? 'ファクトリー' : name}
          <span className={s.msgTime}>{time(at)}</span>
        </div>
        {children}
        {actions !== undefined && (
          <MessageActions
            text={actions}
            actions={['copy', 'feedback']}
            reasons={['内容が正しくない', '依頼どおりではない', '説明が長い', 'Other']}
            onFeedback={(k) => k && toast('フィードバックを送りました。ありがとうございます。')}
          />
        )}
      </div>
    </div>
  );
}

/** 作業のまとめ: ステップの実行ごとに1行（細かい内容は実行ログのタブで見る） */
function WorkRows({ tools, session, workflow, openTab }: ConversationProps & { tools: ToolState[] }) {
  const approvedAt = Object.values(session.plans).find((pl) => pl.decision?.decision === 'approved')?.decision?.at ?? Infinity;
  const groups: { key: string; label: string; image?: string | undefined; tools: ToolState[] }[] = [];
  for (const t of tools) {
    const run = session.runs.find((r) => r.runId === t.runId);
    const planning = t.startedAt < approvedAt && session.runs.indexOf(run!) === 0;
    const key = planning ? 'planning' : (t.runId ?? 'none');
    let g = groups.find((x) => x.key === key);
    if (!g) {
      const stepId = run?.stepId ?? '';
      const n = run ? Number(run.runId.split('#')[1]) : 1;
      g = { key, label: planning ? '計画のための確認' : `${stepLabel(stepId)}${n > 1 ? `（${n} 回目）` : ''}`, image: planning ? undefined : workflow?.steps.find((st) => st.id === stepId)?.image, tools: [] };
      groups.push(g);
    }
    g.tools.push(t);
  }
  return (
    <div className={s.workRows} role="list" aria-label="作業のまとめ">
      {groups.map((g) => {
        const running = g.tools.find((t) => t.endedAt === undefined);
        const failed = g.tools.findLast((t) => t.ok === false);
        const lastDone = g.tools.findLast((t) => t.endedAt !== undefined);
        return (
          <div key={g.key} className={s.workRow} role="listitem">
            <Dot tone={running ? 'run' : failed && failed === lastDone ? 'err' : 'ok'} />
            <span className={s.workLabel}>
              {g.label}
              {g.image && <span>{g.image}</span>}
            </span>
            {running ? (
              <ThinkingLoader size="sm" variant="plain" phases={[running.summary]} />
            ) : (
              <span className={s.workText} data-tone={failed && failed === lastDone ? 'err' : undefined} title={lastDone?.result ?? lastDone?.summary}>
                {g.tools.length} 件の作業 · {lastDone?.result ?? lastDone?.summary}
              </span>
            )}
            <button type="button" className={s.workMore} onClick={() => openTab('log')}>
              ログ
            </button>
          </div>
        );
      })}
    </div>
  );
}

function Deliverables({ item, session, workflow, openTab, onPublish, onDownload }: ConversationProps) {
  const publishable = workflow?.steps.some((st) => st.action === 'propose-publish') || Object.keys(session.tools).length > 0;
  const rows: { icon: ReactNode; title: string; detail: string; action: ReactNode }[] = [];
  if (session.preview) rows.push({ icon: <IconEye />, title: 'プレビュー', detail: `VM の中で動いているアプリ（ポート ${session.preview.port}）を開けます`, action: <Button size="sm" variant="secondary" onClick={() => openTab('preview')}>開く</Button> });
  if (item.pullRequest)
    rows.push({
      icon: <IconPR />, title: `プルリクエスト #${item.pullRequest.number}`, detail: `${item.branch ?? ''} → ${item.repo?.baseBranch ?? 'main'}`,
      action: <a className={s.workMore} href={item.pullRequest.url} target="_blank" rel="noreferrer">GitHub で開く <IconExternal /></a>,
    });
  if (publishable) rows.push({ icon: <IconGlobe />, title: '社内に公開', detail: '公開の前のチェックをしてから、範囲と期限を選んで公開します', action: <Button size="sm" variant="secondary" onClick={onPublish}>公開する</Button> });
  rows.push({ icon: <IconDownload />, title: 'ダウンロード', detail: 'ワークスペースのファイル一式（zip）', action: <DownloadButton onDownload={onDownload} /> });
  return (
    <div style={{ marginLeft: 38 }}>
      <section className={s.tray} aria-label="成果物">
        <header className={s.trayHead}>
          <span className={s.badge} data-tone="ok">完了</span>
          <span>成果物</span>
          <span className={s.trayRight}>所要 {duration(Date.parse(item.updatedAt) - Date.parse(item.createdAt))} · {usd(item.costUsd)}</span>
        </header>
        <div className={s.card}>
          {rows.map((r) => (
            <div key={r.title} className={s.deliverRow}>
              <span className={s.deliverIcon}>{r.icon}</span>
              <span className={s.deliverBody}>
                <span className={s.deliverTitle}>{r.title}</span>
                <span className={s.deliverDetail}>{r.detail}</span>
              </span>
              {r.action}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function DownloadButton({ onDownload }: { onDownload: () => Promise<void> }) {
  const busy = useRef(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        if (busy.current) return;
        busy.current = true;
        void onDownload().finally(() => (busy.current = false));
      }}
    >
      保存
    </Button>
  );
}

function Failure({ session, openTab, onRetry }: ConversationProps) {
  const failedRun = session.runs.findLast((r) => r.state === 'failed');
  const failedTool = failedRun ? failedRun.tools.map((t) => session.tools[t]).findLast((t) => t?.ok === false) : undefined;
  return (
    <div style={{ marginLeft: 38 }}>
      <section className={s.tray} aria-label="失敗">
        <header className={s.trayHead}>
          <span className={s.badge} data-tone="err">失敗</span>
          <span>ワークフローが止まりました</span>
          {failedRun && <span className={s.trayRight}>{stepLabel(failedRun.stepId)} · {failedRun.runId}</span>}
        </header>
        <div className={s.card}>
          <p className={s.failText}>{failedRun ? `${stepLabel(failedRun.stepId)}のステップが失敗しました。` : '作業が止まりました。'}原因を直してから、やり直せます。</p>
          {failedTool && <div className={s.failReason}>{failedTool.summary} → {failedTool.result}</div>}
          <div className={s.actions}>
            <span className={s.actionsHint}>やり直すと、同じステップを新しい VM で実行します</span>
            <Button size="sm" variant="secondary" onClick={() => openTab('log')}>実行ログを見る</Button>
            {failedRun && <Button size="sm" onClick={() => void onRetry(failedRun.runId)}>やり直す</Button>}
          </div>
        </div>
      </section>
    </div>
  );
}

/** 一番下に近いときだけ、新しい内容に合わせてスクロールする */
export function useStickToBottom<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return ref;
}
