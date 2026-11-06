// packages/web/src/__tests__/session.test.ts — MSW（Node）+ Zustand の結合テスト
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiRequestError, createApiClient } from './apiClient.js';
import { fixtures, handlers } from './mocks.js';
import { useSessionStore } from './sessionStore.js';

const server = setupServer(...handlers);
const api = createApiClient('http://localhost:5173');

beforeAll(() => server.listen({ onUnhandledFrame: 'error' })); // MSW 3 では onUnhandledRequest から名前が変わった
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => useSessionStore.getState().reset());

describe('apiClient × MSW', () => {
  it('作成したワークアイテムを契約どおりに受け取る', async () => {
    const wi = await api.createWorkItem({ title: 'テスト', message: 'こんにちは' });
    expect(wi.state).toBe('queued');
    expect(wi.lineRef).toBe('chat@1');
  });

  it('404 は ApiRequestError になる', async () => {
    await expect(api.getWorkItem('nope')).rejects.toBeInstanceOf(ApiRequestError);
  });
});

describe('sessionStore.applyEvent', () => {
  const id = fixtures.workItem.id;

  it('message.delta を同じメッセージに連結する', () => {
    const s = useSessionStore.getState();
    s.open(id);
    s.applyEvent({ type: 'message.delta', workItemId: id, messageId: 'm1', text: '計画を' });
    s.applyEvent({ type: 'message.delta', workItemId: id, messageId: 'm1', text: '作りました' });
    s.applyEvent({ type: 'message.completed', workItemId: id, messageId: 'm1' });
    const { messages } = useSessionStore.getState();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ text: '計画を作りました', done: true });
  });

  it('plan.proposed で承認待ちになり、running に変わると計画が消える', () => {
    const s = useSessionStore.getState();
    s.open(id);
    s.applyEvent({
      type: 'plan.proposed', workItemId: id, planVersion: 1,
      plan: { summaryForHumans: 'x', goal: 'g', deliverables: [], repos: [], steps: ['a'], doneCriteria: [], externalAccess: [], estimate: { minutes: 1, usd: 0 } },
    });
    expect(useSessionStore.getState().state).toBe('awaiting_approval');
    s.applyEvent({ type: 'workitem.state', workItemId: id, state: 'running' });
    expect(useSessionStore.getState().pendingPlan).toBeNull();
  });

  it('契約に合わないイベントと、別のワークアイテムのイベントは無視する', () => {
    const s = useSessionStore.getState();
    s.open(id);
    s.applyEvent({ type: 'message.delta', workItemId: id });                     // 必須項目が欠けている
    s.applyEvent({ type: 'egress.blocked', workItemId: '01JC1111111111111111111111', host: 'evil.example' });
    expect(useSessionStore.getState().messages).toHaveLength(0);
    expect(useSessionStore.getState().blockedHosts).toHaveLength(0);
  });
});
