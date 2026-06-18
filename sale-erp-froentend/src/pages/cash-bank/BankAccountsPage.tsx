import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { bankAccountApi } from '../../api/endpoints';
import type { BankAccountRequest } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { formatCurrency } from '../../utils/formatCurrency';

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

export const BankAccountsPage: React.FC = () => {
  const [showForm, setShowForm] = useState(false);
  const accounts = useQuery({ queryKey: ['bank-accounts'], queryFn: bankAccountApi.getAll });
  return <div className="space-y-5"><div className="text-sm text-gray-500">Home &gt; Cash &amp; Bank &gt; Bank Accounts</div><div className="overflow-hidden rounded-lg bg-white shadow"><div className="flex items-center justify-between border-b px-5 py-4"><h1 className="text-xl font-semibold uppercase">Bank Accounts</h1><Button onClick={() => setShowForm(true)}>Create Bank Account</Button></div>{showForm && <BankAccountForm onClose={() => setShowForm(false)} />}<div className="overflow-x-auto p-5">{accounts.isLoading ? <Loader /> : <table className="w-full text-sm"><thead className="bg-gray-50"><tr>{['Bank Name', 'Account Name', 'Account Number', 'IFSC', 'Branch', 'Opening Balance', 'Current Balance'].map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}</tr></thead><tbody>{accounts.data?.data?.content?.length ? accounts.data.data.content.map((account) => <tr key={account.id} className="even:bg-gray-50"><td className="border p-3">{account.bankName}</td><td className="border p-3">{account.accountName}</td><td className="border p-3">{account.accountNumber}</td><td className="border p-3">{account.ifscCode}</td><td className="border p-3">{account.branchName}</td><td className="border p-3">{formatCurrency(account.openingBalance)}</td><td className="border p-3">{formatCurrency(account.currentBalance ?? account.openingBalance)}</td></tr>) : <tr><td colSpan={7} className="bg-gray-50 p-5 text-center">No data available in table</td></tr>}</tbody></table>}</div></div></div>;
};

const BankAccountForm: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [form, setForm] = useState<BankAccountRequest>({ bankName: '', accountName: '', accountNumber: '', ifscCode: '', branchName: '', openingBalance: 0 });
  const mutation = useMutation({ mutationFn: bankAccountApi.create, onSuccess: () => { toast.success('Bank account created'); queryClient.invalidateQueries({ queryKey: ['bank-accounts'] }); onClose(); }, onError: (error: any) => toast.error(error?.message || 'Failed to create bank account') });
  const set = (field: keyof BankAccountRequest, value: string | number) => setForm((current) => ({ ...current, [field]: value }));
  return <div className="border-b bg-gray-50 p-5"><div className="grid grid-cols-1 gap-4 md:grid-cols-3"><label className="text-sm">Bank Name<input className={`${inputClass} mt-1`} value={form.bankName} onChange={(event) => set('bankName', event.target.value)} /></label><label className="text-sm">Account Name<input className={`${inputClass} mt-1`} value={form.accountName} onChange={(event) => set('accountName', event.target.value)} /></label><label className="text-sm">Account Number<input className={`${inputClass} mt-1`} value={form.accountNumber} onChange={(event) => set('accountNumber', event.target.value)} /></label><label className="text-sm">IFSC Code<input className={`${inputClass} mt-1`} value={form.ifscCode} onChange={(event) => set('ifscCode', event.target.value)} /></label><label className="text-sm">Branch Name<input className={`${inputClass} mt-1`} value={form.branchName} onChange={(event) => set('branchName', event.target.value)} /></label><label className="text-sm">Opening Balance<input type="number" className={`${inputClass} mt-1`} value={form.openingBalance || ''} onChange={(event) => set('openingBalance', Number(event.target.value))} /></label></div><div className="mt-4 flex gap-3"><Button onClick={() => mutation.mutate(form)} isLoading={mutation.isPending}>Submit</Button><Button variant="secondary" onClick={onClose}>Close</Button></div></div>;
};
