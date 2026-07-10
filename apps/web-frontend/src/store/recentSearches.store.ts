import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface RecentSearchItem {
  id: string;
  entity: string;
  label: string;
  subtitle?: string;
  route?: string;
}

interface RecentSearchesState {
  items: RecentSearchItem[];
  addItem: (item: RecentSearchItem) => void;
  clear: () => void;
}

const MAX_RECENT_ITEMS = 10;

// Recent command-palette selections, per Part 22 of the design system ("Recent items
// stored in Zustand + localStorage, up to 10"). Follows ui.store.ts's persist pattern.
export const useRecentSearchesStore = create<RecentSearchesState>()(
  persist(
    (set) => ({
      items: [],
      addItem: (item) =>
        set((s) => ({
          items: [
            item,
            ...s.items.filter((i) => !(i.id === item.id && i.entity === item.entity)),
          ].slice(0, MAX_RECENT_ITEMS),
        })),
      clear: () => set({ items: [] }),
    }),
    { name: 'nexoraa-recent-searches' }
  )
);
