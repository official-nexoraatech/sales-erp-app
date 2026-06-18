import React from 'react';
import type { PurchaseRequest } from '../../../api/endpoints';
import { PurchaseForm } from '../bills/PurchaseForm';

interface Props {
  initial?: PurchaseRequest & { lines?: any[] };
  submitText: string;
  loading: boolean;
  onSubmit: (payload: PurchaseRequest) => void;
  onCancel: () => void;
}

export const PurchaseOrderForm: React.FC<Props> = (props) => <PurchaseForm {...props} mode="order" />;
