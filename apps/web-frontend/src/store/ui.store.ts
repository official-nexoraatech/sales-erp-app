import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Density = 'compact' | 'comfortable' | 'spacious';

interface UIState {
  sidebarCollapsed: boolean;
  density: Density;
  setSidebarCollapsed: (v: boolean) => void;
  toggleSidebar: () => void;
  setDensity: (v: Density) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      density: 'comfortable',
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setDensity: (v) => set({ density: v }),
    }),
    {
      name: 'nexoraa-ui',
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, density: s.density }),
    }
  )
);
