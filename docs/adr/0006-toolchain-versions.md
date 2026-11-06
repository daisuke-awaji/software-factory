# ADR-0006: TypeScript 6.0 と Node.js 24 に固定する

- 状態: Accepted
- 日付: 2026-11-06
- 関連: 実装計画 §2

## 背景
2026-11-06 の時点で、TypeScript の最新は 7.0.2 だが、typescript-eslint 8.72 の対応範囲は `typescript <6.1.0` である。Lambda の durable functions が対応しているランタイムは `nodejs22.x` と `nodejs24.x`。

## 決定
- TypeScript は **6.0.x** に固定する（ルートの `package.json` で `typescript: 6.0.3`）
- Node.js は **24**（Lambda は `nodejs24.x`、ローカルは `.nvmrc`、CI も 24）
- バージョンは pnpm の lockfile で固定し、Renovate などで上げるときは CI を通す

## 結果
- 良くなること: lint と型チェックが確実に動く
- 悪くなること: TypeScript 7 の新しい機能はまだ使えない。typescript-eslint が対応したら、この ADR を更新して上げる
