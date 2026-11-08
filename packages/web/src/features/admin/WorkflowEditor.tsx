// 管理: ワークフローのビジュアルエディタ（FR-LINE-06）。図と YAML のどちらで直しても、もう一方にそのまま反映する。
// 図での操作は lib/workflowEdit.ts を通し、保存は今までどおり YAML を PUT する（サーバーが検証して新しい版にする）
import { analyzeWorkflow, forwardTargets, type GraphIssue, type StepDef } from '@factory/contracts';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Banner, ErrorBanner, Field, IconButton, Select, TextArea, TextInput } from '../../components/kit';
import {
  IconFork,
  IconPersonCheck,
  IconRedo,
  IconSettings,
  IconSpark,
  IconTerminal,
  IconTrash,
  IconUndo,
  IconWarning,
} from '../../components/icons';
import { Button } from '../../components/ui/button';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { WorkflowGraph, type GraphSelection } from '../../components/workflow';
import { errorMessage } from '../../lib/api';
import { stepLabel } from '../../lib/format';
import { useApi } from '../../lib/services';
import { useResource } from '../../lib/useResource';
import {
  addStep,
  branchMode,
  connect,
  disconnect,
  draftToYaml,
  makeDefault,
  parseDraft,
  removeStep,
  renameCase,
  renameStep,
  setBranchMode,
  setMaxLoops,
  updateStep,
  validStepId,
  type Draft,
  type StepType,
} from '../../lib/workflowEdit';
import { useUi } from '../../stores/ui';
import p from '../pages.module.css';
import e from './WorkflowEditor.module.css';

type View = 'graph' | 'yaml';
type History = { past: Draft[]; future: Draft[] };

const ADD: { type: StepType; label: string; icon: ReactNode }[] = [
  { type: 'agent', label: 'エージェント', icon: <IconSpark /> },
  { type: 'command', label: 'コマンド', icon: <IconTerminal /> },
  { type: 'approval', label: '人の承認', icon: <IconPersonCheck /> },
  { type: 'system', label: '決まった処理', icon: <IconSettings /> },
];
const TYPE_TEXT: Record<StepType, string> = {
  agent: 'エージェント（VM 上の AI）',
  command: 'コマンド（VM 上で決まった処理）',
  approval: '人の承認',
  system: '決まった処理（VM なし）',
};
const ACTION_TEXT: Record<NonNullable<StepDef['action']>, string> = {
  'create-pull-request': 'プルリクエストを作る',
  'propose-publish': '社内への公開を提案する',
};

/** 矢印の id（graphEdges）を読む */
function parseEdge(id: string): { kind: 'next' | 'case' | 'fail'; from: string; to: string; label?: string } | null {
  const fail = /^(.+)!->(.+)$/.exec(id);
  if (fail) return { kind: 'fail', from: fail[1]!, to: fail[2]! };
  const kase = /^(.+)=(.+)->(.+)$/.exec(id);
  if (kase) return { kind: 'case', from: kase[1]!, label: kase[2]!, to: kase[3]! };
  const next = /^(.+)->(.+)$/.exec(id);
  return next ? { kind: 'next', from: next[1]!, to: next[2]! } : null;
}

const issueStep = (draft: Draft, i: GraphIssue) => (typeof i.path[1] === 'number' ? draft.steps[i.path[1]]?.id : undefined);

export function WorkflowEditor() {
  const api = useApi();
  const toast = useUi((u) => u.toast);
  const workflows = useResource(() => api.workflows(), []);
  const images = useResource(() => api.images(), []);
  const networks = useResource(() => api.admin.networkProfiles(), []);
  const [name, setName] = useState('build-verify');
  const def = useResource(() => api.admin.workflow(name), [name]);
  const [view, setView] = useState<View>('graph');
  const [yaml, setYaml] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [history, setHistory] = useState<History>({ past: [], future: [] });
  const [selected, setSelected] = useState<GraphSelection | null>(null);
  const [yamlError, setYamlError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const yamlId = useId();

  const reset = (text: string, version: number) => {
    const r = parseDraft(text, version);
    setYaml(text);
    setDraft(r.ok ? r.draft : null);
    setYamlError(r.ok ? null : r.error);
    setHistory({ past: [], future: [] });
    setSelected(null);
    setSaveError(null);
  };
  useEffect(() => {
    if (def.data) reset(def.data.yaml, def.data.version);
  }, [def.data]);

  const issues = useMemo(() => (draft ? analyzeWorkflow(draft).issues : []), [draft]);
  const dirty = !!def.data && yaml !== def.data.yaml;
  const editable = !!draft && !yamlError;

  /** 図での操作: 1手ごとに履歴へ積み、YAML を書き直す */
  const apply = (next: Draft, select?: GraphSelection | null) => {
    if (!draft || next === draft) return;
    setHistory((h) => ({ past: [...h.past, draft].slice(-50), future: [] }));
    setDraft(next);
    setYaml(draftToYaml(next, yaml));
    if (select !== undefined) setSelected(select);
  };
  const undo = () => {
    const prev = history.past.at(-1);
    if (!prev || !draft) return;
    setHistory({ past: history.past.slice(0, -1), future: [draft, ...history.future] });
    setDraft(prev);
    setYaml(draftToYaml(prev, yaml));
  };
  const redo = () => {
    const [next, ...rest] = history.future;
    if (!next || !draft) return;
    setHistory({ past: [...history.past, draft], future: rest });
    setDraft(next);
    setYaml(draftToYaml(next, yaml));
  };
  const onYaml = (text: string) => {
    setYaml(text);
    const r = parseDraft(text, def.data?.version ?? 1);
    if (r.ok) {
      setDraft(r.draft);
      setYamlError(null);
    } else setYamlError(r.error);
  };
  const remove = () => {
    if (!draft || !selected) return;
    if (selected.kind === 'step') apply(removeStep(draft, selected.id), null);
    else apply(disconnect(draft, selected.id), null);
  };
  const save = async () => {
    setSaving(true);
    try {
      const r = await api.admin.putWorkflow(name, yaml);
      toast(`${r.name}@${r.version} を登録しました`, 'ok');
      setSaveError(null);
      await def.reload();
      await workflows.reload();
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  // 取り消し・やり直し（入力欄の中では、ブラウザの取り消しに任せる）
  useEffect(() => {
    if (view !== 'graph') return;
    const onKey = (ev: KeyboardEvent) => {
      if (!(ev.metaKey || ev.ctrlKey) || ev.key.toLowerCase() !== 'z') return;
      if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement || ev.target instanceof HTMLSelectElement)
        return;
      ev.preventDefault();
      if (ev.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const blocked = !dirty || !!yamlError || issues.length > 0 || saving;
  return (
    <div className={p.stack}>
      <div className={e.bar}>
        <Select aria-label="ワークフロー" value={name} onChange={(ev) => setName(ev.target.value)} className={e.pick}>
          {workflows.data?.map((l) => (
            <option key={l.name} value={l.name}>
              {l.title ?? l.name}（{l.name}@{l.version}）
            </option>
          ))}
        </Select>
        <SegmentedControl<View>
          size="sm"
          aria-label="編集のしかた"
          value={view}
          onChange={setView}
          options={[
            { value: 'graph', label: '図' },
            { value: 'yaml', label: 'YAML' },
          ]}
        />
        <span className={e.right}>
          <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => def.data && reset(def.data.yaml, def.data.version)}>
            元に戻す
          </Button>
          <Button
            size="sm"
            disabled={blocked}
            loading={saving}
            onClick={() => void save()}
            title={issues.length ? `${issues.length} 件の誤りを直すと登録できます` : undefined}
          >
            検証して登録
          </Button>
        </span>
      </div>
      <p className={e.note}>保存すると新しいバージョンになります。動いているタスクは、始めたときのバージョンのまま進みます。</p>
      {def.error && <ErrorBanner error={def.error} />}
      {saveError && <ErrorBanner error={saveError} />}

      {view === 'graph' ? (
        <>
          {yamlError && (
            <Banner tone="warn">YAML に誤りがあるため、図は最後に読めた形を出しています。YAML で直してください: {yamlError}</Banner>
          )}
          <div className={e.tools} role="toolbar" aria-label="図の編集">
            {ADD.map((a) => (
              <Button
                key={a.type}
                size="sm"
                variant="secondary"
                icon={a.icon}
                disabled={!editable}
                onClick={() => {
                  if (!draft) return;
                  const after = selected?.kind === 'step' ? selected.id : undefined;
                  const r = addStep(draft, a.type, after);
                  apply(r.draft, { kind: 'step', id: r.id });
                }}
              >
                {a.label}
              </Button>
            ))}
            <span className={e.sep} />
            <IconButton label="取り消す" onClick={undo} disabled={!history.past.length}>
              <IconUndo />
            </IconButton>
            <IconButton label="やり直す" onClick={redo} disabled={!history.future.length}>
              <IconRedo />
            </IconButton>
            <IconButton label="選んだものを消す" onClick={remove} disabled={!selected || !editable}>
              <IconTrash />
            </IconButton>
          </div>
          <div className={e.editor}>
            <div className={e.canvas}>
              {draft ? (
                <WorkflowGraph
                  workflow={draft}
                  mode={editable ? 'edit' : 'view'}
                  label={`${draft.title ?? draft.name} の編集`}
                  height={500}
                  selected={selected}
                  onSelect={setSelected}
                  onConnect={(from, to, kind) => apply(connect(draft, from, to, kind))}
                  onDelete={remove}
                />
              ) : null}
            </div>
            <aside className={e.inspector} aria-label="選んだものの設定">
              {draft && editable ? (
                <Inspector
                  draft={draft}
                  selected={selected}
                  images={(images.data ?? []).map((i) => `${i.name}@${i.latestVersion}`)}
                  networks={(networks.data ?? []).map((n) => n.name)}
                  apply={apply}
                  onSelect={setSelected}
                />
              ) : null}
            </aside>
          </div>
          {draft && issues.length > 0 && (
            <section className={e.issues} aria-label="直すところ">
              <h3>
                <IconWarning /> 直すところ（{issues.length} 件）
              </h3>
              <ul>
                {issues.map((i, n) => {
                  const id = issueStep(draft, i);
                  return (
                    <li key={n}>
                      {id ? (
                        <button type="button" className={e.issueLink} onClick={() => setSelected({ kind: 'step', id })}>
                          {stepLabel(id)}
                        </button>
                      ) : null}
                      <span>{i.message}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      ) : (
        <Field
          label="ワークフローの定義（YAML）"
          htmlFor={yamlId}
          error={yamlError ?? (issues[0] ? `${issues.length} 件の誤り: ${issues[0].message}` : undefined)}
        >
          <TextArea
            id={yamlId}
            className={p.yaml}
            spellCheck={false}
            value={yaml}
            onChange={(ev) => onYaml(ev.target.value)}
            aria-invalid={!!yamlError || issues.length > 0}
          />
        </Field>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 右の設定
function Inspector({
  draft,
  selected,
  images,
  networks,
  apply,
  onSelect,
}: {
  draft: Draft;
  selected: GraphSelection | null;
  images: string[];
  networks: string[];
  apply: (d: Draft, select?: GraphSelection | null) => void;
  onSelect: (s: GraphSelection | null) => void;
}) {
  if (selected?.kind === 'step') {
    const st = draft.steps.find((s) => s.id === selected.id);
    if (st)
      return <StepInspector key={st.id} draft={draft} step={st} images={images} networks={networks} apply={apply} onSelect={onSelect} />;
  }
  if (selected?.kind === 'edge') {
    const edge = parseEdge(selected.id);
    if (edge && draft.steps.some((s) => s.id === edge.from))
      return <EdgeInspector key={selected.id} draft={draft} edge={edge} edgeId={selected.id} apply={apply} />;
  }
  return (
    <div className={e.empty}>
      <strong>ステップか矢印を選んでください</strong>
      <dl className={e.legend}>
        <div>
          <dt>
            <span className={e.lineSolid} />
          </dt>
          <dd>成功したら進む</dd>
        </div>
        <div>
          <dt>
            <span className={e.lineDashed} />
          </dt>
          <dd>失敗したら戻る</dd>
        </div>
        <div>
          <dt>
            <span className={e.chip}>label</span>
          </dt>
          <dd>結果のラベルで分ける</dd>
        </div>
        <div>
          <dt>
            <IconFork />
          </dt>
          <dd>並列で進め、すべて終わってから合流</dd>
        </div>
      </dl>
      <p>ノードの右の点から次のステップへ、下のオレンジの点から失敗したときの戻り先へ、ドラッグしてつなぎます。</p>
    </div>
  );
}

function StepInspector({
  draft,
  step,
  images,
  networks,
  apply,
  onSelect,
}: {
  draft: Draft;
  step: StepDef;
  images: string[];
  networks: string[];
  apply: (d: Draft, select?: GraphSelection | null) => void;
  onSelect: (s: GraphSelection | null) => void;
}) {
  const uid = useId();
  const [id, setId] = useState(step.id);
  const idError =
    id === step.id
      ? undefined
      : !validStepId(id)
        ? '英小文字で始まる、英小文字・数字・ハイフンの 2〜32 文字にしてください'
        : draft.steps.some((s) => s.id === id)
          ? 'この id はもう使われています'
          : undefined;
  const commitId = () => {
    if (id !== step.id && !idError) apply(renameStep(draft, step.id, id), { kind: 'step', id });
  };
  const patch = (x: Parameters<typeof updateStep>[2]) => apply(updateStep(draft, step.id, x));
  const vm = step.type === 'agent' || step.type === 'command';
  const mode = branchMode(step);
  const targets = forwardTargets(step);
  const others = draft.steps.filter((s) => s.id !== step.id);
  const imageOptions = [...new Set([...(step.image ? [step.image] : []), ...images])];
  const networkOptions = [...new Set([...(step.network ? [step.network] : []), ...networks])];
  const setType = (type: StepType) => {
    if (type === 'system')
      patch({ type, action: step.action ?? 'create-pull-request', image: undefined, network: undefined, instructions: undefined });
    else if (type === 'approval') patch({ type, image: undefined, network: undefined, action: undefined });
    else patch({ type, image: step.image ?? 'base@3', action: undefined });
  };
  return (
    <div className={e.form}>
      <div className={e.formHead}>
        <h3>{stepLabel(step.id)}</h3>
        <IconButton label="このステップを消す" onClick={() => apply(removeStep(draft, step.id), null)} disabled={draft.steps.length <= 1}>
          <IconTrash />
        </IconButton>
      </div>
      <Field label="id" htmlFor={`${uid}-id`} error={idError}>
        <TextInput
          id={`${uid}-id`}
          className="mono"
          value={id}
          onChange={(ev) => setId(ev.target.value.trim())}
          onBlur={commitId}
          onKeyDown={(ev) => ev.key === 'Enter' && commitId()}
        />
      </Field>
      <Field label="種類" htmlFor={`${uid}-type`}>
        <Select id={`${uid}-type`} value={step.type} onChange={(ev) => setType(ev.target.value as StepType)}>
          {(Object.keys(TYPE_TEXT) as StepType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_TEXT[t]}
            </option>
          ))}
        </Select>
      </Field>
      {vm && (
        <>
          <Field label="VM のイメージ" htmlFor={`${uid}-image`}>
            <Select
              id={`${uid}-image`}
              className="mono"
              value={step.image ?? ''}
              onChange={(ev) => patch({ image: ev.target.value || undefined })}
            >
              {!step.image && <option value="">選んでください</option>}
              {imageOptions.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="通信" htmlFor={`${uid}-net`}>
            <Select id={`${uid}-net`} value={step.network ?? ''} onChange={(ev) => patch({ network: ev.target.value || undefined })}>
              <option value="">（既定）</option>
              {networkOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}
      {step.type === 'agent' && (
        <Field label="指示とスキル" htmlFor={`${uid}-inst`}>
          <TextInput
            id={`${uid}-inst`}
            className="mono"
            placeholder="skills/implement.md"
            value={step.instructions ?? ''}
            onChange={(ev) => patch({ instructions: ev.target.value || undefined })}
          />
        </Field>
      )}
      {step.type === 'system' && (
        <Field label="処理" htmlFor={`${uid}-action`}>
          <Select
            id={`${uid}-action`}
            value={step.action ?? 'create-pull-request'}
            onChange={(ev) => patch({ action: ev.target.value as NonNullable<StepDef['action']> })}
          >
            {(Object.keys(ACTION_TEXT) as NonNullable<StepDef['action']>[]).map((a) => (
              <option key={a} value={a}>
                {ACTION_TEXT[a]}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <label className={e.check}>
        <input
          type="checkbox"
          checked={step.gates.includes('plan-approval')}
          onChange={(ev) => patch({ gates: ev.target.checked ? ['plan-approval'] : [] })}
        />
        このステップの中で、計画の承認を求める
      </label>
      {vm && (
        <label className={e.check}>
          <input type="checkbox" checked={step.keepVm} onChange={(ev) => patch({ keepVm: ev.target.checked })} />
          次のステップでも同じ VM を使う
        </label>
      )}
      <Field label="時間の上限（時間）" htmlFor={`${uid}-timeout`}>
        <TextInput
          id={`${uid}-timeout`}
          type="number"
          min={1}
          max={72}
          value={step.timeoutHours}
          onChange={(ev) => patch({ timeoutHours: Math.min(72, Math.max(1, Number(ev.target.value) || 1)) })}
        />
      </Field>

      <div className={e.section}>
        <h4>成功したら</h4>
        {targets.length >= 2 && (
          <SegmentedControl<'parallel' | 'cases'>
            size="sm"
            fullWidth
            aria-label="分かれ方"
            value={mode === 'cases' ? 'cases' : 'parallel'}
            onChange={(v) => apply(setBranchMode(draft, step.id, v))}
            options={[
              { value: 'parallel', label: '並列で進める' },
              { value: 'cases', label: '結果で分ける' },
            ]}
          />
        )}
        {mode === 'end' && <p className={e.muted}>ここで終わります。右の点からドラッグすると、次のステップにつなげます。</p>}
        {mode === 'single' && (
          <p className={e.muted}>
            次は <EdgeLink onClick={() => onSelect({ kind: 'edge', id: `${step.id}->${targets[0]}` })}>{stepLabel(targets[0]!)}</EdgeLink>
            。もう1本つなぐと、並列か、結果で分けるかを選べます。
          </p>
        )}
        {mode === 'parallel' && (
          <ul className={e.targets}>
            {targets.map((t) => (
              <li key={t}>
                <EdgeLink onClick={() => onSelect({ kind: 'edge', id: `${step.id}->${t}` })}>{stepLabel(t)}</EdgeLink>
              </li>
            ))}
            <li className={e.muted}>すべてを同時に始め、合流するステップで全部が終わるのを待ちます。</li>
          </ul>
        )}
        {mode === 'cases' && (
          <ul className={e.targets}>
            {Object.entries(step.on?.cases ?? {}).map(([label, to]) => (
              <li key={label}>
                <code>{label}</code> のとき →{' '}
                <EdgeLink onClick={() => onSelect({ kind: 'edge', id: `${step.id}=${label}->${to}` })}>{stepLabel(to)}</EdgeLink>
              </li>
            ))}
            {typeof step.next === 'string' && (
              <li>
                それ以外 →{' '}
                <EdgeLink onClick={() => onSelect({ kind: 'edge', id: `${step.id}->${step.next}` })}>
                  {stepLabel(step.next as string)}
                </EdgeLink>
              </li>
            )}
          </ul>
        )}
      </div>

      <div className={e.section}>
        <h4>失敗したら</h4>
        <div className={e.row}>
          <Select
            aria-label="失敗したときの戻り先"
            value={step.on?.fail?.goto ?? ''}
            onChange={(ev) =>
              apply(
                ev.target.value
                  ? connect(draft, step.id, ev.target.value, 'fail')
                  : disconnect(draft, `${step.id}!->${step.on?.fail?.goto}`),
              )
            }
          >
            <option value="">止める</option>
            <option value={step.id}>このステップをやり直す</option>
            {others.map((s) => (
              <option key={s.id} value={s.id}>
                {stepLabel(s.id)} に戻る
              </option>
            ))}
          </Select>
          {step.on?.fail && (
            <TextInput
              aria-label="戻る回数の上限"
              className={e.loops}
              type="number"
              min={0}
              max={5}
              value={step.on.fail.maxLoops}
              onChange={(ev) => apply(setMaxLoops(draft, step.id, Math.min(5, Math.max(0, Number(ev.target.value) || 0))))}
            />
          )}
          {step.on?.fail && <span className={e.muted}>回まで</span>}
        </div>
      </div>
    </div>
  );
}

function EdgeInspector({
  draft,
  edge,
  edgeId,
  apply,
}: {
  draft: Draft;
  edge: NonNullable<ReturnType<typeof parseEdge>>;
  edgeId: string;
  apply: (d: Draft, select?: GraphSelection | null) => void;
}) {
  const uid = useId();
  const step = draft.steps.find((s) => s.id === edge.from)!;
  const [label, setLabel] = useState(edge.label ?? '');
  const labelError =
    edge.kind !== 'case' || label === edge.label
      ? undefined
      : !/^[a-z][a-z0-9-]{0,31}$/.test(label)
        ? '英小文字で始まる、英小文字・数字・ハイフンにしてください'
        : step.on?.cases?.[label]
          ? 'このラベルはもう使われています'
          : undefined;
  const commitLabel = () => {
    if (edge.kind === 'case' && edge.label && label !== edge.label && !labelError)
      apply(renameCase(draft, step.id, edge.label, label), { kind: 'edge', id: `${step.id}=${label}->${edge.to}` });
  };
  const title = { next: '成功したら進む', case: '結果で分ける', fail: '失敗したら戻る' }[edge.kind];
  return (
    <div className={e.form}>
      <div className={e.formHead}>
        <h3>{title}</h3>
        <IconButton label="この矢印を消す" onClick={() => apply(disconnect(draft, edgeId), null)}>
          <IconTrash />
        </IconButton>
      </div>
      <p className={e.path}>
        {stepLabel(edge.from)} <span aria-hidden="true">→</span>
        <span className="sr-only">から</span> {stepLabel(edge.to)}
      </p>
      {edge.kind === 'case' && (
        <>
          <Field label="ラベル（エージェントが結果で返す値）" htmlFor={`${uid}-label`} error={labelError}>
            <TextInput
              id={`${uid}-label`}
              className="mono"
              value={label}
              onChange={(ev) => setLabel(ev.target.value.trim())}
              onBlur={commitLabel}
              onKeyDown={(ev) => ev.key === 'Enter' && commitLabel()}
            />
          </Field>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => apply(makeDefault(draft, step.id, edge.label!), { kind: 'edge', id: `${step.id}->${edge.to}` })}
          >
            ラベルが合わないときの行き先にする
          </Button>
        </>
      )}
      {edge.kind === 'next' && branchMode(step) === 'cases' && <p className={e.muted}>ラベルが合わなかったときに進みます。</p>}
      {edge.kind === 'next' && branchMode(step) === 'parallel' && <p className={e.muted}>ほかの枝と同時に始まります。</p>}
      {edge.kind === 'fail' && (
        <Field label="戻る回数の上限" htmlFor={`${uid}-loops`} hint="これを超えて失敗すると、ワークフローを止めます。">
          <TextInput
            id={`${uid}-loops`}
            type="number"
            min={0}
            max={5}
            value={step.on?.fail?.maxLoops ?? 0}
            onChange={(ev) => apply(setMaxLoops(draft, step.id, Math.min(5, Math.max(0, Number(ev.target.value) || 0))))}
          />
        </Field>
      )}
    </div>
  );
}

function EdgeLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={e.edgeLink} onClick={onClick}>
      {children}
    </button>
  );
}
