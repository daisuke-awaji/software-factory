// モック用: 2つの版のファイルから unified diff を作る（行単位の LCS。小さなファイルだけを扱う）
import type { DiffFile } from '@factory/contracts';

type Op = { k: ' ' | '-' | '+'; line: string; a: number; b: number };

function ops(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) out.push({ k: ' ', line: a[i++]!, a: i, b: ++j });
    else if (j < m && (i >= n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) out.push({ k: '+', line: b[j++]!, a: i, b: j });
    else out.push({ k: '-', line: a[i++]!, a: i, b: j });
  }
  return out;
}

const split = (s: string) => (s === '' ? [] : s.replace(/\n$/, '').split('\n'));

export function unifiedPatch(before: string, after: string, context = 3): { patch: string; additions: number; deletions: number } {
  const list = ops(split(before), split(after));
  const changed = list.map((o, idx) => (o.k !== ' ' ? idx : -1)).filter((x) => x >= 0);
  if (changed.length === 0) return { patch: '', additions: 0, deletions: 0 };
  // 変更のまわりを hunk にまとめる
  const hunks: [number, number][] = [];
  for (const c of changed) {
    const lo = Math.max(0, c - context);
    const hi = Math.min(list.length - 1, c + context);
    const last = hunks.at(-1);
    if (last && lo <= last[1] + 1) last[1] = hi;
    else hunks.push([lo, hi]);
  }
  const lines: string[] = [];
  for (const [lo, hi] of hunks) {
    const part = list.slice(lo, hi + 1);
    const aStart = part.find((o) => o.k !== '+')?.a ?? (list[lo]?.a ?? 0) + 1;
    const bStart = part.find((o) => o.k !== '-')?.b ?? (list[lo]?.b ?? 0) + 1;
    const aLen = part.filter((o) => o.k !== '+').length;
    const bLen = part.filter((o) => o.k !== '-').length;
    lines.push(`@@ -${aLen ? aStart : aStart - 1},${aLen} +${bLen ? bStart : bStart - 1},${bLen} @@`);
    for (const o of part) lines.push(`${o.k}${o.line}`);
  }
  return { patch: lines.join('\n'), additions: list.filter((o) => o.k === '+').length, deletions: list.filter((o) => o.k === '-').length };
}

export function diffFiles(base: Record<string, string>, head: Record<string, string>): DiffFile[] {
  const paths = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort();
  const out: DiffFile[] = [];
  for (const path of paths) {
    if (path.startsWith('attachments/')) continue; // 添付はリポジトリの変更に含めない
    const a = base[path];
    const b = head[path];
    if (a === b) continue;
    const { patch, additions, deletions } = unifiedPatch(a ?? '', b ?? '');
    out.push({ path, status: a === undefined ? 'added' : b === undefined ? 'deleted' : 'modified', additions, deletions, patch });
  }
  return out;
}
