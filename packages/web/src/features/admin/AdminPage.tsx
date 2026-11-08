// 管理（FR-ADM）: 許可リスト、パッケージソース、ワークフローの登録、VM と容量、ユーザー、イメージの申請
import { NetworkProfile, type AdminUser, type PackageSource } from '@factory/contracts';
import { useEffect, useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Page } from '../../app/AppShell';
import { Button } from '../../components/ui/button';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { Banner, Card, Empty, ErrorBanner, Field, Meter, PageHeader, Select, Table, Tag, TextArea, TextInput } from '../../components/kit';
import { CardGridSkeleton, CardSkeleton, MeterSkeleton, Skeleton, SkeletonText, TableSkeleton } from '../../components/skeletons';
import { IconImage, IconShield } from '../../components/icons';
import { errorMessage } from '../../lib/api';
import { mib, relative, usd } from '../../lib/format';
import { useApi } from '../../lib/services';
import { useResource } from '../../lib/useResource';
import { isAdmin, useMe } from '../../stores/me';
import { useUi } from '../../stores/ui';
import { ConfirmDialog } from '../task/Dialogs';
import p from '../pages.module.css';
import { WorkflowEditor } from './WorkflowEditor';

type Tab = 'network' | 'packages' | 'workflows' | 'vms' | 'users' | 'images';

export function AdminPage() {
  const me = useMe((m) => m.me);
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? 'network';
  if (!isAdmin(me)) {
    return (
      <Page>
        <PageHeader title="管理" />
        <Banner tone="warn">この画面は管理者だけが使えます。</Banner>
      </Page>
    );
  }
  return (
    <Page>
      <PageHeader title="管理" description="変更はすぐに反映され、監査ログに残ります。" />
      <div style={{ marginBottom: 18 }}>
        <SegmentedControl<Tab>
          size="sm"
          aria-label="管理の項目"
          value={tab}
          onChange={(v) => setParams({ tab: v })}
          options={[
            { value: 'network', label: '通信の許可リスト' },
            { value: 'packages', label: 'パッケージソース' },
            { value: 'workflows', label: 'ワークフロー' },
            { value: 'vms', label: 'VM と容量' },
            { value: 'users', label: 'ユーザー' },
            { value: 'images', label: 'イメージの申請' },
          ]}
        />
      </div>
      {tab === 'network' && <NetworkProfiles />}
      {tab === 'packages' && <PackageSources />}
      {tab === 'workflows' && <WorkflowEditor />}
      {tab === 'vms' && <Vms />}
      {tab === 'users' && <Users />}
      {tab === 'images' && <ImageRequests />}
    </Page>
  );
}

function NetworkProfiles() {
  const api = useApi();
  const toast = useUi((u) => u.toast);
  const list = useResource(() => api.admin.networkProfiles(), []);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (list.error) return <ErrorBanner error={list.error} onRetry={() => void list.reload()} />;
  if (!list.data)
    return (
      <div className={p.stack}>
        <SkeletonText size={13} width="min(640px, 100%)" />
        <CardGridSkeleton count={4} lines={1} body={<Skeleton height={128} radius={10} />} />
      </div>
    );
  const save = async (name: string, description: string | undefined) => {
    const allow = (drafts[name] ?? '')
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
    const check = NetworkProfile.omit({ updatedAt: true }).safeParse({ name, allow, ...(description ? { description } : {}) });
    if (!check.success)
      return setErrors((e) => ({
        ...e,
        [name]: check.error.issues.map((i) => `${allow[Number(i.path[1])] ?? ''}: ${i.message}`).join(' / '),
      }));
    try {
      await api.admin.putNetworkProfile(check.data);
      setErrors((e) => ({ ...e, [name]: '' }));
      setDrafts((d) => {
        const { [name]: _x, ...rest } = d;
        void _x;
        return rest;
      });
      toast(`${name} の許可リストを保存しました`, 'ok');
      await list.reload();
    } catch (e) {
      setErrors((x) => ({ ...x, [name]: errorMessage(e) }));
    }
  };
  return (
    <div className={p.stack}>
      <p className={p.sectionDesc} style={{ margin: 0 }}>
        VM からの通信は、ここに書いたホストにだけ通します（D4）。ステップごとに、ワークフローの定義でプロファイルを選びます。
      </p>
      <div className={p.grid}>
        {list.data.map((prof) => {
          const value = drafts[prof.name] ?? prof.allow.join('\n');
          return (
            <Card key={prof.name}>
              <div className={p.cardBody}>
                <h3 className={p.cardTitle}>
                  <IconShield /> {prof.name}
                </h3>
                {prof.description && <p className={p.desc}>{prof.description}</p>}
                <Field
                  label="許可するホスト（1行に1つ）"
                  htmlFor={`np-${prof.name}`}
                  error={errors[prof.name] || undefined}
                  hint={`更新 ${relative(prof.updatedAt)}`}
                >
                  <TextArea
                    id={`np-${prof.name}`}
                    rows={5}
                    className="mono"
                    value={value}
                    placeholder="（なし: 外部への通信をすべて止める）"
                    onChange={(e) => setDrafts((d) => ({ ...d, [prof.name]: e.target.value }))}
                  />
                </Field>
                <div className={p.row}>
                  <span className={p.right}>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={drafts[prof.name] === undefined}
                      onClick={() => void save(prof.name, prof.description)}
                    >
                      保存
                    </Button>
                  </span>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function PackageSources() {
  const api = useApi();
  const toast = useUi((u) => u.toast);
  const list = useResource(() => api.admin.packageSources(), []);
  const [draft, setDraft] = useState<Omit<PackageSource, 'updatedAt'> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ids = { kind: useId(), npm: useId(), pypi: useId() };
  useEffect(() => {
    const cur = list.data?.[0];
    if (cur && !draft)
      setDraft({
        name: cur.name,
        kind: cur.kind,
        ...(cur.npmRegistry ? { npmRegistry: cur.npmRegistry } : {}),
        ...(cur.pypiIndex ? { pypiIndex: cur.pypiIndex } : {}),
      });
  }, [list.data, draft]);
  if (list.error) return <ErrorBanner error={list.error} />;
  if (!draft)
    return (
      <div style={{ maxWidth: 640 }}>
        <CardSkeleton
          lines={2}
          body={
            <>
              <Skeleton height={36} radius={10} />
              <Skeleton height={36} radius={10} />
            </>
          }
        />
      </div>
    );
  return (
    <Card>
      <div className={p.cardBody} style={{ maxWidth: 640 }}>
        <h3 className={p.cardTitle}>
          パッケージの取得元 <span className="mono">{draft.name}</span>
        </h3>
        <p className={p.desc}>
          いまは公開レジストリから取得します。CodeArtifact に切り替えても、イメージやワークフローの定義は変えずに済みます（D9）。
        </p>
        <Field label="種類" htmlFor={ids.kind}>
          <Select id={ids.kind} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as PackageSource['kind'] })}>
            <option value="public">公開レジストリ（npm / PyPI）</option>
            <option value="codeartifact">AWS CodeArtifact</option>
          </Select>
        </Field>
        <Field label="npm のレジストリ" htmlFor={ids.npm}>
          <TextInput
            id={ids.npm}
            className="mono"
            value={draft.npmRegistry ?? ''}
            onChange={(e) => setDraft({ ...draft, npmRegistry: e.target.value })}
          />
        </Field>
        <Field label="PyPI のインデックス" htmlFor={ids.pypi}>
          <TextInput
            id={ids.pypi}
            className="mono"
            value={draft.pypiIndex ?? ''}
            onChange={(e) => setDraft({ ...draft, pypiIndex: e.target.value })}
          />
        </Field>
        {error && <Banner tone="err">{error}</Banner>}
        <div className={p.row}>
          <span className={p.right}>
            <Button
              size="sm"
              onClick={() =>
                void api.admin.putPackageSource(draft).then(
                  () => {
                    setError(null);
                    toast('パッケージソースを保存しました', 'ok');
                  },
                  (e: unknown) => setError(errorMessage(e)),
                )
              }
            >
              保存
            </Button>
          </span>
        </div>
      </div>
    </Card>
  );
}

const VM_HEAD = ['VM', 'タスク', '利用者', 'イメージ', '状態', '起動', ''];

function Vms() {
  const api = useApi();
  const toast = useUi((u) => u.toast);
  const vms = useResource(() => api.admin.vms(), [], { pollMs: 3000 });
  const cap = useResource(() => api.admin.capacity(), [], { pollMs: 3000 });
  const [target, setTarget] = useState<string | null>(null);
  return (
    <div className={p.stack}>
      <Card>
        {cap.data ? (
          <div className={p.meters}>
            <Meter label="メモリ（MicroVMs のクォータ）" used={cap.data.memoryMiB.used} limit={cap.data.memoryMiB.limit} format={mib} />
            <Meter label="同時に動くエージェント" used={cap.data.agents.used} limit={cap.data.agents.limit} />
            <Meter label="Bedrock の TPM" used={cap.data.tpm.used} limit={cap.data.tpm.limit} format={(n) => `${Math.round(n / 1000)}k`} />
          </div>
        ) : (
          <div className={p.meters} aria-busy="true">
            <MeterSkeleton />
            <MeterSkeleton />
            <MeterSkeleton />
          </div>
        )}
      </Card>
      {cap.data ? (
        <p className={p.sectionDesc} style={{ margin: 0 }}>
          順番待ちのタスク: {cap.data.queueLength} 件
        </p>
      ) : (
        <SkeletonText size={13} width={150} />
      )}
      {!vms.data ? (
        <TableSkeleton head={VM_HEAD} rows={3} label="VM の一覧" />
      ) : vms.data.length === 0 ? (
        <Empty title="動いている VM はありません" />
      ) : (
        <Table head={VM_HEAD} label="VM の一覧">
          {vms.data.map((v) => (
            <tr key={v.id}>
              <td className="mono">
                {v.id}
                <span className={p.sub}>{v.stepRunId}</span>
              </td>
              <td>
                <Link to={`/t/${v.taskId}`} className={p.link}>
                  開く
                </Link>
              </td>
              <td>{v.owner}</td>
              <td className="mono">
                {v.image} · {mib(v.memoryMiB)}
              </td>
              <td>
                <Tag tone={v.state === 'running' ? 'run' : undefined}>{v.state === 'running' ? '実行中' : '一時停止'}</Tag>
              </td>
              <td className="muted">{relative(v.startedAt)}</td>
              <td>
                <Button size="sm" variant="destructive" onClick={() => setTarget(v.id)}>
                  強制停止
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <ConfirmDialog
        open={!!target}
        title="VM を強制停止しますか？"
        body="エージェントの作業は止まり、タスクは失敗になります。利用者には会話の中で知らせます。"
        confirm="強制停止"
        danger
        onConfirm={async () => {
          try {
            await api.admin.terminateVm(target!);
            toast('VM を停止しました', 'ok');
            await vms.reload();
          } catch (e) {
            toast(errorMessage(e), 'err');
          }
        }}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}

function Users() {
  const api = useApi();
  const toast = useUi((u) => u.toast);
  const users = useResource(() => api.admin.users(), []);
  const [drafts, setDrafts] = useState<Record<string, AdminUser>>({});
  const save = async (u: AdminUser) => {
    try {
      await api.admin.putUser(u.id, { roles: u.roles, limits: u.limits });
      toast(`${u.name} を保存しました`, 'ok');
      setDrafts((d) => {
        const { [u.id]: _x, ...rest } = d;
        void _x;
        return rest;
      });
      await users.reload();
    } catch (e) {
      toast(errorMessage(e), 'err');
    }
  };
  if (users.error) return <ErrorBanner error={users.error} />;
  if (!users.data) return <TableSkeleton head={USER_HEAD} label="ユーザーの一覧" />;
  return (
    <Table head={USER_HEAD} label="ユーザーの一覧">
      {users.data.map((orig) => {
        const u = drafts[orig.id] ?? orig;
        const set = (patch: Partial<AdminUser>) => setDrafts((d) => ({ ...d, [u.id]: { ...u, ...patch } }));
        return (
          <tr key={u.id}>
            <td>
              {u.name}
              <span className={p.sub}>{u.email}</span>
            </td>
            <td>
              <input
                type="checkbox"
                aria-label={`${u.name} を管理者にする`}
                checked={u.roles.includes('admin')}
                onChange={(e) => set({ roles: e.target.checked ? ['user', 'admin'] : ['user'] })}
              />
            </td>
            <td>
              <TextInput
                className={p.numInput}
                type="number"
                min={1}
                max={20}
                aria-label={`${u.name} の同時に進めるタスク`}
                value={u.limits.concurrentTasks}
                onChange={(e) => set({ limits: { ...u.limits, concurrentTasks: Number(e.target.value) } })}
              />
            </td>
            <td>
              <TextInput
                className={p.numInput}
                type="number"
                min={0}
                aria-label={`${u.name} の月の上限（ドル）`}
                value={u.limits.monthlyUsd}
                onChange={(e) => set({ limits: { ...u.limits, monthlyUsd: Number(e.target.value) } })}
              />
            </td>
            <td>{usd(u.monthUsd)}</td>
            <td>
              <Button size="sm" variant="secondary" disabled={!drafts[u.id]} onClick={() => void save(u)}>
                保存
              </Button>
            </td>
          </tr>
        );
      })}
    </Table>
  );
}

const USER_HEAD = ['ユーザー', '管理者', '同時に進めるタスク', '月の上限', '今月の費用', ''];
const REQUEST_HEAD = ['イメージ', '申請した人', 'メモリ', ''];

function ImageRequests() {
  const api = useApi();
  const toast = useUi((u) => u.toast);
  const images = useResource(() => api.images(), []);
  const pending = images.data?.filter((i) => i.orgRequest === 'pending') ?? [];
  if (images.error) return <ErrorBanner error={images.error} onRetry={() => void images.reload()} />;
  if (!images.data) return <TableSkeleton head={REQUEST_HEAD} rows={3} label="組織への公開の申請" />;
  if (!pending.length) return <Empty title="承認を待っている申請はありません" icon={<IconImage />} />;
  return (
    <Table head={REQUEST_HEAD} label="組織への公開の申請">
      {pending.map((i) => (
        <tr key={i.name}>
          <td>
            <strong>
              {i.name}@{i.latestVersion}
            </strong>
            <span className={p.sub}>{i.description}</span>
          </td>
          <td>{i.owner}</td>
          <td>{mib(i.memoryMiB)}</td>
          <td>
            <Button
              size="sm"
              onClick={() =>
                void api.admin.approveOrgImage(i.name).then(
                  () => {
                    toast(`${i.name} を組織に公開しました`, 'ok');
                    void images.reload();
                  },
                  (e: unknown) => toast(errorMessage(e), 'err'),
                )
              }
            >
              承認する
            </Button>
          </td>
        </tr>
      ))}
    </Table>
  );
}
