# ソフトウェアファクトリー API・イベント仕様 v1.0

- 作成日: 2026-11-06
- **型の正は `packages/contracts`（Zod）**。この文書は一覧と約束ごとを示すもので、スキーマの詳細はコードを見る（雛形: [samples/src/contracts/index.ts](./samples/src/contracts/index.ts)）
- OpenAPI は Hono（`@hono/zod-openapi`）が `/openapi.json` として自動で生成する

---

## 1. 共通の約束

| 項目 | 内容 |
|---|---|
| ベースパス | `https://<App の CloudFront>/api/v1`（CloudFront → API Gateway HTTP API） |
| 認証 | `Authorization: Bearer <Cognito の ID トークン>`。API Gateway の JWT authorizer が検証する |
| 形式 | JSON（UTF-8）。時刻は UTC の ISO 8601、ID は ULID |
| エラー | `ApiError { code, message, requestId? }` |
| ページング | `?limit=20&cursor=<不透明な文字列>` → `{ items, nextCursor? }` |
| 冪等性 | 作成系の POST は `Idempotency-Key` ヘッダーを受け付ける（24時間保持） |
| 権限 | User は自分のワークアイテムだけ、Admin はすべてを操作できる。リポジトリへの権限は GitHub 側で判定する |

### 1.1 エラーコード
| HTTP | code | 意味 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | 入力が契約に合わない |
| 401 | `UNAUTHORIZED` | 認証されていない |
| 403 | `FORBIDDEN` | 権限がない（他人のワークアイテム、Admin 専用の操作など） |
| 404 | `NOT_FOUND` | 見つからない（他人のものも 404 にして、存在を明かさない） |
| 409 | `CONFLICT` | 状態が合わない（承認待ちでないのに承認しようとした、など） |
| 422 | `PRECHECK_FAILED` | 公開前のチェックや、ブランチ保護のチェックで止まった |
| 429 | `QUOTA_EXCEEDED` / `RATE_LIMITED` | ユーザーごとの上限を超えた / 呼び出しが多すぎる |
| 503 | `CAPACITY_WAIT` | 受付制御で順番待ちになった（`Retry-After` を付ける） |

---

## 2. REST API（ユーザー向け）

### 2.1 ワークアイテム（セッション）
| メソッド | パス | 内容 | 主な要件 |
|---|---|---|---|
| POST | `/work-items` | 作成する（`CreateWorkItemRequest`: title?、lineRef、projectId?、repo?、message。title を省略したら本文の最初の文から作る（60字まで。`titleFromMessage`）。後から `PATCH` で変えられる）。durable execution を起動する | FR-UI-01、FR-LINE-07 |
| GET | `/work-items` | 自分のワークアイテムの一覧（`?state=`・`?archived=`）。更新の新しい順に、ページングで返す | FR-UI-02 |
| GET | `/work-items/{id}` | 詳細（状態、現在のステージ、使用量） | |
| PATCH | `/work-items/{id}` | 名前の変更、アーカイブ | FR-UI-02 |
| POST | `/work-items/{id}/messages` | 追加の指示を送る（VM の `/v1/messages` に転送する） | FR-UI-07 |
| POST | `/work-items/{id}/interrupt` | 実行中のエージェントを中断する | FR-UI-07 |
| POST | `/work-items/{id}/cancel` | ライン全体を中断する | FR-LINE-08 |
| GET | `/work-items/{id}/events` | イベントの履歴（`?after=<ulid>`。WebSocket を再接続したときの取りこぼしを埋める） | |

### 2.2 計画と承認
| メソッド | パス | 内容 |
|---|---|---|
| GET | `/work-items/{id}/plans` | 計画の版の一覧 |
| POST | `/work-items/{id}/plans/{version}/approve` | 計画を承認する。承認しないまま新しい版が出ていたら 409 |
| POST | `/work-items/{id}/plans/{version}/request-changes` | 修正を依頼する（`{ comment }`） |
| POST | `/work-items/{id}/plans/{version}/reject` | 却下する |
| POST | `/work-items/{id}/approvals/{approvalId}` | 再承認に回答する（`{ decision: 'approve' \| 'deny', comment? }`。範囲の変更、egress、予算、時間） |

### 2.3 ステージ・ファイル・成果物
| メソッド | パス | 内容 |
|---|---|---|
| GET | `/work-items/{id}/stages` | ステージの実行の一覧（状態、結果、ログへのリンク） |
| POST | `/work-items/{id}/stages/{runId}/retry` | ステージをやり直す（Admin、または本人） |
| GET | `/work-items/{id}/files?path=` | ファイルツリー（実行中は VM から、終了後はスナップショットから） |
| GET | `/work-items/{id}/files/content?path=` | ファイルの中身（presigned URL へのリダイレクト） |
| GET | `/work-items/{id}/diff` | 作業ブランチの差分 |
| POST | `/work-items/{id}/attachments` | 添付ファイルのアップロード用の presigned URL を発行する |
| POST | `/work-items/{id}/downloads` | ダウンロード（ファイル単位、または zip）を作る |

### 2.4 プレビュー
| メソッド | パス | 内容 |
|---|---|---|
| POST | `/work-items/{id}/previews` | `{ port }` → `{ url }`（`https://<Preview>/__open?t=<一回限りのチケット>`。60秒で無効） |

### 2.5 社内公開
| メソッド | パス | 内容 |
|---|---|---|
| POST | `/work-items/{id}/publications/precheck` | 公開前のチェック（secret、サイズ、絶対パス、外部の参照）→ 結果 |
| POST | `/publications` | 公開する（`{ workItemId, path, acl: { scope: 'org' \| 'restricted', users?, groups? }, expiresAt? }`）。**Cognito の JWT が必須で、VM のトークンでは呼べない** |
| GET | `/publications` | 自分の公開物の一覧 |
| PATCH | `/publications/{id}` | 公開範囲・有効期限の変更、再公開（バージョンを上げる） |
| DELETE | `/publications/{id}` | 公開を停止する |

### 2.6 GitHub 連携
| メソッド | パス | 内容 |
|---|---|---|
| GET | `/github/connect` | GitHub App の user-to-server 認可へのリダイレクト |
| GET | `/github/callback` | 認可の callback（トークンを Secrets Manager に保存する） |
| GET | `/github/repos` | 使えるリポジトリの一覧（本人の権限と App のインストール先が重なるもの） |

### 2.7 イメージとライン
| メソッド | パス | 内容 |
|---|---|---|
| GET | `/images` | 使えるイメージの一覧（既定、自分、プロジェクト、組織） |
| POST | `/images` | イメージ定義を登録してビルドを始める（`ImageSpec`） |
| GET | `/images/{name}/versions` | バージョンとビルドの状態 |
| GET | `/images/{name}/versions/{v}/build-log` | ビルドログ |
| POST | `/images/{name}/visibility` | 公開範囲の変更（org は管理者の承認待ちになる） |
| GET | `/lines` | ラインの一覧（閲覧） |

---

## 3. REST API（管理者向け: `/admin/*`。Admin のロールが必須）
| メソッド | パス | 内容 |
|---|---|---|
| GET / PUT | `/admin/network-profiles/{name}` | allowlist のプロファイル |
| GET / PUT | `/admin/package-sources/{name}` | パッケージソースのプロファイル（`public` / `codeartifact`） |
| GET / PUT | `/admin/lines/{name}` | ラインの登録（YAML。新しいバージョンになる） |
| POST | `/admin/images/{name}/approve-org` | イメージを組織全体に公開することを承認する |
| GET | `/admin/vms` | 実行中・suspend 中の VM の一覧 |
| POST | `/admin/vms/{id}/terminate` | VM を強制的に停止する |
| GET | `/admin/capacity` | クォータの使用状況（メモリ、エージェント数、TPM）とキューの長さ |
| GET / PUT | `/admin/users/{id}` | ロールと上限 |

---

## 4. WebSocket（ユーザー向けのイベント配信）

- 接続先: `wss://<WebSocket API>/ws?token=<Cognito の ID トークン>`（`$connect` で検証する）
- クライアントからの送信: `{ "action": "subscribe", "workItemId": "<ulid>" }` / `{ "action": "unsubscribe", ... }`
- サーバーからの配信: `FactoryEvent`（contracts の判別共用体）に `eventId`（ULID）を付けたもの
- 再接続したら `GET /work-items/{id}/events?after=<最後に受け取った eventId>` で取りこぼしを埋める

| type | いつ届くか | 主な項目 |
|---|---|---|
| `message.delta` / `message.completed` | エージェントの応答（ストリーミング） | messageId、text |
| `tool.started` / `tool.finished` | ツールの実行（コマンド、ファイルの編集など） | toolUseId、tool、summary、ok |
| `plan.proposed` | 計画を提示したとき | planVersion、plan（`Plan`） |
| `approval.required` | 再承認が必要になったとき | reason（scope / egress / budget / time）、detail |
| `egress.blocked` | allowlist で通信が拒否されたとき | host |
| `usage` | 使用量の増分 | inputTokens、outputTokens、vmSeconds |
| `stage.changed` | ステージが始まった・終わった | stageId、state |
| `workitem.state` | ワークアイテムの状態が変わった | state |

---

## 5. Agent Callback API（VM → コントロールプレーン。プライベート）

- 到達経路: VM → LNC → `execute-api` の VPC エンドポイント → プライベート REST API（リソースポリシーでその VPC エンドポイントに限る）
- 認証: `Authorization: Bearer <vmToken>`（`/run` のときに受け取る。ワークアイテムとステージに紐づき、ステージが終わると失効する）

| メソッド | パス | 内容 |
|---|---|---|
| POST | `/cb/v1/events` | イベントをまとめて送る（`{ events: FactoryEvent[] }`。`eventId` で重複を除く） |
| POST | `/cb/v1/heartbeat` | heartbeat（5分ごと）→ `SendDurableExecutionCallbackHeartbeat` |
| POST | `/cb/v1/stage-complete` | ステージの完了（`StageResult`）→ `SendDurableExecutionCallbackSuccess` |
| POST | `/cb/v1/stage-failed` | ステージの失敗（`{ error, retryable }`）→ `SendDurableExecutionCallbackFailure` |
| POST | `/cb/v1/artifacts/presign` | 出力をアップロードする presigned URL の発行（そのワークアイテムとステージのプレフィックスに限る） |
| POST | `/cb/v1/checkpoint` | チェックポイントの完了の通知（保存先のキー） |

---

## 6. agentd の HTTP インターフェース（VM 内の 8080 番ポート）

呼び出し元は Lambda（lifecycle hooks）と VM マネージャー（MicroVM のエンドポイント + `X-aws-proxy-auth`）。

| パス | 呼び出し元 | 内容 |
|---|---|---|
| `/aws/lambda-microvms/runtime/v1/ready` | Lambda（ビルド時） | 初期化が終わったら 200、まだなら 503（すぐに返す） |
| `/aws/lambda-microvms/runtime/v1/validate` | Lambda（ビルド時） | 自己テストとイメージ定義の `warmup` |
| `/aws/lambda-microvms/runtime/v1/run` | Lambda（起動時） | `runHookPayload`（`RunPayload`）を受け取り、すぐに 200 を返す |
| `/aws/lambda-microvms/runtime/v1/suspend` / `resume` / `terminate` | Lambda | flush、接続の張り直し、最後の送信 |
| `POST /v1/messages` | VM マネージャー | ユーザーのメッセージ |
| `POST /v1/plan/approve` | VM マネージャー | 計画の承認（ステージ内の承認） |
| `POST /v1/interrupt` | VM マネージャー | 中断 |
| `POST /v1/checkpoint` | VM マネージャー | チェックポイントを作る（設計 §3.8） |
| `GET /v1/files` / `GET /v1/diff` | API | ファイルツリーと差分 |
| `GET /healthz` | VM マネージャー | keepalive。`{ state: 'busy' \| 'idle' }` |

### 6.1 `RunPayload`（`runHookPayload` に JSON で入れる）
```jsonc
{
  "workItemId": "01JC...",
  "stageRunId": "verify#2",
  "vmToken": "<VPC の中でだけ使えるトークン>",
  "callbackBaseUrl": "https://<private-api-id>.execute-api.ap-northeast-1.amazonaws.com/prod",
  "stage": { "id": "verify", "type": "agent", "instructions": "skills/verify.md" },
  "harness": { "type": "claude-code", "model": "<JP の推論プロファイルの ID>" },
  "inputs": { "branch": { "repo": "org/repo", "ref": "factory/01JC.../implement" }, "request": "<依頼の本文>" },
  "network": { "proxy": "http://egress-proxy.internal:3128", "gitGateway": "https://git-gw.internal" },
  "packageSource": "public",
  "restore": null
}
```
- この中身は snapshot には入らない（`/run` のときに渡るだけ）。秘密情報は vmToken だけにする
- **durable execution の callbackId は VM に渡さない**。Callback API が vmToken → `StageRuns` の順に引いて、`SendDurableExecutionCallback*` を呼ぶ（VM が別のステージを完了させることを防ぐ）

---

## 7. Web の実装で足した契約（提案）

`packages/web` を MSW のモックで最後まで動かすために、`packages/contracts` に次の項目を足した。どれも既存の項目を変えない追加で、バックエンドの実装（M1〜M2）で採用するかを決める。型の正は `packages/contracts/src/index.ts`。

### 7.1 イベント
| type / 項目 | 内容 | なぜ要るか |
|---|---|---|
| `message.user`（新規） | messageId、text、author、attachments? | 再読み込みしたときに、ユーザーの発言も履歴（`GET /events`）から組み立て直すため |
| `tool.finished.summary`（追加） | 結果の要約（例: 「4 件のテストが通過」） | 会話の「作業のまとめ」と実行ログに結果を出すため |
| `plan.decided`（新規） | planVersion、decision（approved / changes_requested / rejected）、by、comment? | だれがいつ承認・修正の依頼をしたかを会話に出すため |
| `approval.required.approvalId`（追加） | 再承認の ID | `POST /approvals/{approvalId}` に必要（今の定義では ID が分からない） |
| `approval.resolved`（新規） | approvalId、decision、by | 回答済みのカードにするため。ほかのタブ・端末にも反映するため |
| `preview.ready`（新規） | port、path | プレビューのタブを開けるようになったことを知るため（`POST /previews` に port が要る） |
| `eventId`（配信の封筒） | `FactoryEventEnvelope = FactoryEvent & { eventId }` | WebSocket と `GET /events` で同じ形にし、重複を除くため |

### 7.2 REST
| メソッド | パス | 内容 |
|---|---|---|
| GET | `/me` | ログインしているユーザー（名前、ロール、GitHub の連携状態） |
| POST | `/attachments` | 作成する前の添付の presigned URL（新しい依頼の入力欄から上げるため）。作成時に `CreateWorkItemRequest.attachments` で渡す |
| GET | `/admin/network-profiles`、`/admin/package-sources` | 一覧（§3 は名前ごとの GET / PUT だけだった） |

### 7.3 型
- `WorkItem` に `repo?`、`branch?`、`pullRequest?`、`usage?`、`costUsd?`、`archived` を足した（一覧とヘッダーに出すため）
- `Line` に `title?`、`description?` を足した（画面に出す名前と説明）
- 新規: `PlanRecord`、`StageRun`、`FileTree`、`Diff`、`AttachmentTicket`、`Download`、`Preview`、`PrecheckResult`、`Publication`（と作成・更新の入力）、`Me`、`Repo`、`ImageSpec`、`ImageSummary`、`ImageVersion`、`BuildLog`、`NetworkProfile`、`PackageSource`、`LineDefinition`、`VmInfo`、`Capacity`、`AdminUser`
