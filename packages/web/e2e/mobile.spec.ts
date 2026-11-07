// スマホの幅（06_ui_spec.md §6）: 横にはみ出さない・会話と成果物の切り替え・右上のメニュー・下から出るダイアログ
import { expect, test, type Page } from '@playwright/test';

const fresh = async (page: Page) => {
  await page.goto('/?mock-reset&mock-speed=8');
  await expect(page.getByRole('list', { name: '依頼の一覧' })).toBeVisible();
};

/** ページ全体が、画面の幅より広くならない（横スクロールが出ない） */
const expectNoHorizontalScroll = async (page: Page) => {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(width);
};

test('ホーム: 対応が必要な項目が先頭に出て、一覧はカードになる', async ({ page }) => {
  await fresh(page);
  const inbox = page.getByRole('region', { name: '対応が必要な項目' });
  const list = page.getByRole('list', { name: '依頼の一覧' });
  await expect(inbox).toBeVisible();
  const [inboxBox, listBox] = [await inbox.boundingBox(), await list.boundingBox()];
  expect(inboxBox!.y).toBeLessThan(listBox!.y);
  await expect(page.getByRole('table', { name: '依頼の一覧' })).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  // iOS が拡大しないように、入力欄の文字は 16px 以上
  const size = await page.getByLabel('依頼の内容').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);
});

test('右上のメニューから、ほかの画面に移れる', async ({ page }) => {
  await fresh(page);
  await expect(page.getByRole('navigation', { name: 'メイン', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'メニュー' }).click();
  await page.getByRole('navigation', { name: 'メイン（メニュー）' }).getByRole('link', { name: '公開物' }).click();
  await expect(page).toHaveURL(/\/publications/);
  await expect(page.getByRole('navigation', { name: 'メイン（メニュー）' })).toHaveCount(0);
  for (const path of ['/publications', '/images', '/lines', '/settings', '/admin']) {
    await page.goto(path);
    await expect(page.getByRole('main')).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
});

test('ワークスペース: 会話と成果物を切り替えて、計画を承認できる', async ({ page }) => {
  await fresh(page);
  await page.getByRole('link', { name: /週次売上ダッシュボードを追加/ }).click();
  await expect(page).toHaveURL(/\/w\//);

  // 上部のナビゲーションは隠し、戻るボタンを出す
  await expect(page.getByRole('link', { name: '依頼の一覧に戻る' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'メニュー' })).toBeHidden();

  const views = page.getByRole('tablist', { name: '表示の切り替え' });
  const chat = page.getByRole('region', { name: '会話' });
  const work = page.locator('#view-work');
  await expect(chat.getByRole('region', { name: '計画 第1版' })).toBeVisible();
  await expect(work).toBeHidden();

  await views.getByRole('tab', { name: '成果物' }).click();
  await expect(work).toBeVisible();
  await expect(chat).toBeHidden();
  await expect(work.getByRole('tab', { name: '計画' })).toHaveAttribute('aria-selected', 'true');
  await expectNoHorizontalScroll(page);

  await views.getByRole('tab', { name: '会話' }).click();
  await chat.getByRole('button', { name: '承認して開始' }).click();
  await expect(chat.getByText(/に承認しました/)).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('ワークスペース: 会話の「ログ」から、成果物の実行ログに切り替わる', async ({ page }) => {
  await fresh(page);
  await page.getByRole('link', { name: /問い合わせフォームの入力チェックを直す/ }).click();
  const chat = page.getByRole('region', { name: '会話' });
  await chat.getByRole('button', { name: 'ログ' }).first().click();
  const work = page.locator('#view-work');
  await expect(work).toBeVisible();
  await expect(work.getByRole('tab', { name: '実行ログ' })).toHaveAttribute('aria-selected', 'true');

  // PR は、その他の操作のメニューから開く
  await page.getByRole('button', { name: 'その他の操作' }).click();
  await expect(page.getByRole('menuitem', { name: /PR #\d+ を開く/ })).toBeVisible();
});

test('ダイアログは、画面の下から出るシートになる', async ({ page }) => {
  await fresh(page);
  await page.getByRole('link', { name: /部署別の売上レポートを作って公開/ }).click();
  await page.getByRole('region', { name: '会話' }).getByRole('region', { name: '成果物' }).getByRole('button', { name: '公開する' }).click();
  const dialog = page.getByRole('dialog', { name: '社内に公開' });
  await expect(dialog.getByText(/問題はありません/)).toBeVisible();
  const box = (await dialog.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(Math.round(box.width)).toBe(vp.width);
  expect(Math.round(box.y + box.height)).toBe(vp.height);
});
