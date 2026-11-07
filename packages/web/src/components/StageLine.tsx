// ラインの進み具合（計画 → 実装 → 検証 → レビュー → 納品）。UI モックの StageLine を引き継いだ
import type { Step } from '../lib/line';
import { IconCheck, IconClose } from './icons';
import s from './StageLine.module.css';

const statusText = { waiting: '未着手', running: '実行中', done: '完了', alert: '対応待ち', failed: '失敗' } as const;

export function StageLine({ steps, size = 'md', showSub = false, label = 'ラインの進み具合' }: { steps: Step[]; size?: 'xs' | 'sm' | 'md'; showSub?: boolean; label?: string }) {
  return (
    <ol className={s.line} data-size={size} aria-label={label}>
      {steps.map((st, i) => (
        <li key={st.id} className={s.item} data-status={st.status} title={`${st.label}: ${statusText[st.status]}`}>
          {i > 0 && <span className={s.bar} aria-hidden="true" />}
          <span className={s.node} aria-hidden="true">
            {st.status === 'done' ? <IconCheck /> : st.status === 'failed' ? <IconClose /> : null}
          </span>
          {size !== 'xs' && (
            <span className={s.text}>
              <span className={s.label}>{st.label}</span>
              {showSub && st.sub && <span className={s.sub}>{st.sub}</span>}
            </span>
          )}
          <span className="sr-only">
            {size === 'xs' ? `${st.label}: ` : ''}
            {statusText[st.status]}
          </span>
        </li>
      ))}
    </ol>
  );
}
