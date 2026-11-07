// ログインしているユーザー（GET /me）。画面のどこからでも使う
import type { Me } from '@factory/contracts';
import { create } from 'zustand';

type MeStore = { me: Me | null; setMe: (me: Me) => void };

export const useMe = create<MeStore>()((set) => ({ me: null, setMe: (me) => set({ me }) }));

export const isAdmin = (me: Me | null) => !!me?.roles.includes('admin');
