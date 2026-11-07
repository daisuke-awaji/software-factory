// 図の位置を ELK（layered）で決める。戻る矢印（on.fail.goto）は位置に影響させず、ノードの下を回して描く
import type { ELK, ElkNode } from 'elkjs/lib/elk-api';
import type { Model } from './model';

export type Direction = 'RIGHT' | 'DOWN';
export type Positioned = { positions: Record<string, { x: number; y: number }>; width: number; height: number };

let elk: Promise<ELK> | null = null;
const loadElk = () => (elk ??= import('elkjs/lib/elk.bundled.js').then((m) => new m.default()));

/** ラベルの幅の見積もり（等幅 11px + 左右の余白） */
const labelWidth = (text: string) => Math.ceil(text.length * 6.8 + 18);

export async function layout(model: Model, direction: Direction): Promise<Positioned> {
  const engine = await loadElk();
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.layered.spacing.nodeNodeBetweenLayers': direction === 'RIGHT' ? '44' : '36',
      'elk.spacing.nodeNode': direction === 'RIGHT' ? '20' : '28',
      // YAML に書いた順で枝を並べる（編集しても図が大きく動かないように）
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
      'elk.padding': '[top=8,left=8,bottom=8,right=8]',
      'elk.edgeLabels.placement': 'CENTER',
      'elk.layered.edgeLabels.centerLabelPlacementStrategy': 'MEDIAN_LAYER',
    },
    children: model.nodes.map((n) => ({ id: n.id, width: n.width, height: n.height })),
    // 分岐のラベルは ELK に大きさを伝えて、段の間をその分だけ広げる（ラベルがノードに重ならないように）
    edges: model.edges.filter((e) => e.data.kind !== 'fail').map((e) => ({
      id: e.id, sources: [e.source], targets: [e.target],
      ...(e.data.kind === 'case' && e.data.label ? { labels: [{ id: `${e.id}:label`, text: e.data.label, width: labelWidth(e.data.label), height: 18 }] } : {}),
    })),
  };
  const out = await engine.layout(graph);
  const positions: Positioned['positions'] = {};
  for (const c of out.children ?? []) positions[c.id] = { x: c.x ?? 0, y: c.y ?? 0 };
  return { positions, width: out.width ?? 0, height: out.height ?? 0 };
}
