// 画面の結合テスト: 本物の apiClient と EventStream を、MSW（Node）のモックのバックエンドにつなぐ
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../app/App';
import { dayBucket } from '../app/Sidebar';
import { createApiClient } from '../lib/api';
import { EventStream } from '../lib/events';
import { ServicesProvider, type Services } from '../lib/services';
import { getDb } from '../mocks/db';
import { handlers, initMockBackend } from '../mocks/index';
import { useMe } from '../stores/me';
import { useUi } from '../stores/ui';

const server = setupServer(...handlers);
let services: Services;

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  initMockBackend({ fresh: true, speed: 50 });
  const api = createApiClient({ baseUrl: 'http://localhost', getToken: () => 'test' });
  const events = new EventStream('wss://ws.factory.mock/ws', () => 'test', api);
  events.start();
  services = { api, events, mock: true };
  useMe.setState({ me: null });
  localStorage.removeItem('sf.sidebar');
  useUi.setState({ sidebarPinned: true, sidebarOverlay: false });
});
afterEach(() => services.events.stop());

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <ServicesProvider value={services}>
      <RouterProvider router={router} />
    </ServicesProvider>,
  );
  return router;
}

describe('ホーム', () => {
  it('サイドパネルにタスクの一覧と対応が必要な項目を、ホームに入力欄だけを出す', async () => {
    renderAt('/');
    const side = await screen.findByRole('navigation', { name: 'タスク' });
    const action = await within(side).findByRole('region', { name: '対応が必要' });
    expect(within(action).getByRole('link', { name: /週次売上ダッシュボードを追加/ })).toBeInTheDocument();
    expect(within(side).getByRole('link', { name: /問い合わせフォームの入力チェックを直す/ })).toBeInTheDocument();
    const form = screen.getByRole('region', { name: '新しいタスク' });
    expect(within(form).getByLabelText('タスクの内容')).toBeInTheDocument();
    expect(within(form).queryByLabelText('タイトル')).not.toBeInTheDocument();
    expect(within(form).queryByLabelText('ワークフロー')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'ひな形から始める' })).not.toBeInTheDocument();
    expect(screen.queryByText('計画の承認: 週次売上ダッシュボードを追加')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'この7日間' })).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'タスクの一覧' })).not.toBeInTheDocument();
  });

  it('サイドパネルに過去のタスクを日付で分けて出し、続きを読み込める', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const side = await screen.findByRole('navigation', { name: 'タスク' });
    // 1日前のタスクは、時刻によって「昨日」か「過去7日間」に入る
    expect(await within(side).findAllByRole('region', { name: /^(昨日|過去7日間)$/ })).not.toHaveLength(0);
    expect(within(side).getByRole('region', { name: 'それより前' })).toBeInTheDocument();
    expect(within(side).queryByRole('link', { name: /セッションの有効期限を延ばす/ })).not.toBeInTheDocument();
    // jsdom ではスクロールで読めないので、ボタンで読む
    await user.click(within(side).getByRole('button', { name: '続きを読み込む' }));
    expect(await within(side).findByRole('link', { name: /セッションの有効期限を延ばす/ })).toBeInTheDocument();
    expect(within(side).queryByRole('button', { name: '続きを読み込む' })).not.toBeInTheDocument();
  });

  it('サイドパネルは畳むとアイコンの列になり、畳んだことを覚えておく', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await screen.findByRole('navigation', { name: 'タスク' });
    await user.click(screen.getByRole('button', { name: 'サイドパネルを畳む' }));
    expect(screen.queryByRole('navigation', { name: 'タスク' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'すべてのタスク' })).toBeInTheDocument();
    expect(localStorage.getItem('sf.sidebar')).toBe('collapsed');
    await user.keyboard('{Control>}b{/Control}');
    expect(await screen.findByRole('navigation', { name: 'タスク' })).toBeInTheDocument();
    expect(localStorage.getItem('sf.sidebar')).toBeNull();
  });
});

describe('dayBucket', () => {
  it('今日・昨日・過去7日間・それより前に分ける（暦の日で数える）', () => {
    const now = new Date(2026, 10, 7, 9, 0);
    expect(dayBucket(new Date(2026, 10, 7, 0, 5).toISOString(), now)).toBe('today');
    expect(dayBucket(new Date(2026, 10, 6, 23, 50).toISOString(), now)).toBe('yesterday');
    expect(dayBucket(new Date(2026, 10, 1, 0, 0).toISOString(), now)).toBe('week');
    expect(dayBucket(new Date(2026, 9, 31, 23, 59).toISOString(), now)).toBe('older');
  });
});

describe('すべてのタスク', () => {
  it('表で絞り込み・検索できる', async () => {
    const user = userEvent.setup();
    renderAt('/tasks');
    const table = await screen.findByRole('table', { name: 'タスクの一覧' });
    expect(within(table).getByText('問い合わせフォームの入力チェックを直す')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'タスクを検索' }), '週次');
    await waitFor(() => expect(within(table).queryByText('問い合わせフォームの入力チェックを直す')).not.toBeInTheDocument());
    expect(within(table).getByText('週次売上ダッシュボードを追加')).toBeInTheDocument();
  });

  it('新しいタスクを作ると、ワークスペースに移って計画が出る → 承認すると完了まで進む', async () => {
    const user = userEvent.setup();
    const router = renderAt('/');
    await user.type(await screen.findByLabelText('タスクの内容'), 'README にテストの実行手順を追記してください');
    await user.selectOptions(await screen.findByLabelText('リポジトリ'), 'acme/platform');
    await user.click(screen.getByRole('button', { name: '開始する' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/t\//));
    // タイトルは本文から作られる（後から「名前を変更」で直せる）
    expect(await screen.findByRole('heading', { level: 1, name: 'README にテストの実行手順を追記してください' })).toBeInTheDocument();

    // 計画のカード（会話と計画タブの両方に出る）
    const approve = await screen.findAllByRole('button', { name: '承認して開始' }, { timeout: 8000 });
    await user.click(approve[0]!);
    expect(await screen.findByText(/が .* に承認しました/, {}, { timeout: 4000 })).toBeInTheDocument();
    // 完了すると成果物が出る
    expect(await screen.findByRole('region', { name: '成果物' }, { timeout: 15000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(/プルリクエスト #\d+/).length).toBeGreaterThan(0), { timeout: 15000 });
  }, 30000);
});

describe('ワークスペース', () => {
  it('計画の修正を依頼すると、第2版が出る', async () => {
    const user = userEvent.setup();
    const dash = getDb().tasks.find((w) => w.title.includes('ダッシュボード'))!;
    renderAt(`/t/${dash.id}`);
    const buttons = await screen.findAllByRole('button', { name: '修正を依頼' });
    await user.click(buttons[0]!);
    await user.type(screen.getAllByPlaceholderText(/直してほしい点/)[0]!, 'グラフは折れ線にしてください');
    await user.click(screen.getByRole('button', { name: '修正を依頼する' }));
    expect(await screen.findAllByLabelText('計画 第2版', {}, { timeout: 8000 })).not.toHaveLength(0);
    expect(screen.getAllByText(/グラフは折れ線にしてください/).length).toBeGreaterThan(0);
  }, 20000);

  it('失敗したタスクは、理由とやり直すボタンを出す', async () => {
    const failed = getDb().tasks.find((w) => w.state === 'failed')!;
    renderAt(`/t/${failed.id}`);
    expect(await screen.findByText('ワークフローが止まりました')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'やり直す' }).length).toBeGreaterThan(0);
  });

  it('存在しないタスクは、見つからないと伝える', async () => {
    renderAt('/t/01J00000000000000000000000');
    expect(await screen.findByRole('alert')).toHaveTextContent('見つかりません');
  });
});

describe('管理', () => {
  it('許可リストにホスト名でないものを入れると、保存の前に止める', async () => {
    const user = userEvent.setup();
    renderAt('/admin?tab=network');
    const box = await screen.findByLabelText('許可するホスト（1行に1つ）', { selector: '#np-web' });
    await user.clear(box);
    await user.type(box, 'https://example.com/');
    const card = box.closest('div[class]')!.parentElement!.parentElement!;
    await user.click(within(card as HTMLElement).getByRole('button', { name: '保存' }));
    expect(await screen.findByText(/ホスト名（例: registry\.npmjs\.org/)).toBeInTheDocument();
  });

  it('管理者でなければ管理の画面は使えない', async () => {
    getDb().me.roles = ['user'];
    renderAt('/admin');
    expect(await screen.findByText('この画面は管理者だけが使えます。')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '管理' })).not.toBeInTheDocument();
  });
});
