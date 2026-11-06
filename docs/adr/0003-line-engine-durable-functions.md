# ADR-0003: ライン実行エンジンに Lambda durable functions を使う

- 状態: Accepted
- 日付: 2026-11-06
- 関連: 要件 D18・FR-LINE / 設計 §3.3

## 背景
ラインはステージを順に実行し、各ステージの完了（VM からの callback）や人の承認を、数時間から数日待つことがある。ライン定義は YAML で、管理者が後から追加する。

## 決定
- **1件のワークアイテムにつき1つの durable execution** を動かす（`@aws/durable-execution-sdk-js` v3、Node.js 24）
- ライン定義はコードで解釈する（定義ごとに状態機械を生成しない）
- ステージの完了は `waitForCallback`（`timeout` と `heartbeatTimeout` 付き）で待つ。VM の heartbeat は Callback API が `SendDurableExecutionCallbackHeartbeat` に中継する
- `RunMicrovm` などの副作用は `ctx.step` の中で行い、冪等キー（`clientToken`）を付ける

## 検討した選択肢
- Step Functions（Standard）: 可視化と運用ツールが優れている。一方で、ライン定義から状態機械を動的に作る必要があり、ループや分岐をライン定義から組み立てるのが複雑になる

## 結果
- 良くなること: ライン定義をそのままコードで解釈でき、テストも普通の TypeScript で書ける。待っている間は料金がかからない（最大1年）
- 悪くなること: replay で先頭から再実行されるため、処理を決定的に書く規律が必要になる（実装計画 §5.1）。新しい仕組みなので、PoC（V11）で挙動を確かめる
