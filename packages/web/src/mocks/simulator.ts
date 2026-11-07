// ラインの実行のシミュレーター。台本（SimStep の列）を時間をかけて流し、イベントを出す。
// 本物と同じく「計画 → 承認 → ステージごとの VM → PR」の順に進み、承認や中断で止まる
import { type CreateWorkItemRequest, type FactoryEvent, type Line, type WorkItem, ulid } from '@factory/contracts';
import { emit as rawEmit, getDb, save, workItem, type DistributiveOmit, type Sim, type SimStep } from './db';
import { repoFiles } from './fixtures';
import { finalSummary, pickScenario, planning, stageWork } from './scenarios';

const timers = new Map<string, ReturnType<typeof setTimeout>>();

// シードを作るときは、時計を進めながら一気に流す（タイマーを使わない）
let virtualNow: number | null = null;
export function now() {
  if (virtualNow === null) return Date.now();
  return virtualNow++;
}
const instant = () => virtualNow !== null;

/** シード用: 時計を止めた状態で fn を実行する */
export function atTime<T>(t: number, fn: () => T): T {
  const prev = virtualNow;
  virtualNow = t;
  try {
    return fn();
  } finally {
    virtualNow = prev;
  }
}

export function lineOf(item: WorkItem): Line {
  const name = item.lineRef.split('@')[0];
  const def = getDb().lines.find((l) => l.name === name);
  if (!def) throw new Error(`ラインが見つかりません: ${item.lineRef}`);
  return def.line;
}

/** イベントを出す。ステージの実行の記録（GET /stages）もここで更新する */
function ev(id: string, event: DistributiveOmit<FactoryEvent, 'workItemId'>) {
  const at = now();
  if (event.type === 'stage.changed') {
    const runs = (getDb().stageRuns[id] ??= []);
    if (event.state === 'started') {
      const n = runs.filter((r) => r.stageId === event.stageId).length + 1;
      const image = lineOf(workItem(id)!).stages.find((s) => s.id === event.stageId)?.image;
      runs.push({ runId: `${event.stageId}#${n}`, stageId: event.stageId, state: 'running', startedAt: new Date(at).toISOString(), ...(image ? { image } : {}) });
    } else {
      const run = runs.findLast((r) => r.stageId === event.stageId && r.state === 'running');
      if (run) {
        run.state = event.state;
        run.endedAt = new Date(at).toISOString();
        run.result = { verdict: event.state === 'completed' ? 'pass' : 'fail', summary: event.state === 'completed' ? '完了しました' : '失敗しました', outputs: {} };
      }
    }
  }
  if (event.type === 'plan.proposed') {
    const list = (getDb().plans[id] ??= []);
    for (const p of list) if (p.status === 'proposed') p.status = 'superseded';
    list.push({ version: event.planVersion, plan: event.plan, status: 'proposed', createdAt: new Date(at).toISOString() });
  }
  return rawEmit(id, event, at);
}

function sayNow(id: string, text: string) {
  const messageId = `msg_${ulid(now())}`;
  ev(id, { type: 'message.delta', messageId, text });
  ev(id, { type: 'message.completed', messageId });
}

/** 発言を、ストリーミングらしく小分けの delta にする */
function expandSay(text: string): SimStep[] {
  const messageId = `msg_${ulid(now())}`;
  const chunks = text.match(/.{1,7}/gsu) ?? [text];
  return [
    ...chunks.map((c, i): SimStep => ({ t: 'emit', delay: i === 0 ? 0 : 45, event: { type: 'message.delta', messageId, text: c } })),
    { t: 'emit', delay: 30, event: { type: 'message.completed', messageId } },
  ];
}

function applyStep(id: string, step: SimStep) {
  const d = getDb();
  const sim = d.sim[id]!;
  const item = workItem(id)!;
  switch (step.t) {
    case 'emit':
      ev(id, step.event);
      break;
    case 'say':
      sim.queue.unshift(...expandSay(step.text));
      break;
    case 'write': {
      const files = (d.files[id] ??= {});
      if (step.content === null) delete files[step.path];
      else files[step.path] = step.content;
      break;
    }
    case 'gate':
      sim.waiting = step.gate;
      if (step.approvalId) sim.approvalId = step.approvalId;
      break;
    case 'pr': {
      const number = 128 + d.workItems.filter((w) => w.pullRequest && w.id !== id).length;
      item.pullRequest = { number, url: `https://github.com/${item.repo?.owner}/${item.repo?.name}/pull/${number}` };
      break;
    }
    case 'next':
      sim.queue.push(...nextStage(id, sim, step.outcome));
      break;
    case 'finish':
      if (step.state === 'completed') sim.queue.unshift({ t: 'say', delay: 300, text: finalSummary(sim.scenario, item.pullRequest?.number) }, { t: 'emit', delay: 200, event: { type: 'workitem.state', state: 'completed' } });
      else sim.queue.unshift({ t: 'emit', delay: 200, event: { type: 'workitem.state', state: 'failed' } });
      break;
  }
}

/** ラインの定義に沿って、次のステージの台本を返す */
function nextStage(id: string, sim: Sim, outcome: 'pass' | 'fail'): SimStep[] {
  const line = lineOf(workItem(id)!);
  const idx = line.stages.findIndex((s) => s.id === sim.stage);
  const cur = line.stages[idx];
  let target: string | undefined;
  if (outcome === 'pass') target = cur?.on?.pass ?? cur?.next ?? line.stages[idx + 1]?.id;
  else {
    const fail = cur?.on?.fail;
    const loops = sim.attempts[cur?.id ?? ''] ?? 1;
    if (fail && loops <= fail.maxLoops) target = fail.goto;
    else
      return [
        { t: 'say', delay: 300, text: `${cur?.id === 'verify' ? '検証' : 'ステージ'}が ${loops} 回続けて失敗したため、ラインを止めました。実行ログで原因を確かめて、「やり直す」で再開できます。` },
        { t: 'finish', delay: 100, state: 'failed' },
      ];
  }
  if (!target) return [{ t: 'finish', delay: 300, state: 'completed' }];
  sim.stage = target;
  const attempt = (sim.attempts[target] ?? 0) + 1;
  sim.attempts[target] = attempt;
  return stageWork(sim.scenario, target, attempt, sim, false);
}

// ---------------------------------------------------------------- 実行（タイマー）
function tick(id: string) {
  if (instant() || timers.has(id)) return;
  const sim = getDb().sim[id];
  if (!sim || sim.waiting || sim.interrupted) return;
  const step = sim.queue[0];
  if (!step) return;
  const speed = Math.max(0.1, getDb().settings.speed);
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      const s = getDb().sim[id];
      if (!s || s.queue[0] !== step || s.waiting || s.interrupted) return;
      s.queue.shift();
      applyStep(id, step);
      save();
      tick(id);
    }, step.delay / speed),
  );
}

function stop(id: string) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
}

export function stopAll() {
  for (const id of [...timers.keys()]) stop(id);
}

export function resumeAll() {
  for (const id of Object.keys(getDb().sim)) tick(id);
}

/** シード用: 待ちになるまで（または decide が 'stop' を返すまで）一気に流す */
export function fastForward(id: string, startAt: number, decide: (sim: Sim) => 'approve' | 'stop', maxSteps = 2000, scale = 1): number {
  virtualNow = startAt;
  try {
    for (let i = 0; i < maxSteps; i++) {
      const sim = getDb().sim[id]!;
      if (sim.waiting) {
        if (decide(sim) === 'stop') return virtualNow;
        if (sim.waiting === 'plan') approvePlan(id, sim.planVersion, '佐藤 美咲');
        else if (sim.waiting === 'approval' && sim.approvalId) answerApproval(id, sim.approvalId, 'approve', '佐藤 美咲');
        continue;
      }
      const step = sim.queue.shift();
      if (!step) return virtualNow;
      virtualNow += Math.max(1, step.delay * scale);
      applyStep(id, step);
    }
    return virtualNow;
  } finally {
    virtualNow = null;
  }
}

/** シード用: 指定した数の手順だけ進める（実行中の状態を作る） */
export function advance(id: string, startAt: number, steps: number, scale = 1) {
  virtualNow = startAt;
  try {
    for (let i = 0; i < steps; i++) {
      const sim = getDb().sim[id]!;
      if (sim.waiting || !sim.queue[0]) return;
      const step = sim.queue.shift()!;
      virtualNow += Math.max(1, step.delay * scale);
      applyStep(id, step);
    }
  } finally {
    virtualNow = null;
  }
}

// ---------------------------------------------------------------- 操作（API のハンドラーから呼ぶ）
export class Conflict extends Error {}

export function createWorkItem(req: CreateWorkItemRequest, ownerId: string, author: string, at = now()): WorkItem {
  const d = getDb();
  const id = ulid(at);
  const iso = new Date(at).toISOString();
  const item: WorkItem = {
    id, ownerId, title: req.title, lineRef: req.lineRef, state: 'queued', createdAt: iso, updatedAt: iso, archived: false,
    ...(req.projectId ? { projectId: req.projectId } : {}),
    ...(req.repo ? { repo: req.repo, branch: `factory/${id.slice(-6).toLowerCase()}` } : {}),
    usage: { inputTokens: 0, outputTokens: 0, vmSeconds: 0 },
    costUsd: 0,
  };
  d.workItems.unshift(item);
  const base = req.repo ? { ...(repoFiles[`${req.repo.owner}/${req.repo.name}`] ?? { 'README.md': `# ${req.repo.name}\n` }) } : {};
  d.baseFiles[id] = base;
  d.files[id] = { ...base };
  for (const p of req.attachments ?? []) {
    const a = d.attachments[p];
    if (a) d.files[id][`attachments/${a.fileName}`] = a.content;
  }
  const line = lineOf(item);
  const first = line.stages[0]!.id;
  d.sim[id] = {
    scenario: pickScenario(req.title, req.message), queue: [], waiting: null, attempts: { [first]: 1 }, stage: first,
    planVersion: 1, comments: [], flags: {}, interrupted: false,
  };
  d.events[id] = [];
  ev(id, { type: 'message.user', messageId: `msg_${ulid(now())}`, text: req.message, author, ...(req.attachments?.length ? { attachments: req.attachments.map((p) => d.attachments[p]?.fileName ?? p) } : {}) });
  d.sim[id].queue = planning(d.sim[id].scenario, item, first, 1, []);
  d.plans[id] = [];
  save();
  tick(id);
  return item;
}

function requirePlanGate(id: string, version: number) {
  const sim = getDb().sim[id];
  const item = workItem(id);
  if (!sim || !item) throw new Conflict('見つかりません');
  if (item.state !== 'awaiting_approval' || sim.waiting !== 'plan') throw new Conflict('承認を待っている計画はありません');
  if (version !== sim.planVersion) throw new Conflict(`第${version}版は最新ではありません（最新は第${sim.planVersion}版）`);
  return sim;
}

function decide(id: string, version: number, status: 'approved' | 'changes_requested' | 'rejected', by: string, comment?: string) {
  const rec = getDb().plans[id]?.find((p) => p.version === version);
  if (rec) Object.assign(rec, { status, decidedBy: by, decidedAt: new Date(now()).toISOString(), ...(comment ? { comment } : {}) });
  ev(id, { type: 'plan.decided', planVersion: version, decision: status, by, ...(comment ? { comment } : {}) });
}

export function approvePlan(id: string, version: number, by: string) {
  const sim = requirePlanGate(id, version);
  decide(id, version, 'approved', by);
  sim.waiting = null;
  ev(id, { type: 'workitem.state', state: 'running' });
  sim.queue = stageWork(sim.scenario, sim.stage, 1, sim, true);
  save();
  tick(id);
}

export function requestChanges(id: string, version: number, comment: string, by: string) {
  const sim = requirePlanGate(id, version);
  ev(id, { type: 'message.user', messageId: `msg_${ulid(now())}`, text: comment, author: by });
  decide(id, version, 'changes_requested', by, comment);
  sim.waiting = null;
  sim.comments.push(comment);
  sim.planVersion = version + 1;
  sim.queue = planning(sim.scenario, workItem(id)!, sim.stage, sim.planVersion, sim.comments);
  save();
  tick(id);
}

export function rejectPlan(id: string, version: number, by: string) {
  const sim = requirePlanGate(id, version);
  decide(id, version, 'rejected', by);
  sim.waiting = null;
  sim.queue = [];
  ev(id, { type: 'stage.changed', stageId: sim.stage, state: 'failed' });
  sayNow(id, '計画が却下されたため、作業を止めました。VM は停止しています。');
  ev(id, { type: 'workitem.state', state: 'cancelled' });
  save();
}

export function answerApproval(id: string, approvalId: string, decision: 'approve' | 'deny', by: string) {
  const sim = getDb().sim[id];
  if (!sim || sim.waiting !== 'approval' || sim.approvalId !== approvalId) throw new Conflict('この承認は回答済みか、存在しません');
  ev(id, { type: 'approval.resolved', approvalId, decision, by });
  sim.waiting = null;
  delete sim.approvalId;
  ev(id, { type: 'workitem.state', state: 'running' });
  if (decision === 'deny') sim.queue.unshift({ t: 'say', delay: 300, text: '許可されなかったので、外部のライブラリを使わずに SVG でグラフを描きます。' });
  else sim.queue.unshift({ t: 'say', delay: 300, text: 'ありがとうございます。この作業の間だけ cdn.jsdelivr.net への通信を許可しました（許可リストの本体は変わりません）。' });
  save();
  tick(id);
}

export function postMessage(id: string, text: string, attachments: string[], by: string) {
  const d = getDb();
  const sim = d.sim[id];
  const item = workItem(id);
  if (!sim || !item) throw new Conflict('見つかりません');
  if (sim.waiting === 'plan') return requestChanges(id, sim.planVersion, text, by);
  const names = attachments.map((p) => d.attachments[p]?.fileName ?? p);
  for (const p of attachments) {
    const a = d.attachments[p];
    if (a) (d.files[id] ??= {})[`attachments/${a.fileName}`] = a.content;
  }
  ev(id, { type: 'message.user', messageId: `msg_${ulid(now())}`, text, author: by, ...(names.length ? { attachments: names } : {}) });
  if (sim.interrupted) {
    sim.interrupted = false;
    ev(id, { type: 'workitem.state', state: 'running' });
    sim.queue.unshift({ t: 'say', delay: 400, text: '指示を受け取りました。続きから再開します。' });
  } else if (item.state === 'running' || item.state === 'planning') {
    sim.queue.unshift({ t: 'say', delay: 600, text: '了解しました。次の手順から反映します。' });
  } else if (sim.waiting === 'approval') {
    sayNow(id, '承知しました。承認への回答をいただいてから、反映します。');
  } else {
    sayNow(id, item.state === 'completed' ? 'ありがとうございます。続けて手を加える場合は、内容を書いて新しい依頼にしてください（この依頼の成果物を引き継げます）。' : 'この依頼は終了しています。必要なら「やり直す」から再開してください。');
  }
  save();
  tick(id);
}

export function interrupt(id: string) {
  const sim = getDb().sim[id];
  const item = workItem(id);
  if (!sim || !item || !['running', 'planning'].includes(item.state) || sim.waiting) throw new Conflict('中断できる状態ではありません');
  stop(id);
  sim.interrupted = true;
  sayNow(id, '作業を中断しました。VM はそのまま残しています。指示を送ると、続きから再開します。');
  ev(id, { type: 'workitem.state', state: 'suspended' });
  save();
}

export function cancel(id: string, reason = 'ラインを中止しました。VM は停止しています。', state: 'cancelled' | 'failed' = 'cancelled') {
  const d = getDb();
  const sim = d.sim[id];
  const item = workItem(id);
  if (!sim || !item || ['completed', 'failed', 'cancelled'].includes(item.state)) throw new Conflict('中止できる状態ではありません');
  stop(id);
  sim.queue = [];
  sim.waiting = null;
  sim.interrupted = false;
  for (const r of d.stageRuns[id] ?? []) if (r.state === 'running') Object.assign(r, { state: 'cancelled', endedAt: new Date(now()).toISOString() });
  sayNow(id, reason);
  ev(id, { type: 'workitem.state', state });
  save();
}

export function retry(id: string, runId: string) {
  const d = getDb();
  const sim = d.sim[id];
  const item = workItem(id);
  const run = d.stageRuns[id]?.find((r) => r.runId === runId);
  if (!sim || !item || !run) throw new Conflict('見つかりません');
  if (item.state !== 'failed' || run.state !== 'failed') throw new Conflict('やり直せるのは、失敗したステージだけです');
  sim.flags['retried'] = true;
  sim.stage = run.stageId;
  const attempt = (sim.attempts[run.stageId] ?? 0) + 1;
  sim.attempts[run.stageId] = attempt;
  ev(id, { type: 'workitem.state', state: 'running' });
  sim.queue = [{ t: 'say', delay: 300, text: `${run.stageId === 'verify' ? '検証' : 'ステージ'}をやり直します。` }, ...stageWork(sim.scenario, run.stageId, attempt, sim, false)];
  save();
  tick(id);
}

/** 管理者が VM を止めた */
export function terminateVm(workItemId: string) {
  cancel(workItemId, '管理者が VM を停止したため、作業を止めました。', 'failed');
}

export type { SimStep };
