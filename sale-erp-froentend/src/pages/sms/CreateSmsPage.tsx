import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/Button';

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

export const CreateSmsPage: React.FC = () => {
  const [mobileNumbers, setMobileNumbers] = useState('');
  const [message, setMessage] = useState('');

  const send = () => {
    if (!mobileNumbers.trim()) return toast.error('Mobile number is required');
    if (!message.trim()) return toast.error('Message is required');
    toast('Create SMS API is required to send this message.');
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; SMS &gt; Create SMS</div>
      <div className="max-w-xl overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b px-5 py-4">
          <h1 className="text-xl font-semibold text-gray-900">Create SMS</h1>
        </div>
        <div className="space-y-4 p-5">
          <label className="block text-sm text-gray-600">
            Mobile Number
            <input className={`${inputClass} mt-1`} placeholder="Comma separator for multiple numbers" value={mobileNumbers} onChange={(event) => setMobileNumbers(event.target.value)} />
          </label>
          <label className="block text-sm text-gray-600">
            Message
            <textarea className="mt-1 h-56 w-full rounded border border-gray-300 p-3 text-sm outline-none focus:ring-2 focus:ring-blue-100" value={message} onChange={(event) => setMessage(event.target.value)} />
          </label>
        </div>
        <div className="flex gap-3 px-5 pb-5">
          <Button type="button" onClick={send}>Send</Button>
          <Button type="button" variant="secondary" onClick={() => { setMobileNumbers(''); setMessage(''); }}>Close</Button>
        </div>
      </div>
    </div>
  );
};
