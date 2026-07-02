import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Search, ChevronRight } from 'lucide-react';
import { reportsEngineApi } from '../../api/endpoints.js';

interface ReportDef {
  slug: string;
  name: string;
  category: string;
  description: string;
  permission: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  SALES: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  PURCHASE: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  INVENTORY: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  FINANCIAL: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  HR: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  GST: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
};

const CATEGORIES = ['ALL', 'SALES', 'PURCHASE', 'INVENTORY', 'FINANCIAL', 'HR', 'GST'];

export default function ReportsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('ALL');

  const { data, isLoading } = useQuery({
    queryKey: ['report-list'],
    queryFn: reportsEngineApi.list,
  });

  const allReports: ReportDef[] = data
    ? Object.values(data.grouped).flat() as ReportDef[]
    : [];

  const filtered = allReports.filter((r) => {
    const matchesSearch = !search
      || r.name.toLowerCase().includes(search.toLowerCase())
      || r.description.toLowerCase().includes(search.toLowerCase());
    const matchesCat = activeCategory === 'ALL' || r.category === activeCategory;
    return matchesSearch && matchesCat;
  });

  const grouped = filtered.reduce<Record<string, ReportDef[]>>((acc, r) => {
    if (!acc[r.category]) acc[r.category] = [];
    acc[r.category]!.push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <BarChart3 size={22} className="text-brand" /> Reports Browser
          </h1>
          <p className="text-sm text-secondary mt-0.5">
            {data?.total ?? 0} reports across 6 categories
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
          <input
            type="text"
            placeholder="Search reports..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-default bg-surface-card text-primary placeholder-secondary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeCategory === cat
                  ? 'bg-primary text-white'
                  : 'bg-surface-raised text-secondary hover:text-primary border border-default'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="text-secondary text-sm">Loading reports...</div>
      )}

      {/* Report groups */}
      {Object.entries(grouped).map(([category, reports]) => (
        <div key={category}>
          <div className="flex items-center gap-2 mb-3">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${CATEGORY_COLORS[category] ?? 'bg-surface-raised text-secondary'}`}>
              {category}
            </span>
            <span className="text-xs text-secondary">{reports.length} reports</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {reports.map((report) => (
              <button
                key={report.slug}
                onClick={() => navigate(`/reports/${report.slug}`)}
                className="text-left bg-surface-card border border-default rounded-xl p-4 hover:border-primary/50 hover:shadow-sm transition-all group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-primary group-hover:text-brand transition-colors">
                      {report.name}
                    </p>
                    <p className="text-xs text-secondary mt-0.5 line-clamp-2">{report.description}</p>
                  </div>
                  <ChevronRight size={14} className="text-secondary group-hover:text-primary transition-colors shrink-0 mt-0.5" />
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-16 text-secondary">
          <BarChart3 size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No reports match your search</p>
        </div>
      )}
    </div>
  );
}
