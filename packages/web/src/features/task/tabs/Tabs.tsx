// 右の列のタブの中身
import type { Diff, Workflow, Task } from '@factory/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { ToolCallCard, ToolCallGroup } from '../../../components/ui/tool-call-card';
import { Banner, Dot, ErrorBanner, IconButton, Tag } from '../../../components/kit';
import { Busy, CodeSkeleton, Skeleton, SkeletonText } from '../../../components/skeletons';
import { WorkflowGraph } from '../../../components/workflow';
import { ShimmerText } from '../../../components/ui/shimmer-loader';
import {
  IconBlock,
  IconChevron,
  IconChevronDown,
  IconDownload,
  IconExternal,
  IconEye,
  IconFile,
  IconFolder,
  IconList,
  IconRefresh,
  toolIcon,
} from '../../../components/icons';
import { errorMessage } from '../../../lib/api';
import { saveFromUrl } from '../../../lib/download';
import { bytes, duration, stepLabel, time, tokens, usd } from '../../../lib/format';
import { useApi } from '../../../lib/services';
import type { Session } from '../../../lib/session';
import { useResource } from '../../../lib/useResource';
import { planStatusOf, stepStatusesFromSession } from '../../../lib/workflow';
import { useUi } from '../../../stores/ui';
import { PlanCard, type PlanActions } from '../Cards';
import t from './tabs.module.css';

// ---------------------------------------------------------------- プレビュー（FR-UI-06・D16）
export function PreviewTab({ item, session }: { item: Task; session: Session }) {
  const api = useApi();
  const toast = useUi((u) => u.toast);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const port = session.preview?.port;
  const stopped = item.state === 'failed' || item.state === 'cancelled';

  useEffect(() => {
    if (!port || stopped) return;
    let alive = true;
    setError(null);
    // チケットは一回限りで 60 秒で無効になる。開くたびに発行し直す
    api.preview(item.id, port).then(
      (p) => alive && setUrl(p.url),
      (e: unknown) => alive && setError(errorMessage(e)),
    );
    return () => {
      alive = false;
    };
  }, [api, item.id, port, nonce, stopped]);

  if (!session.preview) {
    return (
      <div className={t.empty}>
        <IconEye />
        <strong>プレビューはまだありません</strong>
        <span>
          エージェントが VM の中でアプリを起動すると、ここに表示されます。HTML のレポートや Web アプリを、その場で確かめられます。
        </span>
      </div>
    );
  }
  if (stopped)
    return (
      <div className={t.empty}>
        <IconEye />
        <strong>VM が停止しているため、プレビューは開けません</strong>
        <span>成果物は「ファイル」のタブから見られます。</span>
      </div>
    );

  const shown = `preview.factory › ${item.id.slice(-6).toLowerCase()}:${session.preview.port}${session.preview.path}`;
  return (
    <div className={t.preview}>
      <div className={t.chrome}>
        <span className={t.dots} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className={t.url} title={shown}>
          {shown}
        </span>
        <IconButton label="再読み込み" onClick={() => setNonce((n) => n + 1)}>
          <IconRefresh />
        </IconButton>
        <IconButton
          label="新しいタブで開く"
          onClick={() => {
            void api.preview(item.id, session.preview!.port).then(
              (p) => window.open(p.url, '_blank', 'noopener'),
              (e: unknown) => toast(errorMessage(e), 'err'),
            );
          }}
        >
          <IconExternal />
        </IconButton>
      </div>
      {error ? (
        <ErrorBanner error={error} onRetry={() => setNonce((n) => n + 1)} />
      ) : url ? (
        <iframe
          key={url}
          className={t.frame}
          src={url}
          title="プレビュー"
          sandbox={url.startsWith('blob:') ? 'allow-scripts allow-forms' : 'allow-scripts allow-forms allow-same-origin'}
        />
      ) : (
        <div className={t.frame} style={{ display: 'grid', placeItems: 'center' }} role="status">
          <ShimmerText>プレビューを開いています…</ShimmerText>
        </div>
      )}
      <p className={t.previewNote}>
        このブラウザで同時に開けるプレビューは1つだけです（D16）。別のタスクのプレビューを開くと、こちらは閉じます。
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- 変更（差分）
type DiffLine = { t: ' ' | '+' | '-' | '@'; text: string; a?: number; b?: number };
function parsePatch(patch: string): DiffLine[] {
  const out: DiffLine[] = [];
  let a = 0;
  let b = 0;
  for (const raw of patch.split('\n')) {
    const m = /^@@ -(\d+),?\d* \+(\d+),?\d* @@/.exec(raw);
    if (m) {
      a = Number(m[1]);
      b = Number(m[2]);
      out.push({ t: '@', text: raw });
      continue;
    }
    const sign = raw[0] as ' ' | '+' | '-';
    const text = raw.slice(1);
    if (sign === '+') out.push({ t: '+', text, b: b++ });
    else if (sign === '-') out.push({ t: '-', text, a: a++ });
    else out.push({ t: ' ', text, a: a++, b: b++ });
  }
  return out;
}

const statusLabel = { added: '追加', modified: '変更', deleted: '削除', renamed: '名前の変更' } as const;

export function ChangesTab({ diff }: { diff: { data: Diff | undefined; error: string | null; reload: () => Promise<void> } }) {
  const files = diff.data?.files ?? [];
  const [sel, setSel] = useState<string | null>(null);
  const current = files.find((f) => f.path === sel) ?? files[0];
  const lines = useMemo(() => (current ? parsePatch(current.patch) : []), [current]);
  if (diff.error)
    return (
      <div className={t.pad}>
        <ErrorBanner error={diff.error} onRetry={() => void diff.reload()} />
      </div>
    );
  if (!diff.data) return <ChangesSkeleton />;
  if (files.length === 0)
    return (
      <div className={t.empty}>
        <IconFile />
        <strong>まだ変更はありません</strong>
        <span>エージェントがファイルを書き換えると、作業ブランチとの差分がここに出ます。</span>
      </div>
    );
  const plus = files.reduce((n, f) => n + f.additions, 0);
  const minus = files.reduce((n, f) => n + f.deletions, 0);
  return (
    <div className={t.changes}>
      <nav className={t.fileList} aria-label="変更したファイル">
        <div className={t.fileHead}>
          <span>{files.length} ファイル</span>
          <span className={t.plus}>+{plus}</span>
          <span className={t.minus}>−{minus}</span>
        </div>
        {files.map((f) => (
          <button
            key={f.path}
            type="button"
            className={t.file}
            aria-current={f.path === current?.path || undefined}
            onClick={() => setSel(f.path)}
            title={f.path}
          >
            <IconFile />
            <span className={t.fileName}>{f.path}</span>
            <span className={t.plus}>+{f.additions}</span>
            {f.deletions > 0 ? <span className={t.minus}>−{f.deletions}</span> : <span />}
          </button>
        ))}
      </nav>
      {current && (
        <div className={t.diff}>
          <div className={t.diffHead}>
            <span className={t.status}>{statusLabel[current.status]}</span>
            {current.path}
            <span style={{ marginLeft: 'auto' }} className="muted">
              {diff.data.base} ← {diff.data.head}
            </span>
          </div>
          <pre className={t.code} aria-label={`${current.path} の差分`}>
            {lines.map((l, i) => (
              <div key={i} className={t.ln} data-t={l.t}>
                <span className={t.no}>{l.a ?? ''}</span>
                <span className={t.no}>{l.b ?? ''}</span>
                <span className={t.sign}>{l.t === '@' ? '' : l.t}</span>
                <span>{l.text}</span>
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}

const FILE_W = ['70%', '52%', '84%', '60%', '44%'];

/** 差分を読み込んでいる間: 左のファイルの一覧と右の差分の形だけを出す */
function ChangesSkeleton() {
  return (
    <Busy className={t.changes}>
      <div className={t.fileList} aria-hidden="true">
        <div className={t.fileHead}>
          <SkeletonText size={12.5} width={96} />
        </div>
        {FILE_W.map((w, i) => (
          <div key={i} className={t.file}>
            <Skeleton width={14} height={14} radius={4} />
            <SkeletonText size={12} width={w} />
            <Skeleton width={22} height={9} />
            <span />
          </div>
        ))}
      </div>
      <div className={t.diff} aria-hidden="true">
        <div className={t.diffHead}>
          <SkeletonText size={12} width={220} />
        </div>
        <span className={t.codeSkeleton}>
          <CodeSkeleton lines={18} />
        </span>
      </div>
    </Busy>
  );
}

/** ファイルの一覧を読み込んでいる間 */
function FilesSkeleton() {
  return (
    <Busy className={t.changes}>
      <div className={t.tree} aria-hidden="true">
        <div className={t.treeToolbar}>
          <span className={t.source}>
            <SkeletonText size={11.5} width={110} />
          </span>
          <Skeleton width={30} height={30} radius={9} />
        </div>
        {FILE_W.map((w, i) => (
          <div key={i} className={t.treeItem} style={{ paddingLeft: 8 + (i > 1 && i < 4 ? 14 : 0) }}>
            <Skeleton width={14} height={14} radius={4} />
            <SkeletonText size={12} width={w} />
          </div>
        ))}
      </div>
      <div className={t.diff} aria-hidden="true" />
    </Busy>
  );
}

// ---------------------------------------------------------------- ファイル（FR-UI-05）
export function FilesTab({ item, version, onPublish }: { item: Task; version: number; onPublish: () => void }) {
  const api = useApi();
  const toast = useUi((u) => u.toast);
  const root = useResource(() => api.files(item.id, ''), [item.id, version]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [children, setChildren] = useState<Record<string, Awaited<ReturnType<typeof api.files>>['entries']>>({});
  const [sel, setSel] = useState<string | null>(null);
  const content = useResource(() => (sel ? api.fileContent(item.id, sel) : Promise.resolve(null)), [sel, version]);

  useEffect(() => {
    // 開いているフォルダは、ファイルが変わったら読み直す
    for (const dir of Object.keys(open).filter((d) => open[d]))
      void api.files(item.id, dir).then((tr) => setChildren((c) => ({ ...c, [dir]: tr.entries })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const toggle = async (dir: string) => {
    const next = !open[dir];
    setOpen((o) => ({ ...o, [dir]: next }));
    if (next && !children[dir]) {
      const tr = await api.files(item.id, dir);
      setChildren((c) => ({ ...c, [dir]: tr.entries }));
    }
  };
  const download = async (format: 'file' | 'zip', paths?: string[]) => {
    try {
      const d = await api.download(item.id, { format, ...(paths ? { paths } : {}) });
      await saveFromUrl(d.url, d.fileName);
    } catch (e) {
      toast(errorMessage(e), 'err');
    }
  };

  const render = (entries: NonNullable<typeof root.data>['entries'], depth: number): React.ReactNode =>
    entries.map((e) => (
      <div key={e.path}>
        <button
          type="button"
          className={t.treeItem}
          style={{ paddingLeft: 8 + depth * 14 }}
          aria-current={sel === e.path || undefined}
          aria-expanded={e.type === 'dir' ? !!open[e.path] : undefined}
          onClick={() => (e.type === 'dir' ? void toggle(e.path) : setSel(e.path))}
        >
          {e.type === 'dir' ? open[e.path] ? <IconChevronDown /> : <IconChevron /> : <span style={{ width: 14 }} />}
          {e.type === 'dir' ? <IconFolder /> : <IconFile />}
          {e.name}
          {e.size !== undefined && (
            <span className="faint" style={{ marginLeft: 'auto' }}>
              {bytes(e.size)}
            </span>
          )}
        </button>
        {e.type === 'dir' && open[e.path] && children[e.path] && render(children[e.path]!, depth + 1)}
      </div>
    ));

  if (root.error)
    return (
      <div className={t.pad}>
        <ErrorBanner error={root.error} onRetry={() => void root.reload()} />
      </div>
    );
  if (!root.data) return <FilesSkeleton />;
  return (
    <div className={t.changes}>
      <nav className={t.tree} aria-label="ファイルツリー">
        <div className={t.treeToolbar}>
          <span className={t.source}>{root.data.source === 'vm' ? 'VM から（実行中）' : 'スナップショットから'}</span>
          <IconButton label="すべてを zip でダウンロード" onClick={() => void download('zip')}>
            <IconDownload />
          </IconButton>
        </div>
        {root.data.entries.length === 0 ? (
          <p className="muted" style={{ padding: 8 }}>
            ファイルはまだありません。
          </p>
        ) : (
          render(root.data.entries, 0)
        )}
      </nav>
      <div className={t.diff}>
        {sel ? (
          <>
            <div className={t.diffHead}>
              {sel}
              <span className={t.viewerActions}>
                <Button size="sm" variant="ghost" icon={<IconDownload />} onClick={() => void download('file', [sel])}>
                  ダウンロード
                </Button>
                <Button size="sm" variant="secondary" onClick={onPublish}>
                  公開する
                </Button>
              </span>
            </div>
            {content.error ? (
              <div className={t.pad}>
                <ErrorBanner error={content.error} />
              </div>
            ) : content.data ? (
              <pre className={t.code} aria-label={`${sel} の中身`}>
                {content.data.text.split('\n').map((l, i) => (
                  <div key={i} className={t.ln} style={{ gridTemplateColumns: '44px 1fr' }}>
                    <span className={t.no}>{i + 1}</span>
                    <span>{l}</span>
                  </div>
                ))}
              </pre>
            ) : (
              <Busy>
                <span className={t.codeSkeleton}>
                  <CodeSkeleton lines={18} />
                </span>
              </Busy>
            )}
          </>
        ) : (
          <div className={t.empty}>
            <IconFolder />
            <strong>ファイルを選んでください</strong>
            <span>添付したファイルは attachments/ に入っています。</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 計画とステップの構成
export function PlanTab({
  session,
  workflow,
  actions,
  onOpenStep,
}: {
  session: Session;
  workflow: Workflow | undefined;
  actions: PlanActions;
  onOpenStep?: (stepId: string) => void;
}) {
  const latest = session.latestPlan ? session.plans[session.latestPlan] : undefined;
  const older = Object.values(session.plans)
    .filter((p) => p.version !== session.latestPlan)
    .sort((a, b) => b.version - a.version);
  return (
    <div className={t.pad}>
      <div className={t.narrow}>
        {latest ? (
          <PlanCard
            plan={latest}
            latest
            actionable={session.state === 'awaiting_approval' && !latest.decision}
            actions={actions}
            defaultDetails
          />
        ) : (
          <div className={t.empty}>
            <IconList />
            <strong>計画を立てています</strong>
            <span>エージェントがタスクの内容と関係するファイルを確かめて、計画を出します。承認するまで作業は始まりません（D3）。</span>
          </div>
        )}
        {workflow && (
          <>
            <h3 className={t.h}>
              ワークフロー「{workflow.title ?? workflow.name}」のステップ（{workflow.name}@{workflow.version}）
            </h3>
            <WorkflowGraph
              workflow={workflow}
              mode="run"
              label={`${workflow.title ?? workflow.name} の進み具合`}
              statuses={stepStatusesFromSession(workflow, session)}
              planStatus={planStatusOf(session)}
              onSelect={(sel) => sel?.kind === 'step' && onOpenStep?.(sel.id)}
            />
            <p className={t.hint}>ステップを押すと、その実行ログを開きます。</p>
          </>
        )}
        {older.length > 0 && (
          <>
            <h3 className={t.h}>前の版</h3>
            <div className={t.old}>
              {older.map((p) => (
                <PlanCard key={p.version} plan={p} latest={false} actionable={false} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 実行ログ（FR-UI-04）
export function LogTab({
  item,
  session,
  workflow,
  onRetry,
  focusStep,
}: {
  item: Task;
  session: Session;
  workflow: Workflow | undefined;
  onRetry: (runId: string) => Promise<void>;
  focusStep?: { id: string; at: number } | null;
}) {
  const runs = [...session.runs].reverse();
  const list = useRef<HTMLDivElement>(null);
  // 図からステップを選んだら、その最後の実行まで動かして、少しのあいだ目立たせる
  useEffect(() => {
    if (!focusStep) return;
    const el = list.current?.querySelector<HTMLElement>(`[data-step="${CSS.escape(focusStep.id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    el.dataset['focus'] = 'true';
    const timer = setTimeout(() => delete el.dataset['focus'], 1600);
    return () => clearTimeout(timer);
  }, [focusStep]);
  return (
    <div className={t.pad}>
      <div className={t.narrow} ref={list}>
        <dl className={t.usage} aria-label="使用量">
          <div>
            <dt>入力トークン</dt>
            <dd>{tokens(session.usage.inputTokens)}</dd>
          </div>
          <div>
            <dt>出力トークン</dt>
            <dd>{tokens(session.usage.outputTokens)}</dd>
          </div>
          <div>
            <dt>VM の時間</dt>
            <dd>{duration(session.usage.vmSeconds * 1000)}</dd>
          </div>
          <div>
            <dt>費用（概算）</dt>
            <dd>{usd(item.costUsd)}</dd>
          </div>
        </dl>
        {session.blocked.length > 0 && (
          <Banner tone="warn">
            <strong>許可リストで止めた通信</strong>
            <ul className={t.blocked}>
              {session.blocked.map((b, i) => (
                <li key={i}>
                  <IconBlock /> <code>{b.host}</code> <span className="muted">{time(b.at)}</span>
                </li>
              ))}
            </ul>
          </Banner>
        )}
        {runs.length === 0 && (
          <div className={t.empty}>
            <IconList />
            <strong>まだ作業はありません</strong>
            <span>計画が承認されると、ステップごとの作業（コマンド、ファイルの編集、テスト）がここに出ます。</span>
          </div>
        )}
        {runs.map((r) => {
          const st = workflow?.steps.find((x) => x.id === r.stepId);
          const tools = r.tools.map((tid) => session.tools[tid]).filter((x): x is NonNullable<typeof x> => !!x);
          return (
            <section key={r.runId} className={t.run} data-step={r.stepId} aria-label={`${stepLabel(r.stepId)} ${r.runId}`}>
              <div className={t.runHead}>
                <Dot tone={r.state === 'running' ? 'run' : r.state === 'failed' ? 'err' : 'ok'} />
                <span className={t.runLabel}>{stepLabel(r.stepId)}</span>
                <span className={t.runMeta}>
                  {r.runId}
                  {st?.image ? ` · ${st.image}` : ''}
                  {st?.network ? ` · 通信: ${st.network}` : ''}
                </span>
                <span className={t.runRight}>
                  {r.state === 'failed' && <Tag tone="err">失敗</Tag>}
                  {r.endedAt ? duration(r.endedAt - r.startedAt) : '実行中'}
                  {r.state === 'failed' && item.state === 'failed' && r === runs.find((x) => x.state === 'failed') && (
                    <Button size="sm" variant="secondary" onClick={() => void onRetry(r.runId)}>
                      やり直す
                    </Button>
                  )}
                </span>
              </div>
              {tools.length > 0 && (
                <ToolCallGroup
                  key={`${r.runId}:${r.state}`}
                  defaultOpen={r.state !== 'completed'}
                  label={`${tools.length} 件の作業`}
                  runningLabel={`${stepLabel(r.stepId)}をしています…`}
                >
                  {tools.map((tl) => (
                    <ToolCallCard
                      key={tl.id}
                      name={tl.tool}
                      icon={toolIcon(tl.tool)}
                      status={tl.endedAt === undefined ? 'running' : tl.ok ? 'success' : 'error'}
                      summary={tl.summary}
                      {...(tl.result && tl.ok ? { result: tl.result } : {})}
                      {...(tl.result && tl.ok === false ? { error: tl.result } : {})}
                      {...(tl.endedAt === undefined ? { startedAt: tl.startedAt } : { duration: tl.endedAt - tl.startedAt })}
                    />
                  ))}
                </ToolCallGroup>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
