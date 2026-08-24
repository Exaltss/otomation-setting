import { create } from 'zustand';
import { DEFAULT_ROUTER_POLICY, type RouterPolicy } from '../router/nineRouter';

interface AppState {
  routerPolicy: RouterPolicy;
  sampleInput: string;
  setRouterPolicy: (patch: Partial<RouterPolicy>) => void;
  setSampleInput: (value: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  routerPolicy: DEFAULT_ROUTER_POLICY,
  sampleInput: 'Buat automation untuk mengirim email ketika form masuk.',
  setRouterPolicy: (patch) =>
    set((state) => ({
      routerPolicy: { ...state.routerPolicy, ...patch },
    })),
  setSampleInput: (value) => set({ sampleInput: value }),
}));