# ソフトウェアファクトリー アーキテクチャ詳細設計書 v1.0

- 作成日: 2026-11-06
- 対象: 要件定義書 [02_requirements.md](./02_requirements.md)（D1〜D19）
- ステータス: **確定（実装を始める基準とする）**。PoC の結果で変える場合は ADR（[adr/](./adr/)）を書く
- 実装計画: [04_implementation_plan.md](./04_implementation_plan.md) / API 仕様: [05_api_spec.md](./05_api_spec.md)

---

## 0. 設計原則

| # | 原則 | 意味 |
|---|---|---|
| P1 | **統制はエージェントが回避できない境界で行う** | ネットワークは subnet、SG、プロキシで、権限は IAM で、Git はゲートウェイとブランチ保護で、公開はユーザーの操作で縛る。プロンプトへの指示には頼らない |
| P2 | **VM は使い捨てにし、状態は外に置く** | 会話、計画、成果物、コードは VM の外（DynamoDB / S3 / Git）に置く。VM が消えたり8時間の上限に達したりしても、別の VM で再開できる |
| P3 | **1ステージに1台の VM** | ステージごとにイメージ、ネットワーク、権限を変えられる。ステージをまたいで状態は共有しない（受け渡しは明示的に行う） |
| P4 | **VM には価値の高い秘密情報を置かない** | VM の中にあるのは、Bedrock を呼ぶための短期クレデンシャル（execution role）と、外では使えない VM 識別トークンだけにする |
| P5 | **常時稼働のサーバーを最小限にする** | 常時稼働するのは、egress プロキシとプレビュープロキシ（Fargate）だけにする。ほかは Lambda、DynamoDB、S3 などのサーバーレスで組む |
| P6 | **イメージとラインはコードで定義する** | どちらも宣言的な定義からビルド・登録する。バージョンは変更不可にし、ステージからは固定して参照する |

---

## 1. 全体構成

![AWS 構成図](./diagrams/architecture.png)

編集用のファイル: [diagrams/architecture.drawio](./diagrams/architecture.drawio)（draw.io で開く）。図中の番号（①〜⑩）は §1.1 の経路に対応する。

### 1.1 主要な通信経路
| # | 経路 | 方式 | ポイント |
|---|---|---|---|
| ① | ユーザー → アプリ | CloudFront(App) → API Gateway（HTTP / WebSocket） | Cognito の JWT で認可する |
| ② | コントロールプレーン → VM | MicroVM の HTTPS エンドポイント + `X-aws-proxy-auth`（JWE トークン。VM とポートを限定し、有効期限付き） | トークンは VM マネージャーが発行し、キャッシュする（50 TPS の制限があるため） |
| ③ | VM → コントロールプレーン | VM → LNC → `execute-api` VPC エンドポイント → **Agent Callback API（プライベート）** | MicroVM のエンドポイントは inbound 専用なので、VM からイベントを push する |
| ④ | VM → Bedrock | VM → LNC → `bedrock-runtime` VPC エンドポイント | execution role の短期クレデンシャルを使う。JP の推論プロファイルを呼ぶ |
| ⑤ | VM → パッケージレジストリ | VM → LNC → egress プロキシ（HTTP CONNECT。SNI と Host で allowlist を判定）→ NAT | TLS は終端しない |
| ⑥ | VM → GitHub | VM → LNC → **Git ゲートウェイ**（リバースプロキシ）→ GitHub | `git config url.insteadOf` でゲートウェイに向ける。ユーザーのトークンはゲートウェイが付け加える |
| ⑦ | ユーザー → プレビュー | CloudFront(Preview) → 内部 ALB → プレビュープロキシ → MicroVM のエンドポイント | ブラウザは `X-aws-proxy-auth` を付けられないので、プロキシが付け加える |
| ⑧ | 閲覧者 → 公開物 | CloudFront(Publish) + Lambda@Edge（Cognito の JWT と ACL で判定）→ S3（OAC） | 公開物ごとにパスを分ける。CSP の sandbox でオリジンを分離する |
| ⑨ | イメージのビルド | イメージビルダー → `CreateMicrovmImage` / `UpdateMicrovmImage` → ビルド用 VM → LNC:build → egress プロキシ（:3129） | ビルド中の通信も allowlist で判定する |
| ⑩ | SSO | 企業 IdP ⇄ Cognito（SAML / OIDC） | IdP のグループを `cognito:groups` に取り込む |

---

## 2. コンポーネント一覧

| # | コンポーネント | 主な AWS サービス | 責務 |
|---|---|---|---|
| C1 | Web アプリ（SPA） | S3 + CloudFront(App)。**React + Vite + Zustand + Zod**（開発とテストでは MSW でモック） | チャット、計画の承認、ステージの進捗、ファイル、差分、プレビューの埋め込み、公開、イメージやラインの管理画面 |
| C2 | 認証 | Cognito User Pool（企業 IdP と SAML / OIDC で連携）。IdP のグループを `cognito:groups` に取り込む | SSO、User / Admin のロール、公開範囲で使うグループ |
| C3 | API | API Gateway HTTP API（REST。**Hono on Lambda**）+ WebSocket API（UI にイベントを push する） | 認可、入力の検証、ドメインサービスの呼び出し |
| C4 | ドメインサービス | Lambda（TypeScript / **Hono**）。1つの Hono アプリを機能ごとのルートに分ける（モジュラーモノリス） | Session / WorkItem、Plan / Approval、Repo（GitHub App）、Publish、Image カタログ、Admin |
| C5 | **ライン実行エンジン** | **Lambda durable functions**（ワークアイテムごとに1つの durable execution。D18） | ライン定義を解釈し、ステージを順に実行する。VM を起動し、完了や承認を `waitForCallback` で待つ。遷移とリトライを扱う |
| C6 | **VM マネージャー** | Lambda + DynamoDB（セマフォ、トークンバケット） | 受付制御（メモリの予算、エージェントの同時実行数）、API のレート制御、Run / Suspend / Resume / Terminate、認証トークンの発行とキャッシュ、keepalive |
| C7 | Agent Callback API | API Gateway（プライベート REST API。execute-api VPC エンドポイント経由でのみ到達できる）+ Lambda（Hono） | VM からのイベント（進捗、計画、メッセージ、使用量、ステージの完了、チェックポイント）を受け取る。VM トークンで認証する |
| C8 | **イメージビルダー** | durable function + S3 + `CreateMicrovmImage` | イメージ定義の検証 → Dockerfile の合成 → ビルド → 検証 → カタログへの登録 |
| C9 | **egress プロキシ** | ECS Fargate（2台以上、マルチ AZ）、NLB | CONNECT と HTTP のプロキシ。VM トークンからネットワークプロファイルを引いて allowlist を判定する。拒否した通信をログに残す |
| C10 | **Git ゲートウェイ** | ECS Fargate | Git の smart HTTP をリバースプロキシする。ユーザーの GitHub トークンを付け加え、保護ブランチや既定ブランチの ref 更新を拒否する |
| C11 | プレビュープロキシ | ECS Fargate + 内部 ALB（CloudFront の VPC origin） | プレビューのセッションを認証し、宛先の VM を決め、`X-aws-proxy-auth` と `X-aws-proxy-port` を付け加える。WebSocket（HMR）にも対応する |
| C12 | 公開サービス | Lambda + S3(Publish) + CloudFront(Publish) + Lambda@Edge | 公開前のチェック、コピー、ACL の登録、公開停止、有効期限 |
| C13 | **factory-agentd**（VM 内） | Node.js / TypeScript のデーモン。全イメージのベース層に入れる | lifecycle hooks、コントロールプレーンとの通信、ハーネス（Claude Code）の起動と制御、チェックポイントと復元、プロキシとパッケージソースの設定 |
| C14 | 可観測性と監査 | CloudWatch Logs / Metrics、X-Ray、CloudTrail、Firehose → S3（Object Lock） | セッション単位のトレース、監査ログ、クォータの監視 |

---

## 3. ファクトリーラインとステージ VM（D15）

### 3.1 概念モデル
```mermaid
erDiagram
  LINE ||--|{ STAGE_DEF : "stages"
  STAGE_DEF }o--|| IMAGE_VERSION : "image@version"
  STAGE_DEF }o--|| NETWORK_PROFILE : "network"
  STAGE_DEF }o--|| ROLE_PROFILE : "iam"
  WORK_ITEM }o--|| LINE : "line@version"
  WORK_ITEM ||--|{ STAGE_RUN : "runs"
  STAGE_RUN ||--o{ VM_INSTANCE : "vm（8時間を超えると複数）"
  STAGE_RUN ||--o{ ARTIFACT : "outputs"
  WORK_ITEM ||--o{ APPROVAL : "gates"
```
- **Line**: ステージを順につないだ定義。バージョンは変更不可。管理者が登録する（MVP）
- **WorkItem**: ラインを流れる1件の作業。チャットのセッションも WorkItem の一つ
- **StageRun**: ステージの1回の実行。担当する VM が1台以上ある（8時間を超えたら新しい VM に引き継ぐ）

### 3.2 ライン定義（例: `build-verify`）
```yaml
apiVersion: factory/v1
kind: Line
metadata: { name: build-verify, version: 3 }
spec:
  defaults:
    harness: { type: claude-code, model: jp.anthropic.claude-sonnet }   # 実際のモデルIDは設定ファイルで解決する
    network: org-baseline
    role: bedrock-only
  stages:
    - id: implement
      type: agent
      image: web@5                # Node + Chromium。VM のサイズ（2GB）はイメージで決まる
      instructions: skills/implement.md
      gates: [plan-approval]      # ステージ内で計画の承認を求める
      inputs:  [request, repo]
      outputs: [branch, summary]
      timeout: 6h
      next: verify
    - id: verify
      type: agent
      image: qa-playwright@2      # ユーザーが作ったカスタムイメージ
      network: verify-restricted  # パッケージの取得のみ許可。GitHub は読み取りのみ
      instructions: skills/verify.md   # テストをクリーンな環境で再実行し、E2E で確かめ、スクリーンショットを撮る
      inputs:  [branch]
      outputs: [testReport, screenshots, verdict]
      on:
        pass: review
        fail: { goto: implement, maxLoops: 2 }   # 失敗の内容を implement に戻す
    - id: review
      type: agent
      image: base@7
      instructions: skills/review.md
      inputs: [branch, testReport]
      outputs: [reviewNotes, verdict]
      on: { pass: deliver, fail: { goto: implement, maxLoops: 1 } }
    - id: deliver
      type: system                # VM を使わず、コントロールプレーンが PR を作る
      action: create-pull-request
```
- `type`: `agent`（VM 上のエージェント）/ `command`（VM 上で決まったコマンドを実行する。LLM は使わない）/ `approval`（人の承認を待つ）/ `system`（コントロールプレーン側の処理）
- 標準のラインは2つ（FR-LINE-04 / 05）
  - `chat`: `workbench`（1ステージ。対話しながら作業する VM。計画の承認はステージの中で行う）→ `deliver`（任意）
  - `build-verify`: 上の例

### 3.3 実行エンジン（Lambda durable functions。D18）
1件の WorkItem につき1つの durable execution を動かす。待機中は料金がかからず、最大1年まで待てる。上限は `durableConfig.executionTimeout` で決め、初期値は30日とする。

```ts
// packages/engine/src/handler.ts（骨子。SDK: @aws/durable-execution-sdk-js v3。strict の tsc で型を確認済み）
import { withDurableExecution, type DurableContext } from '@aws/durable-execution-sdk-js';
import type { Line, StageDef, StageResult, WorkItem } from '@factory/contracts';
import { findStage, nextStage } from './transition.js';
import { approvals, repo, systemActions, vmManager } from './ports.js';

export const handler = withDurableExecution(async (event: { workItemId: string }, ctx: DurableContext) => {
  const wi: WorkItem = await ctx.step('load-work-item', async () => repo.loadWorkItem(event.workItemId));
  const line: Line = await ctx.step('load-line', async () => repo.loadLine(wi.lineRef));
  const loops: Record<string, number> = {};
  let stageId: string | undefined = line.stages[0]?.id;
  let seq = 0;

  while (stageId) {
    const stage: StageDef = findStage(line, stageId);
    const runId = `${stageId}#${++seq}`; // replay で先頭から再実行されても同じ値になる
    let result: StageResult;

    if (stage.type === 'approval') {
      result = await ctx.waitForCallback<StageResult>(
        `approve:${runId}`,
        async (callbackId) => { await approvals.request(wi, stage, callbackId); },
        { timeout: { days: 7 } },
      );
    } else if (stage.type === 'system') {
      const action = stage.action;
      if (!action) throw new Error(`stage ${stage.id}: type=system には action が必要`); // 本来はライン登録時の検証で弾く
      result = await ctx.step(`system:${runId}`, async () => systemActions[action](wi));
    } else {
      // agent / command: 受付制御 → RunMicrovm → 完了の callback を待つ
      const lease = await ctx.step(`lease:${runId}`, async () => vmManager.acquire(wi, stage, runId));
      result = await ctx.waitForCallback<StageResult>(
        `done:${runId}`,
        async (callbackId) => { await vmManager.run(lease, { stage, runId, callbackId }); },
        { timeout: { hours: stage.timeoutHours }, heartbeatTimeout: { minutes: 15 } },
      );
      await ctx.step(`release:${runId}`, async () => vmManager.release(lease, stage.keepVm));
    }

    await ctx.step(`record:${runId}`, async () => repo.saveStageResult(wi.id, runId, result));
    stageId = nextStage(stage, result, loops); // pass / fail / goto（maxLoops を超えたら undefined を返し、ワークアイテムを失敗にする）
  }
});
```
- **処理を決定的に書く**: replay では関数が先頭から再実行される。そのため、乱数・現在時刻・外部とのやり取り（I/O）は必ず `ctx.step` の中で扱う
- **冪等にする**: `RunMicrovm` には `clientToken = ${workItemId}:${runId}` を渡す。step が再試行されても、VM が二重に起動しないようにするため
- **heartbeat**: agentd は Callback API 経由で5分ごとに heartbeat を送る（Callback API が `SendDurableExecutionCallbackHeartbeat` を呼ぶ）。15分途切れると callback が失敗するので、エンジンはそのステージをチェックポイントから再試行する
- **完了の通知**: Callback API が `SendDurableExecutionCallbackSuccess` または `SendDurableExecutionCallbackFailure` を呼ぶ。そのために callbackId を `StageRuns` に保存しておく
- **中断・やり直し**（FR-LINE-08）: 管理 API が `SendDurableExecutionCallbackFailure` を送る（理由として cancel または retry を付ける）
- Durable Functions を選んだ理由は [ADR-0003](./adr/0003-line-engine-durable-functions.md) を参照

### 3.4 ステージ VM のライフサイクル
```mermaid
sequenceDiagram
  autonumber
  participant ENG as 実行エンジン
  participant MGR as VM マネージャー
  participant MV as Lambda MicroVMs
  participant VM as Stage VM (agentd)
  participant CBK as Callback API
  ENG->>MGR: acquire(stage)
  MGR->>MGR: 受付制御（メモリの予算 / エージェント数 / RunMicrovm のトークンバケット）
  ENG->>MGR: run(lease, inputs, callbackId)
  MGR->>MGR: VM トークンを発行（ワークアイテムとステージに紐づけ、ネットワークプロファイルと対応づける）
  MGR->>MV: RunMicrovm(image@ver, egress=[LNC:runtime], ingress=HTTP, executionRole, idlePolicy, maxDuration=8h, runHookPayload)
  MV->>VM: /run（payload: VM トークン、callback URL、入力のマニフェスト（presigned URL）、ステージの定義）
  VM->>VM: プロキシ / パッケージソースの設定を生成 → 入力を取得（git bundle / 成果物）→ ハーネスを起動
  VM-->>CBK: events（進捗、計画、メッセージ、使用量）
  Note over VM: 計画の承認が要るステージでは、ここで計画を提示し、承認を待つ（ステージの中で）
  VM-->>CBK: stage.completed（出力のマニフェスト）
  CBK->>ENG: SendDurableExecutionCallbackSuccess(callbackId, result)
  ENG->>MGR: release → TerminateMicrovm（keepVm の指定がなければ）
```

### 3.5 ステージ間の受け渡し（FR-LINE-03）
| 種類 | 方式 | 理由 |
|---|---|---|
| コード | ステージを終えるときに、作業ブランチを Git ゲートウェイ経由で push する。新規のワークスペースのように GitHub がない場合は、`git bundle` を成果物ストアに置く | 履歴と差分を損なわずに渡せる。検証ステージは、クリーンな状態から checkout できる |
| 成果物 | 成果物ストア `s3://…/workitems/{wi}/stages/{stage}/outputs/…` | テスト結果、スクリーンショット、レポートなど |
| 引き継ぎ記録 | DynamoDB `StageRun.result`（JSON: verdict、summary、outputs のマニフェスト、次のステージへのメモ） | 次のステージに渡す指示の材料にする。UI にも表示する |

VM は S3 への IAM 権限を**持たない**。入力と出力は、コントロールプレーンが発行する、そのワークアイテムとステージに限定した presigned URL でだけやり取りする（P4、ワークアイテム間の分離）。

### 3.6 chat ライン（workbench）の特徴
- ユーザーとの対話が続くあいだ、VM は同じものを使い続ける。UI → API → VM マネージャー → VM のエンドポイント（`POST /v1/messages`）の順に届く
- 計画の承認はステージの中で行う。agentd が `plan.proposed` を送り、UI で承認されると `POST /v1/plan/approve` を受けて実行を始める
- 作業を終えたら、`deliver`（PR の作成、または公開の提案）に進むか、そのままセッションを続ける

### 3.7 suspend / resume と keepalive
- idle policy は、**MicroVM のエンドポイントに inbound の通信が来ない**ことを idle と判定する。そのため、エージェントが自律的に作業していて外からの通信がないと、suspend されるおそれがある
- 対策: エージェントの実行中（`busy`）は、VM マネージャーが EventBridge Scheduler（1分ごと）から、該当する VM の `/healthz` に keepalive を送る。`idle`（ユーザーの入力待ち、承認待ち）になったら keepalive を止め、idle policy（15分）に任せて suspend させる（**要検証 V9**: 外向きの通信だけで idle と見なされないか）
- `RunMicrovm` の `idlePolicy` は `maxIdleDurationSeconds: 900`、`suspendedDurationSeconds: 7200`、`autoResumeEnabled: true` にする（3つとも必須。NFR-07）。期限が切れたら終了し、クォータを空ける。ユーザーが戻ってきたら §3.8 の手順で復元する
- 承認を長く待つときは、**suspend したまま待つ**。承認されたら ResumeMicrovm を呼ぶ（明示的に呼ぶので、5 TPS の制限の対象になる）

### 3.8 8時間の上限とチェックポイント
1. VM マネージャーは、VM ごとに `startedAt + 7h30m` の時刻にチェックポイントを要求するようスケジュールしておく
2. agentd は `POST /v1/checkpoint` を受けると、ハーネスを一時停止し、作業ツリーを WIP commit して `git bundle` にまとめる。ハーネスのセッションファイル（Claude Code の `~/.claude/projects/...`）と `/workspace` 以外の状態（追加でインストールしたパッケージの一覧）もまとめて、presigned URL で S3 にアップロードする
3. VM マネージャーは新しい VM を同じイメージで起動し、`runHookPayload.restore` でチェックポイントの場所を渡す。agentd は復元してから、ハーネスをセッションの再開モード（`--resume` 相当）で起動する
4. 古い VM を終了する。callbackId はそのまま引き継ぐので、実行エンジンからは何も起きていないように見える
5. suspend の期限が切れた後の復元（§3.7）も、同じ手順で行う

---

## 4. VM 内部の設計（factory-agentd）

### 4.1 イメージの層構造
```
┌─────────────────────────────────────────────┐
│ L3 プラットフォームの最終層（必ず付ける）       │ ← ENTRYPOINT/CMD = agentd、hooks の設定、権限を再設定
├─────────────────────────────────────────────┤
│ L2 ユーザーの層（カスタムイメージ）            │ ← 宣言的な定義 / Dockerfile の断片
├─────────────────────────────────────────────┤
│ L1 factory-base（プラットフォームが保守）       │ ← agentd、Claude Code、git、CA、非 root ユーザー `agent`
├─────────────────────────────────────────────┤
│ L0 public.ecr.aws/lambda/microvms:al2023-minimal │ ← AWS 提供（snapshot 互換の OpenSSL）
└─────────────────────────────────────────────┘
```

### 4.2 agentd の HTTP インターフェース（VM 内の 8080 番ポート）
| パス | 呼び出し元 | 内容 |
|---|---|---|
| `/aws/lambda-microvms/runtime/v1/ready` | Lambda（ビルド時） | agentd の初期化が終わったら 200 を返す（ここで snapshot を取る） |
| `…/validate` | Lambda（ビルド時） | 自己テスト: ハーネスが起動するか、`/workspace` に書き込めるか、必要なコマンドがあるか |
| `…/run` | Lambda（起動時） | `runHookPayload` を受け取り、**すぐに 200 を返して**から、非同期で初期化する（hook のタイムアウトを避けるため） |
| `…/suspend` / `…/resume` | Lambda | suspend 前に書き込みを flush し、コールバックへの接続を閉じる。resume 後は短期クレデンシャルを更新し（CodeArtifact のトークンも将来はここで）、接続を張り直す |
| `…/terminate` | Lambda | 最後のログとチェックポイントを送る |
| `/v1/messages` `/v1/plan/approve` `/v1/interrupt` | VM マネージャー | ユーザーの入力、承認、中断 |
| `/v1/checkpoint` | VM マネージャー | §3.8 |
| `/v1/files/*` | API（読み取り） | ファイルツリーと差分を UI に表示するため |
| `/healthz` | VM マネージャー | keepalive と状態（busy / idle） |
| 任意のポート（3000 など） | プレビュープロキシ | アプリのプレビュー（認証トークンで許可したポートだけ通す） |

### 4.3 ハーネスの抽象化
```ts
interface Harness {
  start(opts: { workdir: string; instructions: string; model: string; resume?: SessionRef }): Promise<void>;
  send(msg: UserMessage): Promise<void>;          // 進捗は onEvent で送る
  interrupt(): Promise<void>;
  checkpoint(): Promise<SessionRef>;              // セッションファイルを書き出す
  onEvent(cb: (e: HarnessEvent) => void): void;   // text / tool_use / plan / usage / done
}
```
- MVP の実装は **ClaudeCodeHarness**（Claude Agent SDK）
  - `CLAUDE_CODE_USE_BEDROCK=1`、`AWS_REGION=ap-northeast-1`、モデルは JP の推論プロファイルの ID
  - **非 root ユーザー `agent` で、permission mode を bypass にして**動かす（D3: 細かな確認はしない）
  - 計画を作るときは plan mode で実行し、出てきた計画を `plan.proposed` として送る
- 将来、Codex CLI や Kiro CLI のハーネスを足すときも、イメージ（L1 か L2）とこの実装を加えるだけで済むようにする

### 4.4 VM 内のネットワーク設定（agentd が `/run` のときに生成する）
- `HTTPS_PROXY` / `HTTP_PROXY` = `http://vm:{vmToken}@egress-proxy.internal:3128`、`NO_PROXY` = VPC エンドポイント（Bedrock、Callback API、S3）
- git: `url."https://git-gw.internal/{owner}/".insteadOf "https://github.com/{owner}/"`。ゲートウェイへの認証にも vmToken を使う
- パッケージソース: プロファイル（§6.4）から `.npmrc`、`pip.conf`、`settings.xml` などを生成する
- **vmToken は snapshot に含めない**（`/run` のときに受け取ってメモリと tmpfs にだけ置く）。トークンは VPC の中でしか使えず、そのワークアイテムのステージが終わると失効する

---

## 5. カスタムイメージ（D14）

### 5.1 イメージ定義（ユーザーが書くもの）
```yaml
apiVersion: factory/v1
kind: Image
metadata:
  name: qa-playwright
  owner: user:tanaka            # user:<id> | project:<id> | org
  visibility: project           # private | project | org（org は管理者の承認が必要）
spec:
  base: factory-base@7          # L1。プラットフォームが用意するベースからしか選べない
  arch: arm64                   # arm64（既定）| x86_64
  resources: { minimumMemoryInMiB: 2048 }
  packages:
    dnf:  [chromium, nss, atk]
    npm:  ["@playwright/test@1.49"]
    pip:  []
  files:                        # S3 にアップロードしたファイルを配置する（任意）
    - src: uploads/qa/config.json
      dest: /opt/qa/config.json
  dockerfile: |                 # 上級者向け: Dockerfile の断片（L2）。使える命令は RUN / COPY / ENV / WORKDIR / ARG
    RUN npx playwright install --with-deps chromium
  env:
    PLAYWRIGHT_BROWSERS_PATH: /opt/ms-playwright
  warmup:                       # /validate で実行するスモークテスト（snapshot の読み込み範囲を最適化するのにも使う）
    - npx playwright --version
```

### 5.2 ビルドパイプライン
```mermaid
sequenceDiagram
  autonumber
  actor U as ユーザー
  participant API as Image API
  participant IMB as イメージビルダー（durable fn）
  participant S3 as S3(build-artifacts)
  participant MV as Lambda MicroVMs
  participant PX as egress プロキシ（ビルド用プロファイル）
  U->>API: POST /images（定義）
  API->>API: 静的検証（スキーマ、使える命令、base の固定、サイズと数の上限）
  API->>IMB: start(imageSpec)
  IMB->>IMB: Dockerfile を合成（L1 FROM → L2 → L3 の最終層）と zip 化
  IMB->>S3: put build.zip
  IMB->>MV: CreateMicrovmImage（初回）/ UpdateMicrovmImage（新しいバージョン）<br/>buildRole、egress=[LNC:build]、hooks: ready + validate、resources
  MV->>PX: ビルド中の通信（dnf / npm / pip）。ビルド用 subnet から来た通信として判定する
  MV->>MV: Dockerfile を実行 → agentd が起動 → /ready=200 → snapshot
  MV->>MV: 新しい VM を起動 → /validate（agentd の自己テストと warmup）
  IMB->>MV: GetMicrovmImageBuild / GetMicrovmImageVersion をポーリング
  IMB->>API: カタログに登録（名前、版、spec のハッシュ、base の版、ビルドログへのリンク）
  API-->>U: 通知（成功 / 失敗とログ）
```

### 5.3 合成のルールとガードレール
| ルール | 理由 |
|---|---|
| `FROM` はプラットフォームが固定する（ユーザーは `spec.base` で選ぶだけ） | snapshot 互換性（OpenSSL）と agentd が入っていることを保証するため |
| L2 で使える命令は `RUN / COPY / ENV / WORKDIR / ARG` だけ。`ENTRYPOINT / CMD / USER / EXPOSE / HEALTHCHECK` は拒否する | agentd の起動と hooks の設定を壊させないため |
| L3 で agentd の配置、`USER agent`、`CMD`、ファイルの権限を**再設定する** | L2 で上書きされても元に戻すため |
| ビルドには secret を渡さない。ビルド中の通信は `build` ネットワークプロファイルの allowlist に限る | ビルドを通じた情報の持ち出しを防ぎ、サプライチェーンを統制するため |
| イメージにユーザー固有の値を焼き込まない（ID、トークン、乱数シード） | snapshot の性質上、同じイメージから起動した VM がすべて同じ値を持ってしまうため |
| `spec` のハッシュが同じなら再ビルドしない（キャッシュ） | クォータ（同時ビルド10）とコストを節約するため |

### 5.4 カタログとバージョン
- `ImageCatalog`（DynamoDB）: `name`、`owner`、`visibility`、`versions[]`（`version`、`microvmImageArn`、`microvmImageVersion`、`specHash`、`baseVersion`、`state`、`createdAt`）
- MicroVM のイメージとの対応: **カタログの1イメージ = MicroVM の1イメージ**。カタログのバージョン = MicroVM のイメージバージョン（`UpdateMicrovmImage` を呼ぶたびに新しいバージョンができる）
- **VM のサイズはイメージで決まる**（`resources.minimumMemoryInMiB`。`RunMicrovm` では指定できない）。同じ中身でサイズだけが違う場合は、別のイメージとして登録する（例: `web` と `web-4g`）
- クォータへの対応（イメージ100個 / 1イメージあたり50バージョン / 同時ビルド10）
  - 1ユーザーが持てるのは5イメージまで（MVP。10人なら50個で収まる）。100人に増やす前にイメージ数のクォータの引き上げを申請する
  - バージョンは「最新の5つ + ステージから参照されているもの」を残し、それ以外は90日で自動的に削除する（イメージの保存には最低1週間分の料金がかかる点も考慮する）
- `factory-base` を更新したとき（セキュリティパッチなど）: そのベースを使うカスタムイメージを自動で再ビルドし、新しいバージョンとして登録する。ラインのステージはバージョンを固定しているので勝手には変わらず、オーナーに更新を勧める通知を送る（S）

### 5.5 既定のイメージ（FR-IMG-01）
| 名前 | 中身 | 想定するステージ |
|---|---|---|
| `base` | factory-base（git、Claude Code、Node LTS、Python 3.12、jq、ripgrep） | review、軽い作業 |
| `web` | base + pnpm / yarn、Chromium（ヘッドレス）、Playwright | workbench（Web アプリやプレビュー）、verify |
| `data` | base + pandas / Polars / DuckDB / matplotlib / openpyxl、日本語フォント | LoB のデータ加工、レポート作成 |

---

## 6. ネットワーク設計

### 6.1 VPC の構成（東京、2AZ）
| subnet | 用途 | ルート | SG（egress） |
|---|---|---|---|
| `mvm-runtime-a/c` | LNC:runtime（ステージ VM） | **0.0.0.0/0 へのルートなし** | `sg-mvm-runtime`: egress プロキシの NLB:3128、Git ゲートウェイの NLB:443、VPC エンドポイント:443 **だけ** |
| `mvm-build-a/c` | LNC:build（イメージのビルド） | ルートなし | `sg-mvm-build`: egress プロキシの NLB:3129（ビルド用ポート）だけ |
| `proxy-a/c` | egress プロキシ、Git ゲートウェイ、プレビュープロキシ（Fargate）、NLB、内部 ALB | NAT へ | 必要最小限 |
| `public-a/c` | NAT Gateway | IGW へ | — |

- VM が使う subnet にはインターネットへのルートがない。そのため、**プロキシを通らない通信はネットワークの段階で届かない**（P1）
- VPC エンドポイント: `bedrock-runtime`、`execute-api`（Callback API）、`lambda-microvms`（コントロールプレーン用）、`logs`、S3（Gateway 型）
- **S3 の Gateway エンドポイントのポリシー**: 許可するバケットは、このシステムのバケット（ワークスペースと成果物）だけにする。presigned URL を悪用して別のバケットに持ち出すことを防ぐ
- LNC を作るときは `runtime` と `build` を別にする。LNC にはバージョンがあり、更新すると新しいバージョンができる。run のときには修飾しない ARN（最新版）を指定する

### 6.2 egress プロキシ（C9）
- 方式: 明示的な forward プロキシ（`CONNECT`、`HTTP`）。**TLS は終端しない**。宛先は CONNECT の宛先と SNI が一致することを確かめてから、FQDN で判定する
- 認証: `Proxy-Authorization`（vmToken）→ DynamoDB（DAX かメモリ上の TTL キャッシュ）で `VmToken → {workItemId, stageId, networkProfileId, expiresAt}` を引く
- 判定: L0（システム必須）∪ プロファイル（L1 組織全体 + L2 プロジェクト + ステージのプロファイル + L3 の一時許可）で決める。拒否したときは 403 を返し、本文に `X-Factory-Blocked: <fqdn>` の印を付ける。agentd はこれを見つけて、エージェントに「この宛先はブロックされた。許可が必要なら申請を提案して」と伝える（FR-PLAN-04 の②）
- ビルド用のポート（3129）: ビルド用の subnet から来た通信だけを受け付け、`build` プロファイルで判定する（ビルド VM には vmToken がないため、subnet で見分ける）
- 実装: **TypeScript（Node.js 24）で書いた軽量のプロキシ**（`node:http` の `connect` イベントと `node:net` で実装する）を ECS Fargate で動かす（ARM、0.5vCPU × 2台から始める）。言語をモノレポ全体で揃えるため（D19）。性能が足りない場合の代わりの案は Squid と external_acl_type
- ログ: 許可と拒否を JSON で CloudWatch Logs に出し、Firehose で S3 の監査ログに送る

### 6.3 Git ゲートウェイ（C10）
- VM の git は `https://git-gw.internal/{owner}/{repo}.git` を remote として使う（insteadOf）
- ゲートウェイの処理
  1. vmToken を確かめ、ワークアイテム → 依頼者 → **その人の GitHub user-to-server トークン**（Secrets Manager に暗号化して保存し、有効期限が切れる前に更新する）を引く
  2. 対象のリポジトリが、そのワークアイテムの計画で許可したリポジトリかどうかを確かめる
  3. `git-receive-pack`（push）の場合は、ref の更新内容を読み、`refs/heads/factory/*` 以外への更新を**拒否する**（既定ブランチと保護ブランチへの push を防ぐ）。GitHub 側のブランチ保護と合わせて二重に守る
  4. GitHub に転送する（Authorization ヘッダーはゲートウェイが付ける）
- **PR の作成、Issue へのコメント、ラベル付けはコントロールプレーンが GitHub API で行う**。VM の中のエージェントには GitHub API を使わせない（`deliver` ステージの役割）
- 読み取り専用で GitHub API を使いたい場合（Issue の本文、PR のコメント）は、コントロールプレーンが入力のマニフェストに入れて渡す

### 6.4 ネットワークプロファイルとパッケージソース
```yaml
kind: NetworkProfile
metadata: { name: org-baseline }
spec:
  include: [system-required, package-source:public]   # L0 + パッケージソース（public）
  allow:
    - "*.githubusercontent.com"
    - "api.example-saas.com"                             # 管理者が追加した宛先
---
kind: NetworkProfile
metadata: { name: verify-restricted }
spec:
  include: [system-required, package-source:public]
  git: read-only                                         # Git ゲートウェイで push を拒否する
---
kind: PackageSource
metadata: { name: public }        # 将来は codeartifact に切り替える
spec:
  npm: { registry: https://registry.npmjs.org/ }
  pypi: { index: https://pypi.org/simple }
  maven: { mirror: https://repo1.maven.org/maven2 }
  allowHosts: [registry.npmjs.org, pypi.org, files.pythonhosted.org, repo1.maven.org, proxy.golang.org, index.crates.io]
```
- CodeArtifact への切り替え（要件 §5.3）: `PackageSource: codeartifact` を作り、ネットワークプロファイルの include を書き換えるだけで済む。agentd は `/run` と `/resume` のときに、execution role で `codeartifact:GetAuthorizationToken` を呼んで設定ファイルを生成する。その段階で、execution role に CodeArtifact の権限と、VPC エンドポイント（`codeartifact.api` / `codeartifact.repositories`）を追加する

---

## 7. プレビューと社内公開（D6・D8・D12）

### 7.1 3つのディストリビューションでオリジンを分ける
| ディストリビューション | 配信するもの | 認証 | ねらい |
|---|---|---|---|
| **App**（`xxxx.cloudfront.net`） | SPA と `/api/*`（API Gateway） | Cognito の JWT（メモリ上に保持） | 信頼できるコードだけを配信する |
| **Preview**（`yyyy.cloudfront.net`） | VM 上の任意のアプリ（エージェントが作ったコード） | プレビュー用の cookie（HttpOnly、Secure） | 信頼できないコードを App から隔離する |
| **Publish**（`zzzz.cloudfront.net`） | 公開した静的コンテンツ（S3） | Lambda@Edge で Cognito の JWT を確かめる（cookie） | 信頼できないコードを App と Preview から隔離する |

- `cloudfront.net` は Public Suffix List に登録されているので、ディストリビューションが違えば別サイトとして扱われ、cookie も共有されない（**要確認 V13**）
- D12 により独自ドメインは使わない。そのため、サブドメインのワイルドカード（`{id}.preview.example.com`）は使えない。§7.2 と §7.3 はこの制約を前提にした設計になっている

### 7.2 ライブプレビュー
```mermaid
sequenceDiagram
  autonumber
  actor U as ユーザー（App 画面）
  participant API as API
  participant CFP as CloudFront(Preview)
  participant PVP as プレビュープロキシ
  participant MGR as VM マネージャー
  participant VM as Stage VM
  U->>API: POST /previews {workItemId, port:3000}
  API->>API: 本人のワークアイテムであることを確認 → 一回限りのチケット（60秒、署名付き）を発行
  API-->>U: https://yyyy.cloudfront.net/__open?t=<ticket>
  U->>CFP: iframe か新しいタブで開く
  CFP->>PVP: /__open?t=...
  PVP->>PVP: チケットを確かめる → Set-Cookie: pv=<session>（HttpOnly; Secure; SameSite=None; Partitioned）→ / にリダイレクト
  U->>CFP: GET /（以降すべてのパス、WebSocket も含む）
  CFP->>PVP: cookie pv
  PVP->>MGR: 宛先を解決（VM の endpoint、port）。認証トークンはキャッシュから
  PVP->>VM: X-aws-proxy-auth + X-aws-proxy-port: 3000（WebSocket は subprotocol `lambda-microvms.port.3000`）
  VM-->>U: アプリの応答（HMR の WebSocket も通る）
```
- **パスではなく cookie で宛先を決める**ので、アプリはルートパス（`/`）のまま動く（絶対パスの資源も壊れない）。そのかわり、**1つのブラウザで同時に開けるプレビューは1つだけ**になる（MVP の制約。独自ドメインを使えるようになれば解消できる）
- iframe に埋め込むと、cookie はサードパーティの扱いになる。`Partitioned`（CHIPS）を付けて、各ブラウザで動くか確かめる（**V2**）。動かないブラウザでは新しいタブで開くように誘導する
- VM が suspend していた場合は、auto-resume で最初の応答が少し遅れる。それまでの間、プロキシは「再開中」のページを返す
- 帯域: VM のエンドポイントは 1vCPU あたり 2MB/s（バーストすると 10MB/s）。プレビューは本人と少人数での確認に使うものと割り切る

### 7.3 社内公開
- 保存場所: `s3://publish/{publishId}/v{n}/…` → CloudFront(Publish) の `/{publishId}/…`（OAC で配信する）
- **Lambda@Edge（viewer-request）**:
  1. cookie の JWT（Cognito の ID トークン）を検証する（JWKS はキャッシュする）。JWT がなければ Cognito の Hosted UI にリダイレクトする（PKCE。callback も Lambda@Edge で処理する）
  2. `publishId` の ACL（`org` / `users[]` / `groups[]`、有効期限、公開停止フラグ）を確かめる。ACL は us-east-1 の DynamoDB のレプリカ（Global Table）から読み、メモリに60秒キャッシュする
  3. 許可されたら、現在のバージョンのパスに書き換えて S3 に転送する
- **レスポンスヘッダーのポリシー**（公開物と Preview の両方）
  - `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-downloads; …`（**`allow-same-origin` は付けない**）。こうすると、公開物は opaque origin として扱われ、同じディストリビューションにある別の公開物を読めなくなる。cookie も読めない
  - 副作用: sandbox の中では `localStorage` や cookie を使えないので、それを使う HTML は動かない。公開前のチェックで警告する（**V14**）
- 公開前のチェック（FR-SHARE-05）: secret のスキャン、合計サイズ（初期値100MB）、絶対パス（`/xxx`）の参照（パス配下で配信するため壊れる）、外部の CDN の参照（警告のみ）
- 公開は **App の画面からユーザーが操作したときだけ**実行できる。公開 API は Cognito の JWT が必須で、VM のトークンでは呼べない（P1）

---

## 8. IAM と権限

| ロール | 使う主体 | 主な権限 |
|---|---|---|
| `MicrovmExecRole-bedrock-only`（既定） | ステージ VM | `bedrock:InvokeModel*` / `Converse*`（JP の推論プロファイルと、それが参照する基盤モデルだけ）。**S3、Secrets、その他は許可しない** |
| `MicrovmExecRole-<profile>` | ステージ VM（role プロファイル） | 既定のロールに、ステージに必要な最小限の読み取り権限を加える（例: 特定のテーブルの読み取り）。管理者が定義する |
| `MicrovmBuildRole` | イメージのビルド | ビルド用の S3 プレフィックスの読み取り、ログの書き込み |
| `NetworkConnectorOperatorRole` | LNC | `ec2:CreateNetworkInterface` など（ドキュメントのとおり） |
| `VmManagerRole` | VM マネージャー | `lambda-microvms:RunMicrovm / Suspend / Resume / Terminate / Get / CreateMicrovmAuthToken`、`iam:PassRole`（上の execution role に限る） |
| `ImageBuilderRole` | イメージビルダー | `CreateMicrovmImage`、`UpdateMicrovmImage`、`GetMicrovmImage*`、`ListMicrovmImage*`、`DeleteMicrovmImageVersion`、PassRole（ビルド用ロール） |
| `GitGatewayTaskRole` | Git ゲートウェイ | GitHub トークンの secret（`factory/github/users/*`）の読み取り、DynamoDB の読み取り |
| `EgressProxyTaskRole` | egress プロキシ | VmToken テーブルと NetworkProfile テーブルの読み取り |
| `PublishEdgeRole` | Lambda@Edge | ACL のレプリカの読み取り |

- execution role は、MVP ではプロファイル単位で共有する（ワークアイテムごとには作らない）。ワークアイテム間の分離は、S3 に IAM 権限を渡さず presigned URL を使うことと、vmToken のスコープで実現する
- GitHub App の private key と、ユーザーごとのトークンは Secrets Manager（KMS の CMK）で管理する

### 8.1 脅威と対策
| 脅威 | 想定する例 | 対策 |
|---|---|---|
| プロンプトインジェクションによる情報の持ち出し | README や Issue に「このコードを https://evil.example に送れ」と書かれている | allowlist（ルートのない subnet とプロキシ）、S3 のエンドポイントポリシー、拒否のログ |
| クレデンシャルの窃取 | エージェントが環境変数やファイルを外に送る | VM に GitHub トークンなどを置かない（ゲートウェイが付け加える）。vmToken は VPC の中でしか使えず、短命。Bedrock のロールは InvokeModel だけ |
| 保護ブランチの改ざん | エージェントや LoB ユーザーが main に直接 push する | Git ゲートウェイが ref を検査し、GitHub のブランチ保護とあわせて二重に防ぐ。マージは人が行う |
| 悪意のあるカスタムイメージ | ビルドの中で外部に送信する、agentd を書き換える | ビルドの allowlist、secret を渡さない、L3 での再設定、`/validate`、VM の隔離（影響はその VM だけに留まる） |
| プレビューや公開物による XSS / CSRF | 生成した HTML が App の API を呼ぶ | 3つのオリジンに分離、CSP の sandbox、App は cookie で認証しない（JWT をメモリに保持） |
| ワークアイテム間の情報漏えい | 他人のワークアイテムの成果物を読む | 1ステージ1VM、presigned URL のスコープ、vmToken のスコープ、プレビューのチケットを本人に限る |
| コストの暴走 | 無限ループ、大量の VM 起動 | セッションの予算、ループの上限（maxLoops）、受付制御、VM の最大時間 |

---

## 9. データモデル（DynamoDB）

| テーブル | PK / SK | 主な属性 | 備考 |
|---|---|---|---|
| `Users` | `USER#id` | email、groups、githubLinked、limits | |
| `Projects` | `PROJ#id` / `MEMBER#user` | repos[]、networkProfile、roleProfiles | |
| `WorkItems` | `WI#id` | owner、project、lineRef、state、currentStage、budget、usage、durableExecutionArn | GSI: owner と更新日時 |
| `StageRuns` | `WI#id` / `STAGE#seq#stageId` | state、vmIds[]、callbackId、result、loops | |
| `Events` | `WI#id` / `TS#ulid` | type（message / tool / plan / usage / log）、payload | TTL。Streams → WebSocket で配信 |
| `Plans` / `Approvals` | `WI#id` / `PLAN#n` | content、status、approver、approvedAt | 監査ログにも書く |
| `Vms` | `VM#id` | wi、stage、image@ver、state、memMiB、startedAt、endpoint、tokenCache | GSI: state（クォータの集計用） |
| `VmTokens` | `TOK#hash` | vmId、wi、stage、networkProfile、expiresAt | TTL。プロキシとゲートウェイが参照する |
| `Images` | `IMG#name` / `VER#n` | owner、visibility、specHash、microvmImageArn、state | |
| `Lines` | `LINE#name` / `VER#n` | definition（YAML）、status | |
| `NetworkProfiles` / `PackageSources` | `NP#name` / `PS#name` | 定義 | 変更したら履歴を残す |
| `Publications` | `PUB#id` | owner、acl、currentVersion、expiresAt、revoked | **Global Table**（us-east-1 にレプリカを置き、Lambda@Edge が読む） |
| `Capacity` | `CAP#mem` / `CAP#agents` / `RATE#RunMicrovm` | used、limit、トークンバケット | 条件付き書き込みでセマフォにする |

---

## 10. 容量の制御と新しいアカウントの準備（D10・D13）

### 10.1 受付制御（VM マネージャー）
| 制御 | 方式 | 初期値（MVP / 100人） |
|---|---|---|
| MicroVM のメモリの予算 | `Capacity#mem` に条件付きで加算する（Run の前に確保し、Terminate で解放する。**suspended の VM も数に入れる**） | クォータの 80% |
| エージェントの同時実行数（Bedrock の保護） | `Capacity#agents`。busy のエージェントの数 | 10 / 30（V4 の計測結果で調整する） |
| 1ユーザーあたり | running と suspended の VM の合計 ≤ 3、busy のエージェント ≤ 1 | 同じ |
| RunMicrovm / ResumeMicrovm | トークンバケット 4 TPS（制限の 5 TPS より少なくする） | 同じ |
| 超えた場合 | 実行エンジンが `step` の再試行（指数バックオフ）で待つ。UI に順番待ちの位置を表示する | |

### 10.2 新しいアカウントで最初に出すクォータの申請（D13）
新しいアカウントは既定値より低いクォータから始まるため、**構築を始めると同時に申請を出す**。

| サービス | クォータ | 申請する値（目安） | 時期 |
|---|---|---|---|
| Lambda MicroVMs | 全 MicroVM に割り当てるメモリ（東京） | 実際の値を確認したうえで、MVP は 200GB 以上、100人に広げる前に 800GB 以上 | 最初 |
| Lambda MicroVMs | MicroVM のイメージ数 | 100 → 300（100人に広げる前に） | 拡大する前 |
| Lambda | Concurrent executions | 1,000（新しいアカウントは低く設定されている） | 最初 |
| Bedrock | Cross-Region（JP）InvokeModel tokens per minute（使うモデルごと） | V4 の計測結果 × 同時実行数 × 1.5 | PoC の後すぐ |
| Bedrock | Cross-Model Max Tokens Per Day | 同上 | PoC の後すぐ |
| Bedrock | モデルへのアクセス（JP の推論プロファイル） | 有効にする | 最初 |

### 10.3 コストのかかりどころ（参考）
Bedrock のトークン（最も大きい）、MicroVM の compute（ベースライン + バーストした時間）と snapshot（保存、読み込み、書き込み）、NAT Gateway とデータ転送、Fargate（プロキシ3種類を常時稼働）、CloudFront と Lambda@Edge、DynamoDB と S3。セッションごとの概算は、使用量のイベント（tokens、VM の稼働秒数）から計算して表示する（FR-COST-01）。

---

## 11. 可観測性と監査

- **トレース**: `workItemId` と `stageRunId` を相関 ID として、API → エンジン → VM マネージャー → agentd → Callback API の経路に伝える（X-Ray / OTel）
- **イベント**: agentd がハーネスのイベント（text、tool_use、usage）を Callback API に送る → `Events` テーブル → Streams → WebSocket で UI へ。同時に CloudWatch Logs にも送る
- **監査ログ**（FR-SEC-06）: 承認、公開、PR の作成、ネットワークの拒否、管理操作 → EventBridge → Firehose → S3（**Object Lock を compliance モードで**）。CloudTrail（MicroVMs、Bedrock、IAM）も同じ監査用のバケットに集める
- **メトリクスとアラーム**: クォータの使用率（メモリ、TPM）が 80% を超えたとき、キューの待ち時間、RunMicrovm のスロットリング、ステージの失敗率、プロキシで拒否した件数の急増
- **Bedrock の model invocation logging**: プロンプトの中身まで残すかどうかは、監査の要件とプライバシーの兼ね合いで決める（未決事項 O7）

---

## 12. デプロイ構成（CDK / TypeScript）

| スタック | リージョン | 主なリソース |
|---|---|---|
| `Network` | ap-northeast-1 | VPC、subnet、NAT、SG、VPC エンドポイント、LNC（runtime / build。L1 の `CfnNetworkConnector`） |
| `Data` | ap-northeast-1 | DynamoDB（Publications は us-east-1 へのレプリカ付き）、S3（workspace / artifacts / build / publish / audit）、KMS |
| `Auth` | ap-northeast-1 | Cognito User Pool、IdP 連携、アプリクライアント（App / Publish） |
| `Gateways` | ap-northeast-1 | ECS クラスター、egress プロキシ、Git ゲートウェイ、プレビュープロキシ、NLB、内部 ALB |
| `ControlPlane` | ap-northeast-1 | API Gateway（HTTP / WebSocket / プライベートの Callback）、Lambda（Hono）、durable functions（`lambda.Function` の `durableConfig`）、EventBridge Scheduler、Secrets Manager |
| `Images` | ap-northeast-1 | ビルド用ロール、factory-base と既定のイメージ（L1 の `CfnMicrovmImage` で定義する） |
| `Edge` | **us-east-1** | Lambda@Edge（公開物の認可）、CloudFront 用の WAF（任意） |
| `Frontend` | global | CloudFront × 3（App / Preview / Publish）、レスポンスヘッダーのポリシー |
| `Observability` | ap-northeast-1 | ダッシュボード、アラーム、Firehose、CloudTrail |

### 12.1 リポジトリの構成
モノレポの構成とパッケージの責務は [04_implementation_plan.md](./04_implementation_plan.md) の §3 で定義する。

---

## 13. 未決事項

| # | 論点 | 選択肢 / 現在の案 | 決める時期 |
|---|---|---|---|
| ~~O1~~ | プレビューは1つのブラウザで1つだけ、という制約を受け入れるか | **決定（D16）: 受け入れる** | — |
| ~~O2~~ | GitHub は .com か GHES か | **決定（D17）: GitHub.com**。GitHub App をインストールする Organization は構築のときに決める | — |
| ~~O3~~ | 実行エンジンは durable functions か Step Functions か | **決定（D18）: durable functions** | — |
| O4 | egress プロキシの実装 | TypeScript で自作する（案）/ Squid | PoC の V1 で判断する |
| O5 | 既定のモデルと、セッションごとの予算の初期値 | | PoC の V4 の後 |
| O6 | execution role をプロファイル単位で共有することでよいか | 共有する（案）。厳しく分ける必要があればワークアイテムごとの role を検討する | 設計レビューで |
| O7 | Bedrock の invocation logging でプロンプトの中身まで残すか | | セキュリティ部門と相談して |
| O8 | データの保持期間（イベント、成果物、監査ログ、公開物） | イベント90日、成果物180日、監査ログ1年以上（案） | 設計レビューで |
| O9 | ユーザーがラインを作る機能（S）の権限の範囲 | | Phase 2 の前 |

---

## 14. PoC で検証すること（v0.2 の V1〜V8 に追加した最新版）

| # | 検証項目 | 合格の基準 |
|---|---|---|
| V1 | ルートのない subnet + LNC + egress プロキシで、ドメイン単位の allowlist が動くか（CONNECT、SNI） | 許可した宛先にだけ届き、それ以外は拒否され、ログに残る |
| V2 | プレビュー: チケットから cookie を発行する方式で、iframe（CHIPS）と別タブの両方が動くか。WebSocket（HMR）が通るか | Chrome、Edge、Safari で動く |
| V3 | snapshot 起動、resume、チェックポイントからの復元にかかる時間 | 10秒 / 5秒 / 60秒以内 |
| V4 | エージェント1台あたりの TPM（代表的なタスク3種類で測る） | 計測値を得て、§10.2 の申請値を決める |
| V5 | auto-resume が ResumeMicrovm の API レート制限の対象になるか | 挙動を確認する |
| V6 | suspended の VM がメモリのクォータにどう数えられるか | 挙動を確認する |
| V7 | Git ゲートウェイで GitHub トークンを付け加えられるか。push の ref を検査できるか | `factory/*` 以外への push を拒否できる |
| V8 | 公開物への Lambda@Edge + Cognito による認可と、グループによる ACL | 動作し、許可されていない人には 403 を返す |
| **V9** | エージェントが自律的に作業している間、idle policy で suspend されないか。keepalive が効くか | 作業中に suspend されない |
| **V10** | LNC を使ったとき、送信元 IP が VM ごとに分かれるか（分かれなければ vmToken での識別が必須になる） | 挙動を確認する |
| **V11** | durable functions の `waitForCallback`（timeout / heartbeatTimeout）と、8時間を超えたときの VM の引き継ぎ（同じ callbackId を使う） | 引き継いでも中断なく再開できる。heartbeat が途切れたら失敗として検知できる |
| **V12** | ビルドの通信を LNC:build → プロキシのビルド用ポートで通せるか（Dockerfile の `RUN` に `ARG HTTPS_PROXY` を渡す） | dnf / npm / pip がプロキシ経由で成功する |
| **V13** | 3つの `*.cloudfront.net` の間で cookie とオリジンが分離されるか | 別のディストリビューションから cookie を読めない |
| **V14** | CSP の sandbox を付けたときの公開物の互換性（よくある HTML、Chart.js など） | 代表的なレポートの HTML が正しく表示される |
| **V15** | カスタムイメージのビルド（L2 の合成、L3 での再設定、/validate）を最初から最後まで通せるか。ビルドにかかる時間 | 15分以内にビルドを終え、そのイメージで VM を起動できる |

---

## 15. 実装の順序（MVP）
1. **PoC**（V1、V2、V4、V9、V11、V12 を優先する）と、クォータの申請（§10.2）
2. **基盤**: Network / Data / Auth / Gateways（egress プロキシ）/ factory-base / agentd の最小版
3. **chat ライン**: Web チャット → workbench の VM → 計画の承認 → ストリーミング → ファイルとダウンロード → suspend / resume
4. **リポジトリ連携とプレビュー**: GitHub App、Git ゲートウェイ、PR の作成、ライブプレビュー
5. **カスタムイメージと build-verify ライン**: イメージビルダー、カタログ、多段の実行エンジン、ステージ間の受け渡し、8時間の引き継ぎ
6. **公開と管理**: 社内公開、管理画面（allowlist、プロファイル、クォータ）、監査ログ、コスト → **10人でのパイロット**
