import type { Workflow } from '@factory/contracts';
import type { ProgressStatus, StepStatus } from '../../lib/workflow';

export type GraphSelection = { kind: 'step'; id: string } | { kind: 'edge'; id: string };
export type ConnectKind = 'forward' | 'fail' | 'start';

export type WorkflowGraphProps = {
  workflow: Pick<Workflow, 'steps'>;
  /** view: 見るだけ / run: 実行の様子を重ねる（ノードを押せる） / edit: つなぐ・選ぶ・消す */
  mode: 'view' | 'run' | 'edit';
  label: string;
  statuses?: Record<string, StepStatus> | undefined;
  planStatus?: ProgressStatus | undefined;
  selected?: GraphSelection | null;
  onSelect?: (s: GraphSelection | null) => void;
  onConnect?: (from: string, to: string, kind: ConnectKind) => void;
  onDelete?: () => void;
  /** 省略すると、図の大きさに合わせる */
  height?: number;
};
