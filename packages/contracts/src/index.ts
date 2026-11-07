// @factory/contracts — フロントエンドとバックエンドで共有する Zod スキーマ。型の定義はここだけで行う（I1）
// 元は docs/samples/src/contracts/index.ts。Web の実装で足りなかった項目は「提案」として足した（docs/05_api_spec.md §7）
import { z } from 'zod';

export * from './ulid.js';

export const Ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'ULID 形式で指定してください');
const IsoTime = z.iso.datetime();

export const TaskState = z.enum(['queued', 'planning', 'awaiting_approval', 'running', 'suspended', 'completed', 'failed', 'cancelled']);
export type TaskState = z.infer<typeof TaskState>;

export const ImageRef = z.string().regex(/^[a-z0-9-]+@\d+$/, 'name@version の形式で指定してください'); // 例: web@5
export const WorkflowRef = z.string().regex(/^[a-z0-9-]+@\d+$/); // 例: chat@1

// ---------------------------------------------------------------- ワークフロー
export const StepDef = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/),
  type: z.enum(['agent', 'command', 'approval', 'system']),
  image: ImageRef.optional(),
  network: z.string().optional(),
  role: z.string().optional(),
  instructions: z.string().optional(),
  gates: z.array(z.literal('plan-approval')).default([]),
  action: z.enum(['create-pull-request', 'propose-publish']).optional(),
  timeoutHours: z.number().int().min(1).max(72).default(6),
  keepVm: z.boolean().default(false),
  next: z.string().optional(),
  on: z
    .object({
      pass: z.string().optional(),
      fail: z.object({ goto: z.string(), maxLoops: z.number().int().min(0).max(5) }).optional(),
    })
    .optional(),
});
export type StepDef = z.infer<typeof StepDef>;

export const Workflow = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  version: z.number().int().positive(),
  title: z.string().optional(), // 提案: 画面に出す名前
  description: z.string().optional(), // 提案: 画面に出す説明
  steps: z.array(StepDef).min(1),
});
export type Workflow = z.infer<typeof Workflow>;

/** 管理者が登録する YAML と、それを検証した結果 */
export const WorkflowDefinition = z.object({ name: z.string(), version: z.number().int().positive(), yaml: z.string(), workflow: Workflow, updatedAt: IsoTime });
export type WorkflowDefinition = z.infer<typeof WorkflowDefinition>;

// ---------------------------------------------------------------- タスク
export const RepoRef = z.object({ owner: z.string().min(1), name: z.string().min(1), baseBranch: z.string().default('main') });

export const Usage = z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), vmSeconds: z.number().nonnegative() });
export type Usage = z.infer<typeof Usage>;

export const Task = z.object({
  id: Ulid,
  ownerId: z.string(),
  projectId: z.string().optional(),
  title: z.string().min(1).max(200),
  workflowRef: WorkflowRef,
  state: TaskState,
  currentStepId: z.string().optional(),
  createdAt: IsoTime,
  updatedAt: IsoTime,
  // ---- 以下は提案（一覧とヘッダーに出すため）
  repo: RepoRef.optional(),
  branch: z.string().optional(), // 作業ブランチ（factory/<id>/...）
  pullRequest: z.object({ number: z.number().int().positive(), url: z.url() }).optional(),
  usage: Usage.optional(),
  costUsd: z.number().nonnegative().optional(),
  archived: z.boolean().default(false),
});
export type Task = z.infer<typeof Task>;

export const Page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), nextCursor: z.string().optional() });
export const TaskPage = Page(Task);
export type TaskPage = z.infer<typeof TaskPage>;

export const CreateTaskRequest = z.object({
  title: z.string().min(1).max(200).optional(), // 省略したらサーバーが本文から作る（titleFromMessage）。後から PATCH で変えられる
  workflowRef: WorkflowRef.default('chat@1'),
  projectId: z.string().optional(),
  repo: RepoRef.optional(),
  message: z.string().min(1).max(20_000),
  attachments: z.array(z.string()).max(20).optional(), // 提案: 作成前に上げた添付（POST /attachments の path）
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>;

/** タスクの本文からタイトルを作る: 最初の行の最初の文を、60字までにする */
export function titleFromMessage(message: string): string {
  const first = message.trim().split(/\n|。/).find((x) => x.trim())?.trim() ?? '';
  const chars = Array.from(first || message.trim());
  return chars.length > 60 ? `${chars.slice(0, 59).join('')}…` : chars.join('');
}

export const UpdateTaskRequest = z.object({ title: z.string().min(1).max(200).optional(), archived: z.boolean().optional() });
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequest>;

export const PostMessageRequest = z.object({ text: z.string().min(1).max(20_000), attachments: z.array(z.string()).max(20).optional() });
export type PostMessageRequest = z.infer<typeof PostMessageRequest>;

export const StepResult = z.object({
  verdict: z.enum(['pass', 'fail', 'cancelled']),
  summary: z.string().max(4_000),
  outputs: z.record(z.string(), z.string()).default({}),
});
export type StepResult = z.infer<typeof StepResult>;

export const StepRun = z.object({
  runId: z.string(), // 例: verify#2
  stepId: z.string(),
  state: z.enum(['running', 'completed', 'failed', 'cancelled']),
  image: ImageRef.optional(),
  startedAt: IsoTime,
  endedAt: IsoTime.optional(),
  result: StepResult.optional(),
});
export type StepRun = z.infer<typeof StepRun>;

// ---------------------------------------------------------------- 計画と承認
export const Plan = z.object({
  summaryForHumans: z.string(),
  goal: z.string(),
  deliverables: z.array(z.string()),
  repos: z.array(z.string()),
  steps: z.array(z.string()).min(1),
  doneCriteria: z.array(z.string()),
  externalAccess: z.array(z.string()),
  estimate: z.object({ minutes: z.number().int().nonnegative(), usd: z.number().nonnegative() }),
});
export type Plan = z.infer<typeof Plan>;

export const PlanStatus = z.enum(['proposed', 'approved', 'changes_requested', 'rejected', 'superseded']);
export const PlanRecord = z.object({
  version: z.number().int().positive(),
  plan: Plan,
  status: PlanStatus,
  createdAt: IsoTime,
  decidedBy: z.string().optional(),
  decidedAt: IsoTime.optional(),
  comment: z.string().optional(),
});
export type PlanRecord = z.infer<typeof PlanRecord>;

export const ApprovalReason = z.enum(['scope', 'egress', 'budget', 'time']);
export type ApprovalReason = z.infer<typeof ApprovalReason>;
export const ApprovalDecisionBody = z.object({ decision: z.enum(['approve', 'deny']), comment: z.string().max(4_000).optional() });
export type ApprovalDecisionBody = z.infer<typeof ApprovalDecisionBody>;
export const RequestChangesBody = z.object({ comment: z.string().min(1).max(4_000) });

// ---------------------------------------------------------------- イベント（WebSocket と Callback API）
export const FactoryEvent = z.discriminatedUnion('type', [
  // 提案: ユーザーの発言も履歴に残す（再読み込みしたときに会話を組み立て直すため）
  z.object({ type: z.literal('message.user'), taskId: Ulid, messageId: z.string(), text: z.string(), author: z.string(), attachments: z.array(z.string()).optional() }),
  z.object({ type: z.literal('message.delta'), taskId: Ulid, messageId: z.string(), text: z.string() }),
  z.object({ type: z.literal('message.completed'), taskId: Ulid, messageId: z.string() }),
  z.object({ type: z.literal('tool.started'), taskId: Ulid, toolUseId: z.string(), tool: z.string(), summary: z.string().max(2_000) }),
  // 提案: summary（結果の要約。例: 「12 件のテストが通過」）
  z.object({ type: z.literal('tool.finished'), taskId: Ulid, toolUseId: z.string(), ok: z.boolean(), summary: z.string().max(2_000).optional() }),
  z.object({ type: z.literal('plan.proposed'), taskId: Ulid, planVersion: z.number().int().positive(), plan: Plan }),
  // 提案: 計画への回答（誰がいつ承認したかを会話に出す）
  z.object({ type: z.literal('plan.decided'), taskId: Ulid, planVersion: z.number().int().positive(), decision: z.enum(['approved', 'changes_requested', 'rejected']), by: z.string(), comment: z.string().optional() }),
  // 提案: approvalId（POST /approvals/{approvalId} に必要）
  z.object({ type: z.literal('approval.required'), taskId: Ulid, approvalId: z.string(), reason: ApprovalReason, detail: z.string() }),
  z.object({ type: z.literal('approval.resolved'), taskId: Ulid, approvalId: z.string(), decision: z.enum(['approve', 'deny']), by: z.string() }),
  z.object({ type: z.literal('egress.blocked'), taskId: Ulid, host: z.string() }),
  z.object({ type: z.literal('usage'), taskId: Ulid, inputTokens: z.number().int(), outputTokens: z.number().int(), vmSeconds: z.number() }),
  z.object({ type: z.literal('step.changed'), taskId: Ulid, stepId: z.string(), state: z.enum(['started', 'completed', 'failed']) }),
  z.object({ type: z.literal('task.state'), taskId: Ulid, state: TaskState }),
  // 提案: VM の中でアプリが待ち受けを始めた（プレビューのタブを開けるようになる）
  z.object({ type: z.literal('preview.ready'), taskId: Ulid, port: z.number().int().min(1).max(65535), path: z.string().default('/') }),
]);
export type FactoryEvent = z.infer<typeof FactoryEvent>;
export type FactoryEventType = FactoryEvent['type'];

/** 配信するときは eventId（ULID）を付ける。WebSocket と GET /events の両方で同じ形 */
export const FactoryEventEnvelope = z.intersection(FactoryEvent, z.object({ eventId: Ulid }));
export type FactoryEventEnvelope = z.infer<typeof FactoryEventEnvelope>;
export const EventPage = Page(FactoryEventEnvelope);
export type EventPage = z.infer<typeof EventPage>;

export const WsClientFrame = z.object({ action: z.enum(['subscribe', 'unsubscribe']), taskId: Ulid });
export type WsClientFrame = z.infer<typeof WsClientFrame>;

// ---------------------------------------------------------------- ファイル・差分・成果物
export const FileEntry = z.object({ name: z.string(), path: z.string(), type: z.enum(['file', 'dir']), size: z.number().int().nonnegative().optional() });
export type FileEntry = z.infer<typeof FileEntry>;
export const FileTree = z.object({ path: z.string(), source: z.enum(['vm', 'snapshot']), entries: z.array(FileEntry) });
export type FileTree = z.infer<typeof FileTree>;

export const DiffFile = z.object({
  path: z.string(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed']),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  patch: z.string(), // unified diff の hunk（@@ から）
});
export type DiffFile = z.infer<typeof DiffFile>;
export const Diff = z.object({ base: z.string(), head: z.string(), files: z.array(DiffFile) });
export type Diff = z.infer<typeof Diff>;

export const AttachmentRequest = z.object({ fileName: z.string().min(1).max(255), contentType: z.string(), size: z.number().int().positive().max(100 * 1024 * 1024) });
export const AttachmentTicket = z.object({ uploadUrl: z.url(), path: z.string(), expiresAt: IsoTime });
export type AttachmentTicket = z.infer<typeof AttachmentTicket>;

export const DownloadRequest = z.object({ paths: z.array(z.string()).optional(), format: z.enum(['file', 'zip']) });
export const Download = z.object({ url: z.url(), fileName: z.string(), expiresAt: IsoTime });
export type Download = z.infer<typeof Download>;

export const Preview = z.object({ url: z.url(), expiresAt: IsoTime });
export type Preview = z.infer<typeof Preview>;

// ---------------------------------------------------------------- 社内公開
export const PrecheckFinding = z.object({
  kind: z.enum(['secret', 'size', 'absolute-path', 'external-ref']),
  severity: z.enum(['error', 'warning']),
  path: z.string(),
  message: z.string(),
});
export type PrecheckFinding = z.infer<typeof PrecheckFinding>;
export const PrecheckResult = z.object({ ok: z.boolean(), files: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(), findings: z.array(PrecheckFinding) });
export type PrecheckResult = z.infer<typeof PrecheckResult>;

export const Acl = z.object({ scope: z.enum(['org', 'restricted']), users: z.array(z.string()).optional(), groups: z.array(z.string()).optional() });
export type Acl = z.infer<typeof Acl>;

export const Publication = z.object({
  id: Ulid,
  taskId: Ulid,
  title: z.string(),
  path: z.string(),
  url: z.url(),
  acl: Acl,
  version: z.number().int().positive(),
  status: z.enum(['active', 'stopped', 'expired']),
  createdAt: IsoTime,
  updatedAt: IsoTime,
  expiresAt: IsoTime.optional(),
});
export type Publication = z.infer<typeof Publication>;

export const CreatePublicationRequest = z.object({ taskId: Ulid, path: z.string(), title: z.string().max(200).optional(), acl: Acl, expiresAt: IsoTime.optional() });
export type CreatePublicationRequest = z.infer<typeof CreatePublicationRequest>;
export const UpdatePublicationRequest = z.object({ acl: Acl.optional(), expiresAt: IsoTime.nullable().optional(), republish: z.boolean().optional() });
export type UpdatePublicationRequest = z.infer<typeof UpdatePublicationRequest>;

// ---------------------------------------------------------------- ユーザーと GitHub
export const Role = z.enum(['user', 'admin']);
export const Me = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  roles: z.array(Role),
  github: z.object({ connected: z.boolean(), login: z.string().optional() }),
});
export type Me = z.infer<typeof Me>;

export const Repo = z.object({ owner: z.string(), name: z.string(), defaultBranch: z.string(), private: z.boolean(), protected: z.boolean() });
export type Repo = z.infer<typeof Repo>;

// ---------------------------------------------------------------- イメージ
export const ImageScope = z.enum(['default', 'personal', 'project', 'org']);
export type ImageScope = z.infer<typeof ImageScope>;

const pkg = z.string().regex(/^[a-zA-Z0-9@/._=<>~^-]+$/, 'パッケージ名に使えない文字があります');
export const ImageSpec = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/, '英小文字・数字・ハイフン（2〜32文字）で指定してください'),
  description: z.string().max(500).optional(),
  base: ImageRef,
  memoryMiB: z.union([z.literal(2048), z.literal(4096), z.literal(8192)]),
  packages: z.object({ apt: z.array(pkg).default([]), npm: z.array(pkg).default([]), pip: z.array(pkg).default([]) }),
  run: z.array(z.string().max(500)).max(20).default([]),
  warmup: z.array(z.string().max(500)).max(10).default([]),
});
export type ImageSpec = z.infer<typeof ImageSpec>;

export const ImageSummary = z.object({
  name: z.string(),
  description: z.string().optional(),
  scope: ImageScope,
  owner: z.string().optional(),
  latestVersion: z.number().int().positive().optional(), // ビルドが1つも終わっていなければない
  memoryMiB: z.number().int().positive(),
  orgRequest: z.enum(['pending']).optional(), // 組織への公開を申請中
  updatedAt: IsoTime,
});
export type ImageSummary = z.infer<typeof ImageSummary>;

export const ImageVersion = z.object({
  name: z.string(),
  version: z.number().int().positive(),
  state: z.enum(['building', 'validating', 'ready', 'failed']),
  spec: ImageSpec,
  createdAt: IsoTime,
  error: z.string().optional(),
});
export type ImageVersion = z.infer<typeof ImageVersion>;

export const BuildLog = z.object({ lines: z.array(z.string()), done: z.boolean() });
export type BuildLog = z.infer<typeof BuildLog>;

// ---------------------------------------------------------------- 管理
const host = z.string().regex(/^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/, 'ホスト名（例: registry.npmjs.org、*.example.com）で指定してください');
export const NetworkProfile = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  allow: z.array(host),
  updatedAt: IsoTime,
});
export type NetworkProfile = z.infer<typeof NetworkProfile>;

export const PackageSource = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(['public', 'codeartifact']),
  npmRegistry: z.url().optional(),
  pypiIndex: z.url().optional(),
  updatedAt: IsoTime,
});
export type PackageSource = z.infer<typeof PackageSource>;

export const VmInfo = z.object({
  id: z.string(),
  taskId: Ulid,
  stepRunId: z.string(),
  owner: z.string(),
  image: ImageRef,
  memoryMiB: z.number().int().positive(),
  state: z.enum(['running', 'suspended']),
  startedAt: IsoTime,
});
export type VmInfo = z.infer<typeof VmInfo>;

const Meter = z.object({ used: z.number().nonnegative(), limit: z.number().positive() });
export const Capacity = z.object({ memoryMiB: Meter, agents: Meter, tpm: Meter, queueLength: z.number().int().nonnegative() });
export type Capacity = z.infer<typeof Capacity>;

export const UserLimits = z.object({ concurrentTasks: z.number().int().min(1).max(20), monthlyUsd: z.number().min(0).max(10_000) });
export const AdminUser = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  roles: z.array(Role),
  limits: UserLimits,
  monthUsd: z.number().nonnegative(),
});
export type AdminUser = z.infer<typeof AdminUser>;
export const UpdateAdminUserRequest = z.object({ roles: z.array(Role).optional(), limits: UserLimits.optional() });
export type UpdateAdminUserRequest = z.infer<typeof UpdateAdminUserRequest>;

export const ApiError = z.object({ code: z.string(), message: z.string(), requestId: z.string().optional() });
export type ApiError = z.infer<typeof ApiError>;
