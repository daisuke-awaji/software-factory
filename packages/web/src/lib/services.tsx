// API クライアントとイベントの受信を、画面に渡す（テストでは差し替える）
import { createContext, useContext, type ReactNode } from 'react';
import type { ApiClient } from './api';
import type { EventStream } from './events';

export type Services = { api: ApiClient; events: EventStream; mock: boolean };

const Ctx = createContext<Services | null>(null);

export function ServicesProvider({ value, children }: { value: Services; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useServices(): Services {
  const v = useContext(Ctx);
  if (!v) throw new Error('ServicesProvider の中で使ってください');
  return v;
}

export const useApi = () => useServices().api;
