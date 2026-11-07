// ワークフローをグラフとして読む（分岐・並列・戻り）。登録するときの検証と、画面の図・実行エンジンで同じ解釈を使う
// 矢印の向き: next / on.pass / on.cases は「前へ進む」、on.fail.goto は「戻る」。前へ進む矢印だけで輪を作ってはいけない

/** グラフとして読むのに要る項目だけ（index.ts の StepDef と同じ形） */
export type GraphStep = {
  id: string;
  next?: string | string[] | undefined;
  needs?: string[] | undefined;
  on?: { pass?: string | undefined; cases?: Record<string, string> | undefined; fail?: { goto: string; maxLoops: number } | undefined } | undefined;
};
export type GraphWorkflow = { steps: GraphStep[] };

export type GraphEdgeKind = 'next' | 'case' | 'fail';
export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  kind: GraphEdgeKind;
  /** case のラベル */
  label?: string;
  /** fail の回数の上限 */
  maxLoops?: number;
  /** 並列で始める矢印（next が配列） */
  parallel?: boolean;
};

export type GraphIssue = { path: (string | number)[]; message: string };

export type GraphAnalysis = {
  edges: GraphEdge[];
  issues: GraphIssue[];
  /** 並列の始まり → 合流するステップと、枝ごとのステップ */
  forks: Record<string, { join: string; branches: Record<string, string[]> }>;
  /** ステップ → いちばん内側の並列の枝（`fork/branchStart`）。並列の外は null */
  regionOf: Record<string, string | null>;
  /** 前へ進む矢印でいちばん長く辿ったときの段（0 始まり。画面の進み具合の列に使う） */
  layer: Record<string, number>;
};

export const MAX_PARALLEL = 8;

export const nextTargets = (s: GraphStep): string[] => (s.next === undefined ? [] : Array.isArray(s.next) ? s.next : [s.next]);

/** 前へ進む先（重複なし）。next / on.pass / on.cases の順 */
export function forwardTargets(s: GraphStep): string[] {
  return [...new Set([...nextTargets(s), ...(s.on?.pass ? [s.on.pass] : []), ...Object.values(s.on?.cases ?? {})])];
}

export function graphEdges(wf: GraphWorkflow): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const s of wf.steps) {
    const parallel = Array.isArray(s.next) && s.next.length > 1;
    for (const to of nextTargets(s)) edges.push({ id: `${s.id}->${to}`, from: s.id, to, kind: 'next', ...(parallel ? { parallel } : {}) });
    if (s.on?.pass) edges.push({ id: `${s.id}->${s.on.pass}`, from: s.id, to: s.on.pass, kind: 'next' });
    for (const [label, to] of Object.entries(s.on?.cases ?? {})) edges.push({ id: `${s.id}=${label}->${to}`, from: s.id, to, kind: 'case', label });
    if (s.on?.fail) edges.push({ id: `${s.id}!->${s.on.fail.goto}`, from: s.id, to: s.on.fail.goto, kind: 'fail', maxLoops: s.on.fail.maxLoops });
  }
  return edges;
}

/** 結果から次に進むステップを決める（cases のラベルが合えばその先、なければ next / on.pass。失敗なら on.fail.goto） */
export function resolveNext(s: GraphStep, verdict: 'pass' | 'fail', label?: string): { targets: string[]; loop?: { goto: string; maxLoops: number } } {
  if (verdict === 'fail') return s.on?.fail ? { targets: [s.on.fail.goto], loop: s.on.fail } : { targets: [] };
  const byCase = label !== undefined ? s.on?.cases?.[label] : undefined;
  if (byCase) return { targets: [byCase] };
  return { targets: s.on?.pass ? [s.on.pass] : nextTargets(s) };
}


const isFork = (s: GraphStep) => Array.isArray(s.next) && s.next.length > 1;

/** 前へ進む矢印で並べた順（輪があれば、輪の上のステップを返す） */
function topoOrder(wf: GraphWorkflow, get: (id: string) => GraphStep | undefined): { order: string[]; cycle: string | null } {
  const order: string[] = [];
  const mark = new Map<string, 'doing' | 'done'>();
  let cycle: string | null = null;
  const visit = (id: string) => {
    const m = mark.get(id);
    if (cycle || m === 'done') return;
    if (m === 'doing') {
      cycle = id;
      return;
    }
    mark.set(id, 'doing');
    const s = get(id);
    if (s) for (const t of forwardTargets(s)) if (get(t)) visit(t);
    mark.set(id, 'done');
    order.push(id);
  };
  for (const s of wf.steps) visit(s.id);
  return { order: order.reverse(), cycle };
}

export function analyzeWorkflow(wf: GraphWorkflow): GraphAnalysis {
  const issues: GraphIssue[] = [];
  const edges = graphEdges(wf);
  const result: GraphAnalysis = { edges, issues, forks: {}, regionOf: {}, layer: {} };
  const index = new Map<string, number>();
  wf.steps.forEach((s, i) => {
    if (index.has(s.id)) issues.push({ path: ['steps', i, 'id'], message: `ステップの id「${s.id}」が重なっています` });
    else index.set(s.id, i);
  });
  const at = (id: string) => index.get(id)!;
  const step = (id: string) => wf.steps[at(id)]!;

  // 参照
  wf.steps.forEach((s, i) => {
    const ref = (to: string, path: (string | number)[]) => {
      if (!index.has(to)) issues.push({ path: ['steps', i, ...path], message: `存在しないステップ「${to}」を指しています` });
      else if (to === s.id && path[1] !== 'fail') issues.push({ path: ['steps', i, ...path], message: '自分自身には進めません（やり直すときは on.fail.goto を使ってください）' });
    };
    if (Array.isArray(s.next)) {
      if (s.next.length < 2) issues.push({ path: ['steps', i, 'next'], message: '並列にするときは、2つ以上のステップを並べてください' });
      if (s.next.length > MAX_PARALLEL) issues.push({ path: ['steps', i, 'next'], message: `並列にできるのは ${MAX_PARALLEL} つまでです` });
      if (new Set(s.next).size !== s.next.length) issues.push({ path: ['steps', i, 'next'], message: '同じステップが2回並んでいます' });
      if (s.on?.pass || (s.on?.cases && Object.keys(s.on.cases).length)) issues.push({ path: ['steps', i, 'on'], message: '並列で始めるステップには、on.pass と on.cases は書けません' });
      s.next.forEach((to, j) => ref(to, ['next', j]));
    } else if (s.next !== undefined) ref(s.next, ['next']);
    if (s.next !== undefined && s.on?.pass) issues.push({ path: ['steps', i, 'on', 'pass'], message: 'next と on.pass は、どちらか一方だけにしてください' });
    if (s.on?.pass) ref(s.on.pass, ['on', 'pass']);
    for (const [label, to] of Object.entries(s.on?.cases ?? {})) ref(to, ['on', 'cases', label]);
    if (s.on?.fail) ref(s.on.fail.goto, ['on', 'fail', 'goto']);
    (s.needs ?? []).forEach((n, j) => {
      if (!index.has(n)) issues.push({ path: ['steps', i, 'needs', j], message: `存在しないステップ「${n}」を待とうとしています` });
    });
  });
  if (issues.length || wf.steps.length === 0) return result;

  // 前へ進む矢印だけで輪にしない
  const { order, cycle } = topoOrder(wf, (id) => (index.has(id) ? step(id) : undefined));
  if (cycle) {
    issues.push({ path: ['steps', at(cycle)], message: `「${cycle}」を通る輪になっています。前のステップに戻るときは on.fail.goto（回数の上限付き）を使ってください` });
    return result;
  }

  // 最初のステップから辿り着ける（戻る矢印も使ってよい）
  const reach = new Set<string>();
  const stack = [wf.steps[0]!.id];
  while (stack.length) {
    const id = stack.pop()!;
    if (reach.has(id)) continue;
    reach.add(id);
    const s = step(id);
    stack.push(...forwardTargets(s), ...(s.on?.fail ? [s.on.fail.goto] : []));
  }
  wf.steps.forEach((s, i) => {
    if (!reach.has(s.id)) issues.push({ path: ['steps', i], message: `「${s.id}」には、最初のステップからたどり着けません` });
  });

  // 段（いちばん長い道のり）
  for (const id of order) {
    result.layer[id] ??= 0;
    for (const t of forwardTargets(step(id))) result.layer[t] = Math.max(result.layer[t] ?? 0, result.layer[id]! + 1);
  }

  // 並列: 枝ごとに、合流するステップ（needs を持つ）まで辿る
  const { regionOf, forks } = result;
  const owner = new Map<string, string>(); // 合流 → 並列の始まり
  const resolveFork = (fork: string): string | null => {
    if (forks[fork]) return forks[fork].join;
    const fi = at(fork);
    const branchOf = new Map<string, string>();
    const branches: Record<string, string[]> = {};
    const hits: Record<string, Set<string>> = {};
    const tails = new Set<string>();
    let ok = true;
    for (const start of nextTargets(step(fork))) {
      const nodes: string[] = [];
      const hit = new Set<string>();
      const todo = [start];
      while (todo.length) {
        const id = todo.pop()!;
        if (nodes.includes(id)) continue;
        const other = branchOf.get(id);
        if (other !== undefined) {
          issues.push({ path: ['steps', at(id)], message: `並列の枝「${other}」と「${start}」が、needs で待たずに「${id}」で合わさっています` });
          ok = false;
          continue;
        }
        branchOf.set(id, start);
        nodes.push(id);
        const s = step(id);
        if (isFork(s)) {
          // 内側の並列は、その合流まで飛ばす
          const inner = resolveFork(id);
          if (!inner) {
            ok = false;
            continue;
          }
          for (const ns of Object.values(forks[id]!.branches)) for (const n of ns) branchOf.set(n, start), nodes.push(n);
          todo.push(inner);
          continue;
        }
        const targets = forwardTargets(s);
        if (targets.length === 0) {
          issues.push({ path: ['steps', at(id)], message: `並列の枝「${start}」が、合流する前の「${id}」で終わっています` });
          ok = false;
        }
        for (const t of targets) {
          if (step(t).needs?.length) {
            hit.add(t);
            tails.add(id);
          } else todo.push(t);
        }
      }
      branches[start] = nodes;
      hits[start] = hit;
    }
    const joins = new Set(Object.values(hits).flatMap((h) => [...h]));
    if (joins.size !== 1 || Object.values(hits).some((h) => h.size !== 1)) {
      if (ok) issues.push({ path: ['steps', fi, 'next'], message: `「${fork}」から並列で始めた枝が、1つのステップで合流していません。合流するステップに needs を書いてください` });
      return null;
    }
    const join = [...joins][0]!;
    const want = [...tails].sort();
    const have = [...(step(join).needs ?? [])].sort();
    if (want.join() !== have.join()) issues.push({ path: ['steps', at(join), 'needs'], message: `needs は [${want.join(', ')}] にしてください（合流の直前のステップ）` });
    if (owner.has(join)) issues.push({ path: ['steps', at(join), 'needs'], message: `「${join}」が、2つの並列の合流になっています` });
    owner.set(join, fork);
    forks[fork] = { join, branches };
    for (const [b, ns] of Object.entries(branches)) for (const n of ns) regionOf[n] ??= `${fork}/${b}`;
    return join;
  };
  for (const id of order) if (isFork(step(id))) resolveFork(id);
  for (const id of order) regionOf[id] ??= null;
  wf.steps.forEach((s, i) => {
    if (s.needs?.length && !owner.has(s.id)) issues.push({ path: ['steps', i, 'needs'], message: `「${s.id}」に needs がありますが、並列で始めた枝の合流になっていません` });
  });

  // 並列の枝の途中には、外から入れない。失敗したときの戻り先は、同じ枝の中だけ
  for (const e of edges) {
    const from = regionOf[e.from] ?? null;
    const to = regionOf[e.to] ?? null;
    if (from === to) continue;
    if (e.kind === 'fail') {
      issues.push({ path: ['steps', at(e.from), 'on', 'fail', 'goto'], message: `失敗したときの戻り先「${e.to}」は、「${e.from}」と同じ並列の枝の中にしてください` });
      continue;
    }
    const enters = to === `${e.from}/${e.to}`;
    const exits = from !== null && forks[from.split('/')[0]!]?.join === e.to;
    if (!enters && !exits) issues.push({ path: ['steps', at(e.from)], message: `「${e.from}」から、並列の枝の途中の「${e.to}」に入っています` });
  }
  return result;
}

/** エディタ用: 並列の合流を見つけて needs を付け直す（ほかの項目は変えない） */
export function inferNeeds<T extends GraphWorkflow>(wf: T): T {
  const byId = new Map(wf.steps.map((s) => [s.id, s]));
  const get = (id: string) => byId.get(id);
  const { order, cycle } = topoOrder(wf, get);
  if (cycle) return wf;
  const pos = new Map(order.map((id, i) => [id, i]));
  const reachFrom = (start: string) => {
    const seen = new Set<string>();
    const todo = [start];
    while (todo.length) {
      const id = todo.pop()!;
      const s = get(id);
      if (!s || seen.has(id)) continue;
      seen.add(id);
      todo.push(...forwardTargets(s));
    }
    return seen;
  };
  const needs = new Map<string, Set<string>>();
  for (const f of wf.steps.filter(isFork)) {
    const sets = nextTargets(f).filter((b) => byId.has(b)).map(reachFrom);
    if (sets.length < 2) continue;
    const common = [...sets[0]!].filter((n) => sets.every((r) => r.has(n)));
    const join = common.sort((a, b) => pos.get(a)! - pos.get(b)!)[0];
    if (!join) continue;
    const inside = new Set(sets.flatMap((r) => [...r]).filter((n) => !common.includes(n)));
    const tails = wf.steps.filter((s) => inside.has(s.id) && forwardTargets(s).includes(join)).map((s) => s.id);
    // 枝の始まりがそのまま合流になっている（枝が空）なら、needs は付けない（検証で知らせる）
    if (tails.length < 2 || nextTargets(f).includes(join)) continue;
    needs.set(join, new Set([...(needs.get(join) ?? []), ...tails]));
  }
  return {
    ...wf,
    steps: wf.steps.map((s) => {
      const { needs: _drop, ...rest } = s;
      const n = needs.get(s.id);
      return n && n.size ? { ...rest, needs: [...n].sort() } : rest;
    }),
  };
}
