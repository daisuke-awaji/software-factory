# ADR-0005: App / Preview / Publish を3つの CloudFront ディストリビューションに分ける

- 状態: Accepted
- 日付: 2026-11-06
- 関連: 要件 D6・D8・D12・D16 / 設計 §7

## 背景
プレビューと社内公開では、エージェントが作った（信頼できない）HTML や JS を配信する。独自ドメインは使わず、CloudFront の既定ドメインを使う（D12）。

## 決定
- App（SPA と API）、Preview、Publish を**別々のディストリビューション**（別の `*.cloudfront.net`）にして、オリジンと cookie を分ける
- App は cookie で認証しない（JWT をメモリで持つ）
- Preview は一回限りのチケットから cookie（`HttpOnly; Secure; SameSite=None; Partitioned`）を発行し、cookie で宛先の VM を決める。そのため、**同時に開けるプレビューは1ブラウザに1つ**（D16）
- Publish は Lambda@Edge で Cognito の JWT と ACL を確かめる。CSP の `sandbox`（`allow-same-origin` なし）で、公開物どうしも分ける

## 結果
- 良くなること: 信頼できないコードが App の認証情報や API に触れられない
- 悪くなること: プレビューは1ブラウザに1つ。sandbox の中では `localStorage` が使えないので、それを使う HTML は公開しても動かない（公開前に警告する）。独自ドメインを使えるようになれば、サブドメインで分けて解消できる
