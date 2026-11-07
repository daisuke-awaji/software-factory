// 図の矢印: 前へ進む（実線。分岐はラベル付き）と、失敗したときに戻る（破線。ノードの下を回る）
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import { roundedPath, type EdgeRoute } from './layout';
import type { GraphEdgeData } from './model';
import s from './WorkflowGraph.module.css';

export type FlowEdgeData = GraphEdgeData & { markers: string; dip?: number; direction: 'RIGHT' | 'DOWN'; route?: EdgeRoute };
export type FlowEdge = Edge<FlowEdgeData, 'flow' | 'loop'>;

const tone = (d: FlowEdgeData, selected?: boolean) => (selected ? 'selected' : d.kind === 'fail' ? (d.state === 'taken' ? 'loop-taken' : 'loop') : d.state === 'taken' ? 'taken' : d.state === 'skipped' ? 'skipped' : 'idle');

function Label({ x, y, children, kind, selected, start }: { x: number; y: number; children: string; kind: string; selected?: boolean | undefined; start?: boolean }) {
  // start: 左端をその位置に合わせる（縦に並べたときの戻る矢印。ラベルがノードに重ならないように、曲線の外側に置く）
  return (
    <EdgeLabelRenderer>
      <span className={s.edgeLabel} data-kind={kind} data-selected={selected || undefined} style={{ transform: `translate(${start ? '-6px' : '-50%'}, -50%) translate(${x}px, ${y}px)` }}>
        {children}
      </span>
    </EdgeLabelRenderer>
  );
}

export function FlowEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<FlowEdge>) {
  // ELK が引いた道すじ（ほかのノードを避ける）を使う。まだなければ、ベジェ曲線で仮に引く
  const route = data!.route;
  const [bezier, bx, by] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.35 });
  const path = route ? roundedPath(route.points) : bezier;
  const lx = route?.label?.x ?? bx;
  const ly = route?.label?.y ?? by;
  const t = tone(data!, selected);
  return (
    <>
      <BaseEdge id={id} path={path} className={s.edge} data-tone={t} markerEnd={`url(#${data!.markers}-${t})`} interactionWidth={18} />
      {data!.kind === 'case' && data!.label && <Label x={lx} y={ly} kind="case" selected={selected}>{data!.label}</Label>}
    </>
  );
}

export function LoopEdgeView({ id, sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps<FlowEdge>) {
  const d = data!;
  const t = tone(d, selected);
  let path: string;
  let lx: number;
  let ly: number;
  // dip は曲線のいちばん外側（ラベルを置く位置）。3次ベジェの中点は「端の 1/4 + 制御点の 3/4」なので、制御点はその分だけ外に置く
  if (d.direction === 'RIGHT') {
    ly = Math.max(d.dip ?? 0, sourceY + 24, targetY + 24);
    const c = (ly - 0.125 * (sourceY + targetY)) / 0.75;
    path = `M ${sourceX} ${sourceY} C ${sourceX} ${c}, ${targetX} ${c}, ${targetX} ${targetY}`;
    lx = (sourceX + targetX) / 2;
  } else {
    lx = Math.max(d.dip ?? 0, sourceX + 24, targetX + 24);
    const c = (lx - 0.125 * (sourceX + targetX)) / 0.75;
    path = `M ${sourceX} ${sourceY} C ${c} ${sourceY}, ${c} ${targetY}, ${targetX} ${targetY}`;
    ly = (sourceY + targetY) / 2;
  }
  return (
    <>
      <BaseEdge id={id} path={path} className={s.edge} data-tone={t} markerEnd={`url(#${d.markers}-${t})`} interactionWidth={18} />
      <Label x={lx} y={ly} kind="loop" selected={selected} start={d.direction === 'DOWN'}>{loopText(d.maxLoops ?? 0, d.direction)}</Label>
    </>
  );
}

/** 戻る矢印のラベル（縦に並べたときは右に出るので短くする） */
export const loopText = (n: number, direction: 'RIGHT' | 'DOWN') => (direction === 'RIGHT' ? `失敗したら戻る（${n} 回まで）` : `失敗 · ${n} 回まで`);

/** 文字の幅の見積もり（11px。全角は 1 文字 11px、半角は 6.5px） */
export const textWidth = (t: string) => [...t].reduce((w, c) => w + (/[\u3000-\uffff]/.test(c) ? 11 : 6.5), 0);

const TONES = ['idle', 'taken', 'skipped', 'loop', 'loop-taken', 'selected'] as const;

/** 矢印の先（トーンごと。色は CSS の変数から currentColor で受け取る） */
export function Markers({ prefix }: { prefix: string }) {
  return (
    <svg className={s.markers} aria-hidden="true">
      <defs>
        {TONES.map((t) => (
          <marker key={t} id={`${prefix}-${t}`} className={s.marker} data-tone={t} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M1 1.5L8.5 5L1 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        ))}
      </defs>
    </svg>
  );
}
