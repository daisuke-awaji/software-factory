// イベントを畳み込んで、ワークスペースに出す状態を作る（純粋な関数。ストアとホームの受け箱で共有する）
import { type ApprovalReason, type FactoryEventEnvelope, type Plan, ulidTime, type WorkItemState } from '@factory/contracts';

export type ChatMessage = { id: string; role: 'user' | 'assistant'; text: string; done: boolean; at: number; author?: string; attachments?: string[] };
export type PlanState = {
  version: number;
  plan: Plan;
  at: number;
  decision?: { decision: 'approved' | 'changes_requested' | 'rejected'; by: string; at: number; comment?: string };
};
export type ApprovalState = { id: string; reason: ApprovalReason; detail: string; at: number; resolved?: { decision: 'approve' | 'deny'; by: string; at: number } };
export type ToolState = { id: string; tool: string; summary: string; result?: string; ok?: boolean; startedAt: number; endedAt?: number; runId?: string };
export type RunState = { runId: string; stageId: string; state: 'running' | 'completed' | 'failed'; startedAt: number; endedAt?: number; tools: string[] };

export type Entry =
  | { k: 'user'; id: string }
  | { k: 'assistant'; id: string }
  | { k: 'plan'; version: number }
  | { k: 'approval'; id: string }
  | { k: 'egress'; host: string; at: number }
  | { k: 'work'; id: string; tools: string[] }
  | { k: 'end'; state: 'completed' | 'failed' | 'cancelled'; at: number };

export type Session = {
  workItemId: string;
  state: WorkItemState | null;
  lastEventId: string | null;
  seen: Record<string, true>;
  timeline: Entry[];
  messages: Record<string, ChatMessage>;
  plans: Record<number, PlanState>;
  latestPlan: number | null;
  approvals: Record<string, ApprovalState>;
  tools: Record<string, ToolState>;
  runs: RunState[];
  blocked: { host: string; at: number }[];
  usage: { inputTokens: number; outputTokens: number; vmSeconds: number };
  preview: { port: number; path: string } | null;
  /** ファイルを変更したツールが終わった回数（変更・ファイルのタブを読み直すきっかけ） */
  fileVersion: number;
};

export function emptySession(workItemId: string): Session {
  return {
    workItemId, state: null, lastEventId: null, seen: {}, timeline: [], messages: {}, plans: {}, latestPlan: null, approvals: {},
    tools: {}, runs: [], blocked: [], usage: { inputTokens: 0, outputTokens: 0, vmSeconds: 0 }, preview: null, fileVersion: 0,
  };
}

const FILE_TOOLS = new Set(['edit_file', 'write_file', 'run', 'git_push']);

/** 1件のイベントを反映する。同じ eventId は2回反映しない（WebSocket と履歴の両方から届くため） */
export function reduce(s: Session, e: FactoryEventEnvelope): Session {
  if (e.workItemId !== s.workItemId || s.seen[e.eventId]) return s;
  const at = ulidTime(e.eventId);
  const next: Session = {
    ...s,
    seen: { ...s.seen, [e.eventId]: true },
    lastEventId: !s.lastEventId || e.eventId > s.lastEventId ? e.eventId : s.lastEventId,
  };
  const push = (entry: Entry) => {
    next.timeline = [...next.timeline, entry];
  };

  switch (e.type) {
    case 'message.user':
      next.messages = { ...s.messages, [e.messageId]: { id: e.messageId, role: 'user', text: e.text, done: true, at, author: e.author, ...(e.attachments ? { attachments: e.attachments } : {}) } };
      push({ k: 'user', id: e.messageId });
      break;
    case 'message.delta': {
      const m = s.messages[e.messageId];
      if (m) next.messages = { ...s.messages, [e.messageId]: { ...m, text: m.text + e.text } };
      else {
        next.messages = { ...s.messages, [e.messageId]: { id: e.messageId, role: 'assistant', text: e.text, done: false, at } };
        push({ k: 'assistant', id: e.messageId });
      }
      break;
    }
    case 'message.completed': {
      const m = s.messages[e.messageId];
      if (m) next.messages = { ...s.messages, [e.messageId]: { ...m, done: true } };
      break;
    }
    case 'tool.started': {
      const run = s.runs.findLast((r) => r.state === 'running');
      next.tools = { ...s.tools, [e.toolUseId]: { id: e.toolUseId, tool: e.tool, summary: e.summary, startedAt: at, ...(run ? { runId: run.runId } : {}) } };
      if (run) next.runs = s.runs.map((r) => (r === run ? { ...r, tools: [...r.tools, e.toolUseId] } : r));
      // 会話の中では、続けて動いたツールを1つのまとまり（work）にする
      const lastEntry = s.timeline.at(-1);
      if (lastEntry?.k === 'work') next.timeline = [...s.timeline.slice(0, -1), { ...lastEntry, tools: [...lastEntry.tools, e.toolUseId] }];
      else push({ k: 'work', id: e.toolUseId, tools: [e.toolUseId] });
      break;
    }
    case 'tool.finished': {
      const t = s.tools[e.toolUseId];
      if (t) next.tools = { ...s.tools, [e.toolUseId]: { ...t, ok: e.ok, endedAt: at, ...(e.summary ? { result: e.summary } : {}) } };
      if (t && FILE_TOOLS.has(t.tool) && e.ok) next.fileVersion = s.fileVersion + 1;
      break;
    }
    case 'plan.proposed':
      next.plans = { ...s.plans, [e.planVersion]: { version: e.planVersion, plan: e.plan, at } };
      next.latestPlan = Math.max(s.latestPlan ?? 0, e.planVersion);
      push({ k: 'plan', version: e.planVersion });
      break;
    case 'plan.decided': {
      const p = s.plans[e.planVersion];
      if (p) next.plans = { ...s.plans, [e.planVersion]: { ...p, decision: { decision: e.decision, by: e.by, at, ...(e.comment ? { comment: e.comment } : {}) } } };
      break;
    }
    case 'approval.required':
      next.approvals = { ...s.approvals, [e.approvalId]: { id: e.approvalId, reason: e.reason, detail: e.detail, at } };
      push({ k: 'approval', id: e.approvalId });
      break;
    case 'approval.resolved': {
      const a = s.approvals[e.approvalId];
      if (a) next.approvals = { ...s.approvals, [e.approvalId]: { ...a, resolved: { decision: e.decision, by: e.by, at } } };
      break;
    }
    case 'egress.blocked':
      next.blocked = [...s.blocked, { host: e.host, at }];
      push({ k: 'egress', host: e.host, at });
      break;
    case 'usage':
      next.usage = { inputTokens: s.usage.inputTokens + e.inputTokens, outputTokens: s.usage.outputTokens + e.outputTokens, vmSeconds: s.usage.vmSeconds + e.vmSeconds };
      break;
    case 'stage.changed':
      if (e.state === 'started') {
        const n = s.runs.filter((r) => r.stageId === e.stageId).length + 1;
        next.runs = [...s.runs, { runId: `${e.stageId}#${n}`, stageId: e.stageId, state: 'running', startedAt: at, tools: [] }];
      } else {
        const run = s.runs.findLast((r) => r.stageId === e.stageId && r.state === 'running');
        if (run) next.runs = s.runs.map((r) => (r === run ? { ...r, state: e.state === 'completed' ? 'completed' : 'failed', endedAt: at } : r));
      }
      break;
    case 'workitem.state':
      next.state = e.state;
      if (e.state === 'completed' || e.state === 'failed' || e.state === 'cancelled') push({ k: 'end', state: e.state, at });
      break;
    case 'preview.ready':
      next.preview = { port: e.port, path: e.path };
      break;
    default: {
      // 新しい type を contracts に足したら、ここで型エラーになる（網羅のチェック）
      const never: never = e;
      return never;
    }
  }
  return next;
}

export function reduceAll(s: Session, events: FactoryEventEnvelope[]): Session {
  return events.reduce(reduce, s);
}

/** 回答を待っている承認（計画の承認か、再承認） */
export type Pending =
  | { kind: 'plan'; version: number; plan: Plan; at: number }
  | { kind: 'approval'; approval: ApprovalState };

export function pendingOf(s: Session): Pending | null {
  if (s.state !== 'awaiting_approval') return null;
  const open = Object.values(s.approvals).filter((a) => !a.resolved).sort((a, b) => b.at - a.at)[0];
  if (open) return { kind: 'approval', approval: open };
  const latest = s.latestPlan ? s.plans[s.latestPlan] : undefined;
  if (latest && !latest.decision) return { kind: 'plan', version: latest.version, plan: latest.plan, at: latest.at };
  return null;
}

/** いま動いている（または最後に動いた）ステージの実行 */
export function currentRun(s: Session): RunState | undefined {
  return s.runs.findLast((r) => r.state === 'running') ?? s.runs.at(-1);
}
