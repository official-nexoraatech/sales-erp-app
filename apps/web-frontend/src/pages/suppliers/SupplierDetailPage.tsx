import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Pencil, Trash2 } from 'lucide-react';
import { supplierApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { useConfirm } from '../../context/ConfirmContext.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPDetailSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import AttachmentSection from '../../components/erp/AttachmentSection.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import Checkbox from '../../components/ui/Checkbox.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface SupplierDetail {
  id: number;
  supplierCode: string;
  displayName: string;
  companyName?: string | null;
  contactPerson?: string | null;
  supplierType: string;
  gstin?: string | null;
  isRegistered: boolean;
  pan?: string | null;
  phone: string;
  altPhone?: string | null;
  email?: string | null;
  billingAddress?: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    stateCode: string;
    pincode: string;
    country: string;
  } | null;
  bankName?: string | null;
  bankIfsc?: string | null;
  bankBranch?: string | null;
  creditDays: number;
  creditLimit: string;
  creditLimitEnabled: boolean;
  openingBalance: string;
  status: string;
  notes?: string | null;
  tags?: string[] | null;
}

interface SupplierBalance {
  currentBalance: string;
  totalPurchased: string;
  totalPaid: string;
  totalReturns: string;
  overdueAmount: string;
}

interface GRNSummary {
  id: number;
  grnNumber: string | null;
  grandTotal: string;
  grnDate: string;
  status: string;
}

interface PaymentSummary {
  id: number;
  paymentNumber: string;
  amount: string;
  paymentDate: string;
  status: string;
}

interface SupplierContact {
  id: number;
  name: string;
  designation?: string | null;
  phone?: string | null;
  email?: string | null;
  isPrimary: boolean;
  notes?: string | null;
}

const emptyContactForm = {
  name: '',
  designation: '',
  phone: '',
  email: '',
  isPrimary: false,
  notes: '',
};

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  ACTIVE: 'success',
  INACTIVE: 'default',
  BLACKLISTED: 'danger',
};

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canEdit = hasPermission(PERMISSIONS.SUPPLIER_EDIT);
  const canViewStatement = hasPermission(PERMISSIONS.SUPPLIER_STATEMENT_VIEW);

  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [editingContactId, setEditingContactId] = useState<number | null>(null);
  const [contactForm, setContactForm] = useState(emptyContactForm);

  const { data, isLoading } = useQuery({
    queryKey: ['supplier-detail', id],
    queryFn: () => supplierApi.getById(Number(id)),
    enabled: !!id,
  });

  const { data: statementData } = useQuery({
    queryKey: ['supplier-statement', id],
    queryFn: () => supplierApi.statement(Number(id)),
    enabled: !!id && canViewStatement,
  });

  const { data: contactsData } = useQuery({
    queryKey: ['supplier-contacts', id],
    queryFn: () => supplierApi.contacts(Number(id)),
    enabled: !!id,
  });

  const supplier = data as SupplierDetail | undefined;
  const statement = statementData as
    | {
        balance: SupplierBalance | null;
        recentGrns: GRNSummary[];
        recentPayments: PaymentSummary[];
      }
    | undefined;
  const contacts: SupplierContact[] =
    ((contactsData as Record<string, unknown>)?.content as SupplierContact[]) ?? [];

  function invalidateContacts() {
    qc.invalidateQueries({ queryKey: ['supplier-contacts', id] });
  }

  const saveContactMutation = useMutation({
    mutationFn: () =>
      editingContactId
        ? supplierApi.updateContact(Number(id), editingContactId, {
            ...contactForm,
            email: contactForm.email || undefined,
          })
        : supplierApi.addContact(Number(id), {
            ...contactForm,
            email: contactForm.email || undefined,
          }),
    onSuccess: () => {
      toast.success(editingContactId ? 'Contact updated' : 'Contact added');
      setContactModalOpen(false);
      setEditingContactId(null);
      setContactForm(emptyContactForm);
      invalidateContacts();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteContactMutation = useMutation({
    mutationFn: (contactId: number) => supplierApi.deleteContact(Number(id), contactId),
    onSuccess: () => {
      toast.success('Contact removed');
      invalidateContacts();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <ERPDetailSkeleton />;
  if (!supplier) return <ERPEmptyState type="no-data" title="Supplier not found" />;

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={supplier.displayName}
        entityType="Supplier"
        entityNumber={supplier.supplierCode}
        status={supplier.status}
        backTo="/suppliers"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={STATUS_COLORS[supplier.status] ?? 'default'}>{supplier.status}</Badge>
          {!supplier.isRegistered && <Badge variant="warning">RCM Applicable</Badge>}
          {canEdit && (
            <Button variant="outline" onClick={() => navigate(`/suppliers/${supplier.id}/edit`)}>
              Edit
            </Button>
          )}
        </div>
      </ERPPageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Supplier Type', value: supplier.supplierType },
          { label: 'GSTIN', value: supplier.gstin ?? '—' },
          { label: 'Credit Days', value: String(supplier.creditDays) },
          {
            label: 'Credit Limit',
            value: supplier.creditLimitEnabled
              ? formatCurrency(parseFloat(supplier.creditLimit))
              : 'Not enforced',
          },
        ].map(({ label, value }) => (
          <div key={label} className="bg-surface-card rounded-xl border border-default p-4">
            <div className="text-xs text-secondary">{label}</div>
            <div className="text-lg font-semibold mt-1">{value}</div>
          </div>
        ))}
      </div>

      {statement?.balance && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
          {[
            { label: 'Current Balance', value: statement.balance.currentBalance },
            { label: 'Total Purchased', value: statement.balance.totalPurchased },
            { label: 'Total Paid', value: statement.balance.totalPaid },
            { label: 'Total Returns', value: statement.balance.totalReturns },
            { label: 'Overdue', value: statement.balance.overdueAmount },
          ].map(({ label, value }) => (
            <div key={label} className="bg-surface-card rounded-xl border border-default p-3">
              <div className="text-xs text-secondary">{label}</div>
              <div className="text-base font-semibold mt-1">
                {formatCurrency(parseFloat(value ?? '0'))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="bg-surface-card border border-default rounded-xl p-4 text-sm space-y-2">
          <h3 className="font-semibold mb-2">Contact &amp; Tax Details</h3>
          {supplier.companyName && (
            <div className="flex justify-between">
              <span className="text-secondary">Company Name</span>
              <span>{supplier.companyName}</span>
            </div>
          )}
          {supplier.contactPerson && (
            <div className="flex justify-between">
              <span className="text-secondary">Contact Person</span>
              <span>{supplier.contactPerson}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-secondary">Phone</span>
            <span>{supplier.phone}</span>
          </div>
          {supplier.altPhone && (
            <div className="flex justify-between">
              <span className="text-secondary">Alt Phone</span>
              <span>{supplier.altPhone}</span>
            </div>
          )}
          {supplier.email && (
            <div className="flex justify-between">
              <span className="text-secondary">Email</span>
              <span>{supplier.email}</span>
            </div>
          )}
          {supplier.pan && (
            <div className="flex justify-between">
              <span className="text-secondary">PAN</span>
              <span className="font-mono">{supplier.pan}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-secondary">GST Registered</span>
            <span>{supplier.isRegistered ? 'Yes' : 'No (RCM applies)'}</span>
          </div>
        </div>

        <div className="bg-surface-card border border-default rounded-xl p-4 text-sm space-y-2">
          <h3 className="font-semibold mb-2">Address &amp; Bank Details</h3>
          {supplier.billingAddress ? (
            <div className="flex justify-between">
              <span className="text-secondary">Billing Address</span>
              <span className="text-right">
                {supplier.billingAddress.line1}
                {supplier.billingAddress.line2 ? `, ${supplier.billingAddress.line2}` : ''},{' '}
                {supplier.billingAddress.city}, {supplier.billingAddress.state}{' '}
                {supplier.billingAddress.pincode}, {supplier.billingAddress.country}
              </span>
            </div>
          ) : (
            <p className="text-secondary">No billing address on file.</p>
          )}
          {supplier.bankName && (
            <div className="flex justify-between">
              <span className="text-secondary">Bank</span>
              <span>{supplier.bankName}</span>
            </div>
          )}
          {supplier.bankIfsc && (
            <div className="flex justify-between">
              <span className="text-secondary">IFSC</span>
              <span className="font-mono">{supplier.bankIfsc}</span>
            </div>
          )}
          {supplier.bankBranch && (
            <div className="flex justify-between">
              <span className="text-secondary">Branch</span>
              <span>{supplier.bankBranch}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-secondary">Opening Balance</span>
            <span>{formatCurrency(parseFloat(supplier.openingBalance))}</span>
          </div>
        </div>
      </div>

      <div className="bg-surface-card border border-default rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Contacts</h3>
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditingContactId(null);
                setContactForm(emptyContactForm);
                setContactModalOpen(true);
              }}
            >
              + Add Contact
            </Button>
          )}
        </div>
        {contacts.length === 0 ? (
          <p className="text-sm text-secondary">
            No additional contacts on file — only the single Contact Person field above.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-secondary border-b border-default">
                <th className="pb-2">Name</th>
                <th className="pb-2">Designation</th>
                <th className="pb-2">Phone</th>
                <th className="pb-2">Email</th>
                <th className="pb-2"></th>
                {canEdit && <th className="pb-2"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td className="py-2 text-primary">{c.name}</td>
                  <td className="py-2 text-secondary">{c.designation ?? '—'}</td>
                  <td className="py-2 text-secondary">{c.phone ?? '—'}</td>
                  <td className="py-2 text-secondary">{c.email ?? '—'}</td>
                  <td className="py-2">
                    {c.isPrimary && <Badge variant="success">Primary</Badge>}
                  </td>
                  {canEdit && (
                    <td className="py-2">
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => {
                            setEditingContactId(c.id);
                            setContactForm({
                              name: c.name,
                              designation: c.designation ?? '',
                              phone: c.phone ?? '',
                              email: c.email ?? '',
                              isPrimary: c.isPrimary,
                              notes: c.notes ?? '',
                            });
                            setContactModalOpen(true);
                          }}
                          className="text-secondary hover:text-primary"
                          aria-label={`Edit ${c.name}`}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={async () => {
                            const ok = await confirm({
                              title: 'Remove contact?',
                              message: `Remove ${c.name} from this supplier's contacts?`,
                              confirmLabel: 'Remove',
                              variant: 'danger',
                            });
                            if (ok) deleteContactMutation.mutate(c.id);
                          }}
                          className="text-secondary hover:text-danger"
                          aria-label={`Remove ${c.name}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canViewStatement && statement && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="bg-surface-card border border-default rounded-xl p-4">
            <h3 className="font-semibold mb-3">Recent GRNs</h3>
            {statement.recentGrns.length === 0 ? (
              <p className="text-sm text-secondary">No GRNs yet.</p>
            ) : (
              <ul className="divide-y divide-default text-sm">
                {statement.recentGrns.slice(0, 10).map((g) => (
                  <li
                    key={g.id}
                    className="py-2 flex justify-between cursor-pointer hover:text-link"
                    onClick={() => navigate(`/purchase/grns/${g.id}`)}
                  >
                    <span>{g.grnNumber ?? `GRN-${g.id}`}</span>
                    <span className="text-secondary">{formatDate(g.grnDate)}</span>
                    <span>{formatCurrency(parseFloat(g.grandTotal))}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="bg-surface-card border border-default rounded-xl p-4">
            <h3 className="font-semibold mb-3">Recent Payments</h3>
            {statement.recentPayments.length === 0 ? (
              <p className="text-sm text-secondary">No payments yet.</p>
            ) : (
              <ul className="divide-y divide-default text-sm">
                {statement.recentPayments.slice(0, 10).map((p) => (
                  <li
                    key={p.id}
                    className="py-2 flex justify-between cursor-pointer hover:text-link"
                    onClick={() => navigate(`/purchase/payments/${p.id}`)}
                  >
                    <span>{p.paymentNumber}</span>
                    <span className="text-secondary">{formatDate(p.paymentDate)}</span>
                    <span>{formatCurrency(parseFloat(p.amount))}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="bg-surface-card border border-default rounded-xl p-4 mb-4">
        <AttachmentSection service="purchase" entityType="SUPPLIER" entityId={supplier.id} />
      </div>

      {(supplier.notes || (supplier.tags && supplier.tags.length > 0)) && (
        <div className="bg-surface-card border border-default rounded-xl p-4 text-sm space-y-2">
          {supplier.tags && supplier.tags.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {supplier.tags.map((t) => (
                <Badge key={t} variant="default">
                  {t}
                </Badge>
              ))}
            </div>
          )}
          {supplier.notes && (
            <div>
              <span className="font-medium text-primary">Notes: </span>
              <span className="text-secondary">{supplier.notes}</span>
            </div>
          )}
        </div>
      )}

      <Modal
        isOpen={contactModalOpen}
        onClose={() => setContactModalOpen(false)}
        title={editingContactId ? 'Edit Contact' : 'Add Contact'}
      >
        <div className="space-y-4">
          <Input
            label="Name"
            required
            value={contactForm.name}
            onChange={(e) => setContactForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            label="Designation"
            value={contactForm.designation}
            onChange={(e) => setContactForm((f) => ({ ...f, designation: e.target.value }))}
          />
          <Input
            label="Phone"
            value={contactForm.phone}
            onChange={(e) => setContactForm((f) => ({ ...f, phone: e.target.value }))}
          />
          <Input
            label="Email"
            type="email"
            value={contactForm.email}
            onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))}
          />
          <Checkbox
            label="Primary Contact"
            checked={contactForm.isPrimary}
            onChange={(e) => setContactForm((f) => ({ ...f, isPrimary: e.target.checked }))}
          />
          <Input
            label="Notes"
            value={contactForm.notes}
            onChange={(e) => setContactForm((f) => ({ ...f, notes: e.target.value }))}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setContactModalOpen(false)}>
              Cancel
            </Button>
            <Button
              isLoading={saveContactMutation.isPending}
              disabled={!contactForm.name.trim()}
              onClick={() => saveContactMutation.mutate()}
            >
              {editingContactId ? 'Save' : 'Add'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
