// サイドパネル（ADR-0010・06_ui_spec.md §6）: タスクの切り替え、過去のタスクと続きの読み込み、畳む・広げる（左上のロゴ）、1280px 未満で左から重ねて出す
import { expect, test, type Page } from '@playwright/test';

const fresh = async (page: Page) => {
  await page.goto('/?mock-reset&mock-speed=8');
  await expect(page.getByRole('heading', { name: '新しいタスク' })).toBeVisible();
};

test('サイドパネルから、ホームに戻らずにタスクを切り替えられる', async ({ page }) => {
  await fresh(page);
  const side = page.getByRole('complementary', { name: 'サイドパネル' });
  const list = side.getByRole('navigation', { name: 'タスク' });
  await expect(list.getByRole('region', { name: '対応が必要' }).getByRole('link', { name: /週次売上ダッシュボードを追加/ })).toBeVisible();

  await list.getByRole('link', { name: /週次売上ダッシュボードを追加/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: '週次売上ダッシュボードを追加' })).toBeVisible();
  await expect(list.getByRole('link', { name: /週次売上ダッシュボードを追加/ })).toHaveAttribute('aria-current', 'page');

  await list.getByRole('link', { name: /問い合わせフォームの入力チェックを直す/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: '問い合わせフォームの入力チェックを直す' })).toBeVisible();
  await expect(page.getByRole('region', { name: '会話' })).toBeVisible();

  // 検索で絞り込む
  await side.getByRole('searchbox', { name: 'タスクを探す' }).fill('部署別');
  await expect(list.getByRole('link', { name: /部署別の売上レポートを作って公開/ })).toBeVisible();
  await expect(list.getByRole('link', { name: /週次売上ダッシュボードを追加/ })).toHaveCount(0);
});

test('過去のタスクを日付で分けて出し、下までスクロールすると続きを読む', async ({ page }) => {
  await fresh(page);
  const list = page.getByRole('complementary', { name: 'サイドパネル' }).getByRole('navigation', { name: 'タスク' });
  await expect(list.getByRole('region', { name: 'それより前' })).toBeVisible();
  const oldest = list.getByRole('link', { name: /セッションの有効期限を延ばす/ });
  await expect(oldest).toHaveCount(0);
  const before = await list.getByRole('link').count();

  await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect(oldest).toBeVisible();
  expect(await list.getByRole('link').count()).toBeGreaterThan(before);
  await expect(list.getByRole('button', { name: '続きを読み込む' })).toHaveCount(0);

  await oldest.click();
  await expect(page.getByRole('heading', { level: 1, name: 'セッションの有効期限を延ばす' })).toBeVisible();
  await expect(oldest).toHaveAttribute('aria-current', 'page');
});

test('長いタイトルは … で切り、一覧は横にスクロールしない', async ({ page }) => {
  await fresh(page);
  const list = page.getByRole('complementary', { name: 'サイドパネル' }).getByRole('navigation', { name: 'タスク' });
  await expect(list.getByRole('region', { name: 'それより前' })).toBeVisible();
  const overflow = await list.evaluate((el) => {
    el.scrollLeft = 200;
    return { left: el.scrollLeft, over: el.scrollWidth - el.clientWidth };
  });
  expect(overflow).toEqual({ left: 0, over: 0 });
});

test('読み込んでいる間は、一覧の形だけを先に出す', async ({ page }) => {
  await fresh(page);
  // API の応答を遅らせて、読み込み中の枠を見る（MSW の前で止める）
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      if (String(args[0] instanceof Request ? args[0].url : args[0]).includes('/api/v1/tasks'))
        await new Promise((r) => setTimeout(r, 1500));
      return original(...args);
    };
  });
  await page.reload();
  const list = page.getByRole('complementary', { name: 'サイドパネル' }).getByRole('navigation', { name: 'タスク' });
  await expect(list.locator('[aria-busy="true"]')).toBeVisible();
  await expect(list.getByRole('status')).toHaveText('タスクを読み込んでいます');
  await expect(list.getByRole('region', { name: '対応が必要' })).toBeVisible();
  await expect(list.locator('[aria-busy="true"]')).toHaveCount(0);
});

test('畳むとアイコンの列になり、読み込み直しても畳んだまま', async ({ page }) => {
  await fresh(page);
  const side = page.getByRole('complementary', { name: 'サイドパネル' });
  const wide = (await side.boundingBox())!.width;
  await side.getByRole('button', { name: 'サイドパネルを畳む' }).click();
  await expect(side.getByRole('navigation', { name: 'タスク' })).toHaveCount(0);
  const rail = (await side.boundingBox())!.width;
  expect(rail).toBeLessThan(wide);
  expect(rail).toBeLessThanOrEqual(64);

  await side.getByRole('link', { name: '公開物' }).click();
  await expect(page).toHaveURL(/\/publications/);
  await page.reload();
  // 畳んだ列の左上はロゴ。押すと広がる
  const logo = side.getByRole('button', { name: 'サイドパネルを広げる' });
  await expect(logo).toBeVisible();
  const box = (await logo.boundingBox())!;
  expect(box.y).toBeLessThan(40);
  await logo.click();
  await expect(side.getByRole('navigation', { name: 'タスク' })).toBeVisible();
  await side.getByRole('button', { name: 'サイドパネルを畳む' }).click();

  await page.keyboard.press('ControlOrMeta+b');
  await expect(side.getByRole('navigation', { name: 'タスク' })).toBeVisible();
});

test('1280px 未満では、アイコンの列から重ねて広げる', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await fresh(page);
  const side = page.getByRole('complementary', { name: 'サイドパネル' });
  expect((await side.boundingBox())!.width).toBeLessThanOrEqual(64);
  const main = (await page.getByRole('main').boundingBox())!;

  await side.getByRole('button', { name: 'サイドパネルを広げる' }).click();
  const drawer = page.getByRole('dialog', { name: 'サイドパネル' });
  await expect.poll(async () => Math.round((await drawer.boundingBox())!.x)).toBe(0);
  await drawer.getByRole('link', { name: /週次売上ダッシュボードを追加/ }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: '週次売上ダッシュボードを追加' })).toBeVisible();
  // 重ねて出すので、ページの幅は変わらない
  expect((await page.getByRole('main').boundingBox())!.x).toBe(main.x);

  await side.getByRole('button', { name: 'サイドパネルを広げる' }).click();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
});
