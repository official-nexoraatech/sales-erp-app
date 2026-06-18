import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { excelImportApi, warehouseApi } from '../../api/endpoints';
import { Button } from '../../components/ui/Button';

interface Props {
  type: 'items' | 'contacts';
}

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';
const itemBaseUnitId = 3;

const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export const ImportPage: React.FC<Props> = ({ type }) => {
  const isItems = type === 'items';
  const fileRef = useRef<HTMLInputElement>(null);
  const [warehouseId, setWarehouseId] = useState('');
  const warehouses = useQuery({
    queryKey: ['warehouses', 'utilities-import'],
    queryFn: () => warehouseApi.getAll(''),
    enabled: isItems,
  });

  const warehouseRows = Array.isArray(warehouses.data?.data) ? warehouses.data?.data || [] : [];
  const title = isItems ? 'Import Items' : 'Import Contacts';
  useEffect(() => {
    if (isItems && !warehouseId && warehouseRows.length) {
      setWarehouseId(String(warehouseRows[0].id));
    }
  }, [isItems, warehouseId, warehouseRows]);

  const downloadTemplate = useMutation({
    mutationFn: () => isItems ? excelImportApi.downloadItemsTemplate() : excelImportApi.downloadContactsTemplate(),
    onSuccess: (blob) => {
      saveBlob(blob, isItems ? 'Items-Import-Template.xlsx' : 'Contacts-Import-Template.xlsx');
      toast.success('Template downloaded');
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to download template'),
  });
  const uploadExcel = useMutation({
    mutationFn: (file: File) => {
      if (isItems) {
        const selectedWarehouseId = Number(warehouseId);
        if (!selectedWarehouseId) {
          throw new Error('Please select warehouse');
        }
        return excelImportApi.importItems(file, selectedWarehouseId, itemBaseUnitId);
      }
      return excelImportApi.importContacts(file);
    },
    onSuccess: () => {
      toast.success(`${isItems ? 'Items' : 'Contacts'} imported successfully`);
      if (fileRef.current) fileRef.current.value = '';
    },
    onError: (error: any) => toast.error(error?.message || `Failed to import ${isItems ? 'items' : 'contacts'}`),
  });
  const submit = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error('Please choose an Excel file');
      return;
    }
    uploadExcel.mutate(file);
  };
  const downloadButton = (
    <button
      type="button"
      className="h-10 min-w-[170px] rounded border border-blue-500 bg-white px-5 text-sm font-semibold text-blue-600 hover:bg-blue-50"
      disabled={downloadTemplate.isPending}
      onClick={() => downloadTemplate.mutate()}
    >
      {downloadTemplate.isPending ? 'Downloading...' : 'Download'}
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Utilities &gt; {title}</div>

      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b px-5 py-4">
          <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        </div>

        <div className="p-5">
          <div className={`grid grid-cols-1 gap-4 ${isItems ? 'md:grid-cols-2' : 'max-w-md'}`}>
            {isItems && (
              <label className="text-sm text-gray-600">
                Warehouse (Only for Stock Maintain)
                <select className={`${inputClass} mt-1`} value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
                  {warehouseRows.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                  ))}
                </select>
              </label>
            )}

            {isItems ? (
              <label className="text-sm text-gray-600">
                Download Sample
                <span className="mt-1 block">{downloadButton}</span>
              </label>
            ) : (
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <span className="min-w-[125px]">Download Sample</span>
                {downloadButton}
              </div>
            )}

            <label className="text-sm text-gray-600">
              Browse File
              <input ref={fileRef} type="file" accept=".xls,.xlsx,.csv" className={`${inputClass} mt-1 max-w-md py-2`} />
            </label>
          </div>
        </div>

        <div className="flex gap-3 px-5 pb-5">
          <Button type="button" isLoading={uploadExcel.isPending} onClick={submit}>Submit</Button>
          <Button type="button" variant="secondary" onClick={() => fileRef.current && (fileRef.current.value = '')}>Close</Button>
        </div>
      </div>
    </div>
  );
};
