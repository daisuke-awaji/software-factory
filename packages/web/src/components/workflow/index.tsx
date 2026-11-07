// ワークフローの図は React Flow と ELK を使うので、使う画面を開いたときだけ読み込む
import { lazy, Suspense } from 'react';
import { Skeleton } from '../skeletons';
import type { WorkflowGraphProps } from './types';

const Graph = lazy(() => import('./WorkflowGraph'));

export type { GraphSelection, ConnectKind, WorkflowGraphProps } from './types';

export function WorkflowGraph(props: WorkflowGraphProps) {
  return (
    <Suspense fallback={<Skeleton width="100%" height={props.height ?? 180} radius={16} />}>
      <Graph {...props} />
    </Suspense>
  );
}
