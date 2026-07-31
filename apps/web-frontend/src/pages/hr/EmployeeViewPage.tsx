import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Download, Trash2, Upload, UserRound } from 'lucide-react';
import {
  employeeApi,
  leaveApi,
  employeeFilesApi,
  employeeLoanApi,
  employeeNomineeApi,
  employeeHistoryApi,
  exitWorkflowApi,
  type EmployeeDocument,
} from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPDetailSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPConfirmModal from '../../components/erp/ERPConfirmModal.js';
import Badge from '../../components/ui/Badge.js';
import Button from '../../components/ui/Button.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface Employee {
  id: number;
  employeeCode: string;
  displayName: string;
  phone: string;
  email?: string;
  gender?: string;
  employmentType: string;
  joiningDate: string;
  exitDate?: string;
  status: string;
  hasSalaryData: boolean;
  hasPhoto?: boolean;
  uan?: string;
  esiNumber?: string;
  pfApplicable: boolean;
  esiApplicable: boolean;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const DOCUMENT_TYPES = [
  { value: 'AADHAAR', label: 'Aadhaar' },
  { value: 'PAN', label: 'PAN Card' },
  { value: 'CERTIFICATE', label: 'Education Certificate' },
  { value: 'OFFER_LETTER', label: 'Offer Letter' },
  { value: 'OTHER', label: 'Other' },
];

// Photo/document endpoints require an Authorization header, so a plain <img src> can't
// hit them directly — fetch the blob via apiClient (which attaches the bearer token) and
// render it through a revocable object URL instead.
function useObjectUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  return url;
}

interface LeaveBalance {
  leaveTypeId: number;
  totalDays: string;
  usedDays: string;
  pendingDays: string;
  carriedForwardDays: string;
}

interface EmployeeLoan {
  id: number;
  loanType: string;
  principalAmount: string;
  disbursedAmount: string;
  tenureMonths: number;
  monthlyDeduction: string;
  outstandingBalance: string;
  status: string;
  disbursedDate: string;
}

const LOAN_TYPES = [
  { value: 'SALARY_ADVANCE', label: 'Salary Advance' },
  { value: 'FESTIVAL_ADVANCE', label: 'Festival Advance' },
  { value: 'GENERAL', label: 'General Loan' },
];

interface Nominee {
  id: number;
  name: string;
  relationship: string;
  sharePercentage: string;
  contactNumber?: string;
  isPrimary: boolean;
}

const RELATIONSHIP_TYPES = [
  { value: 'SPOUSE', label: 'Spouse' },
  { value: 'PARENT', label: 'Parent' },
  { value: 'CHILD', label: 'Child' },
  { value: 'SIBLING', label: 'Sibling' },
  { value: 'OTHER', label: 'Other' },
];

interface HistoryRow {
  id: number;
  changeType: string;
  effectiveDate: string;
  previousValue: Record<string, unknown>;
  newValue: Record<string, unknown>;
  reason?: string;
}

const CHANGE_TYPE_LABELS: Record<string, string> = {
  PROMOTION: 'Promotion',
  TRANSFER: 'Branch Transfer',
  INCREMENT: 'Salary Revision',
  DEPARTMENT_CHANGE: 'Department Change',
  DESIGNATION_CHANGE: 'Designation Change',
  MANAGER_CHANGE: 'Manager Change',
};

interface ExitWorkflow {
  id: number;
  resignationDate: string;
  lastWorkingDate: string;
  noticePeriodDays: number;
  clearanceStatus: 'PENDING' | 'CLEARED';
  fnfStatus: 'PENDING' | 'SETTLED';
  fnfTotalAmount?: string;
  proRatedSalaryAmount?: string;
  leaveEncashmentAmount?: string;
  loanRecoveryAmount?: string;
}

export default function EmployeeViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [exitModalOpen, setExitModalOpen] = useState(false);
  const [exitDate, setExitDate] = useState('');
  const [exitReason, setExitReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['employees', id],
    queryFn: () => employeeApi.getById(Number(id)),
  });
  const employee =
    ((data as Record<string, unknown>)?.data as Employee) ?? (data as unknown as Employee);

  const { data: balanceData } = useQuery({
    queryKey: ['leave-balance', id],
    queryFn: () => leaveApi.balance(Number(id)),
    enabled: hasPermission(PERMISSIONS.LEAVE_VIEW),
  });
  const balances: LeaveBalance[] =
    ((balanceData as Record<string, unknown>)?.content as LeaveBalance[]) ?? [];

  const canManageLoans = hasPermission(PERMISSIONS.EMPLOYEE_LOAN_MANAGE);
  const [showLoanForm, setShowLoanForm] = useState(false);
  const [loanType, setLoanType] = useState('SALARY_ADVANCE');
  const [loanPrincipal, setLoanPrincipal] = useState('');
  const [loanTenure, setLoanTenure] = useState('');
  const [loanDisbursedDate, setLoanDisbursedDate] = useState(new Date().toISOString().slice(0, 10));

  const { data: loansData, isLoading: loansLoading } = useQuery({
    queryKey: ['employee-loans', id],
    queryFn: () => employeeLoanApi.list(Number(id)),
    enabled: canManageLoans,
  });
  const loans: EmployeeLoan[] = (loansData as EmployeeLoan[]) ?? [];

  const createLoanMutation = useMutation({
    mutationFn: () =>
      employeeLoanApi.create({
        employeeId: Number(id),
        loanType,
        principalAmount: parseFloat(loanPrincipal),
        tenureMonths: parseInt(loanTenure, 10),
        disbursedDate: loanDisbursedDate,
      }),
    onSuccess: () => {
      toast.success('Loan disbursed');
      setShowLoanForm(false);
      setLoanPrincipal('');
      setLoanTenure('');
      qc.invalidateQueries({ queryKey: ['employee-loans', id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const closeLoanMutation = useMutation({
    mutationFn: (loanId: number) => employeeLoanApi.updateStatus(loanId, 'CLOSED'),
    onSuccess: () => {
      toast.success('Loan closed');
      setCloseLoanId(null);
      qc.invalidateQueries({ queryKey: ['employee-loans', id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const exitMutation = useMutation({
    mutationFn: () => employeeApi.exit(Number(id), { exitDate, exitReason }),
    onSuccess: () => {
      toast.success('Employee exit recorded');
      qc.invalidateQueries({ queryKey: ['employees'] });
      setExitModalOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Nominees ──────────────────────────────────────────────────────────────
  const [showNomineeForm, setShowNomineeForm] = useState(false);
  const [nomineeName, setNomineeName] = useState('');
  const [nomineeRelationship, setNomineeRelationship] = useState('SPOUSE');
  const [nomineeShare, setNomineeShare] = useState('100');
  const [nomineeContact, setNomineeContact] = useState('');
  const [deleteNomineeId, setDeleteNomineeId] = useState<number | null>(null);

  const { data: nomineesData, isLoading: nomineesLoading } = useQuery({
    queryKey: ['employee-nominees', id],
    queryFn: () => employeeNomineeApi.list(Number(id)),
    enabled: hasPermission(PERMISSIONS.EMPLOYEE_VIEW),
  });
  const nominees: Nominee[] =
    ((nomineesData as Record<string, unknown>)?.content as Nominee[]) ?? [];

  const createNomineeMutation = useMutation({
    mutationFn: () =>
      employeeNomineeApi.create(Number(id), {
        name: nomineeName,
        relationship: nomineeRelationship,
        sharePercentage: parseFloat(nomineeShare),
        ...(nomineeContact ? { contactNumber: nomineeContact } : {}),
      }),
    onSuccess: () => {
      toast.success('Nominee added');
      setShowNomineeForm(false);
      setNomineeName('');
      setNomineeContact('');
      setNomineeShare('100');
      qc.invalidateQueries({ queryKey: ['employee-nominees', id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteNomineeMutation = useMutation({
    mutationFn: (nomineeId: number) => employeeNomineeApi.remove(Number(id), nomineeId),
    onSuccess: () => {
      toast.success('Nominee removed');
      setDeleteNomineeId(null);
      qc.invalidateQueries({ queryKey: ['employee-nominees', id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── History (increments/promotions/transfers) ────────────────────────────
  const { data: historyData } = useQuery({
    queryKey: ['employee-history', id],
    queryFn: () => employeeHistoryApi.list(Number(id)),
    enabled: hasPermission(PERMISSIONS.EMPLOYEE_VIEW),
  });
  const history: HistoryRow[] =
    ((historyData as Record<string, unknown>)?.content as HistoryRow[]) ?? [];

  // ── Exit workflow: notice period, clearance, Full & Final settlement ────
  const canManageExit = hasPermission(PERMISSIONS.EMPLOYEE_UPDATE);
  const [showExitWorkflowForm, setShowExitWorkflowForm] = useState(false);
  const [resignationDate, setResignationDate] = useState('');
  const [lastWorkingDate, setLastWorkingDate] = useState('');
  const [noticePeriodDays, setNoticePeriodDays] = useState('30');

  const { data: exitWorkflowData } = useQuery({
    queryKey: ['exit-workflow', id],
    queryFn: () => exitWorkflowApi.get(Number(id)),
    enabled: canManageExit && employee?.status !== 'ACTIVE',
  });
  const exitWorkflow = (exitWorkflowData as ExitWorkflow | null) ?? undefined;

  const startExitWorkflowMutation = useMutation({
    mutationFn: () =>
      exitWorkflowApi.start(Number(id), {
        resignationDate,
        lastWorkingDate,
        noticePeriodDays: parseInt(noticePeriodDays, 10),
        exitReason,
      }),
    onSuccess: () => {
      toast.success('Exit workflow started');
      setShowExitWorkflowForm(false);
      qc.invalidateQueries({ queryKey: ['exit-workflow', id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clearExitMutation = useMutation({
    mutationFn: () => exitWorkflowApi.clear(Number(id)),
    onSuccess: () => {
      toast.success('Clearance marked complete');
      qc.invalidateQueries({ queryKey: ['exit-workflow', id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: fnfPreview, refetch: refetchFnfPreview } = useQuery({
    queryKey: ['exit-fnf-preview', id],
    queryFn: () => exitWorkflowApi.computeFnf(Number(id)),
    enabled: false,
  });

  const settleFnfMutation = useMutation({
    mutationFn: () => {
      if (!fnfPreview) throw new Error('Compute the F&F breakup first');
      return exitWorkflowApi.settle(Number(id), fnfPreview);
    },
    onSuccess: () => {
      toast.success('Full & Final settlement recorded');
      qc.invalidateQueries({ queryKey: ['exit-workflow', id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const photoInputRef = useRef<HTMLInputElement>(null);
  const { data: photoBlob } = useQuery({
    queryKey: ['employee-photo', id],
    queryFn: () => employeeFilesApi.photoBlob(Number(id)),
    enabled: !!employee?.hasPhoto,
  });
  const photoUrl = useObjectUrl(photoBlob);

  const uploadPhotoMutation = useMutation({
    mutationFn: (file: File) => employeeFilesApi.uploadPhoto(Number(id), file),
    onSuccess: () => {
      toast.success('Photo uploaded');
      qc.invalidateQueries({ queryKey: ['employees', id] });
      qc.invalidateQueries({ queryKey: ['employee-photo', id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handlePhotoChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      toast.error('File exceeds the 10MB size limit');
      return;
    }
    uploadPhotoMutation.mutate(file);
  };

  const documentFileInputRef = useRef<HTMLInputElement>(null);
  const [documentType, setDocumentType] = useState('AADHAAR');
  const [deleteDocumentId, setDeleteDocumentId] = useState<number | null>(null);
  const [closeLoanId, setCloseLoanId] = useState<number | null>(null);
  const documentsQueryKey = ['employee-documents', id];

  const { data: documents, isLoading: documentsLoading } = useQuery({
    queryKey: documentsQueryKey,
    queryFn: () => employeeFilesApi.documents(Number(id)),
    enabled: hasPermission(PERMISSIONS.EMPLOYEE_VIEW),
  });

  const uploadDocumentMutation = useMutation({
    mutationFn: (file: File) => employeeFilesApi.uploadDocument(Number(id), documentType, file),
    onSuccess: () => {
      toast.success('Document uploaded');
      void qc.invalidateQueries({ queryKey: documentsQueryKey });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: (attachmentId: number) => employeeFilesApi.deleteDocument(Number(id), attachmentId),
    onSuccess: () => {
      toast.success('Document deleted');
      void qc.invalidateQueries({ queryKey: documentsQueryKey });
      setDeleteDocumentId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleDocumentFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      toast.error('File exceeds the 10MB size limit');
      return;
    }
    uploadDocumentMutation.mutate(file);
  };

  const handleDocumentDownload = async (doc: EmployeeDocument) => {
    try {
      const blob = await employeeFilesApi.downloadDocument(Number(id), doc.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = doc.fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download failed');
    }
  };

  if (isLoading || !employee) return <ERPDetailSkeleton />;

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={employee.displayName}
        subtitle={employee.employeeCode}
        backTo="/hr/employees"
        status={employee.status}
        statusVariant={employee.status === 'ACTIVE' ? 'success' : 'default'}
        actions={
          <div className="flex gap-2 flex-wrap">
            {hasPermission(PERMISSIONS.EMPLOYEE_UPDATE) && (
              <Button variant="secondary" onClick={() => navigate(`/hr/employees/${id}/edit`)}>
                Edit
              </Button>
            )}
            {hasPermission(PERMISSIONS.EMPLOYEE_UPDATE) && employee.status === 'ACTIVE' && (
              <Button
                data-tour-id="hr-employee-record-exit-button"
                variant="danger-outline"
                onClick={() => setExitModalOpen(true)}
              >
                Record Exit
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <div className="bg-surface-card rounded-xl border border-default p-5">
          <h3 className="font-semibold text-primary mb-4">Profile</h3>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 rounded-full bg-surface-hover border border-default flex items-center justify-center overflow-hidden shrink-0">
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt={employee.displayName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <UserRound size={28} className="text-secondary" />
              )}
            </div>
            {hasPermission(PERMISSIONS.EMPLOYEE_UPDATE) && (
              <div>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png"
                  className="hidden"
                  onChange={handlePhotoChange}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={uploadPhotoMutation.isPending}
                >
                  <Upload size={14} className="mr-1.5" />
                  {uploadPhotoMutation.isPending
                    ? 'Uploading…'
                    : employee.hasPhoto
                      ? 'Replace Photo'
                      : 'Upload Photo'}
                </Button>
              </div>
            )}
          </div>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-secondary">Phone</dt>
              <dd>{employee.phone}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-secondary">Email</dt>
              <dd>{employee.email ?? '–'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-secondary">Gender</dt>
              <dd>{employee.gender ?? '–'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-secondary">Employment Type</dt>
              <dd>
                <Badge variant="outline">{employee.employmentType}</Badge>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-secondary">Joining Date</dt>
              <dd>{formatDate(employee.joiningDate)}</dd>
            </div>
            {employee.exitDate && (
              <div className="flex justify-between">
                <dt className="text-secondary">Exit Date</dt>
                <dd>{formatDate(employee.exitDate)}</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="bg-surface-card rounded-xl border border-default p-5">
          <h3 className="font-semibold text-primary mb-4">Salary</h3>
          {employee.hasSalaryData ? (
            <div className="text-sm text-secondary">
              <p>Salary data is encrypted. View on Payroll → Employee Salary page.</p>
              {hasPermission(PERMISSIONS.PAYROLL_PROCESS) && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  onClick={() => navigate(`/hr/payroll?employeeId=${id}`)}
                >
                  Manage Salary
                </Button>
              )}
            </div>
          ) : (
            <p className="text-sm text-disabled">
              You do not have permission to view salary information.
            </p>
          )}
        </div>

        <div className="bg-surface-card rounded-xl border border-default p-5">
          <h3 className="font-semibold text-primary mb-4">Statutory (PF / ESI)</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-secondary">UAN</dt>
              <dd>{employee.uan ?? '–'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-secondary">ESI Number</dt>
              <dd>{employee.esiNumber ?? '–'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-secondary">PF Applicable</dt>
              <dd>
                <Badge variant={employee.pfApplicable ? 'success' : 'default'}>
                  {employee.pfApplicable ? 'Yes' : 'No'}
                </Badge>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-secondary">ESI Applicable</dt>
              <dd>
                <Badge variant={employee.esiApplicable ? 'success' : 'default'}>
                  {employee.esiApplicable ? 'Yes' : 'No'}
                </Badge>
              </dd>
            </div>
          </dl>
        </div>

        <div className="bg-surface-card rounded-xl border border-default p-5 lg:col-span-2">
          <h3 className="font-semibold text-primary mb-4">Leave Balance</h3>
          {balances.length === 0 ? (
            <ERPEmptyState
              type="no-data"
              title="No leave balance records yet"
              description="Leave balances will appear here once assigned."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-secondary text-xs uppercase">
                    <th className="py-2">Leave Type</th>
                    <th className="py-2 text-right">Total</th>
                    <th className="py-2 text-right">Used</th>
                    <th className="py-2 text-right">Pending</th>
                    <th className="py-2 text-right">Carried Forward</th>
                    <th className="py-2 text-right">Available</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-default">
                  {balances.map((b) => {
                    const available =
                      parseFloat(b.totalDays) +
                      parseFloat(b.carriedForwardDays) -
                      parseFloat(b.usedDays) -
                      parseFloat(b.pendingDays);
                    return (
                      <tr key={b.leaveTypeId}>
                        <td className="py-2">Leave Type #{b.leaveTypeId}</td>
                        <td className="py-2 text-right">{b.totalDays}</td>
                        <td className="py-2 text-right">{b.usedDays}</td>
                        <td className="py-2 text-right">{b.pendingDays}</td>
                        <td className="py-2 text-right">{b.carriedForwardDays}</td>
                        <td className="py-2 text-right font-semibold">{available}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6">
        <ERPFormSection
          title="Documents"
          description="Aadhaar, PAN, education certificates, offer letter (PDF, JPG or PNG, max 10MB)"
          columns={1}
        >
          <div className="flex flex-col gap-3">
            {hasPermission(PERMISSIONS.EMPLOYEE_UPDATE) && (
              <div className="flex items-center gap-2 flex-wrap">
                <Select
                  value={documentType}
                  onChange={(e) => setDocumentType(e.target.value)}
                  options={DOCUMENT_TYPES}
                  wrapperClassName="w-56"
                />
                <input
                  ref={documentFileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={handleDocumentFileChange}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => documentFileInputRef.current?.click()}
                  disabled={uploadDocumentMutation.isPending}
                >
                  <Upload size={14} className="mr-1.5" />
                  {uploadDocumentMutation.isPending ? 'Uploading…' : 'Upload Document'}
                </Button>
              </div>
            )}

            {documentsLoading && <p className="text-xs text-secondary">Loading documents…</p>}
            {!documentsLoading && (documents ?? []).length === 0 && (
              <p className="text-xs text-secondary">No documents uploaded yet.</p>
            )}

            {(documents ?? []).map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-default bg-surface-hover"
              >
                <div className="min-w-0">
                  <div className="text-sm text-primary truncate">{doc.fileName}</div>
                  <div className="text-xs text-secondary">
                    {(doc.fileSize / 1024).toFixed(0)} KB · {formatDate(doc.createdAt)}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleDocumentDownload(doc)}
                    className="p-1.5 rounded hover:bg-surface-card text-secondary hover:text-primary"
                    title="Download"
                  >
                    <Download size={15} />
                  </button>
                  {hasPermission(PERMISSIONS.EMPLOYEE_UPDATE) && (
                    <button
                      type="button"
                      onClick={() => setDeleteDocumentId(doc.id)}
                      className="p-1.5 rounded hover:bg-surface-card text-secondary hover:text-danger"
                      title="Delete"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ERPFormSection>
      </div>

      {canManageLoans && (
        <div className="mt-6">
          <ERPFormSection
            title="Loans"
            description="Salary advances and other employee loans, deducted monthly from payroll"
            columns={1}
          >
            <div className="flex flex-col gap-3">
              <div>
                <Button
                  data-tour-id="hr-employee-disburse-loan-button"
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowLoanForm((v) => !v)}
                >
                  {showLoanForm ? 'Cancel' : '+ Disburse Loan'}
                </Button>
              </div>

              {showLoanForm && (
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 p-3 rounded-lg border border-default">
                  <Select
                    label="Loan Type"
                    value={loanType}
                    onChange={(e) => setLoanType(e.target.value)}
                    options={LOAN_TYPES}
                  />
                  <Input
                    label="Principal Amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={loanPrincipal}
                    onChange={(e) => setLoanPrincipal(e.target.value)}
                  />
                  <Input
                    label="Tenure (months)"
                    type="number"
                    min="1"
                    step="1"
                    value={loanTenure}
                    onChange={(e) => setLoanTenure(e.target.value)}
                  />
                  <Input
                    label="Disbursed Date"
                    type="date"
                    value={loanDisbursedDate}
                    onChange={(e) => setLoanDisbursedDate(e.target.value)}
                  />
                  <div className="sm:col-span-4">
                    <Button
                      type="button"
                      size="sm"
                      disabled={!loanPrincipal || !loanTenure || createLoanMutation.isPending}
                      onClick={() => createLoanMutation.mutate()}
                    >
                      {createLoanMutation.isPending ? 'Disbursing…' : 'Disburse'}
                    </Button>
                  </div>
                </div>
              )}

              {loansLoading && <p className="text-xs text-secondary">Loading loans…</p>}
              {!loansLoading && loans.length === 0 && (
                <p className="text-xs text-secondary">No loans on file for this employee.</p>
              )}
              {loans.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-secondary text-xs uppercase">
                        <th className="py-2">Type</th>
                        <th className="py-2 text-right">Principal</th>
                        <th className="py-2 text-right">Monthly Deduction</th>
                        <th className="py-2 text-right">Outstanding</th>
                        <th className="py-2">Status</th>
                        <th className="py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-default">
                      {loans.map((loan) => (
                        <tr key={loan.id}>
                          <td className="py-2">{loan.loanType.replace(/_/g, ' ')}</td>
                          <td className="py-2 text-right">
                            {formatCurrency(Number(loan.principalAmount))}
                          </td>
                          <td className="py-2 text-right">
                            {formatCurrency(Number(loan.monthlyDeduction))}
                          </td>
                          <td className="py-2 text-right font-semibold">
                            {formatCurrency(Number(loan.outstandingBalance))}
                          </td>
                          <td className="py-2">
                            <Badge
                              variant={
                                loan.status === 'ACTIVE'
                                  ? 'warning'
                                  : loan.status === 'CLOSED'
                                    ? 'success'
                                    : 'default'
                              }
                            >
                              {loan.status}
                            </Badge>
                          </td>
                          <td className="py-2 text-right">
                            {loan.status === 'ACTIVE' && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setCloseLoanId(loan.id)}
                              >
                                Close
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </ERPFormSection>
        </div>
      )}

      <div className="mt-6">
        <ERPFormSection
          title="Nominees"
          description="PF / gratuity nomination beneficiaries"
          columns={1}
        >
          <div className="flex flex-col gap-3">
            {hasPermission(PERMISSIONS.EMPLOYEE_UPDATE) && (
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowNomineeForm((v) => !v)}
                >
                  {showNomineeForm ? 'Cancel' : '+ Add Nominee'}
                </Button>
              </div>
            )}

            {showNomineeForm && (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 p-3 rounded-lg border border-default">
                <Input
                  label="Name"
                  value={nomineeName}
                  onChange={(e) => setNomineeName(e.target.value)}
                />
                <Select
                  label="Relationship"
                  value={nomineeRelationship}
                  onChange={(e) => setNomineeRelationship(e.target.value)}
                  options={RELATIONSHIP_TYPES}
                />
                <Input
                  label="Share %"
                  type="number"
                  min="0"
                  max="100"
                  value={nomineeShare}
                  onChange={(e) => setNomineeShare(e.target.value)}
                />
                <Input
                  label="Contact Number"
                  value={nomineeContact}
                  onChange={(e) => setNomineeContact(e.target.value)}
                />
                <div className="sm:col-span-4">
                  <Button
                    type="button"
                    size="sm"
                    disabled={!nomineeName || createNomineeMutation.isPending}
                    onClick={() => createNomineeMutation.mutate()}
                  >
                    {createNomineeMutation.isPending ? 'Saving…' : 'Add Nominee'}
                  </Button>
                </div>
              </div>
            )}

            {nomineesLoading && <p className="text-xs text-secondary">Loading nominees…</p>}
            {!nomineesLoading && nominees.length === 0 && (
              <p className="text-xs text-secondary">No nominees on file for this employee.</p>
            )}
            {nominees.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-secondary text-xs uppercase">
                      <th className="py-2">Name</th>
                      <th className="py-2">Relationship</th>
                      <th className="py-2 text-right">Share</th>
                      <th className="py-2">Contact</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-default">
                    {nominees.map((n) => (
                      <tr key={n.id}>
                        <td className="py-2">
                          {n.name} {n.isPrimary && <Badge variant="outline">Primary</Badge>}
                        </td>
                        <td className="py-2">{n.relationship}</td>
                        <td className="py-2 text-right">{n.sharePercentage}%</td>
                        <td className="py-2">{n.contactNumber ?? '–'}</td>
                        <td className="py-2 text-right">
                          {hasPermission(PERMISSIONS.EMPLOYEE_UPDATE) && (
                            <button
                              type="button"
                              onClick={() => setDeleteNomineeId(n.id)}
                              className="p-1.5 rounded hover:bg-surface-card text-secondary hover:text-danger"
                              title="Remove"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </ERPFormSection>
      </div>

      {history.length > 0 && (
        <div className="mt-6">
          <ERPFormSection
            title="Increment / Promotion / Transfer History"
            description="Past changes to department, designation, branch, manager, and salary"
            columns={1}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-secondary text-xs uppercase">
                    <th className="py-2">Type</th>
                    <th className="py-2">Effective Date</th>
                    <th className="py-2">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-default">
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td className="py-2">
                        <Badge variant="outline">
                          {CHANGE_TYPE_LABELS[h.changeType] ?? h.changeType}
                        </Badge>
                      </td>
                      <td className="py-2">{formatDate(h.effectiveDate)}</td>
                      <td className="py-2 text-xs text-secondary">
                        {JSON.stringify(h.previousValue)} → {JSON.stringify(h.newValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ERPFormSection>
        </div>
      )}

      {canManageExit && employee.status !== 'ACTIVE' && (
        <div className="mt-6">
          <ERPFormSection
            title="Exit & Full and Final Settlement"
            description="Notice period, clearance, and F&F settlement breakup"
            columns={1}
          >
            {!exitWorkflow ? (
              <div className="flex flex-col gap-3">
                {!showExitWorkflowForm ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowExitWorkflowForm(true)}
                  >
                    Start Exit Workflow
                  </Button>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-lg border border-default">
                    <Input
                      label="Resignation Date"
                      type="date"
                      value={resignationDate}
                      onChange={(e) => setResignationDate(e.target.value)}
                    />
                    <Input
                      label="Last Working Date"
                      type="date"
                      value={lastWorkingDate}
                      onChange={(e) => setLastWorkingDate(e.target.value)}
                    />
                    <Input
                      label="Notice Period (days)"
                      type="number"
                      value={noticePeriodDays}
                      onChange={(e) => setNoticePeriodDays(e.target.value)}
                    />
                    <div className="sm:col-span-3">
                      <Button
                        type="button"
                        size="sm"
                        disabled={
                          !resignationDate ||
                          !lastWorkingDate ||
                          startExitWorkflowMutation.isPending
                        }
                        onClick={() => startExitWorkflowMutation.mutate()}
                      >
                        {startExitWorkflowMutation.isPending ? 'Saving…' : 'Save'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4 text-sm">
                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <dt className="text-secondary text-xs uppercase">Resignation Date</dt>
                    <dd>{formatDate(exitWorkflow.resignationDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-secondary text-xs uppercase">Last Working Date</dt>
                    <dd>{formatDate(exitWorkflow.lastWorkingDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-secondary text-xs uppercase">Notice Period</dt>
                    <dd>{exitWorkflow.noticePeriodDays} days</dd>
                  </div>
                  <div>
                    <dt className="text-secondary text-xs uppercase">Clearance</dt>
                    <dd>
                      <Badge
                        variant={exitWorkflow.clearanceStatus === 'CLEARED' ? 'success' : 'warning'}
                      >
                        {exitWorkflow.clearanceStatus}
                      </Badge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-secondary text-xs uppercase">F&F Status</dt>
                    <dd>
                      <Badge variant={exitWorkflow.fnfStatus === 'SETTLED' ? 'success' : 'warning'}>
                        {exitWorkflow.fnfStatus}
                      </Badge>
                    </dd>
                  </div>
                </dl>

                {exitWorkflow.clearanceStatus === 'PENDING' && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => clearExitMutation.mutate()}
                    loading={clearExitMutation.isPending}
                  >
                    Mark Clearance Complete
                  </Button>
                )}

                {exitWorkflow.clearanceStatus === 'CLEARED' &&
                  exitWorkflow.fnfStatus === 'PENDING' && (
                    <div className="flex flex-col gap-3">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => void refetchFnfPreview()}
                      >
                        Compute F&amp;F Breakup
                      </Button>
                      {fnfPreview && (
                        <div className="p-3 rounded-lg border border-default space-y-1">
                          <div className="flex justify-between">
                            <span className="text-secondary">Pro-rated Last Salary</span>
                            <span>{formatCurrency(fnfPreview.proRatedSalaryAmount)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-secondary">
                              Leave Encashment ({fnfPreview.unusedPaidLeaveDays} days)
                            </span>
                            <span>{formatCurrency(fnfPreview.leaveEncashmentAmount)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-secondary">Loan Recovery</span>
                            <span>-{formatCurrency(fnfPreview.loanRecoveryAmount)}</span>
                          </div>
                          <div className="flex justify-between font-semibold pt-1 border-t border-default">
                            <span>Net F&amp;F Amount</span>
                            <span>{formatCurrency(fnfPreview.fnfTotalAmount)}</span>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            className="mt-2"
                            onClick={() => settleFnfMutation.mutate()}
                            loading={settleFnfMutation.isPending}
                          >
                            Confirm & Settle
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                {exitWorkflow.fnfStatus === 'SETTLED' && (
                  <p className="text-sm text-success">
                    Settled: {formatCurrency(Number(exitWorkflow.fnfTotalAmount))}
                  </p>
                )}
              </div>
            )}
          </ERPFormSection>
        </div>
      )}

      <ERPConfirmModal
        open={deleteNomineeId !== null}
        onClose={() => setDeleteNomineeId(null)}
        onConfirm={() => deleteNomineeId !== null && deleteNomineeMutation.mutate(deleteNomineeId)}
        title="Remove Nominee"
        description="This will permanently remove this nominee record. This action cannot be undone."
        isLoading={deleteNomineeMutation.isPending}
      />

      <ERPConfirmModal
        open={deleteDocumentId !== null}
        onClose={() => setDeleteDocumentId(null)}
        onConfirm={() =>
          deleteDocumentId !== null && deleteDocumentMutation.mutate(deleteDocumentId)
        }
        title="Delete Document"
        description="This will permanently delete the document. This action cannot be undone."
        isLoading={deleteDocumentMutation.isPending}
      />

      <ERPConfirmModal
        open={closeLoanId !== null}
        onClose={() => setCloseLoanId(null)}
        onConfirm={() => closeLoanId !== null && closeLoanMutation.mutate(closeLoanId)}
        title="Close this loan?"
        description="Marks the loan as closed. Any remaining outstanding balance stays on record but stops being deducted from future payroll runs."
        isLoading={closeLoanMutation.isPending}
      />

      <Modal
        open={exitModalOpen}
        onClose={() => setExitModalOpen(false)}
        title="Record Employee Exit"
        size="sm"
      >
        <div className="space-y-4">
          <Input
            label="Exit Date"
            type="date"
            required
            value={exitDate}
            onChange={(e) => setExitDate(e.target.value)}
          />
          <Input
            label="Exit Reason"
            required
            value={exitReason}
            onChange={(e) => setExitReason(e.target.value)}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setExitModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => exitMutation.mutate()}
              loading={exitMutation.isPending}
              disabled={!exitDate || !exitReason}
            >
              Confirm Exit
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
