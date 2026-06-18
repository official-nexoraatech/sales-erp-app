import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { expenseApi } from '../../api/endpoints';
import { ExpenseForm } from './ExpenseForm';

export const ExpenseCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const mutation = useMutation({ mutationFn: expenseApi.create, onSuccess: () => { toast.success('Expense created successfully'); navigate('/expenses'); }, onError: (error: any) => toast.error(error?.message || 'Failed to create expense') });
  return <div className="space-y-5"><div className="text-sm text-gray-500">Home &gt; Expense &gt; Expense List &gt; Create Expense</div><ExpenseForm submitText="Submit" loading={mutation.isPending} onSubmit={(payload) => mutation.mutate(payload)} onCancel={() => navigate('/expenses')} /></div>;
};
