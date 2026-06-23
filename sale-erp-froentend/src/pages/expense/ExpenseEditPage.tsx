import React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { expenseApi } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Loader } from '../../components/ui/Loader';
import { ExpenseForm } from './ExpenseForm';

export const ExpenseEditPage: React.FC = () => {
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const expense = useQuery({ queryKey: ['expense', id], queryFn: () => expenseApi.getById(id), enabled: id > 0 });
  const mutation = useMutation({
    mutationFn: (payload: any) => expenseApi.update(id, payload),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['expenses'] });
      queryClient.removeQueries({ queryKey: ['expense', id] });
      toast.success('Expense updated successfully');
      navigate('/expenses');
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to update expense'),
  });
  if (expense.isLoading) return <Loader />;
  return <div className="space-y-5"><div className="text-sm text-gray-500">Home &gt; Expense &gt; Expense List &gt; Edit Expense</div><ExpenseForm initial={expense.data?.data} submitText="Update" loading={mutation.isPending} onSubmit={(payload) => mutation.mutate(payload)} onCancel={() => navigate('/expenses')} /></div>;
};
