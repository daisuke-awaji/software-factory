// ワークフローの進み具合（計画 → 実装 → 検証 → レビュー → 完了）。UI モックの StepProgress を引き継いだ。
// 同じ列のステップ（並列の枝や、分岐の行き先）は、点を縦に重ねて1つの列にする
import type { ProgressStatus, ProgressStep } from '../lib/workflow';
import { IconCheck, IconClose } from './icons';
import s from './StepProgress.module.css';

const statusText: Record<ProgressStatus, string> = {
  waiting: '未着手',
  running: '実行中',
  done: '完了',
  alert: '対応待ち',
  failed: '失敗',
  skipped: '通らなかった',
};
const priority: ProgressStatus[] = ['alert', 'failed', 'running', 'done', 'waiting', 'skipped'];

/** 列の状態: 対応待ち・失敗・実行中があればそれ、なければ完了（飛ばしたものは数えない） */
function columnStatus(steps: ProgressStep[]): ProgressStatus {
  const live = steps.filter((x) => x.status !== 'skipped');
  if (live.length === 0) return 'skipped';
  if (live.every((x) => x.status === 'done')) return 'done';
  return priority.find((p) => p !== 'done' && live.some((x) => x.status === p)) ?? 'waiting';
}

function group(steps: ProgressStep[]): ProgressStep[][] {
  const out: ProgressStep[][] = [];
  for (const st of steps) {
    const last = out.at(-1);
    if (last && last[0]!.column === st.column) last.push(st);
    else out.push([st]);
  }
  return out;
}

function Node({ status }: { status: ProgressStatus }) {
  return (
    <span className={s.node} data-status={status} aria-hidden="true">
      {status === 'done' ? <IconCheck /> : status === 'failed' ? <IconClose /> : null}
    </span>
  );
}

export function StepProgress({
  steps,
  size = 'md',
  showSub = false,
  label = 'ワークフローの進み具合',
}: {
  steps: ProgressStep[];
  size?: 'xs' | 'sm' | 'md';
  showSub?: boolean;
  label?: string;
}) {
  return (
    <ol className={s.line} data-size={size} aria-label={label}>
      {group(steps).map((col, i) => {
        const status = columnStatus(col);
        const many = col.length > 1;
        // 重なった列の見出しは、いま動いているもの（なければ全部）の名前にする
        const focus = col.filter((x) => x.status === 'running' || x.status === 'alert' || x.status === 'failed');
        const visible = col.filter((x) => x.status !== 'skipped');
        const shown = (focus.length ? focus : visible.length ? visible : col).map((x) => x.label).join('・');
        return (
          <li
            key={col[0]!.id}
            className={s.item}
            data-status={status}
            title={col.map((x) => `${x.label}: ${statusText[x.status]}`).join('\n')}
          >
            {i > 0 && <span className={s.bar} aria-hidden="true" />}
            {many ? (
              <span className={s.stack} aria-hidden="true">
                {col.map((x) => (
                  <Node key={x.id} status={x.status} />
                ))}
              </span>
            ) : (
              <Node status={col[0]!.status} />
            )}
            {size !== 'xs' && (
              <span className={s.text} aria-hidden={many || undefined}>
                <span className={s.label}>{many ? shown : col[0]!.label}</span>
                {showSub && !many && col[0]!.sub && <span className={s.sub}>{col[0]!.sub}</span>}
              </span>
            )}
            <span className="sr-only">
              {col.map((x) => `${size === 'xs' || many ? `${x.label}: ` : ''}${statusText[x.status]}`).join('、')}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
