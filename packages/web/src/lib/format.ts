// 表示の整形（日本語の UI。06_ui_spec.md §4: 状態の名前は日本語で統一する）
import type { ApprovalReason, TaskState } from '@factory/contracts';

export type Tone = 'run' | 'ok' | 'alert' | 'err' | undefined;

export const stateLabel: Record<TaskState, string> = {
  queued: '受付済み',
  planning: '計画中',
  awaiting_approval: '承認待ち',
  running: '実行中',
  suspended: '一時停止',
  completed: '完了',
  failed: '失敗',
  cancelled: '中止',
};

export const stateTone: Record<TaskState, Tone> = {
  queued: undefined,
  planning: 'run',
  awaiting_approval: 'alert',
  running: 'run',
  suspended: undefined,
  completed: 'ok',
  failed: 'err',
  cancelled: undefined,
};

export const reasonLabel: Record<ApprovalReason, string> = {
  scope: '作業の範囲の変更',
  egress: '外部への通信',
  budget: '予算',
  time: '作業時間',
};

export const terminalStates: TaskState[] = ['completed', 'failed', 'cancelled'];
export const isTerminal = (s: TaskState | null | undefined) => !!s && terminalStates.includes(s);

const stepNames: Record<string, string> = {
  workbench: '作業',
  implement: '実装',
  verify: '検証',
  review: 'レビュー',
  deliver: '完了',
  publish: '公開の提案',
  'unit-test': '単体テスト',
  e2e: 'E2E',
  triage: '振り分け',
  'security-review': 'セキュリティレビュー',
};
export const stepLabel = (id: string) => stepNames[id] ?? id;

export function time(t: number | string) {
  return new Date(t).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

export function dateTime(t: number | string) {
  return new Date(t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function date(t: number | string) {
  return new Date(t).toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' });
}

export function relative(t: number | string, now = Date.now()) {
  const d = Math.max(0, now - new Date(t).getTime());
  const m = Math.floor(d / 60_000);
  if (m < 1) return 'たった今';
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  const days = Math.floor(h / 24);
  if (days === 1) return '昨日';
  if (days < 7) return `${days}日前`;
  return new Date(t).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
}

export function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分${s % 60 ? `${s % 60}秒` : ''}`;
  return `${Math.floor(m / 60)}時間${m % 60}分`;
}

export const usd = (v: number | undefined) => (v === undefined ? '—' : `$${v.toFixed(2)}`);
export const tokens = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(0)}k` : n.toLocaleString('ja-JP'));
export const bytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
export const mib = (n: number) => (n >= 1024 ? `${n / 1024} GB` : `${n} MB`);
