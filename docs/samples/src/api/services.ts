// packages/api/src/services.ts — ドメインサービスのインターフェース（実装は DynamoDB と Lambda の SDK を使う。テストではメモリ実装に差し替える）
import type { CreateWorkItemRequest, WorkItem } from '../contracts/index.js';

export interface WorkItemService {
  create(ownerId: string, req: CreateWorkItemRequest): Promise<WorkItem>;
  get(ownerId: string, id: string): Promise<WorkItem | undefined>;
}

const memory = new Map<string, WorkItem>();

export const workItems: WorkItemService = {
  async create(ownerId, req) {
    const now = new Date().toISOString();
    const item: WorkItem = {
      id: '01JC0000000000000000000000',
      ownerId,
      title: req.title,
      lineRef: req.lineRef,
      state: 'queued',
      createdAt: now,
      updatedAt: now,
      ...(req.projectId !== undefined ? { projectId: req.projectId } : {}),
    };
    memory.set(item.id, item);
    return item;
  },
  async get(ownerId, id) {
    const item = memory.get(id);
    return item && item.ownerId === ownerId ? item : undefined;
  },
};
