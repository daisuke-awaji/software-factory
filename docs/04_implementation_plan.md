# ソフトウェアファクトリー 実装計画書 v1.0

- 作成日: 2026-11-06
- 前提: [02_requirements.md](./02_requirements.md)（要件 v1.0） / [03_architecture.md](./03_architecture.md)（設計 v1.0） / [05_api_spec.md](./05_api_spec.md)（API 仕様）
- この文書の目的: **この文書だけ読めば実装を始められる状態にする**。技術の選択、構成、規約、進め方、各マイルストーンの完了条件を決める

---

## 1. 方針

| # | 方針 | 具体的には |
|---|---|---|
| I1 | **契約を先に決める** | API とイベントの型は `packages/contracts` の Zod スキーマだけで定義する。バックエンド（Hono）もフロントエンド（apiClient / MSW）もここから import する |
| I2 | **モックで先に動かす** | フロントエンドは MSW でバックエンドがなくても全画面を動かせるようにする。バックエンドと並行して作り、契約の食い違いはテストで見つける |
| I3 | **小さく縦に通す** | 各マイルストーンで「画面 → API → エンジン → VM」を細くても最後まで通す。横に広げるのはその後 |
| I4 | **境界で統制する** | セキュリティの要（allowlist、クレデンシャルの付与、ブランチ保護、公開の操作）は、エージェントのプロンプトではなくインフラとゲートウェイで実装する（設計の P1） |
| I5 | **PoC の結果で設計を直す** | PoC（M0）の結果で設計を変えるときは ADR を書く。黙って変えない |

---

## 2. 技術スタック（2026-11-06 時点の最新版を確認済み）

### 2.1 共通
| 分類 | 採用するもの | バージョン | 理由・注意点 |
|---|---|---|---|
| 言語 | TypeScript | **6.0.x（6.0.3）に固定** | 最新は 7.0.2 だが、typescript-eslint 8.72 の対応範囲が `<6.1.0`。lint を通すために 6.0 に揃える。typescript-eslint が 7 に対応したら上げる |
| ランタイム | Node.js | **24（LTS）** | Lambda の `nodejs24.x`（durable functions も対応）。Vite 8 と MSW 3 は 22.12 以上が必要 |
| パッケージ管理 | pnpm（workspaces） | 12.x | `corepack` で固定する |
| スキーマ | Zod | 4.x（4.6） | 契約の唯一の正（I1）。`z.iso.datetime()` など v4 の API を使う |
| テスト | Vitest | 5.x | フロントエンドもバックエンドも同じ |
| lint / 整形 | ESLint 10 + typescript-eslint 8 / Prettier 3 | | flat config。React hooks のプラグインも使う |
| ID | ULID | | 時系列で並べられ、DynamoDB のソートキーに向く |

### 2.2 フロントエンド（`packages/web`）
| 分類 | 採用するもの | バージョン | メモ |
|---|---|---|---|
| UI | React | 19.x | |
| ビルド | Vite + `@vitejs/plugin-react` | 8.x / 6.x | |
| 状態管理 | **Zustand** | 5.x | 画面の状態と、WebSocket のイベントを畳み込んだセッションの状態を持つ（§6.3） |
| モック | **MSW** | 3.x | 開発時はブラウザ（`setupWorker`）、テストでは Node（`setupServer`）で**同じハンドラー**を使う。WebSocket も `ws.link()` で模擬する |
| 入力検証 | Zod（contracts） | | フォームの検証にも同じスキーマを使う |
| ルーティング | React Router | 8.x | **提案**（要件にはない。データの読み込みは apiClient + Zustand で行い、router のデータ API は使わない） |
| スタイル | CSS Modules | | **提案**。追加の依存を増やさない。デザインシステムが決まったら見直す |
| テスト | Vitest + Testing Library + jsdom、Playwright（E2E） | | |

### 2.3 バックエンド
| 分類 | 採用するもの | バージョン | メモ |
|---|---|---|---|
| Web フレームワーク | **Hono** + `@hono/zod-openapi` | 4.13 / 1.6 | `hono/aws-lambda` の `handle()` で Lambda で動かす。`/openapi.json` を自動で生成する |
| ワークフロー | **Lambda durable functions**（`@aws/durable-execution-sdk-js`） | 3.x | ワークフロー実行エンジン（D18） |
| AWS SDK | AWS SDK for JavaScript v3 | 3.1163 | `@aws-sdk/client-lambda-microvms`、`client-lambda`（`SendDurableExecutionCallback*`）、`client-dynamodb` + `lib-dynamodb` など |
| ログ・計測 | Powertools for AWS Lambda（Logger / Metrics / Tracer） | 2.x | 構造化ログに `taskId` と `stepRunId` を必ず入れる |
| プロキシ類 | Node.js 24（`node:http` / `node:net`） | | egress プロキシ、Git ゲートウェイ、プレビュープロキシ。ECS Fargate で動かす |
| VM 内のデーモン | agentd（Node.js 24 + Hono + Claude Agent SDK） | | lifecycle hooks と制御用の API を Hono で書く |
| IaC | AWS CDK v2（TypeScript） | 2.275 | MicroVMs は L1（`CfnMicrovmImage` / `CfnNetworkConnector`）、durable functions は `lambda.Function` の `durableConfig` |

### 2.4 検証で分かった注意点（バージョンを上げるときにも確認する）
| # | 内容 | 対応 |
|---|---|---|
| N1 | MSW 3 では `server.listen({ onUnhandledRequest })` が **`onUnhandledFrame`** に変わった | v2 の記事やサンプルを写すときに注意する |
| N2 | MSW のハンドラーのパスを相対（`/api/...`）にすると、Node のテストで一致しない | ハンドラーは `*/api/...` と書く。apiClient はベース URL を引数で受け取る |
| N3 | CDK の型は `exactOptionalPropertyTypes` と互換性がない | `infra` だけこの設定を外す（他のパッケージでは有効にする） |
| N4 | CloudFormation の `CpuConfigurations.Architecture` は **`ARM_64`**（API の enum は `ARM64`） | CDK では `ARM_64` と書く |
| N5 | CDK 2.275 の `CfnMicrovmImageProps` は `tags` 以外が**すべて必須** | 空の値（`[]`、`{}`）も明示する |
| N6 | `RunMicrovm` では VM のサイズを指定できない（イメージの `resources.minimumMemoryInMiB` で決まる） | サイズ違いは別のイメージにする（設計 §5.4） |
| N7 | MicroVMs SDK に `CreateMicrovmImageVersion` はない。新しいバージョンは **`UpdateMicrovmImage`** で作る | |
| N8 | `IdlePolicy` は3項目（`maxIdleDurationSeconds` / `suspendedDurationSeconds` / `autoResumeEnabled`）がすべて必須 | |

これらは [samples/](./samples/) で型チェック・テスト・synth まで確認している（typecheck 成功、テスト 12/12、synth の警告 0 件）。

---

## 3. リポジトリの構成（pnpm モノレポ）

```
software-factory/
├─ package.json / pnpm-workspace.yaml / tsconfig.base.json / eslint.config.js / .prettierrc / .nvmrc(24)
├─ packages/
│  ├─ contracts/        # Zod スキーマ（API・イベント・ワークフロー・イメージの定義）。依存はほかのパッケージに持たない
│  ├─ web/              # React SPA（Vite / Zustand / MSW）
│  ├─ api/              # Hono アプリ（HTTP API）＋ WebSocket の接続ハンドラー
│  ├─ callback-api/     # Hono アプリ（Agent Callback API。プライベート）
│  ├─ engine/           # ワークフロー実行エンジン（durable functions）
│  ├─ vm-manager/       # 受付制御・RunMicrovm・トークン発行・keepalive・チェックポイント
│  ├─ image-builder/    # イメージ定義 → Dockerfile の合成 → CreateMicrovmImage / UpdateMicrovmImage（durable functions）
│  ├─ agentd/           # VM 内のデーモン（lifecycle hooks、ハーネスの制御、チェックポイント）
│  ├─ egress-proxy/     # forward proxy（CONNECT、allowlist）
│  ├─ git-gateway/      # Git smart HTTP のリバースプロキシ（トークンの付与、ref の検査）
│  ├─ preview-proxy/    # プレビューのチケット → cookie → MicroVM のエンドポイント
│  ├─ edge-auth/        # Lambda@Edge（公開物の認可）
│  └─ shared/           # ロガー、ID の生成、DynamoDB のヘルパー、エラー型（AWS SDK に依存するものはここ）
├─ infra/               # CDK アプリ（スタックは設計 §12 のとおり）
├─ images/
│  ├─ factory-base/     # L1: Dockerfile、agentd の配置、hooks の設定
│  └─ defaults/         # base.yaml / web.yaml / data.yaml（イメージ定義）
├─ workflows/               # chat.yaml / build-verify.yaml（ワークフロー定義）
├─ skills/              # ステップごとのエージェントへの指示（implement.md / verify.md / review.md）
└─ docs/                # 計画書・ADR・図・サンプル
```

### 3.1 パッケージ間の依存のルール
- `contracts` はどこからでも import してよい。`contracts` 自身は `zod` 以外に依存しない
- `web` は `contracts` だけに依存する（AWS SDK やバックエンドのパッケージを import しない）
- バックエンドのパッケージ同士は、直接 import せずに `contracts` の型と API で連携する。共通の処理は `shared` に置く
- ルールは ESLint の `no-restricted-imports` で機械的に守らせる

### 3.2 TypeScript の設定
- `tsconfig.base.json`: `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitReturns`、`noFallthroughCasesInSwitch`、`verbatimModuleSyntax`、`module: NodeNext`
- `infra/tsconfig.json` だけ `exactOptionalPropertyTypes: false`（N3）
- `web` は `module: ESNext` / `moduleResolution: Bundler`、`jsx: react-jsx`

---

## 4. 開発環境とローカル実行

| やりたいこと | コマンド（M1 で用意する） | 中身 |
|---|---|---|
| 依存の導入 | `pnpm install` | |
| 画面だけ動かす | `pnpm --filter web dev` | Vite + **MSW**（`VITE_API_MOCK=true`）。バックエンドなしで全画面を操作できる |
| API をローカルで動かす | `pnpm --filter api dev` | `@hono/node-server` で起動する。DynamoDB Local（Docker）につなぐ |
| 画面と API をつないで動かす | `pnpm dev` | Vite の proxy で `/api` をローカルの API に転送する（MSW は無効） |
| 型チェック・lint・テスト | `pnpm typecheck` / `pnpm lint` / `pnpm test` | すべてのパッケージで実行する |
| 整形・不要コード | `pnpm format`（`format:check`） / `pnpm knip` | Prettier で整形する。knip で使われていないファイル・export・依存を見つける |
| lint の抑止を減らす | `pnpm lint:prune` | 既存の違反は `eslint-suppressions.json` に一括で記録している。直したら記録を減らす（減らさないと lint が落ちる） |
| エンジンのテスト | `pnpm --filter engine test` | durable の処理はフェイクのポート（`ports.ts`）でテストする。実行環境での確認は dev 環境で行う |
| agentd をローカルで動かす | `pnpm --filter agentd dev` | lifecycle hooks をローカルの HTTP で叩けるようにする（ハーネスはフェイクに差し替えられる） |
| デプロイ | `pnpm cdk deploy --all -c env=dev` | 環境ごとに `cdk.context` で設定を切り替える |

- 環境は **dev / stg / prod の3つ**（同じアカウントを分けるか、アカウントを分けるかは M2 の前に決める。最初は新規アカウント1つに dev だけを置く）
- シークレット（GitHub App の private key など）は Secrets Manager に置き、リポジトリや `.env` に入れない。`.env.example` だけをコミットする

---

## 5. コーディング規約

### 5.1 共通
- 外から入ってくるデータ（HTTP の入力、イベント、DynamoDB から読んだ値、VM からの callback）は**必ず Zod で parse してから**使う
- エラーは `ApiError`（`code` / `message` / `requestId`）に揃える。`code` は大文字のスネークケース（例: `VALIDATION_ERROR`）
- ログは構造化 JSON で出し、`taskId`、`stepRunId`、`vmId`、`requestId` を入れる。プロンプトの本文や秘密情報はログに出さない
- 時刻は UTC の ISO 8601、ID は ULID
- Durable functions の中では、乱数・現在時刻・I/O を必ず `ctx.step` の中で扱う（replay で先頭から再実行されるため。設計 §3.3）
- 外部への副作用には冪等キーを付ける（`RunMicrovm` の `clientToken` など）

### 5.2 フロントエンド
- サーバーの状態は apiClient（Zod で検証する）で取得する。**Zustand には、画面の状態とリアルタイムのセッションの状態だけ**を置く
- WebSocket のイベントは `useSessionStore.applyEvent()` の1か所で畳み込む（判別共用体の `switch` を網羅する）
- MSW のハンドラーとフィクスチャも contracts で検証する（契約が変われば型エラーかテストの失敗で気づける）

### 5.3 バックエンド
- Hono のルートは `@hono/zod-openapi` の `createRoute` で定義する。入力の検証とエラーの形式は `defaultHook` で揃える
- ルートのハンドラーは薄くし、処理はサービス（インターフェース + 実装）に分ける。テストではメモリ実装に差し替える
- DynamoDB のアクセスは `shared/ddb` のリポジトリにまとめ、キーの組み立て（`TASK#…` など）をあちこちに書かない

### 5.4 Git の運用
- `main` は保護する（レビュー1人以上、CI の成功が必須）。作業は `feat/*`、`fix/*`、`docs/*` のブランチで行う
- コミットは Conventional Commits（`feat(engine): ...`）で書く
- 設計を変える PR には ADR を含める

---

## 6. 主要な実装の指針

### 6.1 契約（contracts）
- 置くもの: `Task`、`CreateTaskRequest`、`Plan`、`StepDef`、`Workflow`、`StepResult`、`FactoryEvent`（判別共用体）、`ImageSpec`、`NetworkProfile`、`PackageSource`、`Publication`、`ApiError`
- YAML で書くワークフロー定義とイメージ定義も、読み込んだら同じ Zod スキーマで検証する（既定値もスキーマで埋める）
- 実際のコードは [samples/src/contracts/index.ts](./samples/src/contracts/index.ts) から始める

### 6.2 API（Hono）
- 雛形: [samples/src/api/app.ts](./samples/src/api/app.ts)（`OpenAPIHono`、`createRoute`、`handle`、認可のミドルウェア、`onError`）
- 認可: API Gateway の JWT authorizer（Cognito）が検証した claims を `requestContext.authorizer.jwt.claims` から取り出す。Lambda の中で JWT をもう一度検証しない
- WebSocket API は Hono を使わず、`$connect` / `$disconnect` / `$default` の小さな Lambda で書く。配信は DynamoDB Streams → Lambda → `PostToConnection`

### 6.3 Web（React / Zustand / MSW）
- 画面: タスクの一覧、チャット（ストリーミング、ツールの実行状況、計画の承認カード、ブロックされた通信の表示）、ファイルと差分、プレビュー（iframe と別タブ）、公開、イメージ、ワークフロー（閲覧）、管理（allowlist、パッケージソース、クォータ）
- 雛形: [samples/src/web/](./samples/src/web/)（apiClient、sessionStore、MSW のハンドラー、結合テスト）
- MSW の起動: `main.tsx` で `import.meta.env.VITE_API_MOCK === 'true'` のときだけ `setupWorker(...handlers).start()` を呼ぶ。`mockServiceWorker.js` は `npx msw init public/` で置く（`msw/vite` のプラグインを使う場合は `mode: 'worker-only'`）

### 6.4 エンジンと VM マネージャー
- 雛形: [samples/src/engine/](./samples/src/engine/)（handler、遷移の純粋関数とそのテスト、ポート、`RunMicrovm`）
- ポート（Repo / VmManager / Approvals）をインターフェースにして、エンジンの単体テストではフェイクを使う
- 受付制御: DynamoDB の条件付き更新でセマフォを作る（メモリの予算、エージェントの同時実行数、ユーザーごとの上限）。空きがなければ step を失敗させ、リトライ（指数バックオフ）で待つ

### 6.5 agentd
- Hono で lifecycle hooks（`/aws/lambda-microvms/runtime/v1/*`）と制御用の API（`/v1/*`）を実装する。ポートは 8080
- `/run` は**すぐに 200 を返し**、初期化は非同期で進める（hook のタイムアウトを避けるため）
- ハーネスは `Harness` インターフェース（設計 §4.3）で抽象化する。最初の実装は Claude Agent SDK を使う
- Callback API への送信は、バッファリングと再送（at-least-once。イベントには ID を付け、受け取る側で重複を除く）

---

## 7. テスト戦略

| レベル | 対象 | 道具 | CI で実行するか |
|---|---|---|---|
| 単体 | contracts、遷移の判定、合成ルール（Dockerfile）、allowlist の判定、ref の検査 | Vitest | ✅ すべての PR |
| ルート | Hono のルート（`app.request()`） | Vitest | ✅ |
| フロントエンドの結合 | apiClient × MSW × Zustand、コンポーネント | Vitest + Testing Library + MSW（Node） | ✅ |
| E2E（モック） | 主要な画面の流れ（作成 → 計画 → 承認 → ストリーミング） | Playwright + MSW（ブラウザ） | ✅ |
| インフラ | CDK のスナップショットと assertions（SG の egress、subnet のルート、IAM の最小権限） | Vitest + `aws-cdk-lib/assertions` | ✅ |
| 結合（dev 環境） | 実際の MicroVM と Bedrock を使う流れ | スクリプト（手動または nightly） | ⏸ main にマージした後 |
| セキュリティ | allowlist の外に出られないこと、保護ブランチに push できないこと、公開物から App の API を呼べないこと | 専用のテストスイート（dev 環境） | ⏸ リリース前 |

---

## 8. CI/CD（GitHub Actions）

| ワークフロー | きっかけ | 内容 |
|---|---|---|
| `ci.yml` | PR / main への push | `pnpm install --frozen-lockfile` → `typecheck` → `lint` → `format:check` → `knip` → `test` → `build` → CDK の `synth` と assertions |
| `e2e.yml` | PR（web に変更があるとき） | Playwright（MSW のモック） |
| `deploy-dev.yml` | main への push | OIDC で AWS に AssumeRole して `cdk deploy`（dev） |
| `images.yml` | `images/**` の変更 | イメージ定義を検証してから、dev でビルドする |

- AWS への認証は GitHub OIDC と IAM ロールで行う（長期のアクセスキーは使わない）
- stg / prod へのデプロイは手動の承認付き（GitHub Environments）

---

## 9. マイルストーン

各マイルストーンの完了条件（DoD）を満たしたら、次に進む。

### M0: PoC とアカウントの準備
| タスク | 内容 | 完了条件 |
|---|---|---|
| M0-1 | クォータの申請（設計 §10.2）。Bedrock のモデルアクセスを有効にする | 申請済み。受付状況を記録した |
| M0-2 | **V1**: ルートのない subnet + LNC + egress プロキシの最小構成 | 許可したドメインにだけつながり、拒否はログに残る |
| M0-3 | **V9 / V5 / V6**: idle と suspend、auto-resume、クォータの数え方 | 挙動を記録し、設計 §3.7 を確定した |
| M0-4 | **V11**: durable functions の callback と heartbeat、VM の引き継ぎ | 中断なく再開でき、heartbeat が途切れたら失敗として検知できる |
| M0-5 | **V2 / V13**: プレビュー（チケット → cookie、CHIPS、WebSocket）と、3つのオリジンの分離 | Chrome / Edge / Safari で動く |
| M0-6 | **V4**: エージェント1台あたりの TPM の計測 | 3種類のタスクの計測値をもとに、クォータの申請値を決めた |
| M0-7 | **V12 / V15**: カスタムイメージのビルド（ビルドの通信、合成、/validate） | 15分以内にビルドでき、そのイメージで VM を起動できる |

**DoD**: V1・V2・V4・V9・V11・V12 の結果が出て、設計を変える点を ADR に書いた。

### M1: 基盤と chat ワークフローの最小版（縦に1本通す）
- モノレポの雛形（§3）、CI（§8 の `ci.yml`）、`contracts`
- CDK: Network / Data / Auth / ControlPlane（最小）/ Frontend（App のみ）
- `factory-base` と `base` イメージ、agentd の最小版（`/run`、`/v1/messages`、イベントの送信）
- API: タスクの作成・取得、メッセージの送信。WebSocket の配信
- エンジン: chat ワークフロー（workbench の1ステップ）
- Web: 一覧とチャット（ストリーミング）。MSW のモードでも全画面が動く

**DoD**: dev 環境で「Web から指示 → VM でエージェントが動く → 応答がストリーミングで表示される」が通る。CI が緑。

### M2: 計画の承認・リポジトリ連携・プレビュー
- 計画の承認と再承認（`plan.proposed` / `approval.required`）
- egress プロキシと allowlist（L0〜L2）、パッケージソース（`public`）
- GitHub App（ユーザーごとの連携）、Git ゲートウェイ（トークンの付与、ref の検査）、PR の作成（deliver ステップ）
- ライブプレビュー（Preview のディストリビューション、プレビュープロキシ）
- suspend / resume、keepalive、8時間の引き継ぎ（チェックポイント）

**DoD**: UC3（LoB が既存リポジトリを変更して PR を作る）と UC2（ライブプレビュー）が dev 環境で通る。保護ブランチへの push が拒否されることをテストで確かめた。

### M3: カスタムイメージと多段のワークフロー
- イメージビルダー（定義の検証、合成、ビルド、/validate、カタログ）、`web` / `data` イメージ
- build-verify ワークフロー（実装 → 別の VM で検証 → レビュー → PR）、ステップ間の受け渡し
- ワークフローの管理（管理者による YAML の登録）

**DoD**: ユーザーが作ったカスタムイメージを verify ステップで使う build-verify ワークフローが、最後まで通る。

### M4: 社内公開・管理・パイロット
- 社内公開（公開前のチェック、S3 + Publish のディストリビューション + Lambda@Edge、ACL、公開停止、有効期限）
- 管理画面（allowlist、パッケージソース、クォータ、実行中の VM の一覧と強制停止）
- 監査ログ（Object Lock）、コストの表示と上限、メール通知
- セキュリティテスト（§7）、運用手順書

**DoD**: UC1（集計して公開まで）を LoB ユーザーが研修なしで完了できる。セキュリティテストが通る。**10人でのパイロットを始める**。

---

## 10. 最初の1週間でやること（M0 と M1 を並行して始める）
1. このリポジトリに `main` の保護、Issue のテンプレート、ラベル（`M0`〜`M4`、`area/*`、`priority/*`）を設定する
2. [backlog.md](./backlog.md) を GitHub Issues に起票する（優先度の高いものから着手する）
3. AWS の新規アカウントで、クォータの申請と Bedrock のモデルアクセスを有効にする（M0-1。時間がかかるので最初にやる）
4. モノレポの雛形を作り、`docs/samples` のコードを `packages/contracts` / `api` / `web` / `engine` に移す（M1）
5. PoC の V1（egress）と V11（durable functions）から始める

---

## 11. リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| Bedrock の TPM が足りない | 同時に使える人数が増やせない | M0 で計測し、早めにクォータを申請する。同時実行の上限と順番待ち（設計 §10.1） |
| MicroVMs の新しい機能の仕様が、ドキュメントと違う | 設計の手戻り | PoC（M0）で先に確かめる。SDK の型で引数を確認する（N6〜N8） |
| idle で作業中に suspend される | 作業が止まる | keepalive（設計 §3.7）。V9 で確認する |
| egress の判定を自作するので穴がありうる | 情報の持ち出し | ルートのない subnet で「プロキシを通らない通信は届かない」状態にしておく（自作の部分が壊れても、閉じる側に倒れる） |
| typescript-eslint が TypeScript 7 に対応するまでに時間がかかる | 最新の TypeScript を使えない | 6.0 に固定する（§2.1）。対応したら上げる |
