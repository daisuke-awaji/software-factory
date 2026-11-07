// モックのバックエンドのデータ（インメモリ。ブラウザでは localStorage に保存して、再読み込みしても続きから動く）
import {
  type AdminUser, type FactoryEvent, type FactoryEventEnvelope, type ImageSummary, type ImageVersion, type WorkflowDefinition, type Me,
  type NetworkProfile, type PackageSource, type PlanRecord, type Publication, type Repo, type StepRun, type Task, ulid,
} from '@factory/contracts';

/** シミュレーターが次に行うこと（JSON にできる形で持つ。再読み込みしても続きから動かすため） */
export type SimStep =
  | { t: 'emit'; delay: number; event: DistributiveOmit<FactoryEvent, 'taskId'> }
  | { t: 'say'; delay: number; text: string } // エージェントの発言（delta に分けて流す）
  | { t: 'write'; delay: number; path: string; content: string | null } // null は削除
  | { t: 'gate'; delay: number; gate: 'plan' | 'approval' | 'message'; approvalId?: string }
  | { t: 'next'; delay: number; outcome: 'pass' | 'fail' } // ステップが終わった。ワークフローの次へ進む
  | { t: 'pr'; delay: number }
  | { t: 'finish'; delay: number; state: 'completed' | 'failed' };

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type Scenario = 'web-form' | 'dashboard' | 'readme' | 'csv-cleanup' | 'report' | 'generic';

export type Sim = {
  scenario: Scenario;
  queue: SimStep[];
  waiting: null | 'plan' | 'approval' | 'message';
  approvalId?: string;
  /** いまのステップ */
  step: string;
  /** ステップごとの実行回数（verify#2 など） */
  attempts: Record<string, number>;
  /** 計画を出した回数と、修正の依頼の内容 */
  planVersion: number;
  comments: string[];
  /** シナリオの分岐（一度だけ失敗する、など） */
  flags: Record<string, boolean>;
  /** 中断された（指示が来たら続きから） */
  interrupted: boolean;
};

export type MockDb = {
  version: 4;
  settings: { speed: number };
  me: Me;
  users: AdminUser[];
  repos: Repo[];
  workflows: WorkflowDefinition[];
  tasks: Task[];
  events: Record<string, FactoryEventEnvelope[]>;
  plans: Record<string, PlanRecord[]>;
  stepRuns: Record<string, StepRun[]>;
  files: Record<string, Record<string, string>>; // タスク → パス → 中身
  baseFiles: Record<string, Record<string, string>>; // 差分の基準（作業を始めたときのリポジトリ）
  attachments: Record<string, { fileName: string; content: string; contentType: string }>; // 添付（path → 中身）
  sim: Record<string, Sim>;
  publications: Publication[];
  images: ImageSummary[];
  imageVersions: Record<string, ImageVersion[]>;
  buildLogs: Record<string, string[]>; // name@version → 行
  networkProfiles: NetworkProfile[];
  packageSources: PackageSource[];
  terminatedVms: string[];
};

const KEY = 'sf.mockdb.v3';
let db: MockDb | null = null;

export function getDb(): MockDb {
  if (!db) throw new Error('モックの DB が初期化されていません（initMockBackend を呼んでください）');
  return db;
}

export function setDb(next: MockDb) {
  db = next;
  save();
}

const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** まとめて保存する（イベントのたびに書くと重いため） */
export function save() {
  const st = storage();
  if (!st || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      if (db) st.setItem(KEY, JSON.stringify(db));
    } catch {
      // 容量を超えたら保存しない（モックなので続きから動かせないだけ）
    }
  }, 300);
}

export function loadDb(): MockDb | null {
  const raw = storage()?.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as MockDb;
    return parsed.version === 4 ? parsed : null;
  } catch {
    return null;
  }
}

export function clearStorage() {
  storage()?.removeItem(KEY);
}

// ---------------------------------------------------------------- イベントの配信
type Listener = (e: FactoryEventEnvelope) => void;
const listeners = new Set<Listener>();

export function onEvent(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** イベントを履歴に残し、購読している WebSocket に配る。at を渡すと、その時刻のイベントにする（シードで使う） */
export function emit(taskId: string, event: DistributiveOmit<FactoryEvent, 'taskId'>, at: number = Date.now()): FactoryEventEnvelope {
  const d = getDb();
  const env = { ...event, taskId, eventId: ulid(at) } as FactoryEventEnvelope;
  (d.events[taskId] ??= []).push(env);
  const current = d.tasks.find((w) => w.id === taskId);
  if (current) {
    current.updatedAt = new Date(at).toISOString();
    if (env.type === 'task.state') current.state = env.state;
    if (env.type === 'step.changed' && env.state === 'started') current.currentStepId = env.stepId;
    if (env.type === 'usage') {
      const u = (current.usage ??= { inputTokens: 0, outputTokens: 0, vmSeconds: 0 });
      u.inputTokens += env.inputTokens;
      u.outputTokens += env.outputTokens;
      u.vmSeconds += env.vmSeconds;
      // Bedrock（入力 $3 / 出力 $15 / 100万トークン）と VM（1秒 $0.00012）でおおよその費用を出す
      current.costUsd = Math.round((u.inputTokens * 3e-6 + u.outputTokens * 15e-6 + u.vmSeconds * 0.00012) * 100) / 100;
    }
  }
  save();
  for (const l of listeners) l(env);
  return env;
}

export function task(id: string) {
  return getDb().tasks.find((w) => w.id === id);
}
