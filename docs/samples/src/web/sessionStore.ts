// packages/web/src/stores/sessionStore.ts — Zustand。WebSocket から届くイベントを1か所で畳み込む
import { create } from 'zustand';
import { FactoryEvent, type Plan, type WorkItemState } from '../contracts/index.js';

export type ChatMessage = { id: string; role: 'user' | 'assistant'; text: string; done: boolean };
export type ToolRun = { id: string; tool: string; summary: string; ok?: boolean };

type SessionState = {
  workItemId: string | null;
  state: WorkItemState | null;
  messages: ChatMessage[];
  tools: ToolRun[];
  pendingPlan: { version: number; plan: Plan } | null;
  blockedHosts: string[];
  usage: { inputTokens: number; outputTokens: number; vmSeconds: number };
  open: (workItemId: string) => void;
  addUserMessage: (id: string, text: string) => void;
  applyEvent: (raw: unknown) => void;   // 検証してから反映する（不正なイベントは捨てる）
  reset: () => void;
};

const initial = {
  workItemId: null, state: null, messages: [], tools: [], pendingPlan: null, blockedHosts: [],
  usage: { inputTokens: 0, outputTokens: 0, vmSeconds: 0 },
} satisfies Partial<SessionState>;

export const useSessionStore = create<SessionState>()((set, get) => ({
  ...initial,
  open: (workItemId) => set({ ...initial, workItemId }),
  addUserMessage: (id, text) => set((s) => ({ messages: [...s.messages, { id, role: 'user', text, done: true }] })),
  applyEvent: (raw) => {
    const parsed = FactoryEvent.safeParse(raw);
    if (!parsed.success || parsed.data.workItemId !== get().workItemId) return;
    const e = parsed.data;
    switch (e.type) {
      case 'message.delta':
        return set((s) => {
          const last = s.messages.at(-1);
          if (last && last.id === e.messageId && !last.done) {
            return { messages: [...s.messages.slice(0, -1), { ...last, text: last.text + e.text }] };
          }
          return { messages: [...s.messages, { id: e.messageId, role: 'assistant', text: e.text, done: false }] };
        });
      case 'message.completed':
        return set((s) => ({ messages: s.messages.map((m) => (m.id === e.messageId ? { ...m, done: true } : m)) }));
      case 'tool.started':
        return set((s) => ({ tools: [...s.tools, { id: e.toolUseId, tool: e.tool, summary: e.summary }] }));
      case 'tool.finished':
        return set((s) => ({ tools: s.tools.map((t) => (t.id === e.toolUseId ? { ...t, ok: e.ok } : t)) }));
      case 'plan.proposed':
        return set({ pendingPlan: { version: e.planVersion, plan: e.plan }, state: 'awaiting_approval' });
      case 'egress.blocked':
        return set((s) => ({ blockedHosts: s.blockedHosts.includes(e.host) ? s.blockedHosts : [...s.blockedHosts, e.host] }));
      case 'usage':
        return set((s) => ({
          usage: {
            inputTokens: s.usage.inputTokens + e.inputTokens,
            outputTokens: s.usage.outputTokens + e.outputTokens,
            vmSeconds: s.usage.vmSeconds + e.vmSeconds,
          },
        }));
      case 'workitem.state':
        return set({ state: e.state, ...(e.state !== 'awaiting_approval' ? { pendingPlan: null } : {}) });
      case 'approval.required':
      case 'stage.changed':
        return; // 通知の UI で扱う（ここでは状態を持たない）
    }
  },
  reset: () => set(initial),
}));
