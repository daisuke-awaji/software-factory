// EventStream: 切れたらつなぎ直し、切れていた間のイベントを履歴から埋める
import type { FactoryEventEnvelope } from '@factory/contracts';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emit, getDb } from '../mocks/db';
import { handlers, initMockBackend } from '../mocks/index';
import { createApiClient } from './api';
import { EventStream } from './events';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

const until = async (fn: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('タイムアウト');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('EventStream', () => {
  it('再接続したら、取りこぼしを GET /events?after= で埋める', async () => {
    initMockBackend({ fresh: true, speed: 0.01 });
    const id = getDb().workItems[0]!.id;
    const api = createApiClient({ baseUrl: 'http://localhost', getToken: () => 't' });
    const stream = new EventStream('wss://ws.factory.mock/ws', () => 't', api);
    const got: FactoryEventEnvelope[] = [];
    stream.start();
    stream.subscribe(id, (e) => got.push(e));
    await until(() => stream.state === 'open');
    await new Promise((r) => setTimeout(r, 50));
    emit(id, { type: 'egress.blocked', host: 'before.example' });
    await until(() => got.some((e) => e.type === 'egress.blocked' && e.host === 'before.example'));

    stream.dropForTest();
    await until(() => stream.state === 'reconnecting');
    // 切れている間のイベント（WebSocket では届かない）
    emit(id, { type: 'egress.blocked', host: 'during.example' });
    await until(() => got.some((e) => e.type === 'egress.blocked' && e.host === 'during.example'), 8000);
    expect(stream.state).toBe('open');
    // 同じイベントが2回届いても、重複は session の側で除く（ここでは1回だけのはず）
    expect(got.filter((e) => e.type === 'egress.blocked' && e.host === 'during.example')).toHaveLength(1);
    stream.stop();
  }, 15000);
});
