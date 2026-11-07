// ワークスペースのダイアログ: 社内公開（FR-SHARE）、名前の変更、確認
import type { Acl, FileEntry, PrecheckResult, Publication, Task } from '@factory/contracts';
import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/ui/button';
import { Banner, Dialog, Field, Select, TextInput } from '../../components/kit';
import { IconCheck, IconCopy, IconWarning } from '../../components/icons';
import { errorMessage } from '../../lib/api';
import { bytes, date } from '../../lib/format';
import { useApi } from '../../lib/services';
import { useUi } from '../../stores/ui';
import t from './tabs/tabs.module.css';

export function ConfirmDialog({ open, title, body, confirm, danger, onConfirm, onClose }: { open: boolean; title: string; body: string; confirm: string; danger?: boolean; onConfirm: () => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width={440}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>やめる</Button>
          <Button
            variant={danger ? 'destructive' : 'primary'}
            size="sm"
            loading={busy}
            onClick={() => {
              setBusy(true);
              void onConfirm().finally(() => {
                setBusy(false);
                onClose();
              });
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{body}</p>
    </Dialog>
  );
}

export function RenameDialog({ open, item, onClose, onSaved }: { open: boolean; item: Task; onClose: () => void; onSaved: (w: Task) => void }) {
  const api = useApi();
  const [title, setTitle] = useState(item.title);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  useEffect(() => setTitle(item.title), [item.title, open]);
  const save = async () => {
    try {
      onSaved(await api.updateTask(item.id, { title: title.trim() }));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="名前を変更"
      width={460}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>やめる</Button>
          <Button size="sm" disabled={!title.trim()} onClick={() => void save()}>保存</Button>
        </>
      }
    >
      <Field label="タイトル" htmlFor={id} error={error ?? undefined}>
        <TextInput id={id} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
      </Field>
    </Dialog>
  );
}

const expiryOptions = [
  { value: '7', label: '7日間' },
  { value: '30', label: '30日間' },
  { value: '90', label: '90日間' },
  { value: '', label: '期限なし' },
];

/** 社内公開: 公開するフォルダを選ぶ → 公開前のチェック → 範囲と期限 → 公開 */
export function PublishDialog({ open, item, onClose }: { open: boolean; item: Task; onClose: () => void }) {
  const api = useApi();
  const navigate = useNavigate();
  const toast = useUi((u) => u.toast);
  const [dirs, setDirs] = useState<FileEntry[]>([]);
  const [path, setPath] = useState('');
  const [check, setCheck] = useState<PrecheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [scope, setScope] = useState<Acl['scope']>('restricted');
  const [groups, setGroups] = useState('');
  const [users, setUsers] = useState('');
  const [expiry, setExpiry] = useState('30');
  const [title, setTitle] = useState(item.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Publication | null>(null);
  const ids = { path: useId(), groups: useId(), users: useId(), expiry: useId(), title: useId() };

  useEffect(() => {
    if (!open) return;
    setDone(null);
    setError(null);
    setTitle(item.title);
    void api.files(item.id, '').then((tree) => {
      const ds = tree.entries.filter((e) => e.type === 'dir' && e.name !== 'attachments');
      setDirs(ds);
      const preferred = ds.find((d) => /^(report|dist|public|build)$/.test(d.name));
      setPath(preferred ? `${preferred.path}/` : '.');
    });
  }, [open, api, item.id, item.title]);

  useEffect(() => {
    if (!open || !path) return;
    setChecking(true);
    setCheck(null);
    api.precheck(item.id, path).then(setCheck, (e: unknown) => setError(errorMessage(e))).finally(() => setChecking(false));
  }, [open, path, api, item.id]);

  const list = (v: string) => v.split(/[,、\s]+/).map((x) => x.trim()).filter(Boolean);
  const aclOk = scope === 'org' || list(groups).length + list(users).length > 0;

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      const pub = await api.publish({
        taskId: item.id,
        path,
        title: title.trim() || item.title,
        acl: scope === 'org' ? { scope } : { scope, ...(list(groups).length ? { groups: list(groups) } : {}), ...(list(users).length ? { users: list(users) } : {}) },
        ...(expiry ? { expiresAt: new Date(Date.now() + Number(expiry) * 86_400_000).toISOString() } : {}),
      });
      setDone(pub);
      toast('公開しました', 'ok');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={done ? '公開しました' : '社内に公開'}
      width={560}
      footer={
        done ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => { onClose(); void navigate('/publications'); }}>公開物の一覧へ</Button>
            <Button size="sm" onClick={onClose}>閉じる</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={onClose}>やめる</Button>
            <Button size="sm" disabled={!check?.ok || !aclOk || checking} loading={busy} onClick={() => void publish()}>公開する</Button>
          </>
        )
      }
    >
      {done ? (
        <>
          <Banner tone="ok">
            <strong>{done.title}</strong> を公開しました。{done.acl.scope === 'org' ? '社内のだれでも' : '指定した人だけが'}、社内のアカウントでログインして開けます。
          </Banner>
          <div className={t.copyRow}>
            <code className={t.url}>{done.url}</code>
            <Button
              size="sm"
              variant="secondary"
              icon={<IconCopy />}
              onClick={() => {
                void navigator.clipboard?.writeText(done.url);
                toast('URL をコピーしました');
              }}
            >
              コピー
            </Button>
          </div>
          {done.expiresAt && <p className="muted" style={{ margin: 0, fontSize: 13 }}>{date(done.expiresAt)} まで公開します。期限や範囲は「公開物」の画面で変えられます。</p>}
        </>
      ) : (
        <>
          <Field label="公開するフォルダ" htmlFor={ids.path} hint="静的なファイル（HTML・画像・CSV など）だけを公開できます（D11）">
            <Select id={ids.path} value={path} onChange={(e) => setPath(e.target.value)}>
              <option value=".">ワークスペース全体</option>
              {dirs.map((d) => (
                <option key={d.path} value={`${d.path}/`}>{d.path}/</option>
              ))}
            </Select>
          </Field>
          <div className={t.check} aria-live="polite">
            <div className={t.checkHead}>公開の前のチェック</div>
            {checking || !check ? (
              <span className="muted">確かめています…</span>
            ) : (
              <>
                <div className={t.checkResult} data-ok={check.ok || undefined}>
                  {check.ok ? <IconCheck /> : <IconWarning />}
                  {check.ok ? `問題はありません（${check.files} ファイル · ${bytes(check.bytes)}）` : '公開できない問題があります'}
                </div>
                {check.findings.length > 0 && (
                  <ul className={t.findings}>
                    {check.findings.map((f, i) => (
                      <li key={i} data-severity={f.severity}>
                        <span className="mono">{f.path}</span> {f.message}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
          <Field label="タイトル" htmlFor={ids.title}>
            <TextInput id={ids.title} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </Field>
          <fieldset className={t.fieldset}>
            <legend>公開する範囲</legend>
            <label className={t.radio}>
              <input type="radio" name="scope" checked={scope === 'restricted'} onChange={() => setScope('restricted')} />
              <span><strong>限られた人</strong><span className="muted">指定したグループとユーザーだけ</span></span>
            </label>
            <label className={t.radio}>
              <input type="radio" name="scope" checked={scope === 'org'} onChange={() => setScope('org')} />
              <span><strong>社内のだれでも</strong><span className="muted">社内のアカウントでログインした人</span></span>
            </label>
          </fieldset>
          {scope === 'restricted' && (
            <div className={t.twoCols}>
              <Field label="グループ" htmlFor={ids.groups} hint="読点かカンマで区切る">
                <TextInput id={ids.groups} value={groups} placeholder="営業企画部" onChange={(e) => setGroups(e.target.value)} />
              </Field>
              <Field label="ユーザー（メール）" htmlFor={ids.users}>
                <TextInput id={ids.users} value={users} placeholder="ken.tanaka@example.co.jp" onChange={(e) => setUsers(e.target.value)} />
              </Field>
            </div>
          )}
          <Field label="公開の期限" htmlFor={ids.expiry}>
            <Select id={ids.expiry} value={expiry} onChange={(e) => setExpiry(e.target.value)}>
              {expiryOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </Field>
          {error && <Banner tone="err">{error}</Banner>}
        </>
      )}
    </Dialog>
  );
}
