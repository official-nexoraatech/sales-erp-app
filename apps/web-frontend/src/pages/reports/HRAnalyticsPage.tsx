import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPErrorBoundary from '../../components/erp/ERPErrorBoundary.js';
import { ERPCardSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPDateRangePicker from '../../components/erp/ERPDateRangePicker.js';
import { reportsEngineApi } from '../../api/endpoints.js';

const COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
];

function fmt(n: number | undefined | null): string {
  if (n === null || n === undefined) return '–';
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

interface DepartmentRow {
  department: string;
  headcount: number | string;
}
interface SalaryTrendRow {
  month: string;
  employeeCount: number | string;
  grossSalaryCost: number | string;
  totalDeductions: number | string;
}
interface HiresExitsRow {
  month: string;
  newHires: number | string;
  exits: number | string;
}
interface GenderRow {
  gender: string;
  headcount: number | string;
}

function defaultFromDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 11);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

export default function HRAnalyticsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(defaultFromDate());
  const [toDate, setToDate] = useState(today);

  const { data: deptData, isLoading: deptLoading } = useQuery({
    queryKey: ['hr-headcount-by-department'],
    queryFn: async () =>
      (await reportsEngineApi.run('hr-headcount-by-department', {})) as { rows: DepartmentRow[] },
  });

  const { data: salaryData, isLoading: salaryLoading } = useQuery({
    queryKey: ['hr-salary-cost-trend', fromDate, toDate],
    queryFn: async () =>
      (await reportsEngineApi.run('hr-salary-cost-trend', { fromDate, toDate })) as {
        rows: SalaryTrendRow[];
      },
  });

  const { data: hiresData, isLoading: hiresLoading } = useQuery({
    queryKey: ['hr-hires-vs-exits', fromDate, toDate],
    queryFn: async () =>
      (await reportsEngineApi.run('hr-hires-vs-exits', { fromDate, toDate })) as {
        rows: HiresExitsRow[];
      },
  });

  const { data: genderData, isLoading: genderLoading } = useQuery({
    queryKey: ['hr-gender-diversity'],
    queryFn: async () =>
      (await reportsEngineApi.run('hr-gender-diversity', {})) as { rows: GenderRow[] },
  });

  const departments = (deptData?.rows ?? []).map((r) => ({
    department: r.department,
    headcount: Number(r.headcount),
  }));
  const salaryTrend = (salaryData?.rows ?? []).map((r) => ({
    month: r.month,
    grossSalaryCost: Number(r.grossSalaryCost),
    totalDeductions: Number(r.totalDeductions),
  }));
  const hiresExits = (hiresData?.rows ?? []).map((r) => ({
    month: r.month,
    newHires: Number(r.newHires),
    exits: Number(r.exits),
  }));
  const genderDiversity = (genderData?.rows ?? []).map((r) => ({
    gender: r.gender,
    headcount: Number(r.headcount),
  }));

  const isLoading = deptLoading || salaryLoading || hiresLoading || genderLoading;

  return (
    <ERPErrorBoundary>
      <div className="space-y-4">
        <ERPPageHeader
          variant="list"
          title="HR Analytics"
          subtitle="Headcount, salary cost trend, hiring activity and diversity"
          actions={
            <ERPDateRangePicker
              value={{ from: fromDate, to: toDate }}
              onChange={(range) => {
                setFromDate(range.from);
                setToDate(range.to);
              }}
            />
          }
        />

        {isLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <ERPCardSkeleton key={i} lines={4} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-surface-card border border-default rounded-xl p-4">
              <h3 className="text-sm font-semibold text-primary mb-3">Headcount by Department</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={departments} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="department" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar
                    dataKey="headcount"
                    name="Headcount"
                    fill="var(--chart-1)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-surface-card border border-default rounded-xl p-4">
              <h3 className="text-sm font-semibold text-primary mb-3">Gender Diversity</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={genderDiversity}
                    dataKey="headcount"
                    nameKey="gender"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                    labelLine={false}
                    style={{ fontSize: 10 }}
                  >
                    {genderDiversity.map((_entry, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-surface-card border border-default rounded-xl p-4 lg:col-span-2">
              <h3 className="text-sm font-semibold text-primary mb-3">Monthly Salary Cost Trend</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={salaryTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(v)} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    type="monotone"
                    dataKey="grossSalaryCost"
                    name="Gross Salary Cost"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="totalDeductions"
                    name="Deductions"
                    stroke="var(--chart-4)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-surface-card border border-default rounded-xl p-4 lg:col-span-2">
              <h3 className="text-sm font-semibold text-primary mb-3">New Hires vs Exits</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={hiresExits} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    dataKey="newHires"
                    name="New Hires"
                    fill="var(--chart-2)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar dataKey="exits" name="Exits" fill="var(--chart-4)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </ERPErrorBoundary>
  );
}
