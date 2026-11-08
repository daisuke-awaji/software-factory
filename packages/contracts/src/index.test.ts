import { describe, expect, it } from 'vitest';
import { CreateTaskRequest, FactoryEventEnvelope, titleFromMessage, ImageSpec, NetworkProfile, ulid, ulidTime } from './index.js';

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
    const taskId = ulid();
    const ok = FactoryEventEnvelope.safeParse({ eventId: ulid(), type: 'egress.blocked', taskId, host: 'example.com' });
    expect(ok.success).toBe(true);
    expect(FactoryEventEnvelope.safeParse({ eventId: ulid(), type: 'nope', taskId }).success).toBe(false);
    expect(FactoryEventEnvelope.safeParse({ type: 'egress.blocked', taskId, host: 'x' }).success).toBe(false);
  });
});

describe('入力の検証', () => {
  it('既定値を埋める', () => {
    const r = CreateTaskRequest.parse({ title: 't', message: 'm', repo: { owner: 'a', name: 'b' } });
    expect(r.workflowRef).toBe('chat@1');
    expect(r.repo?.baseBranch).toBe('main');
  });

  it('タイトルは省略でき、本文の最初の文から作れる', () => {
    expect(CreateTaskRequest.parse({ message: 'm' }).title).toBeUndefined();
    expect(titleFromMessage('\n  問い合わせフォームを直してください。誤りはその場で知らせたいです。')).toBe(
      '問い合わせフォームを直してください',
    );
    expect(titleFromMessage('あ'.repeat(80))).toBe(`${'あ'.repeat(59)}…`);
  });
  it('イメージの名前とメモリを検証する', () => {
    expect(ImageSpec.safeParse({ name: 'Web', base: 'web@5', memoryMiB: 4096, packages: {} }).success).toBe(false);
    expect(ImageSpec.safeParse({ name: 'web-pw', base: 'web@5', memoryMiB: 3000, packages: {} }).success).toBe(false);
    expect(ImageSpec.parse({ name: 'web-pw', base: 'web@5', memoryMiB: 4096, packages: { npm: ['playwright@1'] } }).packages.apt).toEqual(
      [],
    );
  });
  it('許可リストはホスト名だけを受け付ける', () => {
    const base = { name: 'web', updatedAt: new Date().toISOString() };
    expect(NetworkProfile.safeParse({ ...base, allow: ['registry.npmjs.org', '*.github.com'] }).success).toBe(true);
    expect(NetworkProfile.safeParse({ ...base, allow: ['https://example.com/'] }).success).toBe(false);
  });
});
