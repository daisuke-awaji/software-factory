// packages/engine/src/handler.ts（骨子。SDK: @aws/durable-execution-sdk-js v3。strict の tsc で型を確認済み）
import { withDurableExecution, type DurableContext } from '@aws/durable-execution-sdk-js';
import type { Line, StageDef, StageResult, WorkItem } from '../contracts/index.js';
import { findStage, nextStage } from './transition.js';
import { approvals, repo, systemActions, vmManager } from './ports.js';

export const handler = withDurableExecution(async (event: { workItemId: string }, ctx: DurableContext) => {
  const wi: WorkItem = await ctx.step('load-work-item', async () => repo.loadWorkItem(event.workItemId));
  const line: Line = await ctx.step('load-line', async () => repo.loadLine(wi.lineRef));
  const loops: Record<string, number> = {};
  let stageId: string | undefined = line.stages[0]?.id;
  let seq = 0;

  while (stageId) {
    const stage: StageDef = findStage(line, stageId);
    const runId = `${stageId}#${++seq}`; // replay で先頭から再実行されても同じ値になる
    let result: StageResult;

    if (stage.type === 'approval') {
      result = await ctx.waitForCallback<StageResult>(
        `approve:${runId}`,
        async (callbackId) => { await approvals.request(wi, stage, callbackId); },
        { timeout: { days: 7 } },
      );
    } else if (stage.type === 'system') {
      const action = stage.action;
      if (!action) throw new Error(`stage ${stage.id}: type=system には action が必要`); // 本来はライン登録時の検証で弾く
      result = await ctx.step(`system:${runId}`, async () => systemActions[action](wi));
    } else {
      // agent / command: 受付制御 → RunMicrovm → 完了の callback を待つ
      const lease = await ctx.step(`lease:${runId}`, async () => vmManager.acquire(wi, stage, runId));
      result = await ctx.waitForCallback<StageResult>(
        `done:${runId}`,
        async (callbackId) => { await vmManager.run(lease, { stage, runId, callbackId }); },
        { timeout: { hours: stage.timeoutHours }, heartbeatTimeout: { minutes: 15 } },
      );
      await ctx.step(`release:${runId}`, async () => vmManager.release(lease, stage.keepVm));
    }

    await ctx.step(`record:${runId}`, async () => repo.saveStageResult(wi.id, runId, result));
    stageId = nextStage(stage, result, loops); // pass / fail / goto（maxLoops を超えたら undefined を返し、ワークアイテムを失敗にする）
  }
});
