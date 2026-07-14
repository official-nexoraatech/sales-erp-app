import React from 'react';
import type { PurchaseRequest } from '../../../api/endpoints';
import { PurchaseForm, type PurchaseSubmitPayload } from '../bills/PurchaseForm';

interface Props {
  initial?: PurchaseRequest & { lines?: any[]; purchaseNo?: string; status?: string };
  submitText: string;
  loading: boolean;
  onSubmit: (payload: PurchaseSubmitPayload) => void;
  onCancel: () => void;
}

export const PurchaseOrderForm: React.FC<Props> = (props) => <PurchaseForm {...props} mode="order" />;
