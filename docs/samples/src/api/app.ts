// packages/api/src/app.ts — Hono アプリ（API Gateway HTTP API → Lambda）
// 方針: ルートは @hono/zod-openapi で定義し、contracts の Zod スキーマをそのまま使う → /openapi.json を自動で生成する
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { handle } from 'hono/aws-lambda';
import type { LambdaEvent } from 'hono/aws-lambda';
import { HTTPException } from 'hono/http-exception';
import { ApiError, CreateWorkItemRequest, WorkItem } from '../contracts/index.js';
import { workItems } from './services.js';

type Env = {
  Bindings: { event: LambdaEvent };
  Variables: { userId: string; groups: string[]; requestId: string };
};

export const app = new OpenAPIHono<Env>({
  // 入力が契約に合わないときは 400 を返す（エラーの形式も契約で決めた ApiError に揃える）
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json({ code: 'VALIDATION_ERROR', message: z.prettifyError(result.error) }, 400);
    }
  },
});

// 認可: API Gateway の JWT authorizer（Cognito）が検証した claims を取り出す。ローカルでは開発用のヘッダーを使う
app.use('/v1/*', async (c, next) => {
  const event = c.env?.event as { requestContext?: { requestId?: string; authorizer?: { jwt?: { claims?: Record<string, unknown> } } } } | undefined;
  const claims = event?.requestContext?.authorizer?.jwt?.claims;
  const userId = typeof claims?.['sub'] === 'string' ? claims['sub'] : process.env['DEV_USER_ID'];
  if (!userId) throw new HTTPException(401, { message: 'unauthorized' });
  const rawGroups = claims?.['cognito:groups'];
  c.set('userId', userId);
  c.set('groups', Array.isArray(rawGroups) ? rawGroups.map(String) : []);
  c.set('requestId', event?.requestContext?.requestId ?? crypto.randomUUID());
  await next();
});

const createWorkItemRoute = createRoute({
  method: 'post',
  path: '/v1/work-items',
  request: { body: { content: { 'application/json': { schema: CreateWorkItemRequest } }, required: true } },
  responses: {
    201: { description: '作成した', content: { 'application/json': { schema: WorkItem } } },
    400: { description: '入力が不正', content: { 'application/json': { schema: ApiError } } },
  },
});

app.openapi(createWorkItemRoute, async (c) => {
  const body = c.req.valid('json');
  const created = await workItems.create(c.get('userId'), body); // WorkItem を作り、durable execution を起動する
  return c.json(created, 201);
});

const getWorkItemRoute = createRoute({
  method: 'get',
  path: '/v1/work-items/{id}',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: '取得した', content: { 'application/json': { schema: WorkItem } } },
    404: { description: '見つからない', content: { 'application/json': { schema: ApiError } } },
  },
});

app.openapi(getWorkItemRoute, async (c) => {
  const item = await workItems.get(c.get('userId'), c.req.valid('param').id);
  if (!item) return c.json({ code: 'NOT_FOUND', message: 'work item not found' }, 404);
  return c.json(item, 200);
});

app.doc('/openapi.json', { openapi: '3.1.0', info: { title: 'Software Factory API', version: '1.0.0' } });

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ code: 'HTTP_ERROR', message: err.message }, err.status);
  console.error(JSON.stringify({ level: 'error', requestId: c.get('requestId'), err: String(err) }));
  return c.json({ code: 'INTERNAL', message: 'internal error' }, 500);
});

export const handler = handle(app);
