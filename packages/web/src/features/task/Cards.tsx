// 会話と計画タブで使うカード: 計画（承認・修正の依頼・却下）と、再承認
import { useId, useState } from 'react';
import { Button } from '../../components/ui/button';
import { TextArea } from '../../components/kit';
import { IconCheck, IconChevron, IconClose, IconGlobe, IconWarning } from '../../components/icons';
import { reasonLabel, time, usd } from '../../lib/format';
import type { ApprovalState, PlanState } from '../../lib/session';
import s from './workspace.module.css';

export type PlanActions = {
  approve: () => Promise<void>;
  requestChanges: (comment: string) => Promise<void>;
  reject: () => Promise<void>;
};

export function PlanCard({ plan, actionable, latest, actions, defaultDetails = false }: { plan: PlanState; actionable: boolean; latest: boolean; actions?: PlanActions; defaultDetails?: boolean }) {
  const [mode, setMode] = useState<'idle' | 'changes' | 'reject'>('idle');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<null | 'approve' | 'changes' | 'reject'>(null);
  const commentId = useId();
  const p = plan.plan;
  const d = plan.decision;
  const superseded = !latest && !d;
  const tone = d?.decision === 'approved' ? 'ok' : d?.decision === 'rejected' ? 'err' : d ? undefined : superseded ? undefined : 'alert';
  const badge = d?.decision === 'approved' ? '承認済み' : d?.decision === 'rejected' ? '却下' : d?.decision === 'changes_requested' ? '修正を依頼' : superseded ? '古い版' : '承認待ち';
  const folded = !latest; // 古い版は要約だけを出す

  const run = async (kind: 'approve' | 'changes' | 'reject', fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
      setMode('idle');
      setComment('');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={s.tray} data-muted={folded || undefined} aria-label={`計画 第${plan.version}版`}>
      <header className={s.trayHead}>
        <span className={s.badge} data-tone={tone}>{badge}</span>
        <span>計画 第{plan.version}版 · {p.steps.length} ステップ</span>
        <span className={s.trayRight}>見積もり 約{p.estimate.minutes}分 · {usd(p.estimate.usd)}</span>
      </header>
      <div className={s.card}>
        <p className={s.summary}>{p.summaryForHumans}</p>
        {!folded && (
          <>
            <ol className={s.steps} aria-label="手順">
              {p.steps.map((st, i) => (
                <li key={i} className={s.step}>
                  <span className={s.stepNum}>{i + 1}</span>
                  <span>{st}</span>
                </li>
              ))}
            </ol>
            <details className={s.details} open={defaultDetails || p.externalAccess.length > 0 || undefined}>
              <summary>
                <IconChevron /> 目的・成果物・完了の条件
              </summary>
              <dl className={s.detailGrid}>
                <dt>目的</dt>
                <dd>{p.goal}</dd>
                <dt>成果物</dt>
                <dd><ul>{p.deliverables.map((x) => <li key={x}>{x}</li>)}</ul></dd>
                <dt>完了の条件</dt>
                <dd><ul>{p.doneCriteria.map((x) => <li key={x}>{x}</li>)}</ul></dd>
                <dt>リポジトリ</dt>
                <dd>{p.repos.length ? p.repos.join('、') : 'なし（ワークスペースだけで作業します）'}</dd>
                <dt>外部への通信</dt>
                <dd>
                  {p.externalAccess.length ? (
                    <span className={s.warnText}>
                      <IconGlobe /> {p.externalAccess.join('、')}（許可リストにないため、作業中に許可を求めます）
                    </span>
                  ) : (
                    '許可リストの範囲だけ'
                  )}
                </dd>
              </dl>
            </details>
          </>
        )}

        {d ? (
          <div className={s.resolved} data-tone={d.decision === 'approved' ? 'ok' : d.decision === 'rejected' ? 'err' : 'alert'}>
            {d.decision === 'approved' ? <IconCheck /> : d.decision === 'rejected' ? <IconClose /> : <IconWarning />}
            {d.decision === 'approved' && `${d.by} が ${time(d.at)} に承認しました`}
            {d.decision === 'rejected' && `${d.by} が ${time(d.at)} に却下しました`}
            {d.decision === 'changes_requested' && `${d.by} が修正を依頼しました: 「${d.comment ?? ''}」`}
          </div>
        ) : superseded ? (
          <div className={s.resolved}>新しい版が出ています</div>
        ) : actionable && actions ? (
          mode === 'changes' ? (
            <div className={s.changeBox}>
              <label htmlFor={commentId} className="sr-only">直してほしい点</label>
              <TextArea id={commentId} rows={3} autoFocus value={comment} placeholder="直してほしい点を書いてください（例: グラフは折れ線にしてください）" onChange={(e) => setComment(e.target.value)} />
              <div className={s.actions} style={{ borderTop: 0, paddingTop: 0 }}>
                <span className={s.actionsHint}>送ると、エージェントが計画を見直します</span>
                <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>やめる</Button>
                <Button size="sm" disabled={!comment.trim()} loading={busy === 'changes'} onClick={() => void run('changes', () => actions.requestChanges(comment.trim()))}>
                  修正を依頼する
                </Button>
              </div>
            </div>
          ) : mode === 'reject' ? (
            <div className={s.actions}>
              <span className={s.actionsHint}>却下すると、このタスクは中止になります。よろしいですか？</span>
              <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>戻る</Button>
              <Button size="sm" variant="destructive" loading={busy === 'reject'} onClick={() => void run('reject', actions.reject)}>却下する</Button>
            </div>
          ) : (
            <div className={s.actions}>
              <span className={s.actionsHint}>承認すると、作業を始めます</span>
              <Button size="sm" variant="ghost" onClick={() => setMode('reject')}>却下</Button>
              <Button size="sm" variant="secondary" onClick={() => setMode('changes')}>修正を依頼</Button>
              <Button size="sm" loading={busy === 'approve'} onClick={() => void run('approve', actions.approve)}>承認して開始</Button>
            </div>
          )
        ) : null}
      </div>
    </section>
  );
}

export function ApprovalCard({ approval, actionable, onAnswer }: { approval: ApprovalState; actionable: boolean; onAnswer: (d: 'approve' | 'deny') => Promise<void> }) {
  const [busy, setBusy] = useState<null | 'approve' | 'deny'>(null);
  const r = approval.resolved;
  const answer = async (d: 'approve' | 'deny') => {
    setBusy(d);
    try {
      await onAnswer(d);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className={s.tray} aria-label={`${reasonLabel[approval.reason]}の承認`}>
      <header className={s.trayHead}>
        <span className={s.badge} data-tone={r ? (r.decision === 'approve' ? 'ok' : undefined) : 'alert'}>{r ? (r.decision === 'approve' ? '許可済み' : '許可しない') : '確認が必要'}</span>
        <span>{reasonLabel[approval.reason]}の承認</span>
        <span className={s.trayRight}>{time(approval.at)}</span>
      </header>
      <div className={s.card}>
        <p className={s.summary}>{approval.detail}</p>
        {r ? (
          <div className={s.resolved} data-tone={r.decision === 'approve' ? 'ok' : undefined}>
            {r.decision === 'approve' ? <IconCheck /> : <IconClose />}
            {r.by} が {time(r.at)} に{r.decision === 'approve' ? '許可しました' : '許可しませんでした'}
          </div>
        ) : actionable ? (
          <div className={s.actions}>
            <span className={s.actionsHint}>回答するまで、作業は止まっています</span>
            <Button size="sm" variant="secondary" loading={busy === 'deny'} onClick={() => void answer('deny')}>許可しない</Button>
            <Button size="sm" loading={busy === 'approve'} onClick={() => void answer('approve')}>許可する</Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
