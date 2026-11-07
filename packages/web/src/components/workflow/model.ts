// ワークフローを図のノードと矢印にする（純粋な関数。位置は layout.ts で決める）
import { analyzeWorkflow, graphEdges, nextTargets, type GraphIssue, type StepDef, type Workflow } from '@factory/contracts';
import { stepLabel } from '../../lib/format';
import type { ProgressStatus, StepStatus } from '../../lib/workflow';

export const START = '__plan';

export type GraphNodeData = {
  kind: 'start' | 'step';
  stepId: string;
  label: string;
  type?: StepDef['type'];
  /** イメージ、または VM を使わない処理の説明 */
  sub?: string;
  network?: string;
  gate?: boolean;
  /** 並列で始める枝の数 */
  fork?: number;
  /** 合流で待つ枝の数 */
  join?: number;
  status?: ProgressStatus;
  attempts?: number;
  issue?: string;
};

export type GraphEdgeData = {
  kind: 'next' | 'case' | 'fail' | 'start';
  label?: string;
  maxLoops?: number;
  parallel?: boolean;
  /** 実行の様子: 通った / 通らなかった */
  state?: 'taken' | 'skipped';
};

export type ModelNode = { id: string; width: number; height: number; data: GraphNodeData };
export type ModelEdge = { id: string; source: string; target: string; data: GraphEdgeData };
export type Model = { nodes: ModelNode[]; edges: ModelEdge[]; issues: GraphIssue[] };

export const NODE = { width: 168, height: 72 };
/** 縦に並べるとき（狭い画面）は、横に2つ並んでも入るように細くする */
export const NODE_NARROW = { width: 150, height: 72 };
export const START_NODE = { width: 72, height: 40 };

const actionText: Record<NonNullable<StepDef['action']>, string> = { 'create-pull-request': 'PR を作る（VM なし）', 'propose-publish': '公開を提案（VM なし）' };

export function subOf(st: StepDef): string | undefined {
  if (st.type === 'system') return st.action ? actionText[st.action] : '処理を選んでください';
  if (st.type === 'approval') return '人が承認する';
  return st.image;
}

export function buildModel(workflow: Pick<Workflow, 'steps'>, statuses?: Record<string, StepStatus>, planStatus?: ProgressStatus, narrow = false): Model {
  const size = narrow ? NODE_NARROW : NODE;
  const { issues } = analyzeWorkflow(workflow);
  const issueOf = new Map<string, string>();
  for (const i of issues) {
    const idx = typeof i.path[1] === 'number' ? i.path[1] : -1;
    const id = workflow.steps[idx]?.id;
    if (id && !issueOf.has(id)) issueOf.set(id, i.message);
  }
  const nodes: ModelNode[] = [
    { id: START, ...START_NODE, data: { kind: 'start', stepId: START, label: '計画', sub: '人が承認する', ...(planStatus ? { status: planStatus } : {}) } },
  ];
  for (const st of workflow.steps) {
    const status = statuses?.[st.id];
    const sub = subOf(st);
    const fork = Array.isArray(st.next) && st.next.length > 1 ? st.next.length : 0;
    nodes.push({
      id: st.id, ...size,
      data: {
        kind: 'step', stepId: st.id, label: stepLabel(st.id), type: st.type,
        ...(sub ? { sub } : {}),
        ...(st.network ? { network: st.network } : {}),
        ...(st.gates.includes('plan-approval') ? { gate: true } : {}),
        ...(fork ? { fork } : {}),
        ...(st.needs?.length ? { join: st.needs.length } : {}),
        ...(status ? { status: status.status, ...(status.attempts > 1 ? { attempts: status.attempts } : {}) } : {}),
        ...(issueOf.has(st.id) ? { issue: issueOf.get(st.id)! } : {}),
      },
    });
  }
  const ids = new Set(workflow.steps.map((s) => s.id));
  const edges: ModelEdge[] = [];
  const first = workflow.steps[0];
  if (first) edges.push({ id: `${START}->${first.id}`, source: START, target: first.id, data: { kind: 'start', ...(statuses && planStatus === 'done' ? { state: 'taken' as const } : {}) } });
  for (const e of graphEdges(workflow)) {
    if (!ids.has(e.to)) continue;
    const data: GraphEdgeData = { kind: e.kind, ...(e.label ? { label: e.label } : {}), ...(e.maxLoops !== undefined ? { maxLoops: e.maxLoops } : {}), ...(e.parallel ? { parallel: true } : {}) };
    if (statuses) {
      const from = statuses[e.from];
      const to = statuses[e.to];
      if (e.kind === 'fail') {
        // 戻った先がもう一度動いていれば、戻る矢印を通った
        if ((from?.attempts ?? 0) > 0 && (to?.attempts ?? 0) > 1) data.state = 'taken';
      } else if (to?.status === 'skipped' || from?.status === 'skipped') data.state = 'skipped';
      else if (from?.status === 'done' && to && to.status !== 'waiting') data.state = 'taken';
    }
    edges.push({ id: e.id, source: e.from, target: e.to, data });
  }
  return { nodes, edges, issues };
}

/** 前へ進む矢印の先がない（ここで終わる）ステップ */
export function isTerminal(st: StepDef) {
  return nextTargets(st).length === 0 && !st.on?.pass && !Object.keys(st.on?.cases ?? {}).length;
}
