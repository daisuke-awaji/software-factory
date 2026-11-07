// ワークフローの図（React Flow + ELK。ADR-0012）。見るだけ（view）・実行の様子を重ねる（run）・編集（edit）の3つで使う。
// 位置は常に自動で決める（YAML に座標を書かない）。この部品は重いので、index.tsx から遅れて読み込む
import {
  ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type EdgeChange, type FitViewOptions, type IsValidConnection, type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { stepLabel } from '../../lib/format';
import { IconFit, IconZoomIn, IconZoomOut } from '../icons';
import { FlowEdgeView, LoopEdgeView, Markers, type FlowEdge } from './edges';
import { layout, type Direction, type Positioned } from './layout';
import { START, buildModel, type Model } from './model';
import { StartNode, StepNode, type FlowNode } from './StepNode';
import type { WorkflowGraphProps } from './types';
import s from './WorkflowGraph.module.css';

const nodeTypes = { step: StepNode, start: StartNode };
const edgeTypes = { flow: FlowEdgeView, loop: LoopEdgeView };

/** 戻る矢印が、間にあるノードの下（縦に並べたときは右）を通るようにする */
function loopDip(model: Model, pos: Positioned['positions'], source: string, target: string, direction: Direction) {
  const a = model.nodes.find((n) => n.id === source)!;
  const b = model.nodes.find((n) => n.id === target)!;
  const pa = pos[source] ?? { x: 0, y: 0 };
  const pb = pos[target] ?? { x: 0, y: 0 };
  if (direction === 'RIGHT') {
    const lo = Math.min(pa.x, pb.x);
    const hi = Math.max(pa.x + a.width, pb.x + b.width);
    const bottoms = model.nodes.filter((n) => pos[n.id] && pos[n.id]!.x < hi && pos[n.id]!.x + n.width > lo).map((n) => pos[n.id]!.y + n.height);
    return Math.max(...bottoms) + 22;
  }
  const lo = Math.min(pa.y, pb.y);
  const hi = Math.max(pa.y + a.height, pb.y + b.height);
  const rights = model.nodes.filter((n) => pos[n.id] && pos[n.id]!.y < hi && pos[n.id]!.y + n.height > lo).map((n) => pos[n.id]!.x + n.width);
  return Math.max(...rights) + 22;
}

/** 読み上げ用: 図と同じ内容を文で並べる */
function describe(props: WorkflowGraphProps) {
  return props.workflow.steps.map((st) => {
    const parts: string[] = [];
    const nexts = Array.isArray(st.next) ? st.next : st.next ? [st.next] : st.on?.pass ? [st.on.pass] : [];
    if (nexts.length > 1) parts.push(`次は ${nexts.map(stepLabel).join('と')} を並列で`);
    else if (nexts[0]) parts.push(`次は ${stepLabel(nexts[0])}`);
    for (const [label, to] of Object.entries(st.on?.cases ?? {})) parts.push(`結果が ${label} なら ${stepLabel(to)}`);
    if (st.needs?.length) parts.push(`${st.needs.map(stepLabel).join('と')} がすべて終わってから始まる`);
    if (st.on?.fail) parts.push(`失敗したら ${stepLabel(st.on.fail.goto)} に戻る（${st.on.fail.maxLoops} 回まで）`);
    if (!parts.length) parts.push('ここで終わる');
    const status = props.statuses?.[st.id]?.status;
    return { id: st.id, text: `${stepLabel(st.id)}${status ? `（${{ waiting: '未着手', running: '実行中', done: '完了', alert: '対応待ち', failed: '失敗', skipped: '通らなかった' }[status]}）` : ''}: ${parts.join('、')}` };
  });
}

function Canvas(props: WorkflowGraphProps) {
  const { workflow, mode, statuses, planStatus, selected = null, onSelect, onConnect, onDelete, label } = props;
  const editable = mode === 'edit';
  const wrap = useRef<HTMLDivElement>(null);
  const markers = `wf${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [direction, setDirection] = useState<Direction>('RIGHT');
  const [positioned, setPositioned] = useState<Positioned | null>(null);
  const flow = useReactFlow<FlowNode, FlowEdge>();
  const model = useMemo(() => buildModel(workflow, statuses, planStatus), [workflow, statuses, planStatus]);
  const shapeKey = useMemo(() => JSON.stringify([direction, model.nodes.map((n) => n.id), model.edges.filter((e) => e.data.kind !== 'fail').map((e) => e.id)]), [direction, model]);

  // 幅が狭いときは縦に並べる（コンテナーの幅で決める）
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width ?? 0;
      if (w > 0) setDirection(w < 560 ? 'DOWN' : 'RIGHT');
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    void layout(model, direction).then((p) => {
      if (alive) setPositioned(p);
    });
    return () => {
      alive = false;
    };
    // 形（ノードと前へ進む矢印）が変わったときだけ並べ直す
  }, [shapeKey]);

  const nodes: FlowNode[] = useMemo(() => {
    if (!positioned) return [];
    return model.nodes.map((n) => ({
      id: n.id,
      type: n.data.kind === 'start' ? 'start' : 'step',
      position: positioned.positions[n.id] ?? { x: 0, y: 0 },
      width: n.width,
      height: n.height,
      data: { ...n.data, direction, editable },
      draggable: false,
      connectable: editable,
      selectable: mode !== 'view' && n.id !== START,
      selected: selected?.kind === 'step' && selected.id === n.id,
      ariaLabel: n.data.label,
    }));
  }, [model, positioned, direction, editable, mode, selected]);

  const edges: FlowEdge[] = useMemo(() => {
    if (!positioned) return [];
    return model.edges.map((e) => {
      const loop = e.data.kind === 'fail';
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: loop ? 'loop-out' : 'out',
        targetHandle: loop ? 'loop-in' : 'in',
        type: loop ? 'loop' : 'flow',
        data: { ...e.data, markers, direction, ...(loop ? { dip: loopDip(model, positioned.positions, e.source, e.target, direction) } : {}) },
        selectable: editable && e.data.kind !== 'start',
        selected: selected?.kind === 'edge' && selected.id === e.id,
        focusable: editable && e.data.kind !== 'start',
      };
    });
  }, [model, positioned, markers, direction, editable, selected]);

  // 並べ直したら、全体が入るように合わせる（戻る矢印はノードの外を回るので、その分をあける）
  const hasLoops = model.edges.some((e) => e.data.kind === 'fail');
  const loopRoom = hasLoops ? 40 : 16;
  const room = `${loopRoom}px` as const;
  const fitPadding: FitViewOptions['padding'] = direction === 'RIGHT' ? { top: '16px', left: '16px', right: '16px', bottom: room } : { top: '16px', left: '16px', bottom: '16px', right: room };
  const fit = (duration = 0) => void flow.fitView({ padding: fitPadding, maxZoom: 1, duration });
  useEffect(() => {
    if (positioned) requestAnimationFrame(() => fit());
    // 位置が決まったときだけ合わせる（選んだだけでは動かさない）
  }, [positioned]);

  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    const pick = changes.find((c) => c.type === 'select' && c.selected);
    if (pick && 'id' in pick) onSelect?.({ kind: 'step', id: pick.id });
  };
  const onEdgesChange = (changes: EdgeChange<FlowEdge>[]) => {
    const pick = changes.find((c) => c.type === 'select' && c.selected);
    if (pick && 'id' in pick) onSelect?.({ kind: 'edge', id: pick.id });
  };
  const valid: IsValidConnection = (c) => {
    if (!c.source || !c.target || c.target === START) return false;
    if (c.source === START) return true;
    if (c.source === c.target) return c.sourceHandle === 'loop-out';
    return true;
  };
  const connect = (c: Connection) => {
    if (!c.source || !c.target) return;
    onConnect?.(c.source, c.target, c.source === START ? 'start' : c.sourceHandle === 'loop-out' ? 'fail' : 'forward');
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!editable || !selected) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      onDelete?.();
    }
    if (e.key === 'Escape') onSelect?.(null);
  };

  const height = props.height ?? (positioned ? Math.min(Math.max(positioned.height + 16 + (direction === 'RIGHT' ? loopRoom : 16), 120), direction === 'DOWN' ? 960 : 520) : 160);
  return (
    <div ref={wrap} className={s.wrap} data-mode={mode} style={{ height }} onKeyDown={onKeyDown}>
      <Markers prefix={markers} />
      <ReactFlow<FlowNode, FlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={connect}
        isValidConnection={valid}
        onNodeClick={(_, n) => {
          if (mode === 'run' && n.id !== START) onSelect?.({ kind: 'step', id: n.id });
        }}
        onPaneClick={() => onSelect?.(null)}
        nodesDraggable={false}
        nodesConnectable={editable}
        elementsSelectable={mode !== 'view'}
        connectionRadius={44}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        panOnScroll={false}
        preventScrolling={false}
        panOnDrag={editable ? true : [1]}
        minZoom={0.35}
        maxZoom={1.6}
        proOptions={{ hideAttribution: false }}
        aria-label={label}
      />
      <div className={s.controls}>
        <button type="button" className={s.control} onClick={() => void flow.zoomIn({ duration: 150 })} aria-label="拡大"><IconZoomIn /></button>
        <button type="button" className={s.control} onClick={() => void flow.zoomOut({ duration: 150 })} aria-label="縮小"><IconZoomOut /></button>
        <button type="button" className={s.control} onClick={() => fit(200)} aria-label="全体を表示"><IconFit /></button>
      </div>
      <ul className="sr-only" aria-label={`${label}（文で読む）`}>
        {describe(props).map((d) => <li key={d.id}>{d.text}</li>)}
      </ul>
    </div>
  );
}

export default function WorkflowGraph(props: WorkflowGraphProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
