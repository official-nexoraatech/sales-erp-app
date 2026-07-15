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
import { formatDate } from '../../lib/format.js';

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
              <Button variant="danger-outline" onClick={() => setExitModalOpen(true)}>
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
                          <td className="py-2 text-right">₹{loan.principalAmount}</td>
                          <td className="py-2 text-right">₹{loan.monthlyDeduction}</td>
                          <td className="py-2 text-right font-semibold">
                            ₹{loan.outstandingBalance}
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
                                onClick={() => closeLoanMutation.mutate(loan.id)}
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
