// packages/engine/src/ports.ts — エンジンが使う外部の窓口（実装は DynamoDB / MicroVMs SDK。テストではフェイクに差し替える）
import type { Line, StageDef, StageResult, WorkItem } from '../contracts/index.js';

export type Lease = { leaseId: string; workItemId: string; runId: string; imageRef: string };

export interface Repo {
  loadWorkItem(id: string): Promise<WorkItem>;
  loadLine(ref: string): Promise<Line>;
  saveStageResult(workItemId: string, runId: string, result: StageResult): Promise<void>;
}
export interface VmManager {
  acquire(wi: WorkItem, stage: StageDef, runId: string): Promise<Lease>;
  run(lease: Lease, args: { stage: StageDef; runId: string; callbackId: string }): Promise<void>;
  release(lease: Lease, keepVm: boolean): Promise<void>;
}
export interface Approvals {
  request(wi: WorkItem, stage: StageDef, callbackId: string): Promise<void>;
}
export type SystemAction = (wi: WorkItem) => Promise<StageResult>;

declare const _repo: Repo;
declare const _vm: VmManager;
declare const _approvals: Approvals;
export const repo = _repo;
export const vmManager = _vm;
export const approvals = _approvals;
export const systemActions: Record<NonNullable<StageDef['action']>, SystemAction> = {
  'create-pull-request': async () => ({ verdict: 'pass', summary: 'PR を作成した', outputs: {} }),
  'propose-publish': async () => ({ verdict: 'pass', summary: '公開を提案した', outputs: {} }),
};
