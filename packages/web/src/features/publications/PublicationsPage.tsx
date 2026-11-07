// 公開物（FR-SHARE）: 自分が社内に公開したものの一覧。範囲・期限の変更、再公開、停止
import type { Acl, Publication } from '@factory/contracts';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { Page } from '../../app/AppShell';
import { Button } from '../../components/ui/button';
import { Dialog, Empty, ErrorBanner, Field, Loading, Menu, PageHeader, Select, Table, Tag, TextInput } from '../../components/kit';
import { IconGlobe, IconLock, IconMore } from '../../components/icons';
import { errorMessage } from '../../lib/api';
import { date, relative } from '../../lib/format';
import { useApi } from '../../lib/services';
import { useResource } from '../../lib/useResource';
import { useUi } from '../../stores/ui';
import { ConfirmDialog } from '../task/Dialogs';
import p from '../pages.module.css';

const statusLabel = { active: '公開中', stopped: '停止', expired: '期限切れ' } as const;
const statusTone = { active: 'ok', stopped: undefined, expired: 'alert' } as const;

export function PublicationsPage() {
  const api = useApi();
  const toast = useUi((u) => u.toast);
  const list = useResource(() => api.publications(), []);
  const [editing, setEditing] = useState<Publication | null>(null);
  const [stopping, setStopping] = useState<Publication | null>(null);

  const republish = async (pub: Publication) => {
    try {
      await api.updatePublication(pub.id, { republish: true });
      toast(`再公開しました（第${pub.version + 1}版）`, 'ok');
      await list.reload();
    } catch (e) {
      toast(errorMessage(e), 'err');
    }
  };

  return (
    <Page>
      <PageHeader title="公開物" description="依頼の成果物を、社内向けに公開したものです。開くには社内のアカウントでのログインが必要です。" />
      <ErrorBanner error={list.error} onRetry={() => void list.reload()} />
      {list.loading && !list.data ? (
        <Loading />
      ) : !list.data?.length ? (
        <Empty title="公開したものはまだありません" icon={<IconGlobe />}>
          完了した依頼の「成果物」から「公開する」を選ぶと、ここに並びます。
        </Empty>
      ) : (
        <Table head={['タイトル', '範囲', '状態', '版', '期限', '更新', '']} label="公開物の一覧">
          {list.data.map((pub) => {
            const who = [...(pub.acl.groups ?? []), ...(pub.acl.users ?? [])];
            return (
              <tr key={pub.id}>
                <td>
                  {pub.status === 'active' ? (
                    <a className={p.link} href={pub.url} target="_blank" rel="noreferrer">{pub.title}</a>
                  ) : (
                    <span className={p.link}>{pub.title}</span>
                  )}
                  <span className={p.sub}>
                    <span className="mono">{pub.path}</span> · <Link to={`/t/${pub.taskId}`}>元の依頼</Link>
                  </span>
                </td>
                <td>
                  {pub.acl.scope === 'org' ? (
                    <span className={p.row}><IconGlobe /> 社内のだれでも</span>
                  ) : (
                    <span className={p.row} title={who.join('、')}>
                      <IconLock /> {who.slice(0, 2).join('、')}
                      {who.length > 2 && ' ほか'}
                    </span>
                  )}
                </td>
                <td><Tag tone={statusTone[pub.status]}>{statusLabel[pub.status]}</Tag></td>
                <td>第{pub.version}版</td>
                <td>{pub.expiresAt ? date(pub.expiresAt) : '期限なし'}</td>
                <td className="muted">{relative(pub.updatedAt)}</td>
                <td>
                  <Menu
                    label={`${pub.title} の操作`}
                    trigger={<IconMore />}
                    items={[
                      { label: '範囲と期限を変更', onSelect: () => setEditing(pub) },
                      { label: '最新の成果物で再公開', onSelect: () => void republish(pub) },
                      { label: 'URL をコピー', onSelect: () => { void navigator.clipboard?.writeText(pub.url); toast('URL をコピーしました'); } },
                      { label: '公開を停止', onSelect: () => setStopping(pub), danger: true, disabled: pub.status !== 'active' },
                    ]}
                  />
                </td>
              </tr>
            );
          })}
        </Table>
      )}
      {editing && <EditDialog pub={editing} onClose={() => setEditing(null)} onSaved={() => void list.reload()} />}
      <ConfirmDialog
        open={!!stopping}
        title="公開を停止しますか？"
        body={`「${stopping?.title ?? ''}」を開けなくなります。成果物そのものは消えません。あとで再公開できます。`}
        confirm="停止する"
        danger
        onConfirm={async () => {
          try {
            await api.stopPublication(stopping!.id);
            toast('公開を停止しました', 'ok');
            await list.reload();
          } catch (e) {
            toast(errorMessage(e), 'err');
          }
        }}
        onClose={() => setStopping(null)}
      />
    </Page>
  );
}

function EditDialog({ pub, onClose, onSaved }: { pub: Publication; onClose: () => void; onSaved: () => void }) {
  const api = useApi();
  const toast = useUi((u) => u.toast);
  const [scope, setScope] = useState<Acl['scope']>(pub.acl.scope);
  const [groups, setGroups] = useState((pub.acl.groups ?? []).join('、'));
  const [users, setUsers] = useState((pub.acl.users ?? []).join('、'));
  const [expires, setExpires] = useState(pub.expiresAt?.slice(0, 10) ?? '');
  const [error, setError] = useState<string | null>(null);
  const ids = { scope: useId(), groups: useId(), users: useId(), exp: useId() };
  const list = (v: string) => v.split(/[,、\s]+/).map((x) => x.trim()).filter(Boolean);
  const save = async () => {
    if (scope === 'restricted' && list(groups).length + list(users).length === 0) return setError('グループかユーザーを1つ以上入れてください');
    try {
      await api.updatePublication(pub.id, {
        acl: scope === 'org' ? { scope } : { scope, ...(list(groups).length ? { groups: list(groups) } : {}), ...(list(users).length ? { users: list(users) } : {}) },
        expiresAt: expires ? new Date(`${expires}T23:59:59+09:00`).toISOString() : null,
      });
      toast('変更しました', 'ok');
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="範囲と期限を変更"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>やめる</Button>
          <Button size="sm" onClick={() => void save()}>保存</Button>
        </>
      }
    >
      <Field label="公開する範囲" htmlFor={ids.scope}>
        <Select id={ids.scope} value={scope} onChange={(e) => setScope(e.target.value as Acl['scope'])}>
          <option value="restricted">限られた人</option>
          <option value="org">社内のだれでも</option>
        </Select>
      </Field>
      {scope === 'restricted' && (
        <>
          <Field label="グループ" htmlFor={ids.groups}><TextInput id={ids.groups} value={groups} onChange={(e) => setGroups(e.target.value)} /></Field>
          <Field label="ユーザー（メール）" htmlFor={ids.users}><TextInput id={ids.users} value={users} onChange={(e) => setUsers(e.target.value)} /></Field>
        </>
      )}
      <Field label="公開の期限" htmlFor={ids.exp} hint="空にすると期限なし">
        <TextInput id={ids.exp} type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
      </Field>
      {error && <ErrorBanner error={error} />}
    </Dialog>
  );
}
