import { describe, expect, it } from 'vitest';
import { CreateWorkItemRequest, FactoryEventEnvelope, ImageSpec, NetworkProfile, ulid, ulidTime } from './index.js';

describe('ULID', () => {
  it('時刻を取り出せて、同じミリ秒でも増えていく', () => {
    const now = Date.UTC(2026, 10, 7, 1, 2, 3);
    const a = ulid(now);
    const b = ulid(now);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(ulidTime(a)).toBe(now);
    expect(b > a).toBe(true);
  });
});

describe('イベント', () => {
  it('eventId の付いたイベントを受け取り、知らない type は拒否する', () => {
    const workItemId = ulid();
    const ok = FactoryEventEnvelope.safeParse({ eventId: ulid(), type: 'egress.blocked', workItemId, host: 'example.com' });
    expect(ok.success).toBe(true);
    expect(FactoryEventEnvelope.safeParse({ eventId: ulid(), type: 'nope', workItemId }).success).toBe(false);
    expect(FactoryEventEnvelope.safeParse({ type: 'egress.blocked', workItemId, host: 'x' }).success).toBe(false);
  });
});

describe('入力の検証', () => {
  it('既定値を埋める', () => {
    const r = CreateWorkItemRequest.parse({ title: 't', message: 'm', repo: { owner: 'a', name: 'b' } });
    expect(r.lineRef).toBe('chat@1');
    expect(r.repo?.baseBranch).toBe('main');
  });
  it('イメージの名前とメモリを検証する', () => {
    expect(ImageSpec.safeParse({ name: 'Web', base: 'web@5', memoryMiB: 4096, packages: {} }).success).toBe(false);
    expect(ImageSpec.safeParse({ name: 'web-pw', base: 'web@5', memoryMiB: 3000, packages: {} }).success).toBe(false);
    expect(ImageSpec.parse({ name: 'web-pw', base: 'web@5', memoryMiB: 4096, packages: { npm: ['playwright@1'] } }).packages.apt).toEqual([]);
  });
  it('許可リストはホスト名だけを受け付ける', () => {
    const base = { name: 'web', updatedAt: new Date().toISOString() };
    expect(NetworkProfile.safeParse({ ...base, allow: ['registry.npmjs.org', '*.github.com'] }).success).toBe(true);
    expect(NetworkProfile.safeParse({ ...base, allow: ['https://example.com/'] }).success).toBe(false);
  });
});
