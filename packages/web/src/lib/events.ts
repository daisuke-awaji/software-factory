// WebSocket のイベントの受信（API 仕様 §4）。購読はワークアイテムごと。
// 切れたら自動でつなぎ直し、`GET /events?after=` で取りこぼしを埋めてから購読し直す
import { FactoryEventEnvelope } from '@factory/contracts';
import type { ApiClient } from './api';

export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed';
type Handler = (e: FactoryEventEnvelope) => void;

export class EventStream {
  private ws: WebSocket | null = null;
  private subs = new Map<string, Set<Handler>>();
  private last = new Map<string, string>(); // workItemId → 最後に受け取った eventId
  private listeners = new Set<(s: ConnectionState) => void>();
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  state: ConnectionState = 'closed';

  constructor(
    private readonly url: string,
    private readonly getToken: () => Promise<string> | string,
    private readonly api: Pick<ApiClient, 'events'>,
  ) {}

  start() {
    this.stopped = false;
    void this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
    this.setState('closed');
  }

  onState(fn: (s: ConnectionState) => void) {
    this.listeners.add(fn);
    fn(this.state);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** 購読する。同じワークアイテムを複数の画面が購読しても、サーバーへの subscribe は1回 */
  subscribe(workItemId: string, handler: Handler) {
    let set = this.subs.get(workItemId);
    if (!set) {
      set = new Set();
      this.subs.set(workItemId, set);
      this.send({ action: 'subscribe', workItemId });
    }
    set.add(handler);
    return () => {
      const s = this.subs.get(workItemId);
      s?.delete(handler);
      if (s && s.size === 0) {
        this.subs.delete(workItemId);
        this.last.delete(workItemId);
        this.send({ action: 'unsubscribe', workItemId });
      }
    };
  }

  /** 履歴から取り直したイベントの位置を伝える（画面が履歴を読み込んだあとに呼ぶ） */
  markSeen(workItemId: string, eventId: string) {
    const cur = this.last.get(workItemId);
    if (!cur || eventId > cur) this.last.set(workItemId, eventId);
  }

  /** テスト用: 接続を切る（再接続と取りこぼしの補完を確かめる） */
  dropForTest() {
    this.ws?.close();
  }

  private setState(s: ConnectionState) {
    this.state = s;
    for (const l of this.listeners) l(s);
  }

  private send(frame: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame));
  }

  private async connect() {
    if (this.stopped) return;
    this.setState(this.retry === 0 ? 'connecting' : 'reconnecting');
    const token = await this.getToken();
    const ws = new WebSocket(`${this.url}?token=${encodeURIComponent(token)}`);
    this.ws = ws;
    ws.addEventListener('open', () => {
      const reconnected = this.retry > 0;
      this.retry = 0;
      this.setState('open');
      for (const id of this.subs.keys()) this.send({ action: 'subscribe', workItemId: id });
      if (reconnected) void this.backfill();
    });
    ws.addEventListener('message', (m) => {
      let parsed;
      try {
        parsed = FactoryEventEnvelope.safeParse(JSON.parse(String(m.data)));
      } catch {
        return;
      }
      if (parsed.success) this.dispatch(parsed.data);
    });
    ws.addEventListener('close', () => {
      if (this.ws !== ws || this.stopped) return;
      this.ws = null;
      this.retry++;
      this.setState('reconnecting');
      const wait = Math.min(15_000, 250 * 2 ** Math.min(this.retry, 6)) * (0.75 + Math.random() * 0.5);
      this.timer = setTimeout(() => void this.connect(), wait);
    });
  }

  /** 切れていた間のイベントを履歴から埋める */
  private async backfill() {
    for (const id of this.subs.keys()) {
      try {
        const page = await this.api.events(id, this.last.get(id));
        for (const e of page.items) this.dispatch(e);
      } catch {
        // 次の再接続でもう一度試す
      }
    }
  }

  private dispatch(e: FactoryEventEnvelope) {
    this.markSeen(e.workItemId, e.eventId);
    for (const h of this.subs.get(e.workItemId) ?? []) h(e);
  }
}
