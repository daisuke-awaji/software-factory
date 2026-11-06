# バックログ（GitHub Issues に起票する元データ）

- 優先度: **P0** = そのマイルストーンの完了に必須 / **P1** = 入れたい / **P2** = 余裕があれば
- ラベル: `M0`〜`M4`、`area/{infra,web,api,engine,vm,agentd,proxy,image,security,docs}`、`priority/{p0,p1,p2}`
- 各項目の「完了条件」を Issue の受け入れ条件にする

## M0: PoC とアカウントの準備

| ID | タイトル | area | 優先度 | 完了条件 |
|---|---|---|---|---|
| M0-01 | 新規アカウントのクォータ申請と Bedrock のモデルアクセスの有効化 | infra | P0 | 設計 §10.2 の項目を申請した。申請の状況を Issue に記録した |
| M0-02 | PoC V1: ルートのない subnet + LNC + egress プロキシ（CONNECT と allowlist） | proxy, infra | P0 | 許可したドメインにだけつながる。拒否した通信が構造化ログに残る |
| M0-03 | PoC V9 / V5 / V6: idle と suspend の判定、auto-resume、クォータの数え方 | vm | P0 | 挙動を docs に記録し、設計 §3.7 を確定した（変更があれば ADR を書いた） |
| M0-04 | PoC V11: durable functions の waitForCallback、heartbeat、VM の引き継ぎ | engine | P0 | 引き継いでも中断なく再開できる。heartbeat が途切れたら失敗として検知できる |
| M0-05 | PoC V2 / V13: プレビュー（チケット → cookie、CHIPS、WebSocket の HMR）と3つのオリジンの分離 | proxy, security | P0 | Chrome / Edge / Safari で動く。別のディストリビューションから cookie を読めない |
| M0-06 | PoC V4: エージェント1台あたりの TPM の計測 | vm | P0 | 3種類のタスクの計測値があり、TPM のクォータの申請値を決めた |
| M0-07 | PoC V12 / V15: カスタムイメージのビルド（ビルドの通信、合成、/validate） | image | P0 | 15分以内にビルドでき、そのイメージで VM を起動できる |
| M0-08 | PoC V3: snapshot 起動・resume・復元の時間の計測 | vm | P1 | 3つの値を計測し、NFR-01 と比べた |
| M0-09 | PoC V7: Git ゲートウェイでのトークンの付与と、push の ref の検査 | proxy, security | P1 | `factory/*` 以外への push を拒否できる |
| M0-10 | PoC V8 / V14: Lambda@Edge + Cognito による公開物の認可と、CSP の sandbox の互換性 | security | P1 | 許可されていない人には 403。代表的な HTML のレポートが正しく表示される |
| M0-11 | PoC V10: LNC を使ったときの送信元 IP の分かれ方 | proxy | P2 | 結果を記録した |

## M1: 基盤と chat ラインの最小版

| ID | タイトル | area | 優先度 | 完了条件 |
|---|---|---|---|---|
| M1-01 | モノレポの雛形（pnpm、tsconfig、ESLint、Prettier、Vitest）と CI（ci.yml） | docs, infra | P0 | `pnpm typecheck / lint / test` が CI で緑になる |
| M1-02 | `packages/contracts` の作成（samples から移す）と依存ルール（no-restricted-imports） | api, web | P0 | 契約の単体テストが通る。web から AWS SDK を import すると lint で落ちる |
| M1-03 | CDK: Network（VPC、subnet、SG、VPC エンドポイント、LNC） | infra | P0 | CDK の assertions で「mvm subnet にインターネットへのルートがない」ことを確認する |
| M1-04 | CDK: Data（DynamoDB、S3、KMS）/ Auth（Cognito、IdP 連携） | infra | P0 | デプロイでき、SSO でログインできる |
| M1-05 | factory-base イメージ（L1）と base イメージ | image, agentd | P0 | `CfnMicrovmImage` でビルドでき、/ready と /validate が通る |
| M1-06 | agentd の最小版（/run、/v1/messages、Claude Agent SDK、イベントの送信） | agentd | P0 | VM の中でエージェントが応答し、イベントが Callback API に届く |
| M1-07 | Callback API（プライベート REST API + Hono、vmToken の認証） | api | P0 | VPC エンドポイント以外からは到達できない。vmToken が失効したら 401 |
| M1-08 | API: ワークアイテムの作成・取得・メッセージの送信（Hono + zod-openapi） | api | P0 | ルートのテストが通る。`/openapi.json` を出力できる |
| M1-09 | WebSocket API（$connect / $default / 配信）と取りこぼしの補完（events?after=） | api | P0 | 再接続しても取りこぼしがない |
| M1-10 | エンジン: chat ライン（workbench の1ステージ）と VM マネージャー（受付制御、RunMicrovm） | engine, vm | P0 | Web からの依頼で VM が起動し、終わると終了する。二重に起動しない |
| M1-11 | Web: 一覧とチャット（ストリーミング、ツールの実行状況）。MSW のモード | web | P0 | MSW のモードで全画面が動く。結合テストが通る |
| M1-12 | CDK: Frontend（App のディストリビューション）と deploy-dev.yml（OIDC） | infra | P1 | main への push で dev にデプロイされる |

## M2: 計画の承認・リポジトリ連携・プレビュー

| ID | タイトル | area | 優先度 | 完了条件 |
|---|---|---|---|---|
| M2-01 | 計画の提示と承認（plan.proposed、承認カード、ステージ内の承認） | agentd, api, web | P0 | 承認するまで実行が始まらない |
| M2-02 | 再承認（範囲の変更、egress、予算、時間）と approval.required | engine, web | P0 | 4種類のトリガーで作業が止まり、承認すると再開する |
| M2-03 | egress プロキシの本実装（ネットワークプロファイル L0〜L2、拒否時の印、ログ） | proxy | P0 | ブロックされた通信がチャットに表示される |
| M2-04 | パッケージソースのプロファイル（public）と起動フックでの設定の生成 | agentd | P0 | npm / pip がプロキシ経由で動く |
| M2-05 | GitHub App（ユーザーごとの連携）と、使えるリポジトリの一覧 | api | P0 | 本人の権限と App のインストール先が重なるリポジトリだけが出る |
| M2-06 | Git ゲートウェイ（トークンの付与、計画で許可したリポジトリの確認、ref の検査） | proxy, security | P0 | 保護ブランチへの push が拒否されることをテストで確かめた |
| M2-07 | deliver ステージ（PR の作成、説明の自動生成、AI生成のラベル） | engine, api | P0 | PR に計画・テスト結果・依頼者が載る |
| M2-08 | ブランチ保護がないリポジトリへの警告と、書き込みの禁止の設定 | api | P1 | 管理者の設定で禁止できる |
| M2-09 | ライブプレビュー（Preview のディストリビューション、プレビュープロキシ、iframe と別タブ） | proxy, web | P0 | UC2 が dev 環境で通る |
| M2-10 | suspend / resume と keepalive、8時間の引き継ぎ（チェックポイント） | vm, agentd | P0 | 7時間30分で自動的に引き継がれ、会話が続く |
| M2-11 | ファイルツリー・差分・添付・ダウンロード | web, api | P1 | zip でダウンロードできる |

## M3: カスタムイメージと多段のライン

| ID | タイトル | area | 優先度 | 完了条件 |
|---|---|---|---|---|
| M3-01 | ImageSpec の契約と静的検証（使える命令、base の固定、上限） | image | P0 | 禁止した命令（ENTRYPOINT など）を拒否する |
| M3-02 | Dockerfile の合成（L1 → L2 → L3）とビルド（Create / UpdateMicrovmImage、ビルドの監視） | image | P0 | ユーザーの定義からイメージができ、L3 の再設定が効いている |
| M3-03 | イメージのカタログ（バージョン、公開範囲、自動の整理）と UI | image, web | P0 | 個人とプロジェクトの範囲で使える |
| M3-04 | 既定のイメージ（web / data） | image | P0 | web で Playwright、data で pandas が動く |
| M3-05 | build-verify ライン（多段、ステージ間の受け渡し、fail で戻る） | engine | P0 | 検証で失敗すると実装に戻り、maxLoops で止まる |
| M3-06 | ラインの登録（管理者、YAML の検証、バージョン） | api | P1 | 不正な定義を登録時に拒否する |
| M3-07 | ステージの UI（進捗、ステージごとのログと成果物） | web | P1 | どのステージにいるかが分かる |

## M4: 社内公開・管理・パイロット

| ID | タイトル | area | 優先度 | 完了条件 |
|---|---|---|---|---|
| M4-01 | 公開前のチェック（secret、サイズ、絶対パス、外部の参照） | api, security | P0 | secret を含む公開を止める |
| M4-02 | 社内公開（S3 + Publish のディストリビューション + Lambda@Edge、ACL、CSP の sandbox） | infra, security | P0 | 範囲外の人には 403 |
| M4-03 | 公開物の管理（一覧、再公開、公開停止、有効期限） | web, api | P0 | 公開を停止するとすぐに見られなくなる |
| M4-04 | 管理画面（allowlist、パッケージソース、VM の一覧と強制停止、クォータ） | web, api | P0 | 管理者が UI だけで設定を変えられる |
| M4-05 | 監査ログ（EventBridge → Firehose → S3 Object Lock）と CloudTrail | infra, security | P0 | 承認・公開・拒否・管理操作が改ざんできない形で残る |
| M4-06 | コストの表示と、セッションごとの予算の上限 | api, web | P0 | 上限に達すると作業が止まり、承認を求める |
| M4-07 | メール通知（承認待ち、完了、失敗、PR の作成） | api | P1 | |
| M4-08 | セキュリティテストのスイート（egress、保護ブランチ、公開物から App への攻撃） | security | P0 | すべて通る |
| M4-09 | 運用手順書（デプロイ、クォータの監視、障害時の対応） | docs | P1 | |
| M4-10 | 10人でのパイロット（LoB のユーザーテストを含む） | docs | P0 | UC1 を研修なしで完了できる |
