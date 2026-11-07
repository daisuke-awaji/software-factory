// ワークフローのエディタの操作と、YAML への書き戻しのテスト
import { analyzeWorkflow, Workflow } from '@factory/contracts';
import { describe, expect, it } from 'vitest';
import { workflowYaml } from '../mocks/fixtures';
import {
  addStep, branchMode, connect, disconnect, draftToYaml, makeDefault, parseDraft, removeStep, renameCase, renameStep, setBranchMode, setMaxLoops, updateStep, type Draft,
} from './workflowEdit';

const load = (name: string): Draft => {
  const r = parseDraft(workflowYaml[name]!, 1);
  if (!r.ok) throw new Error(r.error);
  return r.draft;
};
const ok = (d: Draft) => expect(analyzeWorkflow(d).issues.map((i) => i.message)).toEqual([]);
const step = (d: Draft, id: string) => d.steps.find((s) => s.id === id)!;

describe('エディタの操作', () => {
  it('つないで並列にすると、合流に needs が付き、検証が通る', () => {
    let d = load('build-verify');
    // 検証のあと、レビューと並べて E2E を流す
    const added = addStep(d, 'agent');
    d = renameStep(added.draft, added.id, 'e2e');
    d = connect(d, 'verify', 'e2e', 'forward');
    // 検証の on.pass は、図で触ると next にそろう
    expect(step(d, 'verify').next).toEqual(['review', 'e2e']);
    expect(step(d, 'verify').on).toEqual({ fail: { goto: 'implement', maxLoops: 2 } });
    expect(branchMode(step(d, 'verify'))).toBe('parallel');
    d = connect(d, 'e2e', 'deliver', 'forward');
    expect(step(d, 'deliver').needs).toEqual(['e2e', 'review']);
    ok(d);
    expect(() => Workflow.parse(d)).not.toThrow();
    // 並列の枝の中から、枝の外へは戻れない
    expect(analyzeWorkflow(connect(d, 'e2e', 'implement', 'fail')).issues[0]?.message).toMatch(/同じ並列の枝の中/);
  });

  it('並列を「結果で分ける」に切り替えると、ラベルを付け、合流の needs を外す', () => {
    let d = load('build-parallel');
    d = setBranchMode(d, 'implement', 'cases');
    expect(step(d, 'implement').next).toBe('unit-test');
    expect(step(d, 'implement').on?.cases).toEqual({ 'case-1': 'e2e' });
    expect(step(d, 'triage').needs).toBeUndefined();
    ok(d);
    d = renameCase(d, 'implement', 'case-1', 'ui');
    expect(step(d, 'implement').on?.cases).toEqual({ ui: 'e2e' });
    d = makeDefault(d, 'implement', 'ui');
    expect(step(d, 'implement').next).toBe('e2e');
    expect(step(d, 'implement').on?.cases).toEqual({ ui: 'unit-test' });
    d = setBranchMode(d, 'implement', 'parallel');
    expect(step(d, 'implement').next).toEqual(['e2e', 'unit-test']);
    expect(step(d, 'triage').needs).toEqual(['e2e', 'unit-test']);
    ok(d);
  });

  it('一列の途中に足す・消すと、前後をつなぎ直す', () => {
    let d = load('build-verify');
    const { draft, id } = addStep(d, 'approval', 'review');
    expect(step(draft, 'review').next).toBe(id);
    expect(step(draft, id).next).toBe('deliver');
    ok(draft);
    d = removeStep(draft, id);
    expect(step(d, 'review').next).toBe('deliver');
    // 戻り先を消すと、戻る矢印もなくなる
    d = removeStep(d, 'implement');
    expect(step(d, 'verify').on?.fail).toBeUndefined();
    expect(d.steps[0]!.id).toBe('verify');
    ok(d);
  });

  it('矢印を消す・失敗したときの戻り先と回数・最初のステップを変える', () => {
    let d = load('build-parallel');
    d = disconnect(d, 'triage=large->security-review');
    expect(step(d, 'triage').on?.cases).toBeUndefined();
    d = disconnect(d, 'triage!->implement');
    expect(step(d, 'triage').on).toBeUndefined();
    d = connect(d, 'triage', 'implement', 'fail');
    d = setMaxLoops(d, 'triage', 3);
    expect(step(d, 'triage').on?.fail).toEqual({ goto: 'implement', maxLoops: 3 });
    d = disconnect(d, 'implement->e2e');
    expect(step(d, 'implement').next).toBe('unit-test');
    expect(step(d, 'triage').needs).toBeUndefined();
    d = connect(d, '__plan', 'deliver', 'start');
    expect(d.steps[0]!.id).toBe('deliver');
  });

  it('id を変えると、ほかのステップからの参照もそろう', () => {
    const d = renameStep(load('build-parallel'), 'triage', 'gate');
    expect(step(d, 'unit-test').next).toBe('gate');
    expect(step(d, 'gate').needs).toEqual(['e2e', 'unit-test']);
    expect(renameStep(d, 'gate', 'deliver')).toBe(d);
    ok(d);
  });

  it('中身を変え、undefined の項目は消す', () => {
    const d = updateStep(load('build-verify'), 'review', { network: undefined, instructions: 'skills/review2.md' });
    expect(step(d, 'review').network).toBeUndefined();
    expect(step(d, 'review').instructions).toBe('skills/review2.md');
  });
});

describe('YAML との行き来', () => {
  it('元の YAML のコメントと書き方を残し、変えたところだけ直す', () => {
    const base = workflowYaml['build-parallel']!;
    const d = setMaxLoops(load('build-parallel'), 'triage', 3);
    const out = draftToYaml(d, base);
    expect(out).toContain('next: [unit-test, e2e] # 並列で始める');
    expect(out).toContain('needs: [e2e, unit-test] # 両方が終わるまで待つ');
    expect(out).toContain('fail: {goto: implement, maxLoops: 3}');
    expect(out.split('\n').length).toBe(base.split('\n').length);
    const back = parseDraft(out, 1);
    expect(back.ok && back.draft).toEqual(d);
  });

  it('変えていなければ、元の YAML と同じになる', () => {
    for (const name of Object.keys(workflowYaml)) expect(draftToYaml(load(name), workflowYaml[name])).toBe(workflowYaml[name]);
  });

  it('新しいステップは既定値の項目を省き、短い配列は1行で書く', () => {
    const d = addStep(load('build-verify'), 'command', 'implement').draft;
    const out = draftToYaml(d, workflowYaml['build-verify']);
    expect(out).toMatch(/- id: command\n {4}type: command\n {4}image: base@3\n {4}network: none\n {4}next: verify\n/);
    expect(out).toContain('    next: command\n');
    expect(out).not.toContain('timeoutHours');
    expect(parseDraft(out, 1)).toEqual({ ok: true, draft: d });
    // 並列の始まりから合流へ直接つなぐ（空の枝）と、needs は付けずに検証で知らせる
    const empty = connect(d, 'implement', 'verify', 'forward');
    expect(empty.steps.find((s) => s.id === 'verify')?.needs).toBeUndefined();
    expect(analyzeWorkflow(empty).issues.length).toBeGreaterThan(0);
    expect(draftToYaml(load('build-parallel'))).toContain('next: [unit-test, e2e]');
  });

  it('元の YAML がなければ、一から書く', () => {
    const out = draftToYaml(load('chat'));
    expect(parseDraft(out, 1)).toEqual({ ok: true, draft: load('chat') });
  });

  it('読めない YAML と、項目の形の誤りを知らせる', () => {
    expect(parseDraft('steps: [', 1)).toMatchObject({ ok: false, error: expect.stringContaining('YAML として読めません') });
    expect(parseDraft('name: x\nsteps:\n  - id: A\n    type: agent\n', 1)).toMatchObject({ ok: false, error: expect.stringContaining('steps.0.id') });
    // つながりの誤りは、図で直せるように通す
    expect(parseDraft('name: x\nsteps:\n  - { id: aa, type: agent, next: zz }\n', 1).ok).toBe(true);
  });
});
