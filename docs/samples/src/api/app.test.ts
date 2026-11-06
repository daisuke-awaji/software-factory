// packages/api/src/app.test.ts — Hono の app.request() でルートを直接テストする（HTTP サーバーは立てない）
import { beforeAll, describe, expect, it } from 'vitest';
import { WorkItem } from '../contracts/index.js';
import { app } from './app.js';

beforeAll(() => { process.env['DEV_USER_ID'] = 'user-1'; });

describe('POST /v1/work-items', () => {
  it('契約どおりの WorkItem を 201 で返す', async () => {
    const res = await app.request('/v1/work-items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '部署別の集計レポート', message: 'CSV を集計して HTML にして' }),
    });
    expect(res.status).toBe(201);
    const body = WorkItem.parse(await res.json());
    expect(body.lineRef).toBe('chat@1');   // 既定値は契約側で埋まる
    expect(body.state).toBe('queued');
  });

  it('入力が契約に合わなければ 400 と ApiError を返す', async () => {
    const res = await app.request('/v1/work-items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('他人のワークアイテムは 404 になる', async () => {
    process.env['DEV_USER_ID'] = 'user-2';
    const res = await app.request('/v1/work-items/01JC0000000000000000000000');
    expect(res.status).toBe(404);
    process.env['DEV_USER_ID'] = 'user-1';
  });

  it('OpenAPI の定義を出力できる', async () => {
    const res = await app.request('/openapi.json');
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/v1/work-items', '/v1/work-items/{id}']));
  });
});
