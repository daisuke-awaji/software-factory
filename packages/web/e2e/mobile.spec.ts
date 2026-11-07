// スマホの幅（06_ui_spec.md §6）: 横にはみ出さない・会話と成果物の切り替え・左上のロゴで左から出すサイドパネル・下から出るダイアログ
import { expect, test, type Page } from '@playwright/test';

const fresh = async (page: Page) => {
  await page.goto('/?mock-reset&mock-speed=8');
  await expect(page.getByRole('heading', { name: '新しい依頼' })).toBeVisible();
};

/** サイドパネルを開いて、依頼を選ぶ */
const openItem = async (page: Page, title: RegExp) => {
  await page.getByRole('button', { name: 'サイドパネルを開く' }).click();
  await page.getByRole('dialog', { name: 'サイドパネル' }).getByRole('link', { name: title }).click();
  await expect(page).toHaveURL(/\/t\//);
  await expect(page.getByRole('dialog', { name: 'サイドパネル' })).toHaveCount(0);
};

/** ページ全体が、画面の幅より広くならない（横スクロールが出ない） */
const expectNoHorizontalScroll = async (page: Page) => {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(width);
};

test('ホーム: 入力欄だけを出し、横にはみ出さない', async ({ page }) => {
  await fresh(page);
  await expect(page.getByLabel('依頼の内容')).toBeVisible();
  await expect(page.getByRole('region', { name: '対応が必要な項目' })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'サイドパネル' })).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  // iOS が拡大しないように、入力欄の文字は 16px 以上
  const size = await page.getByLabel('依頼の内容').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);
});

/** 指で左へなぞる（Touch を作って送る） */
const swipeLeft = async (page: Page, selector: string, from: number, to: number, y = 300) => {
  await page.evaluate(
    ({ selector, from, to, y }) => {
      const el = document.querySelector(selector)!;
      const at = (x: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
      el.dispatchEvent(new TouchEvent('touchstart', { touches: [at(from)], bubbles: true }));
      for (let x = from; x >= to; x -= 20) el.dispatchEvent(new TouchEvent('touchmove', { touches: [at(x)], bubbles: true }));
      el.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true }));
    },
    { selector, from, to, y },
  );
};

test('左上のロゴでサイドパネルを左から出し、ほかの画面に移れる', async ({ page }) => {
  await fresh(page);
  const logo = page.getByRole('button', { name: 'サイドパネルを開く' });
  const logoBox = (await logo.boundingBox())!;
  expect(logoBox.x).toBeLessThan(24);
  expect(logoBox.y).toBeLessThan(80);
  await logo.click();
  const drawer = page.getByRole('dialog', { name: 'サイドパネル' });
  await expect(drawer.getByRole('navigation', { name: '依頼' })).toBeVisible();
  // 左の端に付いて出る（滑り込み終わると x = 0）
  await expect.poll(async () => Math.round((await drawer.boundingBox())!.x)).toBe(0);
  await expect(logo).toHaveAttribute('aria-expanded', 'true');
  await expectNoHorizontalScroll(page);

  // 過去の依頼も出る
  await expect(drawer.getByRole('region', { name: 'それより前' })).toBeAttached();

  // 左へなぞると閉じる
  await swipeLeft(page, '[role="dialog"][aria-label="サイドパネル"]', 220, 40);
  await expect(drawer).toHaveCount(0);

  await logo.click();
  await expect(drawer.getByRole('navigation', { name: '依頼' })).toBeVisible();
  await drawer.getByRole('link', { name: '公開物' }).click();
  await expect(page).toHaveURL(/\/publications/);
  await expect(drawer).toHaveCount(0);

  // 外側を押しても閉じる
  await page.getByRole('button', { name: 'サイドパネルを開く' }).click();
  await page.mouse.click(page.viewportSize()!.width - 10, 300);
  await expect(drawer).toHaveCount(0);

  await page.goto('/requests');
  await expect(page.getByRole('list', { name: '依頼の一覧' })).toBeVisible();
  await expect(page.getByRole('table', { name: '依頼の一覧' })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  for (const path of ['/publications', '/images', '/workflows', '/settings', '/admin']) {
    await page.goto(path);
    await expect(page.getByRole('main')).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
});

test('ワークスペース: 会話と成果物を切り替えて、計画を承認できる', async ({ page }) => {
  await fresh(page);
  await openItem(page, /週次売上ダッシュボードを追加/);

  // 上の細いバーは隠し、サイドパネルはワークスペースのヘッダーから開く
  await expect(page.getByRole('link', { name: 'Software Factory', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'サイドパネルを開く' })).toBeVisible();

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
  await openItem(page, /問い合わせフォームの入力チェックを直す/);
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
  await openItem(page, /部署別の売上レポートを作って公開/);
  await page.getByRole('region', { name: '会話' }).getByRole('region', { name: '成果物' }).getByRole('button', { name: '公開する' }).click();
  const dialog = page.getByRole('dialog', { name: '社内に公開' });
  await expect(dialog.getByText(/問題はありません/)).toBeVisible();
  const box = (await dialog.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(Math.round(box.width)).toBe(vp.width);
  expect(Math.round(box.y + box.height)).toBe(vp.height);
});
