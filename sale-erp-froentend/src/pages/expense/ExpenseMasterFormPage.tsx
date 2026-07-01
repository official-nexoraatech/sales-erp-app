import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  expenseCategoryApi,
  expenseSubCategoryApi,
  paymentMethodApi,
  type ExpenseCategory,
  type ExpenseMasterStatus,
  type ExpenseSubCategory,
  type PaymentMethod,
} from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';

interface Props {
  type: 'category' | 'subcategory' | 'paymentMethod';
  mode: 'create' | 'edit';
}

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

export const ExpenseMasterFormPage: React.FC<Props> = ({ type, mode }) => {
  const categoryMode = type === 'category';
  const subCategoryMode = type === 'subcategory';
  const label = categoryMode
    ? 'Expense Category'
    : subCategoryMode
      ? 'Expense Subcategory'
      : 'Payment Type';
  const defaultBackPath = categoryMode
    ? '/expenses/categories'
    : subCategoryMode
      ? '/expenses/subcategories'
      : '/expenses/payment-types';
  const listQueryKey = categoryMode
    ? 'expense-categories'
    : subCategoryMode
      ? 'expense-subcategories'
      : 'payment-methods';
  const recordQueryKey = categoryMode
    ? 'expense-category'
    : subCategoryMode
      ? 'expense-subcategory'
      : 'payment-method';
  const id = Number(useParams<{ id: string }>().id);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedReturnTo = searchParams.get('returnTo');
  const backPath = requestedReturnTo?.startsWith('/') && !requestedReturnTo.startsWith('//')
    ? requestedReturnTo
    : defaultBackPath;
  const [expenseCategoryId, setExpenseCategoryId] = useState(0);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<ExpenseMasterStatus>('ACTIVE');

  const categories = useQuery({
    queryKey: ['expense-categories', 'subcategory-form'],
    queryFn: () => expenseCategoryApi.getAll(''),
    enabled: subCategoryMode,
  });

  const record = useQuery({
    queryKey: [recordQueryKey, id],
    queryFn: () => {
      if (categoryMode) return expenseCategoryApi.getById(id);
      if (subCategoryMode) return expenseSubCategoryApi.getById(id);
      return paymentMethodApi.getById(id);
    },
    enabled: mode === 'edit' && id > 0,
  });

  useEffect(() => {
    if (!record.data?.data) return;
    const data = record.data.data as ExpenseCategory | ExpenseSubCategory | PaymentMethod;
    setName(data.name || '');
    setDescription(data.description || '');
    setStatus(data.status || 'ACTIVE');
    if ('expenseCategoryId' in data) setExpenseCategoryId(data.expenseCategoryId);
  }, [record.data]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload = { name: name.trim(), description: description.trim(), status };
      if (categoryMode) {
        return mode === 'edit'
          ? expenseCategoryApi.update(id, payload)
          : expenseCategoryApi.create(payload);
      }
      if (subCategoryMode) {
        const subCategoryPayload = { ...payload, expenseCategoryId };
        return mode === 'edit'
          ? expenseSubCategoryApi.update(id, subCategoryPayload)
          : expenseSubCategoryApi.create(subCategoryPayload);
      }
      return mode === 'edit'
        ? paymentMethodApi.update(id, payload)
        : paymentMethodApi.create(payload);
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: [listQueryKey] });
      queryClient.removeQueries({ queryKey: [recordQueryKey, id] });
      queryClient.invalidateQueries({ queryKey: ['pos-payment-methods'] });
      toast.success(`${label} ${mode === 'edit' ? 'updated' : 'created'} successfully`);
      navigate(backPath);
    },
  });

  const submit = () => {
    if (!name.trim()) {
      toast.error(`${label} name is required.`);
      return;
    }
    if (name.trim().length < 2) {
      toast.error(`${label} name must contain at least 2 characters.`);
      return;
    }
    if (subCategoryMode && !expenseCategoryId) {
      toast.error('Expense category is required.');
      return;
    }
    mutation.mutate();
  };

  if (mode === 'edit' && record.isLoading) return <Loader />;

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">
        Home &gt; Expense &gt; {label} List &gt; {mode === 'edit' ? `Edit ${label}` : `Create ${label}`}
      </div>
      <div className="max-w-3xl overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b px-5 py-4">
          <h1 className="text-xl font-semibold text-gray-900">{label} Details</h1>
        </div>
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
          {subCategoryMode && (
            <label className="text-sm text-gray-600 md:col-span-2">
              Expense Category
              <select
                className={`${inputClass} mt-1`}
                value={expenseCategoryId}
                disabled={categories.isLoading}
                onChange={(event) => setExpenseCategoryId(Number(event.target.value))}
              >
                <option value={0}>
                  {categories.isLoading ? 'Loading expense categories...' : 'Select expense category'}
                </option>
                {(categories.data?.data?.content || [])
                  .filter((category) => category.status === 'ACTIVE' || category.id === expenseCategoryId)
                  .map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
              </select>
            </label>
          )}
          <label className="text-sm text-gray-600">
            Name
            <input
              className={`${inputClass} mt-1`}
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="text-sm text-gray-600">
            Status
            <select
              className={`${inputClass} mt-1`}
              value={status}
              onChange={(event) => setStatus(event.target.value as ExpenseMasterStatus)}
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
          <label className="text-sm text-gray-600 md:col-span-2">
            Description
            <textarea
              className="mt-1 h-24 w-full rounded border border-gray-300 bg-white p-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              value={description}
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </div>
        <div className="flex gap-3 px-5 pb-5">
          <Button onClick={submit} isLoading={mutation.isPending}>
            {mode === 'edit' ? 'Update' : 'Submit'}
          </Button>
          <Button variant="secondary" onClick={() => navigate(backPath)}>Close</Button>
        </div>
      </div>
    </div>
  );
};
