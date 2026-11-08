// ワークフローの図（React Flow + ELK。ADR-0012）。見るだけ（view）・実行の様子を重ねる（run）・編集（edit）の3つで使う。
// 位置は常に自動で決める（YAML に座標を書かない）。この部品は重いので、index.tsx から遅れて読み込む
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Connection,
  type EdgeChange,
  type IsValidConnection,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { stepLabel } from '../../lib/format';
import { IconFit, IconZoomIn, IconZoomOut } from '../icons';
import { FlowEdgeView, LoopEdgeView, loopText, Markers, textWidth, type FlowEdge } from './edges';
import { layout, type Direction, type Positioned } from './layout';
import { START, buildModel, type Model } from './model';
import { StartNode, StepNode, type FlowNode } from './StepNode';
import type { WorkflowGraphProps } from './types';
import s from './WorkflowGraph.module.css';

const nodeTypes = { step: StepNode, start: StartNode };
const edgeTypes = { flow: FlowEdgeView, loop: LoopEdgeView };
/** 図のまわりの余白と、横へスクロールさせてでも保つ倍率 */
const PAD = 16;
const MIN_READABLE = 0.85;
const statusText = {
  waiting: '未着手',
  running: '実行中',
  done: '完了',
  alert: '対応待ち',
  failed: '失敗',
  skipped: '通らなかった',
} as const;

/** 戻る矢印が、間にあるノードの下（縦に並べたときは右）を通るようにする */
function loopDip(model: Model, pos: Positioned['positions'], source: string, target: string, direction: Direction) {
  const a = model.nodes.find((n) => n.id === source)!;
  const b = model.nodes.find((n) => n.id === target)!;
  const pa = pos[source] ?? { x: 0, y: 0 };
  const pb = pos[target] ?? { x: 0, y: 0 };
  if (direction === 'RIGHT') {
    const lo = Math.min(pa.x, pb.x);
    const hi = Math.max(pa.x + a.width, pb.x + b.width);
    const bottoms = model.nodes
      .filter((n) => pos[n.id] && pos[n.id]!.x < hi && pos[n.id]!.x + n.width > lo)
      .map((n) => pos[n.id]!.y + n.height);
    return Math.max(...bottoms) + 22;
  }
  const lo = Math.min(pa.y, pb.y);
  const hi = Math.max(pa.y + a.height, pb.y + b.height);
  const rights = model.nodes
    .filter((n) => pos[n.id] && pos[n.id]!.y < hi && pos[n.id]!.y + n.height > lo)
    .map((n) => pos[n.id]!.x + n.width);
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
    return { id: st.id, text: `${stepLabel(st.id)}${status ? `（${statusText[status]}）` : ''}: ${parts.join('、')}` };
  });
}

function Canvas(props: WorkflowGraphProps) {
  const { workflow, mode, statuses, planStatus, selected = null, onSelect, onConnect, onDelete, label } = props;
  const editable = mode === 'edit';
  const wrap = useRef<HTMLDivElement>(null);
  const markers = `wf${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  // 向きは入れ物の幅で決める（狭いときは縦に並べる）。決まるまでは並べない
  const [measured, setMeasured] = useState<Direction | null>(null);
  const [outerWidth, setOuterWidth] = useState(0);
  const inner = useRef<HTMLDivElement>(null);
  const [positioned, setPositioned] = useState<(Positioned & { direction: Direction }) | null>(null);
  const flow = useReactFlow<FlowNode, FlowEdge>();
  const viewport = useStore((st) => `${st.width}x${st.height}`);
  const layoutModel = useMemo(
    () => buildModel(workflow, statuses, planStatus, measured === 'DOWN'),
    [workflow, statuses, planStatus, measured],
  );
  const shapeKey = useMemo(
    () =>
      JSON.stringify([
        measured,
        layoutModel.nodes.map((n) => n.id),
        layoutModel.edges.filter((e) => e.data.kind !== 'fail').map((e) => [e.id, e.data.label]),
      ]),
    [measured, layoutModel],
  );
  // 描くときは、並べたときの向きにそろえる（向きが変わって並べ直している間も崩れない）
  const direction: Direction = positioned?.direction ?? measured ?? 'RIGHT';
  const model = useMemo(
    () => (direction === measured ? layoutModel : buildModel(workflow, statuses, planStatus, direction === 'DOWN')),
    [direction, measured, layoutModel, workflow, statuses, planStatus],
  );

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const pick = (w: number) => {
      setMeasured(w > 0 && w < 560 ? 'DOWN' : 'RIGHT');
      setOuterWidth(w);
    };
    pick(el.clientWidth);
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width ?? 0;
      if (w > 0) pick(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!measured) return;
    let alive = true;
    const dir = measured;
    void layout(layoutModel, dir).then((p) => {
      if (alive) setPositioned({ ...p, direction: dir });
    });
    return () => {
      alive = false;
    };
    // 形（ノード・前へ進む矢印・ラベル）か向きが変わったときだけ並べ直す
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
        data: {
          ...e.data,
          markers,
          direction,
          ...(loop
            ? { dip: loopDip(model, positioned.positions, e.source, e.target, direction) }
            : positioned.routes[e.id]
              ? { route: positioned.routes[e.id]! }
              : {}),
        },
        selectable: editable && e.data.kind !== 'start',
        selected: selected?.kind === 'edge' && selected.id === e.id,
        focusable: editable && e.data.kind !== 'start',
      };
    });
  }, [model, positioned, markers, direction, editable, selected]);

  // 図の範囲（ノードと、外側を回る戻る矢印のラベルまで）。全体が入るように合わせ、高さもここから決める
  const bounds = useMemo(() => {
    if (!positioned) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const n of model.nodes) {
      const p = positioned.positions[n.id];
      if (!p) continue;
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + n.width);
      y1 = Math.max(y1, p.y + n.height);
    }
    for (const e of edges) {
      if (e.data?.kind !== 'fail' || e.data.dip === undefined) continue;
      const w = textWidth(loopText(e.data.maxLoops ?? 0, direction)) + 16;
      if (direction === 'RIGHT') y1 = Math.max(y1, e.data.dip + 12);
      else x1 = Math.max(x1, e.data.dip + w);
    }
    return Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
  }, [positioned, model, edges, direction]);
  const fit = (duration = 0) => {
    const width = inner.current?.clientWidth ?? 0;
    const height = inner.current?.clientHeight ?? 0;
    if (!bounds || !width || !height) return;
    const zoom = Math.max(0.35, Math.min(1, (width - PAD * 2) / bounds.width, (height - PAD * 2) / bounds.height));
    void flow.setViewport(
      { x: (width - bounds.width * zoom) / 2 - bounds.x * zoom, y: (height - bounds.height * zoom) / 2 - bounds.y * zoom, zoom },
      { duration },
    );
  };
  // 位置が決まったときと、入れ物の大きさが変わったときだけ合わせる（状態が変わっただけ・選んだだけでは動かさない）
  const boundsKey = bounds ? `${bounds.x},${bounds.y},${bounds.width},${bounds.height}` : '';
  useEffect(() => {
    if (bounds) requestAnimationFrame(() => fit());
  }, [boundsKey, viewport]);

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
    if (
      (e.key === 'Delete' || e.key === 'Backspace') &&
      !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
    ) {
      e.preventDefault();
      onDelete?.();
    }
    if (e.key === 'Escape') onSelect?.(null);
  };

  // 縦に並べても横に入りきらないときは、小さくしすぎずに横へスクロールさせる（スマホで文字が読める大きさを保つ）
  const scrollWidth =
    bounds && direction === 'DOWN' && !editable && bounds.width * MIN_READABLE + PAD * 2 > outerWidth
      ? Math.ceil(bounds.width * MIN_READABLE + PAD * 2)
      : undefined;
  const zoomFor = (w: number) => (bounds ? Math.min(1, (w - PAD * 2) / bounds.width) : 1);
  const height =
    props.height ??
    (bounds
      ? Math.min(Math.max(bounds.height * zoomFor(scrollWidth ?? outerWidth) + PAD * 2, 120), direction === 'DOWN' ? 960 : 520)
      : 160);
  return (
    <div ref={wrap} className={s.wrap} data-mode={mode} style={{ height }} onKeyDown={onKeyDown}>
      <Markers prefix={markers} />
      <div className={s.scroller}>
        <div ref={inner} className={s.inner} style={scrollWidth ? { width: scrollWidth } : undefined}>
          <ReactFlow<FlowNode, FlowEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={connect}
            isValidConnection={valid}
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
        </div>
      </div>
      <div className={s.controls}>
        <button type="button" className={s.control} onClick={() => void flow.zoomIn({ duration: 150 })} aria-label="拡大">
          <IconZoomIn />
        </button>
        <button type="button" className={s.control} onClick={() => void flow.zoomOut({ duration: 150 })} aria-label="縮小">
          <IconZoomOut />
        </button>
        <button type="button" className={s.control} onClick={() => fit(200)} aria-label="全体を表示">
          <IconFit />
        </button>
      </div>
      <ul className="sr-only" aria-label={`${label}（文で読む）`}>
        {describe(props).map((d) => (
          <li key={d.id}>{d.text}</li>
        ))}
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
