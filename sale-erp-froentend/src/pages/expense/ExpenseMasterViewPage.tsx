import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { expenseCategoryApi, expenseSubCategoryApi, paymentMethodApi } from '../../api/endpoints';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Loader } from '../../components/ui/Loader';
import { PageHeader } from '../../components/ui/PageHeader';

interface Props {
  type: 'category' | 'subcategory' | 'paymentMethod';
}

export const ExpenseMasterViewPage: React.FC<Props> = ({ type }) => {
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const label = type === 'category' ? 'Expense Category' : type === 'subcategory' ? 'Expense Subcategory' : 'Payment Type';
  const basePath = type === 'category' ? '/expenses/categories' : type === 'subcategory' ? '/expenses/subcategories' : '/expenses/payment-types';
  const detail = useQuery({
    queryKey: ['expense-master-view', type, id],
    queryFn: () => {
      if (type === 'category') return expenseCategoryApi.getById(id);
      if (type === 'subcategory') return expenseSubCategoryApi.getById(id);
      return paymentMethodApi.getById(id);
    },
    enabled: id > 0,
  });

  if (detail.isLoading) return <div className="p-10"><Loader /></div>;
  const record = detail.data?.data as any;

  return (
    <div className="space-y-6">
      <PageHeader title={`${label}: ${record?.name || ''}`} actions={<Button variant="secondary" onClick={() => navigate(basePath)}>Back</Button>} />
      <Card>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {type === 'subcategory' && <div><p className="text-sm text-gray-500">Expense Category</p><p className="font-semibold">{record?.expenseCategoryName || 'N/A'}</p></div>}
          <div><p className="text-sm text-gray-500">Name</p><p className="font-semibold">{record?.name || 'N/A'}</p></div>
          <div><p className="text-sm text-gray-500">Status</p><p className="font-semibold">{record?.status || 'N/A'}</p></div>
          <div className="md:col-span-2"><p className="text-sm text-gray-500">Description</p><p className="font-semibold">{record?.description || 'N/A'}</p></div>
        </div>
      </Card>
    </div>
  );
};
