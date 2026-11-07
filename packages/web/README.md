# @factory/web

ソフトウェアファクトリーの Web 画面（React 19 / Vite 8 / Zustand 5 / React Router 8 / MSW 3 / Zod 4）。
バックエンドがなくても、**MSW のモックで全画面を最後まで操作できます**（[ADR-0009](../../docs/adr/0009-mock-backend-simulator.md)）。

## 動かす

```bash
corepack enable          # pnpm 12（ルートの packageManager で固定）
pnpm install
pnpm --filter @factory/web dev     # http://localhost:5173（VITE_API_MOCK=true）
```

| URL のパラメーター | 内容 |
|---|---|
| `?mock-reset` | モックのデータ（ブラウザの localStorage）を作り直す |
| `?mock-speed=5` | シミュレーターを 5 倍の速さで流す（設定の画面からも変えられる） |

設定の画面（右上のアカウント → 設定）では、モックのときだけ、進む速さ・管理者の切り替え・GitHub の連携・データの作り直しを操作できます。

## GitHub Pages のデモ

`main` に push すると、`.github/workflows/pages.yml` がモックつきでビルドし、https://daisuke-awaji.github.io/software-factory/ に公開します。

```bash
PAGES_BASE=/software-factory/ pnpm --filter @factory/web build:pages   # dist-pages/ に出力（404.html は深いリンク用）
```

- `vite build --base` でベースのパスを付け、React Router の `basename` と MSW の Service Worker の場所・範囲（scope）も同じパスに合わせる
- GitHub Pages は SPA のルーティングを知らないので、`index.html` を `404.html` にも置き、`/w/:id` などを直接開けるようにする
- API と WebSocket は Service Worker と MSW が受けるため、外へは通信しない。データはブラウザの localStorage だけに残る

## テスト

```bash
pnpm --filter @factory/web typecheck
pnpm --filter @factory/web test    # Vitest: モックのバックエンド・畳み込み・EventStream・画面の結合（MSW を Node で動かす）
pnpm --filter @factory/web e2e     # Playwright: ブラウザの MSW で、作成 → 承認 → 検証のやり直し → PR → プレビュー → 公開
```

E2E を初めて動かすときは `pnpm --filter @factory/web exec playwright install --with-deps chromium` を実行します。

## 構成

```
src/
├─ main.tsx              # VITE_API_MOCK=true のときだけ MSW を起動する（モックは本番のビルドに入らない）
├─ app/                  # ルーティング（docs/06_ui_spec.md §1）とアプリの枠
├─ lib/
│  ├─ api.ts             # 型付きの API クライアント（応答は必ず contracts で検証する）
│  ├─ events.ts          # WebSocket の受信。再接続したら GET /events?after= で取りこぼしを埋める
│  └─ session.ts         # イベントを畳み込む純粋な関数（会話・計画・承認・ステージ・ツール）
├─ stores/               # Zustand: 画面の状態（テーマ・タブ・通知）と、開いている依頼のセッションだけ
├─ components/
│  ├─ ui/                # AffectUI の無料の部品（取り込んで持つ: ADR-0008）
│  ├─ kit.tsx            # アプリの小さな部品（タグ・ダイアログ・メニュー・フォーム）
│  └─ StageLine.tsx      # ラインの進み具合
├─ features/             # 画面ごと（home / workitem / publications / images / lines / admin / settings）
├─ mocks/                # MSW のハンドラー・インメモリの DB・シミュレーター・シード
└─ styles/               # デザイントークン（tokens.css）とリセット（global.css）
```

## 約束ごと
- サーバーの状態は `useResource` + apiClient で読む。Zustand には置かない（実装計画 §5.2）
- WebSocket のイベントは `useSessionStore.applyEvent()` の1か所で畳み込む。古いイベントが後から届いたら、順に並べ直して畳み込み直す
- 色・角丸・影は `styles/tokens.css` の変数だけを使う。部品は CSS Modules で書く
- 画面の言葉は [06 UI 仕様 §4](../../docs/06_ui_spec.md) に揃える
