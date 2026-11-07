# ADR-0008: UI の部品は AffectUI の無料の部品を取り込んで持ち、スタイルは CSS Modules とデザイントークンにする

- 状態: Proposed
- 日付: 2026-11-07
- 関連: 実装計画 §2.2（「CSS Modules は、デザインシステムが決まったら見直す」）/ ADR-0006

## 背景
UI モックは、AffectUI の無料の部品（Button、Segmented Control、Tool Call Card、Thinking Loader、Decision Inbox、Message Actions、Profile Menu など）と、グローバルの CSS 変数で作った。製品の実装に入る前に、次の3つを決める必要があった。

1. **Pro を買うか**: Pro の Approval Card と Chat Composer は、承認カード（M2-01）と入力欄にそのまま当たる
2. **型チェックの例外**: AffectUI の4つのファイルが `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` で型エラーになる
3. **スタイルの方式**: CSS Modules に寄せるか、モックの書き方（グローバルの CSS）を正式にするか

## 決定
- **Pro は今は買わない。** 承認カードと入力欄は、AffectUI のトレーとカードの構造に合わせて自作する（`features/workitem/Cards.tsx`・`Composer.tsx`）。パイロットの後に、作り直す手間とライセンスの条件（社内での利用、再配布の範囲）を比べて見直す
- **AffectUI の部品は `packages/web/src/components/ui/` にコピーして持ち、型エラーは最小限の修正で直す**（型チェックの対象から外さない）。直した箇所はファイルの先頭に書き、上流の更新を取り込むときは差分で確かめる。英語の文言は日本語にした（FR-UI-09）
- **アプリの部品は CSS Modules で書き、色・角丸・影はデザイントークン（`styles/tokens.css` の CSS 変数）だけを使う。** グローバルの CSS は、リセットと数個のユーティリティ（`.sr-only`、`.mono` など）だけにする。ダークモードは `<html data-theme="dark" class="dark">` で切り替え、AffectUI の部品も同じ条件で切り替わる
- 追加の UI ライブラリ（Tailwind、Radix など）は入れない。ダイアログは `<dialog>`、メニューは小さな自作の部品にする

## 検討した選択肢
| 論点 | 選択肢 | 判断 |
|---|---|---|
| 部品 | Pro を買う | 承認カードと入力欄は助かるが、MVP の画面で必要な挙動（計画の修正の依頼、再承認の理由）に合わせて結局は手を入れる。ライセンスの確認が先に要る |
| 型エラー | `components/ui` を型チェックから外す | 取り込んだ部品の型の誤りに気づけなくなる。修正は4ファイル・数行で済んだ |
| スタイル | グローバルの CSS を正式にする | クラス名が衝突しやすく、画面が増えると壊れやすい。トークンは同じ CSS 変数を使えるので、モックからの移行は機械的にできた |

## 結果
- 良くなること: 依存が増えない（I1・I4 の方針と同じ）。部品の見た目がトークンで揃う。型の厳しさを全体で保てる
- 悪くなること: AffectUI の更新を自動では受け取れない。承認カードと入力欄を自分で保守する
