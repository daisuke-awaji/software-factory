# ADR（Architecture Decision Records）

設計上の大事な決定を1件1ファイルで残す。設計を変えるときは、新しい ADR を書いて古いものを `Superseded` にする（消さない）。

| # | タイトル | 状態 |
|---|---|---|
| [0001](./0001-stage-per-microvm.md) | 1ステップに1台の Lambda MicroVM を使う | Accepted |
| [0002](./0002-contract-first-zod-msw.md) | 契約は Zod に一本化し、フロントエンドは MSW で先に作る | Accepted |
| [0003](./0003-line-engine-durable-functions.md) | ワークフロー実行エンジンに Lambda durable functions を使う | Accepted |
| [0004](./0004-egress-boundary.md) | egress はルートのない subnet + 明示的なプロキシで統制し、クレデンシャルはゲートウェイで付ける | Accepted |
| [0005](./0005-three-origins.md) | App / Preview / Publish を3つの CloudFront ディストリビューションに分ける | Accepted |
| [0006](./0006-toolchain-versions.md) | TypeScript 6.0 と Node.js 24 に固定する | Accepted |
| [0007](./0007-workspace-layout.md) | 画面はホームの一覧とワークスペース（パターン B）の2層にする | Proposed |
| [0008](./0008-ui-components-and-styling.md) | UI の部品は AffectUI の無料の部品を取り込んで持ち、スタイルは CSS Modules とデザイントークンにする | Proposed |
| [0009](./0009-mock-backend-simulator.md) | MSW のモックに、ワークフローの実行を流すシミュレーターを持たせる | Proposed |
| [0010](./0010-session-sidebar.md) | タスクの一覧を、折りたためる左のサイドパネルに移す | Proposed |
| [0011](./0011-general-terms.md) | 画面とコードの言葉を、エージェントのチャットアプリで一般的な名前にそろえる | Proposed |

テンプレート: [template.md](./template.md)
