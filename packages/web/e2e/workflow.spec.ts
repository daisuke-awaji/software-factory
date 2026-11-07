// ワークフローの図（ADR-0012）: 見る・実行の様子を見る・図で編集して登録する
import { expect, test, type Page } from '@playwright/test';

const fresh = async (page: Page) => {
  await page.goto('/?mock-reset&mock-speed=8');
  await expect(page.getByRole('heading', { name: '新しいタスク' })).toBeVisible();
};
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

/** ノードの右の点（out）や下の点（loop-out）から、別のノードへドラッグしてつなぐ */
async function drag(page: Page, from: string, handle: 'out' | 'loop-out', to: string) {
  await node(page, from).hover();
  const start = (await node(page, from).locator(`.react-flow__handle[data-handleid="${handle}"]`).boundingBox())!;
  const end = (await node(page, to).boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + 20, end.y + end.height / 2, { steps: 12 });
  await page.mouse.move(end.x + 6, end.y + end.height / 2, { steps: 4 });
  await page.mouse.up();
}

test('ワークフローの一覧で、並列・分岐・戻りを図で見られる', async ({ page }) => {
  await fresh(page);
  await page.goto('/workflows');
  const graph = page.getByRole('list', { name: '並べて確かめる のステップ（文で読む）' });
  await expect(graph.getByText('実装: 次は 単体テストとE2E を並列で')).toBeAttached();
  await expect(graph.getByText(/^振り分け: 次は 完了、結果が large なら セキュリティレビュー、E2Eと単体テスト がすべて終わってから始まる、失敗したら 実装 に戻る（2 回まで）$/)).toBeAttached();
  const card = page.locator('[data-mode="view"]').filter({ has: node(page, 'triage') });
  await expect(card.getByText('並列 2')).toBeVisible();
  await expect(card.getByText('2 つを待つ')).toBeVisible();
  await expect(card.getByText('large', { exact: true })).toBeVisible();
  await expect(card.getByText('失敗したら戻る（2 回まで）')).toBeVisible();
});

test('ワークスペース: 並列で動いたステップの状態を図に重ね、押すとそのログを開く', async ({ page }) => {
  await fresh(page);
  await page.getByRole('link', { name: /在庫一覧に並び替えを付ける/ }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: '在庫一覧に並び替えを付ける' })).toBeVisible();
  await page.getByRole('tab', { name: '計画' }).click();
  const graph = page.locator('[data-mode="run"]');
  await expect(node(page, 'unit-test').locator('[data-status="done"]')).toBeVisible();
  await expect(node(page, 'e2e').locator('[data-status="done"]')).toBeVisible();
  // 小さい変更なので、セキュリティレビューは通らなかった
  await expect(node(page, 'security-review').locator('[data-status="skipped"]')).toBeVisible();
  await expect(graph.getByRole('list', { name: /文で読む/ }).getByText('セキュリティレビュー（通らなかった）', { exact: false })).toBeAttached();
  await node(page, 'e2e').click();
  const log = page.getByRole('region', { name: /^E2E e2e#1$/ });
  await expect(log).toBeVisible();
  await expect(log).toContainText('npx playwright test');
});

test('管理: 図で矢印をつなぎ、分かれ方を選び、YAML に反映して登録する', async ({ page }) => {
  await fresh(page);
  await page.goto('/admin?tab=workflows');
  await expect(node(page, 'verify')).toBeVisible();

  // 検証からも完了へつなぐと、並列になる（合流がないので、直すところが出る）
  await drag(page, 'verify', 'out', 'deliver');
  const issues = page.getByRole('region', { name: '直すところ' });
  await expect(issues).toBeVisible();
  await expect(page.getByRole('button', { name: '検証して登録' })).toBeDisabled();

  // 検証を選んで「結果で分ける」にすると、誤りがなくなる
  await node(page, 'verify').click();
  const inspector = page.getByRole('complementary', { name: '選んだものの設定' });
  await expect(inspector.getByRole('heading', { name: '検証' })).toBeVisible();
  await inspector.getByRole('radio', { name: '結果で分ける' }).click();
  await expect(issues).toHaveCount(0);
  await expect(page.locator('[data-mode="edit"]').getByText('case-1', { exact: true })).toBeVisible();

  // ラベルを付け直す（矢印を選んで、右で編集する）
  await inspector.getByRole('button', { name: '完了' }).click();
  const label = inspector.getByLabel('ラベル（エージェントが結果で返す値）');
  await label.fill('docs-only');
  await label.press('Enter');
  await expect(page.locator('[data-mode="edit"]').getByText('docs-only', { exact: true })).toBeVisible();

  // 取り消すと、1手前に戻る
  await page.getByRole('button', { name: '取り消す' }).click();
  await expect(page.locator('[data-mode="edit"]').getByText('case-1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'やり直す' }).click();
  await expect(page.locator('[data-mode="edit"]').getByText('docs-only', { exact: true })).toBeVisible();

  // YAML にも同じ内容が出ている
  await page.getByRole('radio', { name: 'YAML' }).click();
  const yaml = page.getByLabel('ワークフローの定義（YAML）');
  await expect(yaml).toHaveValue(/cases: \{docs-only: deliver\}/);
  await expect(yaml).toHaveValue(/# 失敗の内容を implement に戻す|fail: \{goto: implement, maxLoops: 2\}/);

  await page.getByRole('button', { name: '検証して登録' }).click();
  await expect(page.getByText('build-verify@4 を登録しました')).toBeVisible();

  // 一覧の図にも反映される
  await page.getByRole('link', { name: 'ワークフロー', exact: true }).click();
  await expect(page.getByRole('list', { name: '作って確かめる のステップ（文で読む）' }).getByText(/^検証: 次は レビュー、結果が docs-only なら 完了/)).toBeAttached();
});

test('管理: ステップを足して消し、失敗したときの戻り先を図でつなぐ', async ({ page }) => {
  await fresh(page);
  await page.goto('/admin?tab=workflows');
  await expect(node(page, 'review')).toBeVisible();

  // レビューを選んで「人の承認」を足すと、レビューと完了の間に入る
  await node(page, 'review').click();
  await page.getByRole('toolbar', { name: '図の編集' }).getByRole('button', { name: '人の承認' }).click();
  await expect(node(page, 'approval')).toBeVisible();
  const inspector = page.getByRole('complementary', { name: '選んだものの設定' });
  await expect(inspector.getByRole('heading', { name: 'approval' })).toBeVisible();
  await inspector.getByLabel('id').fill('sign-off');
  await inspector.getByLabel('id').press('Enter');
  await expect(node(page, 'sign-off')).toBeVisible();

  // 下の点から実装へつなぐと、失敗したときの戻り先になる
  await drag(page, 'sign-off', 'loop-out', 'implement');
  await node(page, 'sign-off').click();
  await expect(inspector.getByLabel('失敗したときの戻り先')).toHaveValue('implement');

  await page.getByRole('radio', { name: 'YAML' }).click();
  await expect(page.getByLabel('ワークフローの定義（YAML）')).toHaveValue(/- id: sign-off\n {4}type: approval\n {4}next: deliver\n {4}on:\n {6}fail: \{goto: implement, maxLoops: 1\}/);
  await page.getByRole('radio', { name: '図' }).click();

  // Delete で消すと、前後がつながり直す
  await node(page, 'sign-off').click();
  await page.keyboard.press('Delete');
  await expect(node(page, 'sign-off')).toHaveCount(0);
  await page.getByRole('radio', { name: 'YAML' }).click();
  await expect(page.getByLabel('ワークフローの定義（YAML）')).toHaveValue(/- id: review\n(?: {4}.*\n)*? {4}next: deliver/);
});
