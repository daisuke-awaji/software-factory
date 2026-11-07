// セッションのストア: 履歴と WebSocket のイベントが前後して届いても、順番どおりに畳み込む
import { type FactoryEventEnvelope, ulid } from '@factory/contracts';
import { describe, expect, it } from 'vitest';
import { useSessionStore } from './session';

const wid = ulid();
let t = Date.UTC(2026, 10, 7);
const ev = (e: object) => ({ ...e, workItemId: wid, eventId: ulid((t += 1000)) }) as FactoryEventEnvelope;

describe('useSessionStore', () => {
  it('古い履歴が後から届いても、発言と状態が正しい順になる', () => {
    const user = ev({ type: 'message.user', messageId: 'u', text: '依頼', author: '佐藤' });
    const planning = ev({ type: 'workitem.state', state: 'planning' });
    const reply = ev({ type: 'message.delta', messageId: 'a', text: '計画を作りました' });
    const awaiting = ev({ type: 'workitem.state', state: 'awaiting_approval' });
    const st = useSessionStore.getState();
    st.open(wid);
    // WebSocket で新しいものが先に届き、
    st.applyEvent(reply);
    st.applyEvent(awaiting);
    // 履歴（古いものを含む）があとから届く
    useSessionStore.getState().applyHistory([user, planning, reply]);
    const s = useSessionStore.getState().session!;
    expect(s.timeline.map((e) => e.k)).toEqual(['user', 'assistant']);
    expect(s.state).toBe('awaiting_approval');
    expect(s.messages['a']?.text).toBe('計画を作りました');
  });

  it('契約に合わないイベントは捨てる', () => {
    const st = useSessionStore.getState();
    st.open(wid);
    st.applyEvent({ type: 'workitem.state', workItemId: wid, eventId: ulid(), state: 'exploded' });
    expect(useSessionStore.getState().session!.state).toBeNull();
  });
});
