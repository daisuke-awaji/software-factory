// packages/web/src/mocks/handlers.ts — MSW 3（開発時はブラウザ、テストでは Node で同じハンドラーを使う）
// フィクスチャも contracts の Zod で検証するので、契約が変われば型エラーかテストの失敗で気づける
// パスは `*/api/...` と書き、どのオリジン（dev server / テスト）でも一致させる
import { http, HttpResponse, delay } from 'msw';
import { ws } from 'msw';
import { CreateWorkItemRequest, FactoryEvent, WorkItem } from '../contracts/index.js';

export const fixtures = {
  workItem: WorkItem.parse({
    id: '01JC0000000000000000000000',
    ownerId: 'user-1',
    title: '部署別の集計レポート',
    lineRef: 'chat@1',
    state: 'planning',
    createdAt: '2026-11-06T00:00:00.000Z',
    updatedAt: '2026-11-06T00:00:00.000Z',
  }),
};

// API Gateway の WebSocket API を模擬する（計画を提示 → 承認待ち、という流れを再現する）
const events = ws.link('wss://*/ws');

export const handlers = [
  http.post('*/api/v1/work-items', async ({ request }) => {
    const parsed = CreateWorkItemRequest.safeParse(await request.json());
    if (!parsed.success) return HttpResponse.json({ code: 'VALIDATION_ERROR', message: parsed.error.message }, { status: 400 });
    await delay(150);
    return HttpResponse.json({ ...fixtures.workItem, title: parsed.data.title, state: 'queued' }, { status: 201 });
  }),
  http.get('*/api/v1/work-items/:id', ({ params }) =>
    params['id'] === fixtures.workItem.id
      ? HttpResponse.json(fixtures.workItem)
      : HttpResponse.json({ code: 'NOT_FOUND', message: 'work item not found' }, { status: 404 }),
  ),
  events.addEventListener('connection', ({ client }) => {
    const send = (e: FactoryEvent) => client.send(JSON.stringify(FactoryEvent.parse(e)));
    const workItemId = fixtures.workItem.id;
    send({ type: 'message.delta', workItemId, messageId: 'm1', text: '計画を作成しました。' });
    send({ type: 'message.completed', workItemId, messageId: 'm1' });
    send({
      type: 'plan.proposed', workItemId, planVersion: 1,
      plan: {
        summaryForHumans: 'CSV を部署ごとに集計し、グラフ付きの HTML レポートを作ります。',
        goal: '部署別の集計レポートを作る', deliverables: ['report/index.html'], repos: [],
        steps: ['CSV を読み込む', '部署ごとに集計する', 'グラフを描く', 'HTML にまとめる'],
        doneCriteria: ['全部署の合計が元データと一致する'], externalAccess: [], estimate: { minutes: 10, usd: 0.8 },
      },
    });
  }),
];
