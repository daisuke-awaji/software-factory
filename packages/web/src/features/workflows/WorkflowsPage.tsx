// ワークフロー（閲覧）: ステップのつながり（並列・分岐・戻り）を図で見る。ステップごとに VM のイメージと通信が分かる
import { Link } from 'react-router';
import { Page } from '../../app/AppShell';
import { Card, ErrorBanner, PageHeader } from '../../components/kit';
import { CardStackSkeleton, Skeleton } from '../../components/skeletons';
import { WorkflowGraph } from '../../components/workflow';
import { useApi } from '../../lib/services';
import { useResource } from '../../lib/useResource';
import { isAdmin, useMe } from '../../stores/me';
import p from '../pages.module.css';

export function WorkflowsPage() {
  const api = useApi();
  const me = useMe((m) => m.me);
  const workflows = useResource(() => api.workflows(), []);
  return (
    <Page>
      <PageHeader
        title="ワークフロー"
        description="タスクを進めるステップのつながりです。ステップごとに別の VM（別のイメージ）で動きます（D15）。"
        actions={isAdmin(me) ? <Link to="/admin?tab=workflows" className={p.link}>管理で編集する</Link> : undefined}
      />
      <ErrorBanner error={workflows.error} onRetry={() => void workflows.reload()} />
      {!workflows.data ? (
        workflows.error ? null : <CardStackSkeleton count={2} lines={1} body={<Skeleton width="100%" height={160} radius={16} />} />
      ) : (
        <div className={p.stack}>
          {workflows.data.map((l) => (
            <Card key={l.name}>
              <div className={p.cardBody}>
                <h2 className={p.cardTitle}>
                  {l.title ?? l.name} <span className="mono">{l.name}@{l.version}</span>
                </h2>
                {l.description && <p className={p.desc}>{l.description}</p>}
                <WorkflowGraph workflow={l} mode="view" label={`${l.title ?? l.name} のステップ`} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}
