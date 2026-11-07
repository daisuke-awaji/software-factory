// ラインの進み具合（計画 → 各ステージ）を、画面に出す形にする
import type { Workflow, Task } from '@factory/contracts';
import { stepLabel } from './format';
import type { Session } from './session';

export type ProgressStatus = 'waiting' | 'running' | 'done' | 'alert' | 'failed';
export type ProgressStep = { id: string; label: string; status: ProgressStatus; sub?: string };

export function workflowName(ref: string) {
  return ref.split('@')[0] ?? ref;
}

export function findWorkflow(workflows: Workflow[] | undefined, ref: string) {
  return workflows?.find((l) => l.name === workflowName(ref));
}

/** ワークスペース用: イベントから細かく出す */
export function progressFromSession(workflow: Workflow | undefined, s: Session): ProgressStep[] {
  const latest = s.latestPlan ? s.plans[s.latestPlan] : undefined;
  const pendingApproval = Object.values(s.approvals).some((a) => !a.resolved);
  const planStatus: ProgressStatus =
    latest?.decision?.decision === 'approved' ? 'done'
    : latest?.decision?.decision === 'rejected' ? 'failed'
    : latest && !latest.decision && s.state === 'awaiting_approval' ? 'alert'
    : s.state === 'cancelled' || s.state === 'failed' ? 'waiting'
    : 'running';
  const steps: ProgressStep[] = [{ id: '__plan', label: '計画', status: planStatus }];
  for (const st of workflow?.steps ?? []) {
    const run = s.runs.findLast((r) => r.stepId === st.id);
    const loops = s.runs.filter((r) => r.stepId === st.id).length;
    let status: ProgressStatus = 'waiting';
    if (run?.state === 'running') status = planStatus !== 'done' ? 'waiting' : s.state === 'awaiting_approval' && pendingApproval ? 'alert' : s.state === 'cancelled' ? 'waiting' : 'running';
    else if (run?.state === 'completed') status = 'done';
    else if (run?.state === 'failed') status = 'failed';
    steps.push({ id: st.id, label: stepLabel(st.id), status, ...(st.image ? { sub: `${st.image}${loops > 1 ? ` · ${loops} 回目` : ''}` } : {}) });
  }
  return steps;
}

/** 一覧用: ワークアイテムの状態と、いまのステージから大まかに出す（pending は受け箱で分かった承認の種類） */
export function progressFromTask(workflow: Workflow | undefined, item: Task, pending?: 'plan' | 'approval'): ProgressStep[] {
  const defs = workflow?.steps ?? [];
  const idx = item.currentStepId ? defs.findIndex((st) => st.id === item.currentStepId) : -1;
  const planning = item.state === 'queued' || item.state === 'planning' || (item.state === 'awaiting_approval' && pending !== 'approval');
  const planStatus: ProgressStatus =
    item.state === 'awaiting_approval' && pending !== 'approval' ? 'alert' : planning ? 'running' : item.state === 'cancelled' && idx <= 0 ? 'waiting' : 'done';
  const steps: ProgressStep[] = [{ id: '__plan', label: '計画', status: planStatus }];
  defs.forEach((st, i) => {
    let status: ProgressStatus = 'waiting';
    if (item.state === 'completed') status = 'done';
    else if (planning) status = 'waiting';
    else if (i < idx) status = 'done';
    else if (i === idx) {
      status = item.state === 'failed' ? 'failed' : item.state === 'awaiting_approval' ? 'alert' : item.state === 'cancelled' ? 'waiting' : 'running';
    }
    steps.push({ id: st.id, label: stepLabel(st.id), status });
  });
  return steps;
}
