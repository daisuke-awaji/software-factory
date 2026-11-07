// 開いているワークアイテムのリアルタイムの状態。WebSocket のイベントは applyEvent の1か所で畳み込む（実装計画 §5.2）
import { FactoryEventEnvelope } from '@factory/contracts';
import { create } from 'zustand';
import { emptySession, reduce, reduceAll, type Session } from '../lib/session';

type SessionStore = {
  session: Session | null;
  open: (workItemId: string) => void;
  /** 検証してから反映する（契約に合わないイベントと、別のワークアイテムのイベントは捨てる） */
  applyEvent: (raw: unknown) => void;
  applyHistory: (events: FactoryEventEnvelope[]) => void;
  close: () => void;
};

export const useSessionStore = create<SessionStore>()((set, get) => ({
  session: null,
  open: (workItemId) => set({ session: emptySession(workItemId) }),
  applyEvent: (raw) => {
    const s = get().session;
    const parsed = FactoryEventEnvelope.safeParse(raw);
    if (!s || !parsed.success) return;
    const next = reduce(s, parsed.data);
    if (next !== s) set({ session: next });
  },
  applyHistory: (events) => {
    const s = get().session;
    if (!s) return;
    // 履歴と WebSocket が混ざっても、時刻（eventId）の順に並べてから反映する
    set({ session: reduceAll(s, [...events].sort((a, b) => a.eventId.localeCompare(b.eventId))) });
  },
  close: () => set({ session: null }),
}));
