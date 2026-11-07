// イメージ（FR-IMG・D14）: 使えるイメージの一覧、カスタムイメージの作成とビルドの進み具合、公開範囲
import { ImageSpec, type ImageScope, type ImageSummary } from '@factory/contracts';
import { useEffect, useId, useMemo, useState } from 'react';
import { stringify } from 'yaml';
import { Page } from '../../app/AppShell';
import { Button } from '../../components/ui/button';
import { Banner, Card, Dialog, ErrorBanner, Field, Loading, Menu, PageHeader, Select, Tag, TextArea, TextInput } from '../../components/kit';
import { IconImage, IconMore, IconPlus } from '../../components/icons';
import { errorMessage } from '../../lib/api';
import { mib, relative } from '../../lib/format';
import { useApi } from '../../lib/services';
import { useResource } from '../../lib/useResource';
import { useUi } from '../../stores/ui';
import p from '../pages.module.css';

const scopeLabel: Record<ImageScope, string> = { default: '既定', personal: '自分だけ', project: 'プロジェクト', org: '組織' };
const order: ImageScope[] = ['default', 'org', 'project', 'personal'];

export function ImagesPage() {
  const api = useApi();
  const toast = useUi((u) => u.toast);
  const images = useResource(() => api.images(), []);
  const [creating, setCreating] = useState<ImageSummary | 'new' | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  const setScope = async (img: ImageSummary, scope: Exclude<ImageScope, 'default'>) => {
    try {
      const r = await api.setImageVisibility(img.name, scope);
      toast(r.orgRequest === 'pending' ? '組織への公開を申請しました。管理者の承認を待っています。' : `公開範囲を「${scopeLabel[r.scope]}」にしました`, 'ok');
      await images.reload();
    } catch (e) {
      toast(errorMessage(e), 'err');
    }
  };

  return (
    <Page>
      <PageHeader
        title="イメージ"
        description="ステップの VM で使う実行環境です。既定のイメージに、パッケージやコマンドを足したカスタムイメージを作れます。VM のメモリもイメージで決まります。"
        actions={<Button size="sm" icon={<IconPlus />} onClick={() => setCreating('new')}>新しいイメージ</Button>}
      />
      <ErrorBanner error={images.error} onRetry={() => void images.reload()} />
      {!images.data ? (
        <Loading />
      ) : (
        <div className={p.stack}>
          {order.map((scope) => {
            const list = images.data!.filter((i) => i.scope === scope);
            if (!list.length) return null;
            return (
              <section key={scope} className={p.section}>
                <h2 className={p.sectionTitle}>{scopeLabel[scope]}</h2>
                <div className={p.grid}>
                  {list.map((img) => (
                    <Card key={img.name}>
                      <div className={p.cardBody}>
                        <div className={p.row}>
                          <h3 className={p.cardTitle}>
                            <IconImage /> {img.name}
                            <span className="mono">{img.latestVersion ? `@${img.latestVersion}` : '（ビルド中）'}</span>
                          </h3>
                          <span className={p.right}>
                            {img.orgRequest === 'pending' && <Tag tone="alert">組織への公開を申請中</Tag>}
                            <Menu
                              label={`${img.name} の操作`}
                              trigger={<IconMore />}
                              items={[
                                { label: 'バージョンとビルドログ', onSelect: () => setDetail(img.name) },
                                { label: 'この定義をもとに新しい版を作る', onSelect: () => setCreating(img), disabled: img.scope === 'default' },
                                { label: '公開範囲: 自分だけ', onSelect: () => void setScope(img, 'personal'), disabled: img.scope === 'default' || img.scope === 'personal' },
                                { label: '公開範囲: プロジェクト', onSelect: () => void setScope(img, 'project'), disabled: img.scope === 'default' || img.scope === 'project' },
                                { label: '組織への公開を申請', onSelect: () => void setScope(img, 'org'), disabled: img.scope === 'default' || img.scope === 'org' || img.orgRequest === 'pending' },
                              ]}
                            />
                          </span>
                        </div>
                        {img.description && <p className={p.desc}>{img.description}</p>}
                        <div className={p.meta}>
                          <span>メモリ {mib(img.memoryMiB)}</span>
                          {img.owner && <span>作成: {img.owner}</span>}
                          <span>更新 {relative(img.updatedAt)}</span>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {creating && (
        <ImageEditor
          base={creating === 'new' ? null : creating}
          images={images.data ?? []}
          onClose={() => setCreating(null)}
          onBuilt={(name) => {
            setCreating(null);
            setDetail(name);
            void images.reload();
          }}
        />
      )}
      {detail && <ImageDetail name={detail} onClose={() => { setDetail(null); void images.reload(); }} />}
    </Page>
  );
}

const lines = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean);

function ImageEditor({ base, images, onClose, onBuilt }: { base: ImageSummary | null; images: ImageSummary[]; onClose: () => void; onBuilt: (name: string) => void }) {
  const api = useApi();
  const [name, setName] = useState(base?.name ?? '');
  const [description, setDescription] = useState(base?.description ?? '');
  const [from, setFrom] = useState('web@5');
  const [memory, setMemory] = useState(base?.memoryMiB ?? 4096);
  const [apt, setApt] = useState('');
  const [npm, setNpm] = useState('');
  const [pip, setPip] = useState('');
  const [run, setRun] = useState('');
  const [warmup, setWarmup] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { name: useId(), desc: useId(), base: useId(), mem: useId(), apt: useId(), npm: useId(), pip: useId(), run: useId(), warm: useId() };

  // 既存のイメージの新しい版を作るときは、最新の定義を読み込む
  useEffect(() => {
    if (!base?.latestVersion) return;
    void api.imageVersions(base.name).then((vs) => {
      const v = vs.findLast((x) => x.state === 'ready') ?? vs.at(-1);
      if (!v) return;
      setFrom(v.spec.base);
      setMemory(v.spec.memoryMiB);
      setApt(v.spec.packages.apt.join('\n'));
      setNpm(v.spec.packages.npm.join('\n'));
      setPip(v.spec.packages.pip.join('\n'));
      setRun(v.spec.run.join('\n'));
      setWarmup(v.spec.warmup.join('\n'));
    });
  }, [api, base]);

  const spec = { name, ...(description ? { description } : {}), base: from, memoryMiB: memory, packages: { apt: lines(apt), npm: lines(npm), pip: lines(pip) }, run: lines(run), warmup: lines(warmup) };
  const parsed = ImageSpec.safeParse(spec);
  const issues = parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
  const yaml = useMemo(() => stringify(spec), [JSON.stringify(spec)]); // eslint-disable-line react-hooks/exhaustive-deps
  const bases = images.filter((i) => i.latestVersion).map((i) => `${i.name}@${i.latestVersion}`);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const v = await api.buildImage(spec as never);
      onBuilt(v.name);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={base ? `${base.name} の新しい版` : '新しいイメージ'}
      width={880}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>やめる</Button>
          <Button size="sm" disabled={!parsed.success} loading={busy} onClick={() => void submit()}>登録してビルドする</Button>
        </>
      }
    >
      <div className={p.twoCols}>
        <div className={p.formGrid}>
          <Field label="名前" htmlFor={ids.name} error={name ? issues['name'] : undefined} hint="英小文字・数字・ハイフン">
            <TextInput id={ids.name} value={name} disabled={!!base} onChange={(e) => setName(e.target.value)} placeholder="web-playwright" aria-invalid={!!(name && issues['name'])} />
          </Field>
          <Field label="ベース" htmlFor={ids.base}>
            <Select id={ids.base} value={from} onChange={(e) => setFrom(e.target.value)}>
              {bases.map((b) => <option key={b} value={b}>{b}</option>)}
            </Select>
          </Field>
          <div className={p.full}>
            <Field label="説明" htmlFor={ids.desc}><TextInput id={ids.desc} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          </div>
          <Field label="VM のメモリ" htmlFor={ids.mem} hint="RunMicrovm では指定できないため、イメージで決める（N6）">
            <Select id={ids.mem} value={memory} onChange={(e) => setMemory(Number(e.target.value))}>
              {[2048, 4096, 8192].map((m) => <option key={m} value={m}>{mib(m)}</option>)}
            </Select>
          </Field>
          <Field label="apt のパッケージ" htmlFor={ids.apt} error={issues['packages']} hint="1行に1つ">
            <TextArea id={ids.apt} rows={3} value={apt} onChange={(e) => setApt(e.target.value)} placeholder="poppler-utils" />
          </Field>
          <Field label="npm のパッケージ" htmlFor={ids.npm}><TextArea id={ids.npm} rows={3} value={npm} onChange={(e) => setNpm(e.target.value)} placeholder="@playwright/test@1.65" /></Field>
          <Field label="pip のパッケージ" htmlFor={ids.pip}><TextArea id={ids.pip} rows={3} value={pip} onChange={(e) => setPip(e.target.value)} placeholder="pandas==2.3" /></Field>
          <div className={p.full}>
            <Field label="追加のコマンド（ビルド時）" htmlFor={ids.run} hint="パッケージの取得は許可リストの範囲だけ（D9）"><TextArea id={ids.run} rows={2} value={run} onChange={(e) => setRun(e.target.value)} placeholder="npx playwright install --with-deps chromium" /></Field>
          </div>
          <div className={p.full}>
            <Field label="warmup（/validate で実行）" htmlFor={ids.warm}><TextArea id={ids.warm} rows={2} value={warmup} onChange={(e) => setWarmup(e.target.value)} placeholder="npx playwright --version" /></Field>
          </div>
        </div>
        <div className={p.section}>
          <span className={p.sectionDesc} style={{ margin: 0 }}>イメージ定義（YAML）</span>
          <pre className={p.code} aria-label="イメージ定義の YAML">{yaml}</pre>
          <Banner>ビルドでは、L1（factory-base）の上にこの定義を重ねた Dockerfile を合成し、自己テスト（/validate）が通ったら登録します。</Banner>
        </div>
      </div>
      {error && <Banner tone="err">{error}</Banner>}
    </Dialog>
  );
}

function ImageDetail({ name, onClose }: { name: string; onClose: () => void }) {
  const api = useApi();
  const versions = useResource(() => api.imageVersions(name), [name], { pollMs: 1000 });
  const [sel, setSel] = useState<number | null>(null);
  const latest = versions.data?.at(-1);
  const v = versions.data?.find((x) => x.version === sel) ?? latest;
  const building = v && (v.state === 'building' || v.state === 'validating');
  const log = useResource(() => (v ? api.buildLog(name, v.version) : Promise.resolve(null)), [name, v?.version, v?.state], { ...(building ? { pollMs: 700 } : {}) });
  const stateLabel = { building: 'ビルド中', validating: '自己テスト中', ready: '使えます', failed: '失敗' } as const;
  const tone = { building: 'run', validating: 'run', ready: 'ok', failed: 'err' } as const;
  return (
    <Dialog open onClose={onClose} title={`${name} のバージョン`} width={720}>
      {!versions.data ? (
        <Loading />
      ) : (
        <>
          <div className={p.row} role="group" aria-label="バージョン">
            {versions.data.map((x) => (
              <Button key={x.version} size="sm" variant={x.version === v?.version ? 'primary' : 'secondary'} onClick={() => setSel(x.version)}>
                {name}@{x.version}
              </Button>
            ))}
            {v && <span className={p.right}><Tag tone={tone[v.state]}>{stateLabel[v.state]}</Tag></span>}
          </div>
          {v?.error && <Banner tone="err">{v.error}</Banner>}
          <pre className={p.code} aria-label="ビルドログ" aria-live="polite">{log.data?.lines.join('\n') || 'ログを待っています…'}</pre>
          {v && <pre className={p.code} aria-label="定義">{stringify(v.spec)}</pre>}
        </>
      )}
    </Dialog>
  );
}
