import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPErrorBoundary from '../../components/erp/ERPErrorBoundary.js';
import { ERPDetailSkeleton } from '../../components/erp/ERPSkeleton.js';
import Button from '../../components/ui/Button.js';
import { formatCurrency } from '../../lib/format.js';

interface Earnings {
  basicSalary: number;
  hraAmount: number;
  daAmount: number;
  otherAllowances: number;
  pieceRateAmount: number;
}

interface Deductions {
  pfEmployee: number;
  esiEmployee: number;
  professionalTax: number;
  loanDeduction: number;
  tdsDeduction: number;
  totalDeductions: number;
}

interface PayslipData {
  id: number;
  employeeName: string | null;
  designation: string | null;
  payPeriod: string | null;
  presentDays: number;
  paidLeaveDays: number;
  lopDays: number;
  workingDays: number;
  earnings: Earnings;
  grossSalary: number;
  deductions: Deductions;
  pfEmployer: number;
  esiEmployer: number;
  netSalary: number;
  status: string;
}

function SalaryRow({ label, amount }: { label: string; amount: number }) {
  if (amount === 0) return null;
  return (
    <tr>
      <td className="py-1 text-sm text-secondary">{label}</td>
      <td className="py-1 text-sm text-right font-mono">{formatCurrency(amount)}</td>
    </tr>
  );
}

export default function PayslipViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ['payslip', id],
    queryFn: () => payrollApi.getSlip(Number(id)),
    enabled: !!id,
  });

  const slip = data as PayslipData | undefined;

  if (isLoading) return <ERPDetailSkeleton />;
  if (error || !slip) {
    return (
      <div className="p-8 text-center">
        <p className="text-error text-sm">Could not load payslip.</p>
        <Button variant="secondary" className="mt-4" onClick={() => navigate('/hr/payroll')}>Back</Button>
      </div>
    );
  }

  return (
    <ERPErrorBoundary>
      <div className="max-w-3xl mx-auto">
        <ERPPageHeader
          variant="detail"
          backTo="/hr/payroll"
          title={`Salary Slip — ${slip.payPeriod ?? ''}`}
          subtitle={slip.employeeName ?? ''}
          actions={
            <div className="flex gap-2 print:hidden">
              <Button variant="secondary" onClick={() => navigate(-1)}>Back</Button>
              <Button onClick={() => window.print()}>Print</Button>
            </div>
          }
        />

        <div className="bg-surface-card border border-default rounded-xl p-6 space-y-6 print:border-none print:shadow-none">
          {/* Employee info */}
          <div className="grid grid-cols-2 gap-4 border-b border-default pb-4">
            <div>
              <p className="text-xs text-secondary uppercase tracking-wide">Employee</p>
              <p className="font-semibold text-primary">{slip.employeeName ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-secondary uppercase tracking-wide">Designation</p>
              <p className="text-primary">{slip.designation ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-secondary uppercase tracking-wide">Pay Period</p>
              <p className="text-primary">{slip.payPeriod ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-secondary uppercase tracking-wide">Status</p>
              <p className="text-primary">{slip.status}</p>
            </div>
          </div>

          {/* Attendance summary */}
          <div className="grid grid-cols-4 gap-4 border-b border-default pb-4">
            <div className="text-center">
              <p className="text-xs text-secondary">Working Days</p>
              <p className="font-semibold">{slip.workingDays}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-secondary">Present</p>
              <p className="font-semibold">{slip.presentDays}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-secondary">Paid Leave</p>
              <p className="font-semibold">{slip.paidLeaveDays}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-secondary">LOP</p>
              <p className="font-semibold text-error">{slip.lopDays}</p>
            </div>
          </div>

          {/* Earnings and Deductions */}
          <div className="grid grid-cols-2 gap-8">
            <div>
              <h3 className="text-sm font-semibold text-primary mb-3 uppercase tracking-wide">Earnings</h3>
              <table className="w-full">
                <tbody>
                  <SalaryRow label="Basic Salary" amount={slip.earnings.basicSalary} />
                  <SalaryRow label="HRA" amount={slip.earnings.hraAmount} />
                  <SalaryRow label="DA" amount={slip.earnings.daAmount} />
                  <SalaryRow label="Other Allowances" amount={slip.earnings.otherAllowances} />
                  <SalaryRow label="Piece Rate" amount={slip.earnings.pieceRateAmount} />
                  <tr className="border-t border-default">
                    <td className="py-2 text-sm font-semibold text-primary">Gross Salary</td>
                    <td className="py-2 text-sm font-semibold text-right font-mono">{formatCurrency(slip.grossSalary)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-primary mb-3 uppercase tracking-wide">Deductions</h3>
              <table className="w-full">
                <tbody>
                  <SalaryRow label="PF (Employee)" amount={slip.deductions.pfEmployee} />
                  <SalaryRow label="ESI (Employee)" amount={slip.deductions.esiEmployee} />
                  <SalaryRow label="Professional Tax" amount={slip.deductions.professionalTax} />
                  <SalaryRow label="Loan Deduction" amount={slip.deductions.loanDeduction} />
                  <SalaryRow label="TDS" amount={slip.deductions.tdsDeduction} />
                  <tr className="border-t border-default">
                    <td className="py-2 text-sm font-semibold text-primary">Total Deductions</td>
                    <td className="py-2 text-sm font-semibold text-right font-mono text-error">{formatCurrency(slip.deductions.totalDeductions)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Net Salary */}
          <div className="border-t border-default pt-4 flex justify-between items-center">
            <p className="text-base font-bold text-primary">Net Salary</p>
            <p className="text-xl font-bold text-primary font-mono">{formatCurrency(slip.netSalary)}</p>
          </div>

          {/* Employer contributions */}
          <div className="bg-surface-subtle rounded-lg p-4 text-sm">
            <p className="text-xs text-secondary uppercase tracking-wide mb-2">Employer Contributions</p>
            <div className="flex gap-8">
              {slip.pfEmployer > 0 && <span>PF: <strong>{formatCurrency(slip.pfEmployer)}</strong></span>}
              {slip.esiEmployer > 0 && <span>ESI: <strong>{formatCurrency(slip.esiEmployer)}</strong></span>}
            </div>
          </div>
        </div>
      </div>
    </ERPErrorBoundary>
  );
}
