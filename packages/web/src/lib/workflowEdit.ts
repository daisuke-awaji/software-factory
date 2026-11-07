// ワークフローのエディタの操作（純粋な関数）。図での操作はすべてここを通し、最後に needs を付け直す（inferNeeds）。
// YAML に書き戻すときは、元の YAML のコメントと書き方をできるだけ残す
import { forwardTargets, inferNeeds, nextTargets, StepId, WorkflowShape, type StepDef, type Workflow } from '@factory/contracts';
import { Document, isMap, isScalar, isSeq, parse as parseYaml, parseDocument, YAMLSeq, type YAMLMap } from 'yaml';

export type Draft = Workflow;
export type StepType = StepDef['type'];

const finish = (wf: Draft): Draft => inferNeeds(wf);
const map = (wf: Draft, id: string, fn: (s: StepDef) => StepDef): Draft => ({ ...wf, steps: wf.steps.map((s) => (s.id === id ? fn(s) : s)) });

/** on を整える（空になったら消す） */
function withOn(s: StepDef, on: NonNullable<StepDef['on']>): StepDef {
  const clean: NonNullable<StepDef['on']> = {};
  if (on.pass) clean.pass = on.pass;
  if (on.cases && Object.keys(on.cases).length) clean.cases = on.cases;
  if (on.fail) clean.fail = on.fail;
  const { on: _old, ...rest } = s;
  return Object.keys(clean).length ? { ...rest, on: clean } : rest;
}

function withNext(s: StepDef, next: string[]): StepDef {
  const { next: _old, ...rest } = s;
  if (next.length === 0) return rest;
  return { ...rest, next: next.length === 1 ? next[0]! : next };
}

/** on.pass は next と同じ意味なので、図で触ったステップは next にそろえる */
function normalizePass(s: StepDef): StepDef {
  if (!s.on?.pass) return s;
  const pass = s.on.pass;
  return withNext(withOn(s, { ...s.on, pass: undefined }), [...nextTargets(s), pass]);
}

export type BranchMode = 'single' | 'parallel' | 'cases' | 'end';
export function branchMode(s: StepDef): BranchMode {
  if (Object.keys(s.on?.cases ?? {}).length) return 'cases';
  if (Array.isArray(s.next) && s.next.length > 1) return 'parallel';
  return forwardTargets(s).length ? 'single' : 'end';
}

export function newStepId(wf: Draft, base: string): string {
  const ids = new Set(wf.steps.map((s) => s.id));
  if (!ids.has(base)) return base;
  for (let n = 2; ; n++) if (!ids.has(`${base}-${n}`)) return `${base}-${n}`;
}

const defaults: Record<StepType, (id: string) => StepDef> = {
  agent: (id) => ({ id, type: 'agent', image: 'base@3', network: 'none', gates: [], timeoutHours: 6, keepVm: false }),
  command: (id) => ({ id, type: 'command', image: 'base@3', network: 'none', gates: [], timeoutHours: 6, keepVm: false }),
  approval: (id) => ({ id, type: 'approval', gates: [], timeoutHours: 6, keepVm: false }),
  system: (id) => ({ id, type: 'system', action: 'create-pull-request', gates: [], timeoutHours: 6, keepVm: false }),
};
const baseId: Record<StepType, string> = { agent: 'agent', command: 'command', approval: 'approval', system: 'deliver' };

/** ステップを足す。after を渡すと、その後ろ（次が1つなら、その間）に入れる */
export function addStep(wf: Draft, type: StepType, after?: string): { draft: Draft; id: string } {
  const id = newStepId(wf, baseId[type]);
  let step = defaults[type](id);
  let steps = [...wf.steps];
  const at = after ? steps.findIndex((s) => s.id === after) : -1;
  if (at >= 0) {
    const prev = normalizePass(steps[at]!);
    const mode = branchMode(prev);
    if (mode === 'single' || mode === 'end') {
      const old = nextTargets(prev);
      if (old.length) step = withNext(step, old);
      steps[at] = withNext(prev, [id]);
    } else if (mode === 'parallel') {
      steps[at] = withNext(prev, [...nextTargets(prev), id]);
    } else {
      steps[at] = withOn(prev, { ...prev.on, cases: { ...prev.on?.cases, [newCaseLabel(prev)]: id } });
    }
    steps.splice(at + 1, 0, step);
  } else steps = [...steps, step];
  return { draft: finish({ ...wf, steps }), id };
}

function newCaseLabel(s: StepDef) {
  const used = new Set(Object.keys(s.on?.cases ?? {}));
  for (let n = 1; ; n++) if (!used.has(`case-${n}`)) return `case-${n}`;
}

/** ステップを消す。一列の途中なら、前と後ろをつなぎ直す */
export function removeStep(wf: Draft, id: string): Draft {
  const gone = wf.steps.find((s) => s.id === id);
  if (!gone || wf.steps.length <= 1) return wf;
  const bridge = (() => {
    const t = forwardTargets(gone);
    return t.length === 1 && !Object.keys(gone.on?.cases ?? {}).length ? t[0] : undefined;
  })();
  const steps = wf.steps.filter((s) => s.id !== id).map((s) => {
    let st = s;
    const nexts = nextTargets(st);
    if (nexts.includes(id)) {
      const replaced = nexts.flatMap((n) => (n === id ? (bridge && !nexts.includes(bridge) ? [bridge] : []) : [n]));
      st = withNext(st, replaced);
    }
    if (st.on?.pass === id) st = withOn(st, { ...st.on, pass: bridge });
    if (st.on?.cases && Object.values(st.on.cases).includes(id)) {
      st = withOn(st, { ...st.on, cases: Object.fromEntries(Object.entries(st.on.cases).filter(([, v]) => v !== id)) });
    }
    if (st.on?.fail?.goto === id) st = withOn(st, { ...st.on, fail: undefined });
    return st;
  });
  return finish({ ...wf, steps });
}

/** 矢印を足す: forward は前へ進む（2本目からは並列。結果で分けているときは cases に足す）、fail は失敗したときの戻り先、start は最初のステップにする */
export function connect(wf: Draft, from: string, to: string, kind: 'forward' | 'fail' | 'start'): Draft {
  if (kind === 'start') {
    const target = wf.steps.find((s) => s.id === to);
    return target ? finish({ ...wf, steps: [target, ...wf.steps.filter((s) => s.id !== to)] }) : wf;
  }
  if (kind === 'fail') return finish(map(wf, from, (s) => withOn(s, { ...s.on, fail: { goto: to, maxLoops: s.on?.fail?.maxLoops ?? 1 } })));
  if (from === to) return wf;
  return finish(map(wf, from, (raw) => {
    const s = normalizePass(raw);
    if (forwardTargets(s).includes(to)) return s;
    if (branchMode(s) === 'cases') return withOn(s, { ...s.on, cases: { ...s.on?.cases, [newCaseLabel(s)]: to } });
    return withNext(s, [...nextTargets(s), to]);
  }));
}

/** 矢印を消す（graphEdges の id を受け取る） */
export function disconnect(wf: Draft, edgeId: string): Draft {
  const fail = /^(.+)!->(.+)$/.exec(edgeId);
  if (fail) return finish(map(wf, fail[1]!, (s) => withOn(s, { ...s.on, fail: undefined })));
  const kase = /^(.+)=(.+)->(.+)$/.exec(edgeId);
  if (kase) return finish(map(wf, kase[1]!, (s) => withOn(s, { ...s.on, cases: Object.fromEntries(Object.entries(s.on?.cases ?? {}).filter(([k]) => k !== kase[2])) })));
  const fwd = /^(.+)->(.+)$/.exec(edgeId);
  if (!fwd) return wf;
  const [, from, to] = fwd as unknown as [string, string, string];
  return finish(map(wf, from, (raw) => {
    const s = normalizePass(raw);
    const next = nextTargets(s).filter((n) => n !== to);
    // 結果で分けていて「それ以外」の矢印を消したら、最初のラベルの先を「それ以外」にする
    if (branchMode(s) === 'cases' && next.length === 0) {
      const [first, ...rest] = Object.entries(s.on?.cases ?? {});
      if (first) return withNext(withOn(s, { ...s.on, cases: Object.fromEntries(rest) }), [first[1]]);
    }
    return withNext(s, next);
  }));
}

/** 2本以上の前へ進む矢印を、並列にするか、結果のラベルで分けるか */
export function setBranchMode(wf: Draft, id: string, mode: 'parallel' | 'cases'): Draft {
  return finish(map(wf, id, (raw) => {
    const s = normalizePass(raw);
    const targets = forwardTargets(s);
    if (targets.length < 2) return s;
    if (mode === 'parallel') return withNext(withOn(s, { ...s.on, cases: undefined }), targets);
    const [first, ...rest] = targets;
    const cases = Object.fromEntries(rest.map((t, i) => [`case-${i + 1}`, t]));
    return withOn(withNext(s, [first!]), { ...s.on, cases });
  }));
}

export function renameCase(wf: Draft, id: string, from: string, to: string): Draft {
  return map(wf, id, (s) => withOn(s, { ...s.on, cases: Object.fromEntries(Object.entries(s.on?.cases ?? {}).map(([k, v]) => [k === from ? to : k, v])) }));
}

/** 結果で分けるとき、ラベルが合わなかったときに進む先（next）と、ラベルの付いた先を入れ替える */
export function makeDefault(wf: Draft, id: string, label: string): Draft {
  return finish(map(wf, id, (raw) => {
    const s = normalizePass(raw);
    const target = s.on?.cases?.[label];
    const current = nextTargets(s)[0];
    if (!target) return s;
    const cases = Object.fromEntries(Object.entries(s.on?.cases ?? {}).map(([k, v]) => (k === label ? (current ? [k, current] : null) : [k, v])).filter((x): x is [string, string] => !!x));
    return withOn(withNext(s, [target]), { ...s.on, cases });
  }));
}

export function setMaxLoops(wf: Draft, id: string, maxLoops: number): Draft {
  return map(wf, id, (s) => (s.on?.fail ? withOn(s, { ...s.on, fail: { ...s.on.fail, maxLoops } }) : s));
}

/** id を変える（ほかのステップからの参照もそろえる） */
export function renameStep(wf: Draft, from: string, to: string): Draft {
  if (from === to || wf.steps.some((s) => s.id === to)) return wf;
  const r = (x: string) => (x === from ? to : x);
  return finish({
    ...wf,
    steps: wf.steps.map((s) => {
      let st: StepDef = { ...s, id: r(s.id) };
      if (s.next !== undefined) st = withNext(st, nextTargets(s).map(r));
      if (s.needs) st = { ...st, needs: s.needs.map(r) };
      if (s.on) {
        st = withOn(st, {
          ...s.on,
          pass: s.on.pass ? r(s.on.pass) : undefined,
          cases: s.on.cases ? Object.fromEntries(Object.entries(s.on.cases).map(([k, v]) => [k, r(v)])) : undefined,
          fail: s.on.fail ? { ...s.on.fail, goto: r(s.on.fail.goto) } : undefined,
        });
      }
      return st;
    }),
  });
}

/** ステップの中身を変える（undefined を渡した項目は消す） */
export function updateStep(wf: Draft, id: string, patch: Partial<Omit<StepDef, 'id' | 'next' | 'needs' | 'on'>>): Draft {
  return map(wf, id, (s) => {
    const next = { ...s, ...patch } as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
    return next as StepDef;
  });
}

export const validStepId = (id: string) => StepId.safeParse(id).success;

// ---------------------------------------------------------------- YAML との行き来

export type ParsedYaml = { ok: true; draft: Draft } | { ok: false; error: string };

/** YAML を読む。つながりの誤り（分岐・並列）は図で直せるように、ここでは項目の形だけを確かめる */
export function parseDraft(yaml: string, version: number): ParsedYaml {
  let raw: unknown;
  try {
    raw = parseYaml(yaml);
  } catch (e) {
    return { ok: false, error: `YAML として読めません: ${e instanceof Error ? e.message.split('\n')[0] : ''}` };
  }
  const r = WorkflowShape.safeParse({ ...(raw as object), version });
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' / ') };
  return { ok: true, draft: r.data };
}

/** YAML に書く形（既定値の項目は省く。キーの順をそろえる） */
export function toPlainStep(s: StepDef): Record<string, unknown> {
  const out: Record<string, unknown> = { id: s.id, type: s.type };
  if (s.image) out['image'] = s.image;
  if (s.network) out['network'] = s.network;
  if (s.role) out['role'] = s.role;
  if (s.instructions) out['instructions'] = s.instructions;
  if (s.gates.length) out['gates'] = s.gates;
  if (s.action) out['action'] = s.action;
  if (s.timeoutHours !== 6) out['timeoutHours'] = s.timeoutHours;
  if (s.keepVm) out['keepVm'] = true;
  if (s.needs?.length) out['needs'] = s.needs;
  if (s.next !== undefined) out['next'] = s.next;
  if (s.on) {
    const on: Record<string, unknown> = {};
    if (s.on.pass) on['pass'] = s.on.pass;
    if (s.on.cases && Object.keys(s.on.cases).length) on['cases'] = s.on.cases;
    if (s.on.fail) on['fail'] = s.on.fail;
    if (Object.keys(on).length) out['on'] = on;
  }
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// 短い配列と小さな対応表は、1行（flow）で書く: next: [a, b] / fail: { goto: x, maxLoops: 2 }
const FLOW_KEYS = new Set(['next', 'needs', 'gates', 'cases', 'fail']);

function createNode(doc: Document, value: unknown, key?: string) {
  const node = doc.createNode(value);
  const walk = (n: unknown, k?: string) => {
    if ((isSeq(n) || isMap(n)) && k && FLOW_KEYS.has(k)) n.flow = true;
    if (isMap(n)) for (const p of n.items) walk(p.value, isScalar(p.key) ? String(p.key.value) : undefined);
    if (isSeq(n)) for (const item of n.items) walk(item);
  };
  walk(node, key);
  return node;
}

/** 既存の対応表（YAMLMap）を、新しい値に合わせて直す。変わらない項目はそのまま（コメントも残る） */
function mergeMap(doc: Document, target: YAMLMap, value: Record<string, unknown>) {
  for (const pair of [...target.items]) {
    const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
    if (!(key in value)) target.delete(key);
  }
  for (const [k, v] of Object.entries(value)) {
    const cur = target.get(k, true);
    const curJs = cur && typeof cur === 'object' && 'toJSON' in cur ? (cur as { toJSON: () => unknown }).toJSON() : cur;
    if (same(curJs, v)) continue;
    if (isMap(cur) && v && typeof v === 'object' && !Array.isArray(v)) mergeMap(doc, cur, v as Record<string, unknown>);
    else if (isScalar(cur) && (typeof v !== 'object' || v === null)) cur.value = v;
    else target.set(k, createNode(doc, v, k));
  }
}

/** 図で直した内容を YAML にする。base（元の YAML）があれば、コメントと書き方を残して必要なところだけ直す */
export function draftToYaml(draft: Draft, base?: string): string {
  const top: Record<string, unknown> = { name: draft.name };
  if (draft.title) top['title'] = draft.title;
  if (draft.description) top['description'] = draft.description;
  const steps = draft.steps.map(toPlainStep);
  // 何も変えていなければ、元の YAML をそのまま返す（書き方の細かな違いも出さない）
  if (base) {
    const before = parseDraft(base, draft.version);
    if (before.ok && same(before.draft, draft)) return base;
  }
  const doc: Document | null = base ? parseDocument(base) : null;
  if (!doc || doc.errors.length || !isMap(doc.contents)) return stringifyFresh({ name: draft.name, version: draft.version, ...top, steps });
  const root = doc.contents as YAMLMap;
  for (const k of ['name', 'title', 'description'] as const) {
    if (top[k] === undefined) root.delete(k);
    else if (!same(root.get(k), top[k])) root.set(k, top[k]);
  }
  const old = root.get('steps', true);
  const byId = new Map<string, YAMLMap>();
  if (isSeq(old)) for (const item of old.items) if (isMap(item)) byId.set(String(item.get('id')), item);
  const seq = isSeq(old) ? old : new YAMLSeq();
  seq.items = steps.map((st) => {
    const prev = byId.get(String(st['id']));
    if (!prev) return createNode(doc, st);
    mergeMap(doc, prev, st);
    return prev;
  });
  if (!isSeq(old)) root.set('steps', seq);
  return doc.toString(FORMAT);
}

const FORMAT = { lineWidth: 0, flowCollectionPadding: false } as const;

function stringifyFresh(value: Record<string, unknown>) {
  const doc = new Document();
  doc.contents = createNode(doc, value);
  return doc.toString(FORMAT);
}
