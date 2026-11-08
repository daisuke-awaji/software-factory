// ワークフローの進み具合（計画 → 各ステップ）を、画面に出す形にする。並列と分岐は「列」にまとめる
import { analyzeWorkflow, graphEdges, resolveNext, type Workflow, type Task } from '@factory/contracts';
import { isTerminal, stepLabel } from './format';
import type { Session } from './session';

export type ProgressStatus = 'waiting' | 'running' | 'done' | 'alert' | 'failed' | 'skipped';
/** column: 左からの列（0 は計画）。同じ列のステップは、並列で動くか、分岐でどちらかだけが動く */
export type ProgressStep = {
  id: string;
  label: string;
  status: ProgressStatus;
  column: number;
  sub?: string;
  attempts?: number;
  caseLabel?: string;
};
export type StepStatus = { status: ProgressStatus; attempts: number; caseLabel?: string };

export function workflowName(ref: string) {
  return ref.split('@')[0] ?? ref;
}

export function findWorkflow(workflows: Workflow[] | undefined, ref: string) {
  return workflows?.find((l) => l.name === workflowName(ref));
}

/** ステップの列（前へ進む矢印でいちばん長く辿ったときの段 + 1）。定義に誤りがあっても、並び順で出す */
export function columnsOf(workflow: Workflow): Record<string, number> {
  const { layer } = analyzeWorkflow(workflow);
  return Object.fromEntries(workflow.steps.map((st, i) => [st.id, (layer[st.id] ?? i) + 1]));
}

export function planStatusOf(s: Session): ProgressStatus {
  const latest = s.latestPlan ? s.plans[s.latestPlan] : undefined;
  return latest?.decision?.decision === 'approved'
    ? 'done'
    : latest?.decision?.decision === 'rejected'
      ? 'failed'
      : latest && !latest.decision && s.state === 'awaiting_approval'
        ? 'alert'
        : s.state === 'cancelled' || s.state === 'failed'
          ? 'waiting'
          : 'running';
}

/** ステップごとの状態（ワークスペースの図と進み具合で使う） */
export function stepStatusesFromSession(workflow: Workflow, s: Session): Record<string, StepStatus> {
  const planStatus = planStatusOf(s);
  const pendingApproval = Object.values(s.approvals).some((a) => !a.resolved);
  const edges = graphEdges(workflow).filter((e) => e.kind !== 'fail');
  const lastRun = (id: string) => s.runs.findLast((r) => r.stepId === id);
  const out: Record<string, StepStatus> = {};
  for (const st of workflow.steps) {
    const run = lastRun(st.id);
    const attempts = s.runs.filter((r) => r.stepId === st.id).length;
    let status: ProgressStatus = 'waiting';
    if (run?.state === 'running') {
      status =
        planStatus !== 'done' || isTerminal(s.state) ? 'waiting' : s.state === 'awaiting_approval' && pendingApproval ? 'alert' : 'running';
    } else if (run?.state === 'completed') status = 'done';
    else if (run?.state === 'failed') status = 'failed';
    else {
      // 前のステップがすべて終わり、どれもここへ進まなかった（分岐で別の道を選んだ）なら、飛ばした
      const preds = edges.filter((e) => e.to === st.id).map((e) => workflow.steps.find((x) => x.id === e.from)!);
      const passedBy =
        preds.length > 0 &&
        preds.every((p) => {
          const r = lastRun(p.id);
          return r?.state === 'completed' && !resolveNext(p, 'pass', r.label).targets.includes(st.id);
        });
      if (passedBy || s.state === 'completed') status = 'skipped';
    }
    out[st.id] = { status, attempts, ...(run?.label ? { caseLabel: run.label } : {}) };
  }
  return out;
}

/** ワークスペース用: イベントから細かく出す */
export function progressFromSession(workflow: Workflow | undefined, s: Session): ProgressStep[] {
  const steps: ProgressStep[] = [{ id: '__plan', label: '計画', status: planStatusOf(s), column: 0 }];
  if (!workflow) return steps;
  const statuses = stepStatusesFromSession(workflow, s);
  const columns = columnsOf(workflow);
  for (const st of workflow.steps) {
    const { status, attempts, caseLabel } = statuses[st.id]!;
    steps.push({
      id: st.id,
      label: stepLabel(st.id),
      status,
      column: columns[st.id]!,
      ...(attempts > 1 ? { attempts } : {}),
      ...(caseLabel ? { caseLabel } : {}),
      ...(st.image ? { sub: `${st.image}${attempts > 1 ? ` · ${attempts} 回目` : ''}` } : {}),
    });
  }
  return sortByColumn(steps);
}

/** 一覧用: タスクの状態と、いま動いているステップから大まかに出す（pending は受け箱で分かった承認の種類） */
export function progressFromTask(workflow: Workflow | undefined, item: Task, pending?: 'plan' | 'approval'): ProgressStep[] {
  const defs = workflow?.steps ?? [];
  const columns = workflow ? columnsOf(workflow) : {};
  const active = item.activeStepIds?.length ? item.activeStepIds : item.currentStepId ? [item.currentStepId] : [];
  const current = Math.max(-1, ...active.map((id) => columns[id] ?? -1));
  const planning = item.state === 'queued' || item.state === 'planning' || (item.state === 'awaiting_approval' && pending !== 'approval');
  const planStatus: ProgressStatus =
    item.state === 'awaiting_approval' && pending !== 'approval'
      ? 'alert'
      : planning
        ? 'running'
        : item.state === 'cancelled' && current <= 1
          ? 'waiting'
          : 'done';
  const steps: ProgressStep[] = [{ id: '__plan', label: '計画', status: planStatus, column: 0 }];
  for (const st of defs) {
    const column = columns[st.id]!;
    let status: ProgressStatus = 'waiting';
    if (item.state === 'completed') status = 'done';
    else if (planning) status = 'waiting';
    else if (column < current) status = 'done';
    else if (active.includes(st.id)) {
      status =
        item.state === 'failed'
          ? 'failed'
          : item.state === 'awaiting_approval'
            ? 'alert'
            : item.state === 'cancelled'
              ? 'waiting'
              : 'running';
    }
    steps.push({ id: st.id, label: stepLabel(st.id), status, column });
  }
  return sortByColumn(steps);
}

function sortByColumn(steps: ProgressStep[]) {
  return steps
    .map((st, i) => ({ st, i }))
    .sort((a, b) => a.st.column - b.st.column || a.i - b.i)
    .map((x) => x.st);
}
