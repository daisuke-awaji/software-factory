// モックのバックエンドそのもののテスト（MSW を Node で動かし、fetch と WebSocket で一連の流れを通す）
import { FactoryEventEnvelope, ImageVersion, PlanRecord, StepRun, Task } from '@factory/contracts';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { handlers, initMockBackend } from '../index';

const server = setupServer(...handlers);
const base = 'http://localhost:5173/api/v1';
const h = { authorization: 'Bearer test', 'content-type': 'application/json' };
const get = async <S extends z.ZodType>(s: S, path: string) => s.parse(await (await fetch(base + path, { headers: h })).json());
const post = (path: string, body?: unknown) => fetch(base + path, { method: 'POST', headers: h, ...(body ? { body: JSON.stringify(body) } : {}) });
const Items = z.object({ items: z.array(Task) });

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  initMockBackend({ fresh: true, speed: 1000 });
});

const until = async (fn: () => Promise<boolean>, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('タイムアウト');
};
const stateOf = async (id: string) => (await get(Task, `/tasks/${id}`)).state;

describe('モックのバックエンド', () => {
  it('認証のヘッダーがないと 401', async () => {
    const res = await fetch(`${base}/me`);
    expect(res.status).toBe(401);
  });

  it('シードには承認待ち・実行中・完了・失敗のワークアイテムがあり、履歴とつじつまが合う', async () => {
    initMockBackend({ fresh: true, speed: 0.1 });
    const page = await get(Items, '/tasks');
    const states = page.items.map((i) => i.state);
    expect(states).toEqual(expect.arrayContaining(['awaiting_approval', 'running', 'completed', 'failed']));
    const form = page.items.find((i) => i.title.includes('フォーム'))!;
    expect(form.pullRequest?.number).toBe(128);
    const runs = await get(z.array(StepRun), `/tasks/${form.id}/steps`);
    expect(runs.map((r) => `${r.runId}:${r.state}`)).toEqual(['implement#1:completed', 'verify#1:failed', 'implement#2:completed', 'verify#2:completed', 'review#1:completed', 'deliver#1:completed']);
  });

  it('一覧は更新の新しい順で、カーソルで続きを重ならずに取れる', async () => {
    const Page = z.object({ items: z.array(Task), nextCursor: z.string().optional() });
    const first = await get(Page, '/tasks?limit=30');
    expect(first.items).toHaveLength(30);
    expect(first.nextCursor).toBeDefined();
    const rest = await get(Page, `/tasks?limit=30&cursor=${first.nextCursor}`);
    expect(rest.nextCursor).toBeUndefined();
    const all = [...first.items, ...rest.items];
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length);
    expect(all.map((i) => i.updatedAt)).toEqual(all.map((i) => i.updatedAt).sort().reverse());
    // 過去の依頼の PR は 128 より前の番号にする
    expect(Math.max(...rest.items.map((i) => i.pullRequest?.number ?? 0))).toBeLessThan(128);
  });

  it('作成 → 計画 → 承認 → 完了までイベントが届き、履歴から取り直せる', async () => {
    const ws = new WebSocket('wss://ws.factory.mock/ws?token=t');
    const received: FactoryEventEnvelope[] = [];
    ws.addEventListener('message', (e) => received.push(FactoryEventEnvelope.parse(JSON.parse(String(e.data)))));
    await new Promise((r) => ws.addEventListener('open', r));

    const res = await post('/tasks', { title: 'フォームの入力チェック', workflowRef: 'build-verify@3', repo: { owner: 'acme', name: 'support-site' }, message: '入力チェックを直して' });
    expect(res.status).toBe(201);
    const current = Task.parse(await res.json());
    ws.send(JSON.stringify({ action: 'subscribe', taskId: current.id }));

    await until(async () => (await stateOf(current.id)) === 'awaiting_approval');
    const [plan] = await get(z.array(PlanRecord), `/tasks/${current.id}/plans`);
    expect((await post(`/tasks/${current.id}/plans/${plan!.version}/approve`)).status).toBe(202);
    // 2 回目の承認は 409
    expect((await post(`/tasks/${current.id}/plans/${plan!.version}/approve`)).status).toBe(409);

    await until(async () => (await stateOf(current.id)) === 'completed', 15000);
    const done = await get(Task, `/tasks/${current.id}`);
    expect(done.pullRequest?.number).toBeGreaterThan(0);

    const history = await get(z.object({ items: z.array(FactoryEventEnvelope) }), `/tasks/${current.id}/events`);
    expect(history.items.some((e) => e.type === 'step.changed' && e.stepId === 'verify' && e.state === 'failed')).toBe(true); // フォームは一度失敗する
    expect(received.length).toBeGreaterThan(10);
    expect(received.every((e) => e.taskId === current.id)).toBe(true);
    // after を渡すと、その後だけが返る
    const mid = history.items[5]!.eventId;
    const rest = await get(z.object({ items: z.array(FactoryEventEnvelope) }), `/tasks/${current.id}/events?after=${mid}`);
    expect(rest.items.length).toBe(history.items.length - 6);
    ws.close();
  });

  it('修正を依頼すると第2版が出て、古い版は承認できない', async () => {
    const page = await get(Items, '/tasks?state=awaiting_approval');
    const id = page.items[0]!.id;
    expect((await post(`/tasks/${id}/plans/1/request-changes`, { comment: 'グラフは折れ線にしてください' })).status).toBe(202);
    await until(async () => (await get(z.array(PlanRecord), `/tasks/${id}/plans`)).length === 2 && (await stateOf(id)) === 'awaiting_approval');
    const plans = await get(z.array(PlanRecord), `/tasks/${id}/plans`);
    expect(plans.map((p) => p.status)).toEqual(['changes_requested', 'proposed']);
    expect((await post(`/tasks/${id}/plans/1/approve`)).status).toBe(409);
    // 承認すると、途中で外部への通信の再承認が出る
    expect((await post(`/tasks/${id}/plans/2/approve`)).status).toBe(202);
    await until(async () => (await stateOf(id)) === 'awaiting_approval');
    expect((await post(`/tasks/${id}/approvals/ap_egress_jsdelivr`, { decision: 'deny' })).status).toBe(202);
    await until(async () => (await stateOf(id)) === 'completed', 15000);
  });

  it('失敗したステージをやり直すと、最後まで進む', async () => {
    const page = await get(Items, '/tasks?state=failed');
    const id = page.items[0]!.id;
    const runs = await get(z.array(StepRun), `/tasks/${id}/steps`);
    const failed = runs.findLast((r) => r.state === 'failed')!;
    expect((await post(`/tasks/${id}/steps/${encodeURIComponent(failed.runId)}/retry`)).status).toBe(202);
    await until(async () => (await stateOf(id)) === 'completed', 15000);
  });

  it('ファイルの中身はリダイレクトの先から取れ、zip もダウンロードできる', async () => {
    const page = await get(Items, '/tasks?state=completed');
    const id = page.items.find((i) => i.repo)!.id;
    const res = await fetch(`${base}/tasks/${id}/files/content?path=README.md`, { headers: h });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('#');
    const dl = z.object({ url: z.string() }).parse(await (await post(`/tasks/${id}/downloads`, { format: 'zip' })).json());
    const bytes = new Uint8Array(await (await fetch(dl.url)).arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('同時に進められる件数を超えると 429', async () => {
    initMockBackend({ fresh: true, speed: 0.1 });
    for (let i = 0; i < 3; i++) await post('/tasks', { title: `t${i}`, message: 'm' });
    const res = await post('/tasks', { title: 'over', message: 'm' });
    expect(res.status).toBe(429);
  });

  it('イメージを登録すると、ビルドが進んで使えるようになる', async () => {
    const res = await post('/images', { name: 'report-tools', base: 'data@2', memoryMiB: 4096, packages: { pip: ['reportlab'] } });
    expect(res.status).toBe(201);
    expect(ImageVersion.parse(await res.json()).state).toBe('building');
    await until(async () => (await get(z.array(ImageVersion), '/images/report-tools/versions'))[0]!.state === 'ready');
    const log = z.object({ lines: z.array(z.string()), done: z.boolean() }).parse(await (await fetch(`${base}/images/report-tools/versions/1/build-log`, { headers: h })).json());
    expect(log.done).toBe(true);
  });

  it('管理: ラインの YAML を検証して新しい版にする', async () => {
    const bad = await fetch(`${base}/admin/workflows/chat`, { method: 'PUT', headers: h, body: JSON.stringify({ yaml: 'name: chat\nsteps:\n  - id: X\n    type: agent\n' }) });
    expect(bad.status).toBe(400);
    const ok = await fetch(`${base}/admin/workflows/chat`, { method: 'PUT', headers: h, body: JSON.stringify({ yaml: 'name: chat\nversion: 1\nsteps:\n  - id: workbench\n    type: agent\n    image: base@3\n' }) });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { version: number }).version).toBe(2);
  });
});
