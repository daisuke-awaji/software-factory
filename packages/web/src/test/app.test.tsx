// 画面の結合テスト: 本物の apiClient と EventStream を、MSW（Node）のモックのバックエンドにつなぐ
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../app/App';
import { createApiClient } from '../lib/api';
import { EventStream } from '../lib/events';
import { ServicesProvider, type Services } from '../lib/services';
import { getDb } from '../mocks/db';
import { handlers, initMockBackend } from '../mocks/index';
import { useMe } from '../stores/me';

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
  it('依頼の一覧と、対応が必要な項目を出す', async () => {
    renderAt('/');
    const table = await screen.findByRole('table', { name: '依頼の一覧' });
    expect(within(table).getByText('問い合わせフォームの入力チェックを直す')).toBeInTheDocument();
    expect(await screen.findByText('計画の承認: 週次売上ダッシュボードを追加')).toBeInTheDocument();
  });

  it('新しい依頼を出すと、ワークスペースに移って計画が出る → 承認すると完了まで進む', async () => {
    const user = userEvent.setup();
    const router = renderAt('/');
    await user.type(await screen.findByLabelText('依頼の内容'), 'README にテストの実行手順を追記してください');
    await waitFor(() => expect(screen.getByLabelText('リポジトリ')).not.toBeDisabled());
    await user.selectOptions(screen.getByLabelText('リポジトリ'), 'acme/platform');
    await user.click(screen.getByRole('button', { name: '依頼する' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/w\//));

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
    const dash = getDb().workItems.find((w) => w.title.includes('ダッシュボード'))!;
    renderAt(`/w/${dash.id}`);
    const buttons = await screen.findAllByRole('button', { name: '修正を依頼' });
    await user.click(buttons[0]!);
    await user.type(screen.getAllByPlaceholderText(/直してほしい点/)[0]!, 'グラフは折れ線にしてください');
    await user.click(screen.getByRole('button', { name: '修正を依頼する' }));
    expect(await screen.findAllByLabelText('計画 第2版', {}, { timeout: 8000 })).not.toHaveLength(0);
    expect(screen.getAllByText(/グラフは折れ線にしてください/).length).toBeGreaterThan(0);
  }, 20000);

  it('失敗した依頼は、理由とやり直すボタンを出す', async () => {
    const failed = getDb().workItems.find((w) => w.state === 'failed')!;
    renderAt(`/w/${failed.id}`);
    expect(await screen.findByText('ラインが止まりました')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'やり直す' }).length).toBeGreaterThan(0);
  });

  it('存在しない依頼は、見つからないと伝える', async () => {
    renderAt('/w/01J00000000000000000000000');
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
