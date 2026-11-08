// apiClient が付けるリクエストヘッダー
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from './api';

const headersOf = (fetchMock: ReturnType<typeof vi.fn>) => {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  return new Headers(init?.headers);
};

describe('createApiClient のヘッダー', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('本文があるときは authorization と content-type を付ける', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient({ baseUrl: 'http://localhost', getToken: () => 't1' });
    await api.postMessage('task-1', 'こんにちは');
    const h = headersOf(fetchMock);
    expect(h.get('authorization')).toBe('Bearer t1');
    expect(h.get('content-type')).toBe('application/json');
  });

  it('本文がないときは content-type を付けない', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('hello', { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient({ baseUrl: 'http://localhost', getToken: () => 't2' });
    await api.fileContent('task-1', 'README.md');
    const h = headersOf(fetchMock);
    expect(h.get('authorization')).toBe('Bearer t2');
    expect(h.has('content-type')).toBe(false);
  });
});
