import React, { useState } from 'react';
import { CirclePlus, Trash2 } from 'lucide-react';
import type { ExpenseDetail, ExpenseRequest } from '../../api/endpoints';
import { Button } from '../../components/ui/Button';

interface Props { initial?: ExpenseDetail; submitText: string; loading: boolean; onSubmit: (payload: ExpenseRequest) => void; onCancel: () => void }
interface Line { item: string; quantity: number; price: number }
const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

export const ExpenseForm: React.FC<Props> = ({ initial, submitText, loading, onSubmit, onCancel }) => {
  const [expenseCategoryId, setExpenseCategoryId] = useState(initial?.expenseCategory?.id || 0);
  const [subCategory, setSubCategory] = useState('');
  const [expenseDate, setExpenseDate] = useState(initial?.expenseDate || new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(initial?.amount || 0);
  const [paymentMethodId, setPaymentMethodId] = useState(initial?.paymentMethod?.id || 0);
  const [notes, setNotes] = useState(initial?.notes || '');
  const [itemName, setItemName] = useState('');
  const [roundOff, setRoundOff] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const total = lines.reduce((sum, line) => sum + line.quantity * line.price, 0);
  const grandTotal = roundOff ? Math.round(total || amount) : (total || amount);
  const submit = () => {
    if (!expenseCategoryId || !paymentMethodId || grandTotal <= 0) return alert('Select category, payment type and valid amount.');
    onSubmit({ expenseCategoryId, expenseDate, amount: grandTotal, paymentMethodId, notes });
  };
  const addRow = () => {
    if (!itemName.trim()) return;
    setLines((current) => [...current, { item: itemName, quantity: 1, price: amount || 0 }]);
    setItemName('');
  };
  return (
    <div className="overflow-hidden rounded-lg bg-white shadow">
      <div className="border-b px-5 py-4"><h1 className="text-xl font-semibold text-gray-900">Expense Details</h1></div>
      <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
        <label className="text-sm text-gray-600">Category<div className="mt-1 flex"><select className={`${inputClass} rounded-r-none`} value={expenseCategoryId} onChange={(event) => setExpenseCategoryId(Number(event.target.value))}><option value={0}>Choose one thing</option><option value={1}>General</option><option value={2}>Drinks</option><option value={3}>Dipak Kumar</option></select><button type="button" className="flex h-10 w-10 items-center justify-center rounded-r border border-l-0 border-blue-400 text-blue-500"><CirclePlus size={16} /></button></div></label>
        <label className="text-sm text-gray-600">Subcategory<div className="mt-1 flex"><select className={`${inputClass} rounded-r-none`} value={subCategory} onChange={(event) => setSubCategory(event.target.value)}><option value="">Choose one thing</option><option>salary</option><option>Pepsi</option></select><button type="button" className="flex h-10 w-10 items-center justify-center rounded-r border border-l-0 border-blue-400 text-blue-500"><CirclePlus size={16} /></button></div></label>
        <label className="text-sm text-gray-600">Date<input type="date" className={`${inputClass} mt-1`} value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} /></label>
        <label className="text-sm text-gray-600">Expense Number<div className="mt-1 flex"><input className={`${inputClass} rounded-r-none`} value="EXP/" readOnly /><span className="flex h-10 items-center border-y border-gray-300 px-3">#</span><input className={`${inputClass} rounded-l-none`} value="114" readOnly /></div></label>
      </div>
      <h2 className="border-y px-5 py-4 text-lg font-semibold">Expense Items</h2>
      <div className="p-5"><label className="text-sm text-gray-600">Enter Item Name<div className="mt-1 flex max-w-3xl"><input className={`${inputClass} rounded-r-none`} placeholder="Search/Add Items" value={itemName} onChange={(event) => setItemName(event.target.value)} /><button type="button" onClick={addRow} className="h-10 rounded-r border border-blue-400 px-10 text-blue-600">Add Row</button></div></label></div>
      <div className="overflow-x-auto px-5"><table className="w-full text-sm"><thead className="bg-gray-50"><tr>{['Action', 'Item', 'QTY', 'Price/Unit', 'Total'].map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}</tr></thead><tbody>{lines.length ? lines.map((line, index) => <tr key={`${line.item}-${index}`}><td className="border p-3"><button onClick={() => setLines((current) => current.filter((_, i) => i !== index))} className="text-red-600"><Trash2 size={16} /></button></td><td className="border p-3">{line.item}</td><td className="border p-3"><input type="number" value={line.quantity} onChange={(event) => setLines((current) => current.map((entry, i) => i === index ? { ...entry, quantity: Number(event.target.value) } : entry))} className="w-20 rounded border px-2 py-1" /></td><td className="border p-3"><input type="number" value={line.price} onChange={(event) => setLines((current) => current.map((entry, i) => i === index ? { ...entry, price: Number(event.target.value) } : entry))} className="w-28 rounded border px-2 py-1" /></td><td className="border p-3">{(line.quantity * line.price).toFixed(2)}</td></tr>) : <tr><td colSpan={5} className="bg-gray-50 p-4 text-center italic">No items are added yet!!</td></tr>}<tr><td colSpan={2} className="border p-2 text-right font-bold">Total</td><td className="border p-2 font-bold">{lines.reduce((sum, line) => sum + line.quantity, 0)}</td><td className="border p-2" /><td className="border p-2 text-right font-bold">{total.toFixed(2)}</td></tr></tbody></table></div>
      <div className="grid grid-cols-1 gap-5 p-5 md:grid-cols-[1fr_240px]"><label className="text-sm text-gray-600">Note<textarea className="mt-1 h-20 w-full rounded border border-gray-300 p-3" value={notes} onChange={(event) => setNotes(event.target.value)} /></label><div className="space-y-2"><label className="flex items-center justify-between bg-gray-50 p-3 text-sm font-semibold"><span><input type="checkbox" checked={roundOff} onChange={(event) => setRoundOff(event.target.checked)} className="mr-2" />Round Off</span><input value={roundOff ? (grandTotal - (total || amount)).toFixed(2) : '0'} readOnly className="w-24 rounded border border-gray-300 px-3 py-2 text-right" /></label><p className="flex items-center justify-between border-t p-3 text-sm font-bold"><span>Grand Total</span><input value={grandTotal.toFixed(2)} onChange={(event) => setAmount(Number(event.target.value))} className="w-24 rounded border border-gray-300 px-3 py-2 text-right" /></p></div></div>
      <h2 className="border-y px-5 py-4 text-lg font-semibold">Payment</h2>
      <div className="grid grid-cols-1 gap-5 p-5 md:grid-cols-2"><label className="text-sm text-gray-600">#1 Amount<div className="mt-1 flex"><input type="number" className={`${inputClass} rounded-r-none text-right`} value={amount || ''} onChange={(event) => setAmount(Number(event.target.value))} /><span className="flex h-10 w-8 items-center justify-center rounded-r border border-l-0 border-gray-300">$</span></div></label><label className="text-sm text-gray-600">Payment Type<div className="mt-1 flex"><select className={`${inputClass} rounded-r-none`} value={paymentMethodId} onChange={(event) => setPaymentMethodId(Number(event.target.value))}><option value={0}>Choose one thing</option><option value={1}>Cash</option><option value={2}>Cheque</option><option value={3}>Bank</option></select><button type="button" className="flex h-10 w-9 items-center justify-center rounded-r border border-l-0 border-gray-300 text-blue-500"><CirclePlus size={15} /></button></div></label><label className="text-sm text-gray-600">Payment Note<textarea className="mt-1 h-20 w-full rounded border border-gray-300 p-3" value={notes} onChange={(event) => setNotes(event.target.value)} /></label></div>
      <div className="px-5 pb-5"><button type="button" className="text-sm text-blue-600">+ Add Payment Type</button></div>
      <div className="flex gap-3 border-t p-5"><Button onClick={submit} isLoading={loading}>{submitText}</Button><Button variant="secondary" onClick={onCancel}>Close</Button></div>
    </div>
  );
};
