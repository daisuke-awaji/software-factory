// 図のノード: ステップ（種類のアイコン・名前・イメージ・通信）と、最初の「計画」
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { ReactNode } from 'react';
import {
  IconCheck,
  IconClose,
  IconFork,
  IconLock,
  IconMerge,
  IconPersonCheck,
  IconSettings,
  IconShield,
  IconSpark,
  IconTerminal,
  IconWarning,
} from '../icons';
import type { Direction } from './layout';
import type { GraphNodeData } from './model';
import s from './WorkflowGraph.module.css';

export type FlowNodeData = GraphNodeData & { direction: Direction; editable: boolean };
export type FlowNode = Node<FlowNodeData, 'step' | 'start'>;

const typeIcon: Record<NonNullable<GraphNodeData['type']>, ReactNode> = {
  agent: <IconSpark />,
  command: <IconTerminal />,
  approval: <IconPersonCheck />,
  system: <IconSettings />,
};
export const typeText: Record<NonNullable<GraphNodeData['type']>, string> = {
  agent: 'エージェント',
  command: 'コマンド',
  approval: '人の承認',
  system: '決まった処理',
};
const statusText = {
  waiting: '未着手',
  running: '実行中',
  done: '完了',
  alert: '対応待ち',
  failed: '失敗',
  skipped: '通らなかった',
} as const;

function Handles({ direction, editable, start }: { direction: Direction; editable: boolean; start?: boolean }) {
  const right = direction === 'RIGHT';
  return (
    <>
      {!start && (
        <Handle id="in" type="target" position={right ? Position.Left : Position.Top} className={s.handle} isConnectable={editable} />
      )}
      <Handle
        id="out"
        type="source"
        position={right ? Position.Right : Position.Bottom}
        className={s.handle}
        isConnectable={editable}
        title={editable ? 'ドラッグして、次のステップにつなぐ' : undefined}
      />
      {!start && (
        <>
          <Handle
            id="loop-out"
            type="source"
            position={right ? Position.Bottom : Position.Right}
            className={`${s.handle} ${s.loopOut}`}
            isConnectable={editable}
            title={editable ? 'ドラッグして、失敗したときの戻り先にする' : undefined}
          />
          <Handle
            id="loop-in"
            type="target"
            position={right ? Position.Bottom : Position.Right}
            className={`${s.handle} ${s.loopIn}`}
            isConnectable={false}
          />
        </>
      )}
    </>
  );
}

export function StepNode({ data, selected }: NodeProps<FlowNode>) {
  const st = data.status;
  return (
    <div
      className={s.node}
      data-status={st}
      data-selected={selected || undefined}
      data-issue={data.issue ? true : undefined}
      data-type={data.type}
    >
      <Handles direction={data.direction} editable={data.editable} />
      <div className={s.nodeHead}>
        <span className={s.typeIcon} title={data.type ? typeText[data.type] : undefined}>
          {data.type ? typeIcon[data.type] : null}
        </span>
        <strong className={s.nodeLabel}>{data.label}</strong>
        {data.attempts && <span className={s.attempts}>{data.attempts} 回目</span>}
        {st === 'done' && (
          <span className={s.state} data-tone="ok">
            <IconCheck />
          </span>
        )}
        {st === 'failed' && (
          <span className={s.state} data-tone="err">
            <IconClose />
          </span>
        )}
        {data.issue && (
          <span className={s.state} data-tone="warn" title={data.issue}>
            <IconWarning />
          </span>
        )}
      </div>
      {data.sub && <span className={s.nodeSub}>{data.sub}</span>}
      <span className={s.badges}>
        {data.gate && (
          <span className={s.badge} title="ステップの中で計画の承認を求める">
            <IconLock /> 承認
          </span>
        )}
        {data.network && (
          <span className={s.badge} title={`通信のプロファイル: ${data.network}`}>
            <IconShield /> {data.network}
          </span>
        )}
        {data.fork && (
          <span className={s.badge} data-tone="flow" title={`${data.fork} つの枝を同時に始める`}>
            <IconFork /> 並列 {data.fork}
          </span>
        )}
        {data.join && (
          <span className={s.badge} data-tone="flow" title={`${data.join} つの枝がすべて終わるまで待つ`}>
            <IconMerge /> {data.join} つを待つ
          </span>
        )}
      </span>
      {st && <span className="sr-only">{statusText[st]}</span>}
    </div>
  );
}

export function StartNode({ data, selected }: NodeProps<FlowNode>) {
  return (
    <div
      className={s.start}
      data-status={data.status}
      data-selected={selected || undefined}
      title="計画: エージェントが計画を出し、人が承認してから始まる"
    >
      <Handles direction={data.direction} editable={data.editable} start />
      <strong>{data.label}</strong>
      {data.status === 'done' ? (
        <span className={s.state} data-tone="ok">
          <IconCheck />
        </span>
      ) : null}
    </div>
  );
}
