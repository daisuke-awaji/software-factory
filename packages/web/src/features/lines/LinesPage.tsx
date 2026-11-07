// ライン（閲覧）: ステージの並びと、それぞれの VM のイメージ・通信・戻り方
import { Fragment } from 'react';
import { Link } from 'react-router';
import { Page } from '../../app/AppShell';
import { Card, ErrorBanner, Loading, PageHeader } from '../../components/kit';
import { IconChevron, IconShield } from '../../components/icons';
import { stageLabel } from '../../lib/format';
import { useApi } from '../../lib/services';
import { useResource } from '../../lib/useResource';
import { isAdmin, useMe } from '../../stores/me';
import p from '../pages.module.css';

export function LinesPage() {
  const api = useApi();
  const me = useMe((m) => m.me);
  const lines = useResource(() => api.lines(), []);
  return (
    <Page>
      <PageHeader
        title="ライン"
        description="依頼を進める工程の並びです。ステージごとに別の VM（別のイメージ）で動きます（D15）。"
        actions={isAdmin(me) ? <Link to="/admin?tab=lines" className={p.link}>管理で編集する</Link> : undefined}
      />
      <ErrorBanner error={lines.error} onRetry={() => void lines.reload()} />
      {!lines.data ? (
        <Loading />
      ) : (
        <div className={p.stack}>
          {lines.data.map((l) => (
            <Card key={l.name}>
              <div className={p.cardBody}>
                <h2 className={p.cardTitle}>
                  {l.title ?? l.name} <span className="mono">{l.name}@{l.version}</span>
                </h2>
                {l.description && <p className={p.desc}>{l.description}</p>}
                <div className={p.flow} role="list" aria-label={`${l.title ?? l.name} のステージ`}>
                  <div className={p.flowStage} role="listitem">
                    <strong>計画</strong>
                    <span>人が承認する</span>
                  </div>
                  {l.stages.map((st) => (
                    <Fragment key={st.id}>
                      <span className={p.flowArrow} aria-hidden="true"><IconChevron /></span>
                      <div className={p.flowStage} role="listitem">
                        <strong>{stageLabel(st.id)}</strong>
                        <span>{st.type === 'system' ? (st.action === 'create-pull-request' ? 'PR を作る（VM なし）' : '公開を提案（VM なし）') : st.image}</span>
                        {st.network && <span><IconShield /> 通信: {st.network}</span>}
                        {st.on?.fail && <span className={p.loop}>失敗 → {stageLabel(st.on.fail.goto)}（最大 {st.on.fail.maxLoops} 回）</span>}
                      </div>
                    </Fragment>
                  ))}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}
