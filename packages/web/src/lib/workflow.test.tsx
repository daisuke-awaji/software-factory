// 進み具合（並列・分岐の列、通らなかった行き先）のテスト
import { type FactoryEvent, type FactoryEventEnvelope, type Plan, type Task, ulid } from '@factory/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StepProgress } from '../components/StepProgress';
import type { DistributiveOmit } from '../mocks/db';
import { workflows } from '../mocks/fixtures';
import { emptySession, reduceAll } from './session';
import { progressFromSession, progressFromTask, stepStatusesFromSession } from './workflow';

const wf = workflows.find((w) => w.name === 'build-parallel')!.workflow;
const id = ulid();
let t = Date.UTC(2026, 10, 7, 1, 0, 0);
const ev = (e: DistributiveOmit<FactoryEvent, 'taskId'>): FactoryEventEnvelope => ({ ...e, taskId: id, eventId: ulid((t += 1000)) }) as FactoryEventEnvelope;
const plan: Plan = { summaryForHumans: 's', goal: 'g', deliverables: [], repos: [], steps: ['a'], doneCriteria: [], externalAccess: [], estimate: { minutes: 1, usd: 0.1 } };
const step = (stepId: string, state: 'started' | 'completed' | 'failed', label?: string) => ev({ type: 'step.changed', stepId, state, ...(label ? { label } : {}) });
const approved = [ev({ type: 'plan.proposed', planVersion: 1, plan }), ev({ type: 'plan.decided', planVersion: 1, decision: 'approved', by: 'a' }), ev({ type: 'task.state', state: 'running' })];

describe('ワークフローの進み具合', () => {
  it('並列の枝は同じ列に並び、両方が動いている', () => {
    const s = reduceAll(emptySession(id), [step('implement', 'started'), ...approved, step('implement', 'completed'), step('unit-test', 'started'), step('e2e', 'started'), step('unit-test', 'completed')]);
    const p = progressFromSession(wf, s);
    expect(p.map((x) => `${x.column}:${x.id}:${x.status}`)).toEqual([
      '0:__plan:done', '1:implement:done', '2:unit-test:done', '2:e2e:running', '3:triage:waiting', '4:security-review:waiting', '5:deliver:waiting',
    ]);
  });

  it('分岐で選ばなかった行き先は「通らなかった」にし、戻って2回目なら回数を出す', () => {
    const s = reduceAll(emptySession(id), [
      step('implement', 'started'), ...approved, step('implement', 'completed'),
      step('unit-test', 'started'), step('e2e', 'started'), step('unit-test', 'completed'), step('e2e', 'completed'),
      step('triage', 'started'), step('triage', 'failed'),
      step('implement', 'started'), step('implement', 'completed'),
      step('unit-test', 'started'), step('e2e', 'started'), step('unit-test', 'completed'), step('e2e', 'completed'),
      step('triage', 'started'), step('triage', 'completed', 'small'), step('deliver', 'started'),
    ]);
    const st = stepStatusesFromSession(wf, s);
    expect(st['triage']).toEqual({ status: 'done', attempts: 2, caseLabel: 'small' });
    expect(st['security-review']?.status).toBe('skipped');
    expect(st['deliver']?.status).toBe('running');
    expect(progressFromSession(wf, s).find((x) => x.id === 'implement')?.sub).toBe('web@5 · 2 回目');
  });

  it('一覧では、並列で動いているステップ（activeStepIds）をすべて実行中にする', () => {
    const item = { id, state: 'running', currentStepId: 'e2e', activeStepIds: ['unit-test', 'e2e'] } as Task;
    expect(progressFromTask(wf, item).map((x) => `${x.id}:${x.status}`)).toEqual([
      '__plan:done', 'implement:done', 'unit-test:running', 'e2e:running', 'triage:waiting', 'security-review:waiting', 'deliver:waiting',
    ]);
  });

  it('同じ列のステップは点を縦に重ね、読み上げでは名前と状態をすべて伝える', () => {
    const s = reduceAll(emptySession(id), [step('implement', 'started'), ...approved, step('implement', 'completed'), step('unit-test', 'started'), step('e2e', 'started')]);
    render(<StepProgress steps={progressFromSession(wf, s)} size="sm" />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(6);
    expect(items[2]).toHaveTextContent('単体テスト・E2E');
    expect(items[2]).toHaveTextContent('単体テスト: 実行中、E2E: 実行中');
    expect(items[2]).toHaveAttribute('data-status', 'running');
  });
});
