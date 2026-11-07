// 主要な画面の流れ（作成 → 計画 → 承認 → ストリーミング → 成果物）を、ブラウザの MSW で確かめる
import { expect, test, type Page } from '@playwright/test';

const fresh = async (page: Page, path = '/') => {
  await page.goto(`${path}?mock-reset&mock-speed=8`);
  await expect(page.getByRole('navigation', { name: '依頼' }).getByRole('link').first()).toBeVisible();
};

test('依頼を出して、計画を承認すると、検証のやり直しを経て PR とプレビューが届く', async ({ page }) => {
  await fresh(page);
  await page.getByLabel('依頼の内容').fill('問い合わせフォームで、メールアドレスが正しくなくても送信できます。入力チェックを直してください。');
  await page.getByLabel('リポジトリ').selectOption('acme/support-site');
  await page.getByRole('button', { name: '依頼する' }).click();
  await expect(page).toHaveURL(/\/t\//);

  const chat = page.getByRole('region', { name: '会話' });
  await chat.getByRole('button', { name: '承認して開始' }).click();
  await expect(chat.getByText(/に承認しました/)).toBeVisible();
  // 検証で一度失敗して、実装に戻る
  await expect(chat.getByText('検証（2 回目）')).toBeVisible({ timeout: 40_000 });
  const deliver = chat.getByRole('region', { name: '成果物' });
  await expect(deliver).toBeVisible({ timeout: 40_000 });
  await expect(page.getByRole('button', { name: /PR #\d+/ })).toBeVisible();

  // プレビュー: VM の中のフォームを iframe で開き、誤った入力を送ると、欄の下に理由が出る
  await deliver.getByRole('button', { name: '開く' }).click();
  const frame = page.frameLocator('iframe[title="プレビュー"]');
  await frame.getByLabel('メール').fill('yamada@');
  await frame.getByRole('button', { name: '送信' }).click();
  await expect(frame.getByText('メールアドレスの形式が正しくありません')).toBeVisible();

  // 変更のタブに差分が出る
  await page.getByRole('tab', { name: /変更/ }).click();
  await expect(page.getByRole('navigation', { name: '変更したファイル' }).getByText('src/contact-form.ts')).toBeVisible();
});

test('外部への通信の再承認に答えると、作業が続く', async ({ page }) => {
  await fresh(page);
  await page.getByRole('link', { name: '週次売上ダッシュボードを追加' }).click();
  const chat = page.getByRole('region', { name: '会話' });
  await chat.getByRole('button', { name: '承認して開始' }).click();
  const card = chat.getByRole('region', { name: '外部への通信の承認' });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(chat.getByText(/cdn\.jsdelivr\.net への通信を、許可リストで止めました/)).toBeVisible();
  await card.getByRole('button', { name: '許可する' }).click();
  await expect(card.getByText(/許可しました/)).toBeVisible();
  await expect(chat.getByRole('region', { name: '成果物' })).toBeVisible({ timeout: 40_000 });
});

test('再読み込みしても、会話と状態は履歴から組み立て直される', async ({ page }) => {
  await fresh(page);
  await page.getByRole('link', { name: '週次売上ダッシュボードを追加' }).click();
  const chat = page.getByRole('region', { name: '会話' });
  // 承認待ちのときは、入力欄から送っても修正の依頼になる
  await chat.getByLabel('メッセージ').fill('グラフは折れ線にしてください');
  await chat.locator('form').getByRole('button', { name: '修正を依頼' }).click();
  await expect(chat.getByRole('region', { name: '計画 第2版' })).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(chat.getByRole('region', { name: '計画 第2版' })).toBeVisible();
  await expect(chat.getByText('グラフは折れ線にしてください').first()).toBeVisible();
});

test('完了した依頼の成果物を、社内に公開できる', async ({ page }) => {
  await fresh(page);
  await page.getByRole('link', { name: '部署別の売上レポートを作って公開' }).click();
  await page.getByRole('region', { name: '成果物' }).getByRole('button', { name: '公開する' }).click();
  const dialog = page.getByRole('dialog', { name: '社内に公開' });
  await expect(dialog.getByText(/問題はありません/)).toBeVisible();
  await dialog.getByRole('textbox', { name: 'グループ' }).fill('営業企画部');
  await dialog.getByRole('button', { name: '公開する' }).click();
  await expect(page.getByRole('dialog', { name: '公開しました' }).getByText(/cloudfront\.net/)).toBeVisible();
  await page.getByRole('button', { name: '公開物の一覧へ' }).click();
  await expect(page.getByRole('table', { name: '公開物の一覧' }).getByRole('row')).toHaveCount(3);
});
