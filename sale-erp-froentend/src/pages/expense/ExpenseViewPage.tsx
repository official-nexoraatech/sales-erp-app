import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { expenseApi } from '../../api/endpoints';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Loader } from '../../components/ui/Loader';
import { PageHeader } from '../../components/ui/PageHeader';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatDate } from '../../utils/formatDate';

export const ExpenseViewPage: React.FC = () => {
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const expense = useQuery({ queryKey: ['expense', id], queryFn: () => expenseApi.getById(id), enabled: id > 0 });
  if (expense.isLoading) return <Loader />;
  const data = expense.data?.data;
  return <div className="space-y-6"><PageHeader title={`Expense ${data?.expenseNo || data?.expenseNumber || ''}`} actions={<Button variant="secondary" onClick={() => navigate('/expenses')}>Back</Button>} /><Card><div className="grid grid-cols-1 gap-5 md:grid-cols-2"><div><p className="text-sm text-gray-500">Date</p><p className="font-semibold">{data?.expenseDate ? formatDate(data.expenseDate) : 'N/A'}</p></div><div><p className="text-sm text-gray-500">Category</p><p className="font-semibold">{data?.expenseCategory?.name || data?.categoryName || 'N/A'}</p></div><div><p className="text-sm text-gray-500">Payment Method</p><p className="font-semibold">{data?.paymentMethod?.name || data?.paymentMethodName || data?.paymentType || 'N/A'}</p></div><div><p className="text-sm text-gray-500">Amount</p><p className="font-semibold">{formatCurrency(data?.amount || 0)}</p></div><div className="md:col-span-2"><p className="text-sm text-gray-500">Notes</p><p className="font-semibold">{data?.notes || 'N/A'}</p></div></div></Card></div>;
};
