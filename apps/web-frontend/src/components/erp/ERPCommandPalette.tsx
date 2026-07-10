import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, X, Clock, ArrowUpRight, WifiOff, SlidersHorizontal, Bookmark, BookmarkPlus, Trash2, Terminal, SunMoon } from 'lucide-react';
import { searchApi, savedSearchApi, searchAnalyticsApi, type SearchHit, type SavedSearch } from '../../api/endpoints.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useRecentSearchesStore } from '../../store/recentSearches.store.js';
import { SEARCH_ENTITY_CONFIG, getSearchResultTitle, getSearchResultSubtitle, getSearchResultRoute } from '../../lib/searchEntityConfig.js';
import { NAV_GROUPS, filterNavGroups, findNavItemByPath } from '../../lib/navigation.js';
import { QUICK_CREATE_ITEMS, filterQuickCreateItems } from '../../lib/quickCreate.js';
import { useAuthStore } from '../../store/auth.store.js';
import { useUIStore } from '../../store/ui.store.js';
import { useTheme } from '../../context/ThemeContext.js';
import ERPEmptyState from './ERPEmptyState.js';
import Kbd from './Kbd.js';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-fills the query on open — e.g. Ctrl/Cmd+Shift+N opens straight into `>create `
   * action-mode results (ERP-PLANNING/02_ERP_NAVIGATION_ARCHITECTURE.md §12). */
  initialQuery?: string;
}

interface FlatRow {
  key: string;
  title: string;
  subtitle: string | undefined;
  groupLabel: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  route: string | undefined;
  hit?: SearchHit;
  // A saved search doesn't navigate anywhere on select — it re-runs itself (populates the
  // query/filters). Kept separate from `route` rather than overloading it, since "no route"
  // already means something else (non-navigable result row, see searchEntityConfig.ts).
  savedSearch?: SavedSearch;
  // Action-mode (`>` prefix, ERP-PLANNING/02_ERP_NAVIGATION_ARCHITECTURE.md §9) row — runs a
  // callback instead of navigating via `route`. Every sidebar-reachable route and quick-create
  // entry is generated into this list, not hand-maintained separately.
  action?: { onRun: () => void };
}

// Renders an ES highlight fragment (e.g. "<em>Ramesh</em> Textiles") as plain React text
// nodes rather than dangerouslySetInnerHTML — ES only wraps the matched substring in <em>,
// it does not escape the surrounding text, so a customer/item name containing HTML-special
// characters would otherwise be a stored-XSS vector. Splitting on the tags and letting React
// render each segment as text keeps everything auto-escaped.
function HighlightedText({ fragment }: { fragment: string }) {
  const parts = fragment.split(/(<em>.*?<\/em>)/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = /^<em>(.*)<\/em>$/.exec(part);
        return match ? <mark key={i} className="bg-warning-bg text-warning-fg rounded px-0.5">{match[1]}</mark> : <span key={i}>{part}</span>;
      })}
    </>
  );
}

function firstHighlight(hit: SearchHit): string | undefined {
  if (!hit.highlight) return undefined;
  const firstField = Object.values(hit.highlight)[0];
  return firstField?.[0];
}

export default function ERPCommandPalette({ open, onClose, initialQuery = '' }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuthStore();
  const { toggleTheme } = useTheme();
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [savingName, setSavingName] = useState<string | null>(null);
  const debouncedQuery = useDebounce(query, 300);
  const debouncedStatus = useDebounce(status, 300);
  const { items: recentItems, addItem: addRecentItem, clear: clearRecent } = useRecentSearchesStore();
  const recentPages = useUIStore((s) => s.recentPages);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Action mode (`>` prefix) — ERP-PLANNING/02_ERP_NAVIGATION_ARCHITECTURE.md §9. Every
  // sidebar-reachable route (via NAV_GROUPS) and every quick-create entry becomes a runnable
  // command, generated from the same registries the sidebar/header already use — not
  // hand-maintained as a separate list.
  const isActionMode = query.trimStart().startsWith('>');
  const actionQuery = isActionMode ? query.trimStart().slice(1).trim().toLowerCase() : '';

  const commandRegistry = useMemo(() => {
    const commands: { key: string; label: string; icon: FlatRow['icon']; onRun: () => void }[] = [];
    const navGroups = filterNavGroups(NAV_GROUPS, hasPermission);
    for (const group of navGroups) {
      for (const item of group.items) {
        if (item.children) {
          for (const child of item.children) {
            commands.push({ key: `nav-${child.path}`, label: `Go to ${item.label} → ${child.label}`, icon: child.icon, onRun: () => navigate(child.path) });
          }
        } else {
          commands.push({ key: `nav-${item.path}`, label: `Go to ${item.label}`, icon: item.icon, onRun: () => navigate(item.path) });
        }
      }
    }
    for (const item of filterQuickCreateItems(QUICK_CREATE_ITEMS, hasPermission)) {
      commands.push({ key: `create-${item.path}`, label: `Create ${item.label}`, icon: item.icon, onRun: () => navigate(item.path) });
    }
    commands.push({ key: 'toggle-theme', label: 'Toggle light/dark theme', icon: SunMoon, onRun: toggleTheme });
    return commands;
  }, [hasPermission, navigate, toggleTheme]);

  const actionRows: FlatRow[] = useMemo(() => {
    const filtered = actionQuery
      ? commandRegistry.filter((c) => c.label.toLowerCase().includes(actionQuery))
      : commandRegistry;
    return filtered.slice(0, 30).map((c) => ({
      key: c.key,
      title: c.label,
      subtitle: undefined,
      groupLabel: 'Commands',
      icon: c.icon,
      route: undefined,
      action: { onRun: c.onRun },
    }));
  }, [commandRegistry, actionQuery]);

  const trimmedQuery = debouncedQuery.trim();
  const isSearching = !isActionMode && trimmedQuery.length > 0;
  const hasActiveFilters = Boolean(debouncedStatus || dateFrom || dateTo);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['global-search', trimmedQuery, debouncedStatus, dateFrom, dateTo],
    queryFn: () => searchApi.search({
      q: trimmedQuery,
      size: 30,
      ...(debouncedStatus ? { status: debouncedStatus } : {}),
      // '_indexed_at' is the one date field SearchEngine.index() stamps onto every document
      // regardless of entity (see SearchEngine.ts) — most per-entity date fields
      // (invoiceDate, quotationDate, etc.) aren't present across every entity, so filtering
      // by them here would silently no-op for entities that lack that field.
      ...(dateFrom ? { dateFrom, dateField: '_indexed_at' } : {}),
      ...(dateTo ? { dateTo, dateField: '_indexed_at' } : {}),
    }),
    enabled: open && isSearching,
    staleTime: 10_000,
  });

  const { data: savedSearchesData } = useQuery({
    queryKey: ['saved-searches'],
    queryFn: () => savedSearchApi.list(),
    enabled: open,
    staleTime: 30_000,
  });
  const savedSearches = savedSearchesData?.content ?? [];

  const createSavedSearch = useMutation({
    mutationFn: (name: string) => savedSearchApi.create({ name, query: trimmedQuery }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['saved-searches'] }); setSavingName(null); },
  });
  const deleteSavedSearch = useMutation({
    mutationFn: (id: number) => savedSearchApi.delete(id),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['saved-searches'] }); },
  });

  // Reset transient state whenever the palette opens, and move focus/restore it on close —
  // ERPDrawer/Modal in this codebase don't do focus restore either; this is a fresh
  // component, so it's built in from the start rather than retrofitted later.
  useEffect(() => {
    if (open) {
      previouslyFocused.current = document.activeElement as HTMLElement;
      setQuery(initialQuery);
      setHighlightedIndex(0);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    previouslyFocused.current?.focus();
    return undefined;
    // initialQuery is intentionally excluded — it should only seed the query the moment the
    // palette transitions to open, not re-apply on every re-render while already open (which
    // would stomp the user's own typing if the caller's initialQuery prop identity changes).
  }, [open]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const groupedResults = useMemo(() => {
    const hits = data?.hits ?? [];
    const groups = new Map<string, SearchHit[]>();
    for (const hit of hits) {
      const config = SEARCH_ENTITY_CONFIG[hit.entity];
      const groupLabel = config?.groupLabel ?? hit.entity;
      if (!groups.has(groupLabel)) groups.set(groupLabel, []);
      groups.get(groupLabel)!.push(hit);
    }
    return groups;
  }, [data]);

  const flatRows: FlatRow[] = useMemo(() => {
    if (isActionMode) return actionRows;
    if (!isSearching) {
      const recentPageRows: FlatRow[] = recentPages.map((p) => ({
        key: `recent-page-${p.path}`,
        title: p.label,
        subtitle: undefined,
        groupLabel: 'Recent Pages',
        icon: findNavItemByPath(NAV_GROUPS, p.path)?.icon ?? Clock,
        route: p.path,
      }));
      const savedRows: FlatRow[] = savedSearches.map((s) => ({
        key: `saved-${s.id}`,
        title: s.name,
        subtitle: `"${s.query}"`,
        groupLabel: 'Saved Searches',
        icon: Bookmark,
        route: undefined,
        savedSearch: s,
      }));
      const recentRows: FlatRow[] = recentItems.map((r) => ({
        key: `recent-${r.entity}-${r.id}`,
        title: r.label,
        subtitle: r.subtitle,
        groupLabel: 'Recent',
        icon: SEARCH_ENTITY_CONFIG[r.entity]?.icon ?? Clock,
        route: r.route,
      }));
      return [...recentPageRows, ...savedRows, ...recentRows];
    }
    const rows: FlatRow[] = [];
    for (const [groupLabel, hits] of groupedResults) {
      for (const hit of hits) {
        const config = SEARCH_ENTITY_CONFIG[hit.entity];
        rows.push({
          key: `${hit.entity}-${hit.id}`,
          title: getSearchResultTitle(hit),
          subtitle: getSearchResultSubtitle(hit),
          groupLabel,
          icon: config?.icon ?? Search,
          route: getSearchResultRoute(hit),
          hit,
        });
      }
    }
    return rows;
  }, [isActionMode, actionRows, isSearching, recentItems, recentPages, groupedResults, savedSearches]);

  function selectRow(row: FlatRow): void {
    if (row.action) {
      row.action.onRun();
      onClose();
      return;
    }
    // A saved search re-runs itself (populates the query box) instead of navigating —
    // there's no single "record" it points to.
    if (row.savedSearch) {
      setQuery(row.savedSearch.query);
      return;
    }
    // Only record + navigate when there's actually somewhere to go — a non-navigable row
    // (no mapped detail page yet, see searchEntityConfig.ts) recorded as "recent" would be
    // just as un-clickable the next time it's shown, which isn't a useful recent item.
    if (!row.route) return;
    if (row.hit) {
      addRecentItem({
        id: row.hit.id,
        entity: row.hit.entity,
        label: row.title,
        ...(row.subtitle !== undefined ? { subtitle: row.subtitle } : {}),
        route: row.route,
      });
      // Fire-and-forget: closes the analytics loop (Phase 8) without making the click feel
      // slower — a failed/late tracking call should never block navigation.
      searchAnalyticsApi.trackClick({ query: trimmedQuery, resultId: row.hit.id, resultEntity: row.hit.entity }).catch(() => {});
    }
    navigate(row.route);
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, flatRows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = flatRows[highlightedIndex];
      if (row) selectRow(row);
    } else if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Tab') {
      // Focus trap: this is a fresh component, so it traps Tab from the start rather than
      // needing a later retrofit (unlike Modal/ERPDrawer elsewhere in this codebase).
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  if (!open) return null;

  const showOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  return (
    <div
      className="fixed inset-0 flex items-start sm:items-center justify-center p-0 sm:p-4"
      style={{ zIndex: 'var(--z-modal)' }}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Global search"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        className="relative w-full h-full sm:h-auto sm:max-w-2xl sm:mt-[10vh] sm:max-h-[70vh] flex flex-col bg-surface-card sm:rounded-2xl shadow-token-modal overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-default shrink-0">
          <Search size={18} className="text-secondary shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlightedIndex(0); }}
            placeholder="Search pages, records... (type > for commands)"
            aria-label="Search"
            className="flex-1 bg-transparent outline-none text-primary placeholder:text-disabled text-sm"
          />
          {isSearching && (
            <button
              onClick={() => setSavingName(savingName === null ? '' : null)}
              aria-label="Save this search"
              title="Save this search"
              className={`shrink-0 transition-colors ${savingName !== null ? 'text-primary' : 'text-secondary hover:text-primary'}`}
            >
              <BookmarkPlus size={16} />
            </button>
          )}
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            aria-label="Toggle advanced filters"
            title="Filters"
            className={`shrink-0 transition-colors ${filtersOpen || hasActiveFilters ? 'text-primary' : 'text-secondary hover:text-primary'}`}
          >
            <SlidersHorizontal size={16} />
          </button>
          <button onClick={onClose} aria-label="Close search" className="text-secondary hover:text-primary transition-colors shrink-0">
            <X size={18} />
          </button>
        </div>

        {savingName !== null && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-default shrink-0 bg-surface-raised">
            <input
              autoFocus
              value={savingName}
              onChange={(e) => setSavingName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && savingName.trim()) createSavedSearch.mutate(savingName.trim()); }}
              placeholder="Name this search..."
              aria-label="Saved search name"
              className="flex-1 bg-transparent outline-none text-sm text-primary placeholder:text-disabled"
            />
            <button
              onClick={() => savingName.trim() && createSavedSearch.mutate(savingName.trim())}
              disabled={!savingName.trim() || createSavedSearch.isPending}
              className="text-xs font-medium text-primary disabled:opacity-50"
            >
              Save
            </button>
          </div>
        )}

        {filtersOpen && (
          <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-default shrink-0 bg-surface-raised text-xs">
            <label className="flex items-center gap-1.5 text-secondary">
              Status
              <input
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                placeholder="e.g. ACTIVE"
                className="w-28 px-2 py-1 rounded border border-default bg-surface-card text-primary outline-none"
              />
            </label>
            <label className="flex items-center gap-1.5 text-secondary">
              From
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-2 py-1 rounded border border-default bg-surface-card text-primary outline-none"
              />
            </label>
            <label className="flex items-center gap-1.5 text-secondary">
              To
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-2 py-1 rounded border border-default bg-surface-card text-primary outline-none"
              />
            </label>
            {hasActiveFilters && (
              <button
                onClick={() => { setStatus(''); setDateFrom(''); setDateTo(''); }}
                className="text-secondary hover:text-primary transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {isActionMode && flatRows.length === 0 ? (
            <ERPEmptyState type="no-results" icon={Terminal} description={`No commands match "${actionQuery}".`} />
          ) : showOffline && !isActionMode ? (
            <ERPEmptyState type="error" icon={WifiOff} title="You're offline" description="Global search needs a network connection. Reconnect and try again." />
          ) : isSearching && isLoading ? (
            <div className="py-6 space-y-3 px-4" aria-busy="true" aria-label="Searching">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 rounded-lg bg-surface-raised animate-pulse" />
              ))}
            </div>
          ) : isSearching && isError ? (
            <ERPEmptyState type="error" description="Search is temporarily unavailable. Please try again." />
          ) : isSearching && flatRows.length === 0 ? (
            <ERPEmptyState type="no-results" description={`No results for "${trimmedQuery}". Try a different search term.`} />
          ) : !isSearching && !isActionMode && flatRows.length === 0 ? (
            <div className="py-12 px-6 text-center">
              <p className="text-sm text-secondary">Start typing to search across customers, invoices, items and more.</p>
              <p className="text-xs text-disabled mt-2">Tip: type <Kbd>{'>'}</Kbd> for commands, or press <Kbd>Esc</Kbd> to close</p>
            </div>
          ) : (
            <div className="py-2">
              {Array.from(new Set(flatRows.map((r) => r.groupLabel))).map((groupLabel) => {
                let renderedGroupHeader = false;
                return flatRows
                  .filter((r) => r.groupLabel === groupLabel)
                  .map((row) => {
                    const idx = flatRows.indexOf(row);
                    const showHeader = !renderedGroupHeader;
                    renderedGroupHeader = true;
                    return (
                      <div key={row.key}>
                        {showHeader && (
                          <div className="flex items-center justify-between px-4 pt-2 pb-1">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-secondary select-none">{groupLabel}</p>
                            {groupLabel === 'Recent' && (
                              <button onClick={clearRecent} className="text-xs text-secondary hover:text-primary transition-colors">Clear</button>
                            )}
                          </div>
                        )}
                        <CommandRow
                          row={row}
                          highlighted={idx === highlightedIndex}
                          onSelect={() => selectRow(row)}
                          onMouseEnter={() => setHighlightedIndex(idx)}
                          {...(row.savedSearch ? { onDelete: () => deleteSavedSearch.mutate(row.savedSearch!.id) } : {})}
                        />
                      </div>
                    );
                  });
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CommandRow({ row, highlighted, onSelect, onMouseEnter, onDelete }: {
  row: FlatRow;
  highlighted: boolean;
  onSelect: () => void;
  onMouseEnter: () => void;
  onDelete?: () => void;
}) {
  const Icon = row.icon;
  const highlight = row.hit ? firstHighlight(row.hit) : undefined;
  // A saved search has no `route` (it re-runs itself instead of navigating) but is still a
  // real, clickable action — only a search-result row with no mapped detail page is truly
  // non-actionable.
  const actionable = Boolean(row.route) || Boolean(row.savedSearch) || Boolean(row.action);

  return (
    <div className={`flex items-center gap-1 ${highlighted ? 'bg-surface-raised' : ''}`}>
      <button
        onClick={onSelect}
        onMouseEnter={onMouseEnter}
        disabled={!actionable}
        className={`flex-1 min-w-0 flex items-center gap-3 px-4 py-2 text-left transition-colors ${
          actionable ? 'cursor-pointer' : 'cursor-default opacity-60'
        }`}
      >
        <Icon size={16} className="text-secondary shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-primary truncate">
            {highlight ? <HighlightedText fragment={highlight} /> : row.title}
          </p>
          {row.subtitle && <p className="text-xs text-secondary truncate">{row.subtitle}</p>}
        </div>
        {Boolean(row.route) && <ArrowUpRight size={14} className="text-disabled shrink-0" />}
      </button>
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          aria-label={`Delete saved search "${row.title}"`}
          className="p-2 mr-2 text-disabled hover:text-danger transition-colors shrink-0"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}
