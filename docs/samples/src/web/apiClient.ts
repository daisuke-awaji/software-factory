// packages/web/src/lib/apiClient.ts — 型付きの fetch。レスポンスは必ず contracts の Zod で検証する
import type { z } from 'zod';
import { ApiError, CreateWorkItemRequest, WorkItem } from '../contracts/index.js';

export class ApiRequestError extends Error {
  constructor(public readonly status: number, public readonly body: ApiError) {
    super(body.message);
  }
}

// ベース URL は環境ごとに変わる（本番は App の CloudFront、開発は Vite の dev server）。テストでは明示的に渡す
export function createApiClient(baseUrl: string = globalThis.location?.origin ?? 'http://localhost') {
  async function request<S extends z.ZodType>(schema: S, path: string, init?: RequestInit): Promise<z.infer<S>> {
  const res = await fetch(new URL(`/api${path}`, baseUrl), {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const json: unknown = await res.json();
  if (!res.ok) throw new ApiRequestError(res.status, ApiError.parse(json));
  return schema.parse(json);
  }

  return {
    createWorkItem: (input: z.input<typeof CreateWorkItemRequest>) =>
      request(WorkItem, '/v1/work-items', { method: 'POST', body: JSON.stringify(CreateWorkItemRequest.parse(input)) }),
    getWorkItem: (id: string) => request(WorkItem, `/v1/work-items/${encodeURIComponent(id)}`),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
