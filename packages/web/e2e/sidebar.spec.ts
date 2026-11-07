// サイドパネル（ADR-0010・06_ui_spec.md §6）: 依頼の切り替え、畳む・広げる、1280px 未満で重ねて出す
import { expect, test, type Page } from '@playwright/test';

const fresh = async (page: Page) => {
  await page.goto('/?mock-reset&mock-speed=8');
  await expect(page.getByRole('heading', { name: '新しい依頼' })).toBeVisible();
};

test('サイドパネルから、ホームに戻らずに依頼を切り替えられる', async ({ page }) => {
  await fresh(page);
  const side = page.getByRole('complementary', { name: 'サイドパネル' });
  const list = side.getByRole('navigation', { name: '依頼' });
  await expect(list.getByRole('region', { name: '対応が必要' }).getByRole('link', { name: /週次売上ダッシュボードを追加/ })).toBeVisible();

  await list.getByRole('link', { name: /週次売上ダッシュボードを追加/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: '週次売上ダッシュボードを追加' })).toBeVisible();
  await expect(list.getByRole('link', { name: /週次売上ダッシュボードを追加/ })).toHaveAttribute('aria-current', 'page');

  await list.getByRole('link', { name: /問い合わせフォームの入力チェックを直す/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: '問い合わせフォームの入力チェックを直す' })).toBeVisible();
  await expect(page.getByRole('region', { name: '会話' })).toBeVisible();

  // 検索で絞り込む
  await side.getByRole('searchbox', { name: '依頼を探す' }).fill('部署別');
  await expect(list.getByRole('link', { name: /部署別の売上レポートを作って公開/ })).toBeVisible();
  await expect(list.getByRole('link', { name: /週次売上ダッシュボードを追加/ })).toHaveCount(0);
});

test('畳むとアイコンの列になり、読み込み直しても畳んだまま', async ({ page }) => {
  await fresh(page);
  const side = page.getByRole('complementary', { name: 'サイドパネル' });
  const wide = (await side.boundingBox())!.width;
  await side.getByRole('button', { name: 'サイドパネルを畳む' }).click();
  await expect(side.getByRole('navigation', { name: '依頼' })).toHaveCount(0);
  const rail = (await side.boundingBox())!.width;
  expect(rail).toBeLessThan(wide);
  expect(rail).toBeLessThanOrEqual(64);

  await side.getByRole('link', { name: '公開物' }).click();
  await expect(page).toHaveURL(/\/publications/);
  await page.reload();
  await expect(side.getByRole('button', { name: 'サイドパネルを広げる' })).toBeVisible();

  await page.keyboard.press('ControlOrMeta+b');
  await expect(side.getByRole('navigation', { name: '依頼' })).toBeVisible();
});

test('1280px 未満では、アイコンの列から重ねて広げる', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await fresh(page);
  const side = page.getByRole('complementary', { name: 'サイドパネル' });
  expect((await side.boundingBox())!.width).toBeLessThanOrEqual(64);
  const main = (await page.getByRole('main').boundingBox())!;

  await side.getByRole('button', { name: 'サイドパネルを広げる' }).click();
  const drawer = page.getByRole('dialog', { name: 'サイドパネル' });
  await drawer.getByRole('link', { name: /週次売上ダッシュボードを追加/ }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: '週次売上ダッシュボードを追加' })).toBeVisible();
  // 重ねて出すので、ページの幅は変わらない
  expect((await page.getByRole('main').boundingBox())!.x).toBe(main.x);

  await side.getByRole('button', { name: 'サイドパネルを広げる' }).click();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
});
