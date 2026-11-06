// packages/contracts/src/index.ts
// フロントエンドとバックエンドで共有する Zod スキーマ。型の定義はここだけで行う（single source of truth）
import { z } from 'zod';

export const Ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'ULID 形式で指定してください');

export const WorkItemState = z.enum([
  'queued', 'planning', 'awaiting_approval', 'running', 'suspended', 'completed', 'failed', 'cancelled',
]);
export type WorkItemState = z.infer<typeof WorkItemState>;

export const ImageRef = z.string().regex(/^[a-z0-9-]+@\d+$/, 'name@version の形式で指定してください'); // 例: web@5

export const StageDef = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/),
  type: z.enum(['agent', 'command', 'approval', 'system']),
  image: ImageRef.optional(),            // VM のサイズもイメージで決まる（RunMicrovm では指定できない）
  network: z.string().optional(),        // NetworkProfile 名
  role: z.string().optional(),           // execution role のプロファイル名
  instructions: z.string().optional(),   // skills/*.md
  gates: z.array(z.literal('plan-approval')).default([]),
  action: z.enum(['create-pull-request', 'propose-publish']).optional(), // type=system のときに使う
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
export type StageDef = z.infer<typeof StageDef>;

export const Line = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  version: z.number().int().positive(),
  stages: z.array(StageDef).min(1),
});
export type Line = z.infer<typeof Line>;

export const WorkItem = z.object({
  id: Ulid,
  ownerId: z.string(),
  projectId: z.string().optional(),
  title: z.string().min(1).max(200),
  lineRef: z.string().regex(/^[a-z0-9-]+@\d+$/), // 例: chat@1
  state: WorkItemState,
  currentStageId: z.string().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type WorkItem = z.infer<typeof WorkItem>;

export const CreateWorkItemRequest = z.object({
  title: z.string().min(1).max(200),
  lineRef: z.string().regex(/^[a-z0-9-]+@\d+$/).default('chat@1'),
  projectId: z.string().optional(),
  repo: z
    .object({ owner: z.string(), name: z.string(), baseBranch: z.string().default('main') })
    .optional(),
  message: z.string().min(1).max(20_000),
});
export type CreateWorkItemRequest = z.infer<typeof CreateWorkItemRequest>;

export const StageResult = z.object({
  verdict: z.enum(['pass', 'fail', 'cancelled']),
  summary: z.string().max(4_000),
  outputs: z.record(z.string(), z.string()).default({}), // 出力名 → 成果物ストアのキー
});
export type StageResult = z.infer<typeof StageResult>;

export const Plan = z.object({
  summaryForHumans: z.string(),    // 非開発者にも分かる平易な要約（FR-PLAN-03）
  goal: z.string(),
  deliverables: z.array(z.string()),
  repos: z.array(z.string()),
  steps: z.array(z.string()).min(1),
  doneCriteria: z.array(z.string()),
  externalAccess: z.array(z.string()), // allowlist への追加が必要な宛先
  estimate: z.object({ minutes: z.number().int().nonnegative(), usd: z.number().nonnegative() }),
});
export type Plan = z.infer<typeof Plan>;

// WebSocket と Callback API で流れるイベント（type で判別する）
export const FactoryEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message.delta'), workItemId: Ulid, messageId: z.string(), text: z.string() }),
  z.object({ type: z.literal('message.completed'), workItemId: Ulid, messageId: z.string() }),
  z.object({ type: z.literal('tool.started'), workItemId: Ulid, toolUseId: z.string(), tool: z.string(), summary: z.string().max(2_000) }),
  z.object({ type: z.literal('tool.finished'), workItemId: Ulid, toolUseId: z.string(), ok: z.boolean() }),
  z.object({ type: z.literal('plan.proposed'), workItemId: Ulid, planVersion: z.number().int().positive(), plan: Plan }),
  z.object({ type: z.literal('approval.required'), workItemId: Ulid, reason: z.enum(['scope', 'egress', 'budget', 'time']), detail: z.string() }),
  z.object({ type: z.literal('egress.blocked'), workItemId: Ulid, host: z.string() }),
  z.object({ type: z.literal('usage'), workItemId: Ulid, inputTokens: z.number().int(), outputTokens: z.number().int(), vmSeconds: z.number() }),
  z.object({ type: z.literal('stage.changed'), workItemId: Ulid, stageId: z.string(), state: z.enum(['started', 'completed', 'failed']) }),
  z.object({ type: z.literal('workitem.state'), workItemId: Ulid, state: WorkItemState }),
]);
export type FactoryEvent = z.infer<typeof FactoryEvent>;

export const ApiError = z.object({ code: z.string(), message: z.string(), requestId: z.string().optional() });
export type ApiError = z.infer<typeof ApiError>;
