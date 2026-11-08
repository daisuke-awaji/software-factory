import { describe, expect, it } from 'vitest';
import { Workflow } from './index.js';
import { analyzeWorkflow, graphEdges, inferNeeds, resolveNext, type GraphStep } from './workflow-graph.js';

const wf = (steps: GraphStep[]) => ({ steps });
const messages = (steps: GraphStep[]) => analyzeWorkflow(wf(steps)).issues.map((i) => i.message);

// 実装 → [単体テスト, E2E] → 振り分け →（small）完了 /（large）セキュリティレビュー → 完了
const parallel: GraphStep[] = [
  { id: 'implement', next: ['unit-test', 'e2e'] },
  { id: 'unit-test', next: 'triage' },
  { id: 'e2e', next: 'triage' },
  {
    id: 'triage',
    needs: ['e2e', 'unit-test'],
    next: 'deliver',
    on: { cases: { large: 'security-review' }, fail: { goto: 'implement', maxLoops: 2 } },
  },
  { id: 'security-review', next: 'deliver' },
  { id: 'deliver' },
];

describe('ワークフローのグラフ', () => {
  it('一列と戻りだけのワークフローは、そのまま通る', () => {
    const a = analyzeWorkflow(
      wf([
        { id: 'implement', next: 'verify' },
        { id: 'verify', on: { pass: 'review', fail: { goto: 'implement', maxLoops: 2 } } },
        { id: 'review', next: 'deliver' },
        { id: 'deliver' },
      ]),
    );
    expect(a.issues).toEqual([]);
    expect(a.layer).toEqual({ implement: 0, verify: 1, review: 2, deliver: 3 });
    expect(a.edges.map((e) => [e.from, e.to, e.kind])).toContainEqual(['verify', 'implement', 'fail']);
  });

  it('並列と分岐を読み、枝と合流を返す', () => {
    const a = analyzeWorkflow(wf(parallel));
    expect(a.issues).toEqual([]);
    expect(a.forks['implement']).toEqual({ join: 'triage', branches: { 'unit-test': ['unit-test'], e2e: ['e2e'] } });
    expect(a.regionOf).toMatchObject({ implement: null, 'unit-test': 'implement/unit-test', e2e: 'implement/e2e', triage: null });
    expect(a.layer).toMatchObject({ 'unit-test': 1, e2e: 1, triage: 2, 'security-review': 3, deliver: 4 });
    const edges = graphEdges(wf(parallel));
    expect(edges.filter((e) => e.parallel).map((e) => e.to)).toEqual(['unit-test', 'e2e']);
    expect(edges.find((e) => e.kind === 'case')).toMatchObject({ from: 'triage', to: 'security-review', label: 'large' });
  });

  it('並列の中に並列を入れられる', () => {
    const nested: GraphStep[] = [
      { id: 'start', next: ['left', 'right'] },
      { id: 'left', next: ['lint', 'unit'] },
      { id: 'lint', next: 'left-done' },
      { id: 'unit', next: 'left-done' },
      { id: 'left-done', needs: ['lint', 'unit'], next: 'merge' },
      { id: 'right', next: 'merge' },
      { id: 'merge', needs: ['left-done', 'right'] },
    ];
    const a = analyzeWorkflow(wf(nested));
    expect(a.issues).toEqual([]);
    expect(a.regionOf).toMatchObject({ lint: 'left/lint', 'left-done': 'start/left', right: 'start/right', merge: null });
    expect(inferNeeds(wf(nested.map(({ needs: _n, ...s }) => s))).steps.filter((s) => s.needs)).toEqual([
      { id: 'left-done', needs: ['lint', 'unit'], next: 'merge' },
      { id: 'merge', needs: ['left-done', 'right'] },
    ]);
  });

  it('needs を書かずに合流させると、知らせる', () => {
    const steps = parallel.map(({ needs: _n, ...s }) => s);
    expect(messages(steps).join()).toMatch(/needs/);
  });

  it('needs が合流の直前のステップと違うと、正しい並びを知らせる', () => {
    const steps = parallel.map((s) => (s.id === 'triage' ? { ...s, needs: ['e2e', 'implement'] } : s));
    expect(messages(steps)).toContain('needs は [e2e, unit-test] にしてください（合流の直前のステップ）');
  });

  it('並列の枝が合流する前に終わると、知らせる', () => {
    const steps = parallel.map((s) => (s.id === 'e2e' ? { id: 'e2e' } : s));
    expect(messages(steps).join()).toContain('並列の枝「e2e」が、合流する前の「e2e」で終わっています');
  });

  it('並列の枝から外へ戻ること・外から枝の途中へ入ることはできない', () => {
    const out = parallel.map((s) => (s.id === 'e2e' ? { ...s, on: { fail: { goto: 'implement', maxLoops: 1 } } } : s));
    expect(messages(out)).toContain('失敗したときの戻り先「implement」は、「e2e」と同じ並列の枝の中にしてください');
    const into: GraphStep[] = [
      { id: 'a', next: ['b', 'c'] },
      { id: 'b', next: 'b2' },
      { id: 'b2', next: 'j' },
      { id: 'c', next: 'j' },
      { id: 'j', needs: ['b2', 'c'], on: { fail: { goto: 'b2', maxLoops: 1 } } },
    ];
    expect(messages(into)).toContain('失敗したときの戻り先「b2」は、「j」と同じ並列の枝の中にしてください');
  });

  it('枝どうしが needs なしで合わさると、知らせる', () => {
    const steps: GraphStep[] = [
      { id: 'a', next: ['b', 'c'] },
      { id: 'b', next: 'x' },
      { id: 'c', next: 'x' },
      { id: 'x', next: 'j' },
      { id: 'j', needs: ['b', 'c'] },
    ];
    expect(messages(steps).join()).toContain('needs で待たずに「x」で合わさっています');
  });

  it('前へ進む矢印の輪・たどり着けないステップ・存在しない参照・自分自身への矢印を知らせる', () => {
    expect(
      messages([
        { id: 'a', next: 'b' },
        { id: 'b', next: 'a' },
      ])[0],
    ).toMatch(/輪になっています/);
    expect(messages([{ id: 'a' }, { id: 'b' }])).toEqual(['「b」には、最初のステップからたどり着けません']);
    expect(messages([{ id: 'a', next: 'zz' }])).toEqual(['存在しないステップ「zz」を指しています']);
    expect(messages([{ id: 'a', next: 'a' }])[0]).toMatch(/自分自身には進めません/);
    expect(messages([{ id: 'a', on: { fail: { goto: 'a', maxLoops: 1 } } }])).toEqual([]);
    expect(messages([{ id: 'a', next: 'b', on: { pass: 'b' } }, { id: 'b' }])).toEqual([
      'next と on.pass は、どちらか一方だけにしてください',
    ]);
    expect(messages([{ id: 'a', next: ['b'] }, { id: 'b' }])).toEqual(['並列にするときは、2つ以上のステップを並べてください']);
    expect(messages([{ id: 'a', needs: ['b', 'c'], next: 'b' }, { id: 'b', next: 'c' }, { id: 'c' }])).toEqual([
      '「a」に needs がありますが、並列で始めた枝の合流になっていません',
    ]);
  });

  it('結果から次のステップを決める', () => {
    const triage = parallel[3]!;
    expect(resolveNext(triage, 'pass', 'large')).toEqual({ targets: ['security-review'] });
    expect(resolveNext(triage, 'pass', 'small')).toEqual({ targets: ['deliver'] });
    expect(resolveNext(triage, 'pass')).toEqual({ targets: ['deliver'] });
    expect(resolveNext(triage, 'fail')).toEqual({ targets: ['implement'], loop: { goto: 'implement', maxLoops: 2 } });
    expect(resolveNext(parallel[0]!, 'pass')).toEqual({ targets: ['unit-test', 'e2e'] });
    expect(resolveNext({ id: 'end' }, 'pass')).toEqual({ targets: [] });
  });

  it('エディタ用に needs を付け直すと、検証が通る', () => {
    const fixed = inferNeeds(wf(parallel.map(({ needs: _n, ...s }) => s)));
    expect(fixed.steps.find((s) => s.id === 'triage')?.needs).toEqual(['e2e', 'unit-test']);
    expect(analyzeWorkflow(fixed).issues).toEqual([]);
  });

  it('Workflow の Zod スキーマで、グラフの誤りを項目の場所つきで返す', () => {
    const base = { name: 'x', version: 1 };
    const ok = Workflow.safeParse({ ...base, steps: parallel.map((s) => ({ ...s, type: 'agent' })) });
    expect(ok.success).toBe(true);
    const bad = Workflow.safeParse({ ...base, steps: [{ id: 'aa', type: 'agent', next: 'zz' }] });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]).toMatchObject({ path: ['steps', 0, 'next'], message: '存在しないステップ「zz」を指しています' });
    expect(Workflow.safeParse({ ...base, steps: [{ id: 'aa', type: 'agent', on: { cases: { Big: 'aa' } } }] }).success).toBe(false);
  });
});
