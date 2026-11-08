// イベントの畳み込み（純粋な関数）のテスト
import { type FactoryEvent, type FactoryEventEnvelope, type Plan, ulid } from '@factory/contracts';
import type { DistributiveOmit } from '../mocks/db';
import { describe, expect, it } from 'vitest';
import { emptySession, pendingOf, reduce, reduceAll } from './session';

const wid = ulid();
let t = Date.UTC(2026, 10, 7, 1, 0, 0);
const ev = (e: DistributiveOmit<FactoryEvent, 'taskId'>): FactoryEventEnvelope =>
  ({ ...e, taskId: wid, eventId: ulid((t += 1000)) }) as FactoryEventEnvelope;
const plan: Plan = {
  summaryForHumans: 's',
  goal: 'g',
  deliverables: [],
  repos: [],
  steps: ['a'],
  doneCriteria: [],
  externalAccess: [],
  estimate: { minutes: 1, usd: 0.1 },
};

describe('reduce', () => {
  it('同じ eventId は2回反映しない（WebSocket と履歴の両方から届く）', () => {
    const e = ev({ type: 'message.delta', messageId: 'm1', text: 'こん' });
    const s = reduceAll(emptySession(wid), [e, e, ev({ type: 'message.delta', messageId: 'm1', text: 'にちは' })]);
    expect(s.messages['m1']?.text).toBe('こんにちは');
    expect(s.timeline).toHaveLength(1);
  });

  it('別のタスクのイベントは無視する', () => {
    const s0 = emptySession(wid);
    const other = { ...ev({ type: 'egress.blocked', host: 'x.example' }), taskId: ulid() } as FactoryEventEnvelope;
    expect(reduce(s0, other)).toBe(s0);
  });

  it('続けて動いたツールは1つのまとまりになり、発言で区切られる', () => {
    const s = reduceAll(emptySession(wid), [
      ev({ type: 'step.changed', stepId: 'implement', state: 'started' }),
      ev({ type: 'tool.started', toolUseId: 't1', tool: 'read_file', summary: 'a' }),
      ev({ type: 'tool.finished', toolUseId: 't1', ok: true }),
      ev({ type: 'tool.started', toolUseId: 't2', tool: 'edit_file', summary: 'b' }),
      ev({ type: 'tool.finished', toolUseId: 't2', ok: true, summary: '保存しました' }),
      ev({ type: 'message.delta', messageId: 'm', text: 'x' }),
      ev({ type: 'tool.started', toolUseId: 't3', tool: 'run', summary: 'c' }),
    ]);
    expect(s.timeline.map((e) => e.k)).toEqual(['work', 'assistant', 'work']);
    expect(s.runs[0]?.tools).toEqual(['t1', 't2', 't3']);
    expect(s.tools['t2']?.result).toBe('保存しました');
    expect(s.fileVersion).toBe(1); // edit_file が成功した
  });

  it('ステップの実行は回数ごとに分ける（verify#2）', () => {
    const s = reduceAll(emptySession(wid), [
      ev({ type: 'step.changed', stepId: 'verify', state: 'started' }),
      ev({ type: 'step.changed', stepId: 'verify', state: 'failed' }),
      ev({ type: 'step.changed', stepId: 'verify', state: 'started' }),
    ]);
    expect(s.runs.map((r) => `${r.runId}:${r.state}`)).toEqual(['verify#1:failed', 'verify#2:running']);
  });

  it('並列で動いているときは、ツールを stepId のステップに入れ、終わったときのラベルを残す', () => {
    const s = reduceAll(emptySession(wid), [
      ev({ type: 'step.changed', stepId: 'unit-test', state: 'started' }),
      ev({ type: 'step.changed', stepId: 'e2e', state: 'started' }),
      ev({ type: 'tool.started', toolUseId: 't1', tool: 'run', summary: 'npm test', stepId: 'unit-test' }),
      ev({ type: 'tool.started', toolUseId: 't2', tool: 'run', summary: 'playwright', stepId: 'e2e' }),
      ev({ type: 'step.changed', stepId: 'unit-test', state: 'completed', label: 'small' }),
    ]);
    expect(s.runs.map((r) => [r.stepId, r.tools, r.state, r.label])).toEqual([
      ['unit-test', ['t1'], 'completed', 'small'],
      ['e2e', ['t2'], 'running', undefined],
    ]);
  });

  it('承認待ちのときに、何を待っているかが分かる', () => {
    let s = reduceAll(emptySession(wid), [
      ev({ type: 'plan.proposed', planVersion: 1, plan }),
      ev({ type: 'task.state', state: 'awaiting_approval' }),
    ]);
    expect(pendingOf(s)).toMatchObject({ kind: 'plan', version: 1 });
    s = reduceAll(s, [
      ev({ type: 'plan.decided', planVersion: 1, decision: 'approved', by: '佐藤' }),
      ev({ type: 'task.state', state: 'running' }),
      ev({ type: 'approval.required', approvalId: 'a1', reason: 'egress', detail: 'd' }),
      ev({ type: 'task.state', state: 'awaiting_approval' }),
    ]);
    expect(pendingOf(s)).toMatchObject({ kind: 'approval', approval: { id: 'a1' } });
    s = reduceAll(s, [
      ev({ type: 'approval.resolved', approvalId: 'a1', decision: 'approve', by: '佐藤' }),
      ev({ type: 'task.state', state: 'running' }),
    ]);
    expect(pendingOf(s)).toBeNull();
  });
});
