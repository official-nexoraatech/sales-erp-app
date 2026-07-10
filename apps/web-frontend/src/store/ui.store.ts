import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Density = 'compact' | 'comfortable' | 'spacious';

export interface RecentPage {
  path: string;
  label: string;
}

const MAX_RECENT_PAGES = 8;

interface UIState {
  sidebarCollapsed: boolean;
  density: Density;
  recentPages: RecentPage[];
  setSidebarCollapsed: (v: boolean) => void;
  toggleSidebar: () => void;
  setDensity: (v: Density) => void;
  /** Per ERP-PLANNING/02_ERP_NAVIGATION_ARCHITECTURE.md §10 — last 8 visited routes, most recent first. */
  pushRecentPage: (page: RecentPage) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      density: 'comfortable',
      recentPages: [],
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setDensity: (v) => set({ density: v }),
      pushRecentPage: (page) =>
        set((s) => ({
          recentPages: [page, ...s.recentPages.filter((p) => p.path !== page.path)].slice(0, MAX_RECENT_PAGES),
        })),
    }),
    {
      name: 'nexoraa-ui',
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, density: s.density, recentPages: s.recentPages }),
    }
  )
);
