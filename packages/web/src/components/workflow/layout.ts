// 図の位置と矢印の道すじを ELK（layered・直角の線）で決める。
// 戻る矢印（on.fail.goto）は位置に影響させず、ノードの外側を回して描く（edges.tsx）
import type { ELK, ElkNode } from 'elkjs/lib/elk-api';
import type { Model } from './model';

export type Direction = 'RIGHT' | 'DOWN';
export type Point = { x: number; y: number };
export type EdgeRoute = { points: Point[]; label?: Point };
export type Positioned = { positions: Record<string, Point>; routes: Record<string, EdgeRoute>; width: number; height: number };

let elk: Promise<ELK> | null = null;
const loadElk = () => (elk ??= import('elkjs/lib/elk.bundled.js').then((m) => new m.default()));

/** ラベルの幅の見積もり（等幅 11px + 左右の余白） */
const labelWidth = (text: string) => Math.ceil(text.length * 6.8 + 18);

export async function layout(model: Model, direction: Direction): Promise<Positioned> {
  const engine = await loadElk();
  const right = direction === 'RIGHT';
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': right ? '48' : '40',
      'elk.spacing.nodeNode': right ? '20' : '16',
      'elk.spacing.edgeNode': '16',
      'elk.layered.spacing.edgeNodeBetweenLayers': '16',
      // YAML に書いた順で枝を並べる（編集しても図が大きく動かないように）
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
      'elk.edgeLabels.placement': 'CENTER',
      'elk.layered.edgeLabels.centerLabelPlacementStrategy': 'MEDIAN_LAYER',
      'elk.padding': '[top=8,left=8,bottom=8,right=8]',
    },
    // 矢印は、ノードの辺の真ん中（React Flow の点と同じ位置）から出入りさせる
    children: model.nodes.map((n) => ({
      id: n.id,
      width: n.width,
      height: n.height,
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
      ports: [
        { id: `${n.id}:in`, width: 0, height: 0, ...(right ? { x: 0, y: n.height / 2 } : { x: n.width / 2, y: 0 }) },
        { id: `${n.id}:out`, width: 0, height: 0, ...(right ? { x: n.width, y: n.height / 2 } : { x: n.width / 2, y: n.height }) },
      ],
    })),
    // 分岐のラベルは ELK に大きさを伝えて、段の間をその分だけ広げる（ラベルがノードに重ならないように）
    edges: model.edges
      .filter((e) => e.data.kind !== 'fail')
      .map((e) => ({
        id: e.id,
        sources: [`${e.source}:out`],
        targets: [`${e.target}:in`],
        ...(e.data.kind === 'case' && e.data.label
          ? { labels: [{ id: `${e.id}:label`, text: e.data.label, width: labelWidth(e.data.label), height: 18 }] }
          : {}),
      })),
  };
  const out = await engine.layout(graph);
  const positions: Positioned['positions'] = {};
  for (const c of out.children ?? []) positions[c.id] = { x: c.x ?? 0, y: c.y ?? 0 };
  const routes: Positioned['routes'] = {};
  for (const e of out.edges ?? []) {
    const s = e.sections?.[0];
    if (!s) continue;
    const l = e.labels?.[0];
    routes[e.id] = {
      points: [s.startPoint, ...(s.bendPoints ?? []), s.endPoint],
      ...(l ? { label: { x: (l.x ?? 0) + (l.width ?? 0) / 2, y: (l.y ?? 0) + (l.height ?? 0) / 2 } } : {}),
    };
  }
  return { positions, routes, width: out.width ?? 0, height: out.height ?? 0 };
}

/** 直角に曲がる線を、角を丸めた SVG の path にする */
export function roundedPath(points: Point[], radius = 8): string {
  if (points.length < 2) return '';
  const [first, ...rest] = points;
  let d = `M ${first!.x} ${first!.y}`;
  for (let i = 0; i < rest.length; i++) {
    const p = rest[i]!;
    const prev = i === 0 ? first! : rest[i - 1]!;
    const next = rest[i + 1];
    if (!next) {
      d += ` L ${p.x} ${p.y}`;
      break;
    }
    const inLen = Math.hypot(p.x - prev.x, p.y - prev.y);
    const outLen = Math.hypot(next.x - p.x, next.y - p.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const a = { x: p.x - ((p.x - prev.x) / (inLen || 1)) * r, y: p.y - ((p.y - prev.y) / (inLen || 1)) * r };
    const b = { x: p.x + ((next.x - p.x) / (outLen || 1)) * r, y: p.y + ((next.y - p.y) / (outLen || 1)) * r };
    d += ` L ${a.x} ${a.y} Q ${p.x} ${p.y} ${b.x} ${b.y}`;
  }
  return d;
}
