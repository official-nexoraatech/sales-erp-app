import React, { useRef, useState } from 'react';
import { Bold, Italic, Link, List, ListOrdered, Underline } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/Button';

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

export const CreateEmailPage: React.FC = () => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [emailIds, setEmailIds] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const send = () => {
    if (!emailIds.trim()) return toast.error('Email id is required');
    if (!subject.trim()) return toast.error('Subject is required');
    if (!message.trim()) return toast.error('Message is required');
    toast('Create Email API is required to send this email.');
  };

  const resetFile = () => {
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Email &gt; Create Email</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b px-5 py-4">
          <h1 className="text-xl font-semibold text-gray-900">Create Email</h1>
        </div>
        <div className="space-y-4 p-5">
          <label className="block text-sm text-gray-600">
            Email Id(s)
            <input className={`${inputClass} mt-1`} placeholder="Comma separator for multiple Emails Id(s)" value={emailIds} onChange={(event) => setEmailIds(event.target.value)} />
          </label>
          <label className="block text-sm text-gray-600">
            Subject
            <input className={`${inputClass} mt-1`} placeholder="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
          </label>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Message</label>
            <div className="rounded border border-gray-300">
              <div className="flex h-10 items-center gap-4 border-b px-3 text-sm text-gray-700">
                <select className="rounded border-0 bg-white text-sm outline-none"><option>Normal</option></select>
                <Bold size={15} />
                <Italic size={15} />
                <Underline size={15} />
                <Link size={15} />
                <ListOrdered size={15} />
                <List size={15} />
                <span className="font-semibold">T<sub>x</sub></span>
              </div>
              <textarea className="h-40 w-full resize-none p-3 text-sm outline-none md:h-48" value={message} onChange={(event) => setMessage(event.target.value)} />
            </div>
          </div>
          <label className="block text-sm text-gray-600">
            Attachment
            <div className="mt-1 flex">
              <input ref={fileRef} type="file" className="h-10 flex-1 rounded-l border border-gray-300 px-3 py-2 text-sm" />
              <button type="button" onClick={resetFile} className="h-10 rounded-r border border-l-0 border-gray-300 px-5 text-sm text-gray-500 hover:bg-gray-50">Remove</button>
            </div>
          </label>
        </div>
        <div className="flex gap-3 px-5 pb-5">
          <Button type="button" onClick={send}>Send</Button>
          <Button type="button" variant="secondary" onClick={() => { setEmailIds(''); setSubject(''); setMessage(''); resetFile(); }}>Close</Button>
        </div>
      </div>
    </div>
  );
};
