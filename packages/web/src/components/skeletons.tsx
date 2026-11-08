// 読み込み中に出す「形だけの枠」。中身が届いたときに位置がずれないよう、実際の画面と同じ大きさにそろえる
import type { ReactNode } from 'react';
import { Skeleton } from './ui/shimmer-loader';
import { Card, cx } from './kit';
import k from './kit.module.css';
import s from './skeletons.module.css';

export { Skeleton };

/** 読み込み中の入れ物。読み上げには「読み込んでいます」とだけ伝える（枠そのものは aria-hidden） */
export function Busy({
  label = '読み込んでいます',
  className,
  children,
}: {
  label?: string;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className={className} aria-busy="true">
      <span className="sr-only" role="status">
        {label}
      </span>
      {children}
    </div>
  );
}

/** 1行の文字の代わり。行の高さ（1lh）は本物の文字と同じにし、帯はその中で上下の中央に置く */
export function SkeletonText({
  size,
  width = '100%',
  end = false,
}: {
  /** 省略すると親の文字の大きさに合わせる */ size?: number;
  width?: number | string;
  end?: boolean;
}) {
  return (
    <span className={s.line} style={{ fontSize: size, justifyContent: end ? 'flex-end' : undefined }}>
      <Skeleton height="0.72em" width={width} />
    </span>
  );
}

/** 文の行。最後の行だけ短くする */
export function SkeletonLines({ lines = 3, size = 13, last = '60%' }: { lines?: number; size?: number; last?: string }) {
  return (
    <span className={s.lines}>
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonText key={i} size={size} width={i === lines - 1 && lines > 1 ? last : '100%'} />
      ))}
    </span>
  );
}

/** PageHeader と同じ高さの見出し */
export function PageHeaderSkeleton({ description = true }: { description?: boolean }) {
  return (
    <div className={k.pageHead}>
      <div className={s.pageHeadText}>
        <SkeletonText size={22} width={160} />
        {description && (
          <span className={s.desc}>
            <SkeletonText size={13.5} width="min(520px, 100%)" />
          </span>
        )}
      </div>
    </div>
  );
}

/** kit の Table と同じ枠。見出しは本物を出し、行だけを枠にする */
export function TableSkeleton({ head, rows = 5, label }: { head: ReactNode[]; rows?: number; label?: string }) {
  return (
    <Busy>
      <div className={k.tableWrap}>
        <table className={k.table} aria-label={label}>
          <thead>
            <tr>
              {head.map((h, i) => (
                <th key={i} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <SkeletonRow key={r} cols={head.length} seed={r} />
            ))}
          </tbody>
        </table>
      </div>
    </Busy>
  );
}

const WIDTHS = ['78%', '56%', '64%', '42%', '70%', '50%'];
const widthAt = (i: number) => WIDTHS[i % WIDTHS.length] ?? '60%';

/** 表の1行。最初の列は2行（タイトルと補足）にする */
export function SkeletonRow({ cols, seed = 0, className }: { cols: number; seed?: number; className?: string | undefined }) {
  return (
    <tr className={className} aria-hidden="true">
      {Array.from({ length: cols }, (_, c) => (
        <td key={c}>
          {c === 0 ? (
            <>
              <SkeletonText size={13.5} width={widthAt(seed)} />
              <SkeletonText size={12} width="38%" />
            </>
          ) : (
            <SkeletonText size={13.5} width={c === cols - 1 ? 40 : widthAt(seed + c)} />
          )}
        </td>
      ))}
    </tr>
  );
}

/** カード（見出し・説明・中身） */
export function CardSkeleton({ lines = 2, body }: { lines?: number; body?: ReactNode }) {
  return (
    <Card>
      <div className={s.cardBody}>
        <SkeletonText size={15} width="45%" />
        <SkeletonLines lines={lines} size={13} />
        {body}
      </div>
    </Card>
  );
}

/** カードを並べた格子（pages.module.css の .grid と同じ並べ方） */
export function CardGridSkeleton({ count = 4, lines = 2, body }: { count?: number; lines?: number; body?: ReactNode }) {
  return (
    <Busy className={s.grid}>
      {Array.from({ length: count }, (_, i) => (
        <CardSkeleton key={i} lines={lines} body={body} />
      ))}
    </Busy>
  );
}

/** カードを縦に積む */
export function CardStackSkeleton({ count = 3, lines = 1, body }: { count?: number; lines?: number; body?: ReactNode }) {
  return (
    <Busy className={s.stack}>
      {Array.from({ length: count }, (_, i) => (
        <CardSkeleton key={i} lines={lines} body={body} />
      ))}
    </Busy>
  );
}

/** 画面のコードを読み込んでいる間（Suspense）や、ログインの確認中に出す、ふつうのページの中身（Page の中に置く） */
export function PageSkeleton() {
  return (
    <Busy>
      <PageHeaderSkeleton />
      <div className={s.stack}>
        {Array.from({ length: 3 }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </Busy>
  );
}

/** 一覧の行（アイコン・タイトル・右の小さな文字） */
export function ListRowSkeleton({ className, seed = 0 }: { className?: string | undefined; seed?: number }) {
  return (
    <span className={cx(s.listRow, className)} aria-hidden="true">
      <Skeleton width={7} circle />
      <span className={s.listRowText}>
        <SkeletonText size={13} width={widthAt(seed)} />
      </span>
      <Skeleton width={26} height={8} />
    </span>
  );
}

/** kit の Meter と同じ高さ */
export function MeterSkeleton() {
  return (
    <div className={k.meter} aria-hidden="true">
      <SkeletonText size={13} width="60%" />
      <Skeleton height={8} radius={99} />
    </div>
  );
}

/** 等幅の文字の行（ファイルの中身・ログ） */
export function CodeSkeleton({ lines = 12, size = 12 }: { lines?: number; size?: number }) {
  return (
    <span className={s.code} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonText key={i} size={size} width={`${30 + ((i * 37) % 55)}%`} />
      ))}
    </span>
  );
}
