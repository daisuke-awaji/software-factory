// 開いているワークアイテムのリアルタイムの状態。WebSocket のイベントは applyEvent の1か所で畳み込む（実装計画 §5.2）
import { FactoryEventEnvelope } from '@factory/contracts';
import { create } from 'zustand';
import { emptySession, reduce, reduceAll, type Session } from '../lib/session';

type SessionStore = {
  session: Session | null;
  /** 受け取ったイベント（eventId の順）。古いイベントが後から届いたときに、最初から畳み込み直すために持つ */
  events: FactoryEventEnvelope[];
  open: (workItemId: string) => void;
  /** 検証してから反映する（契約に合わないイベントと、別のワークアイテムのイベントは捨てる） */
  applyEvent: (raw: unknown) => void;
  applyHistory: (events: FactoryEventEnvelope[]) => void;
  close: () => void;
};

const byId = (a: FactoryEventEnvelope, b: FactoryEventEnvelope) => (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0);

export const useSessionStore = create<SessionStore>()((set, get) => ({
  session: null,
  events: [],
  open: (workItemId) => set({ session: emptySession(workItemId), events: [] }),
  applyEvent: (raw) => {
    const s = get().session;
    const parsed = FactoryEventEnvelope.safeParse(raw);
    if (!s || !parsed.success || parsed.data.workItemId !== s.workItemId || s.seen[parsed.data.eventId]) return;
    const e = parsed.data;
    if (!s.lastEventId || e.eventId > s.lastEventId) {
      // ふつうは新しいイベントなので、そのまま足す
      set({ session: reduce(s, e), events: [...get().events, e] });
    } else {
      // 古いイベントが後から届いた（履歴と WebSocket が前後した）ので、順に並べ直して畳み込み直す
      const events = [...get().events, e].sort(byId);
      set({ session: reduceAll(emptySession(s.workItemId), events), events });
    }
  },
  applyHistory: (history) => {
    const s = get().session;
    if (!s) return;
    const seen = new Set(get().events.map((e) => e.eventId));
    const merged = [...get().events, ...history.filter((e) => e.workItemId === s.workItemId && !seen.has(e.eventId))].sort(byId);
    set({ session: reduceAll(emptySession(s.workItemId), merged), events: merged });
  },
  close: () => set({ session: null, events: [] }),
}));
