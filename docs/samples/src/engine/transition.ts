// packages/engine/src/transition.ts — 遷移の判定は純粋な関数にして単体テストする
import type { Line, StageDef, StageResult } from '../contracts/index.js';

export function findStage(line: Line, id: string): StageDef {
  const stage = line.stages.find((s) => s.id === id);
  if (!stage) throw new Error(`stage not found: ${id}`);
  return stage;
}

/** 次のステージの id を返す。終わり（または maxLoops を超えた失敗）なら undefined */
export function nextStage(stage: StageDef, result: StageResult, loops: Record<string, number>): string | undefined {
  if (result.verdict === 'cancelled') return undefined;
  if (result.verdict === 'pass') return stage.on?.pass ?? stage.next;
  const fail = stage.on?.fail;
  if (!fail) return undefined;
  const count = (loops[stage.id] ?? 0) + 1;
  loops[stage.id] = count;
  return count <= fail.maxLoops ? fail.goto : undefined;
}
