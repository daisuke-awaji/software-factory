// ラインの進み具合（計画 → 各ステージ）を、画面に出す形にする
import type { Line, WorkItem } from '@factory/contracts';
import { stageLabel } from './format';
import type { Session } from './session';

export type StepStatus = 'waiting' | 'running' | 'done' | 'alert' | 'failed';
export type Step = { id: string; label: string; status: StepStatus; sub?: string };

export function lineName(ref: string) {
  return ref.split('@')[0] ?? ref;
}

export function findLine(lines: Line[] | undefined, ref: string) {
  return lines?.find((l) => l.name === lineName(ref));
}

/** ワークスペース用: イベントから細かく出す */
export function stepsFromSession(line: Line | undefined, s: Session): Step[] {
  const latest = s.latestPlan ? s.plans[s.latestPlan] : undefined;
  const pendingApproval = Object.values(s.approvals).some((a) => !a.resolved);
  const planStatus: StepStatus =
    latest?.decision?.decision === 'approved' ? 'done'
    : latest?.decision?.decision === 'rejected' ? 'failed'
    : latest && !latest.decision && s.state === 'awaiting_approval' ? 'alert'
    : s.state === 'cancelled' || s.state === 'failed' ? 'waiting'
    : 'running';
  const steps: Step[] = [{ id: '__plan', label: '計画', status: planStatus }];
  for (const st of line?.stages ?? []) {
    const run = s.runs.findLast((r) => r.stageId === st.id);
    const loops = s.runs.filter((r) => r.stageId === st.id).length;
    let status: StepStatus = 'waiting';
    if (run?.state === 'running') status = planStatus !== 'done' ? 'waiting' : s.state === 'awaiting_approval' && pendingApproval ? 'alert' : s.state === 'cancelled' ? 'waiting' : 'running';
    else if (run?.state === 'completed') status = 'done';
    else if (run?.state === 'failed') status = 'failed';
    steps.push({ id: st.id, label: stageLabel(st.id), status, ...(st.image ? { sub: `${st.image}${loops > 1 ? ` · ${loops} 回目` : ''}` } : {}) });
  }
  return steps;
}

/** 一覧用: ワークアイテムの状態と、いまのステージから大まかに出す（pending は受け箱で分かった承認の種類） */
export function stepsFromItem(line: Line | undefined, item: WorkItem, pending?: 'plan' | 'approval'): Step[] {
  const stages = line?.stages ?? [];
  const idx = item.currentStageId ? stages.findIndex((st) => st.id === item.currentStageId) : -1;
  const planning = item.state === 'queued' || item.state === 'planning' || (item.state === 'awaiting_approval' && pending !== 'approval');
  const planStatus: StepStatus =
    item.state === 'awaiting_approval' && pending !== 'approval' ? 'alert' : planning ? 'running' : item.state === 'cancelled' && idx <= 0 ? 'waiting' : 'done';
  const steps: Step[] = [{ id: '__plan', label: '計画', status: planStatus }];
  stages.forEach((st, i) => {
    let status: StepStatus = 'waiting';
    if (item.state === 'completed') status = 'done';
    else if (planning) status = 'waiting';
    else if (i < idx) status = 'done';
    else if (i === idx) {
      status = item.state === 'failed' ? 'failed' : item.state === 'awaiting_approval' ? 'alert' : item.state === 'cancelled' ? 'waiting' : 'running';
    }
    steps.push({ id: st.id, label: stageLabel(st.id), status });
  });
  return steps;
}
