import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/Button';

interface Props {
  type: 'sms' | 'email';
}

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

export const MessageTemplateFormPage: React.FC<Props> = ({ type }) => {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const isSms = type === 'sms';
  const title = 'Create Template';
  const basePath = isSms ? '/sms/templates' : '/email/templates';

  const submit = () => {
    if (!name.trim()) return toast.error('Name is required');
    if (!content.trim()) return toast.error(`${isSms ? 'SMS' : 'Email'} content is required`);
    toast(`${isSms ? 'SMS' : 'Email'} template API is required to save this form.`);
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; {isSms ? 'SMS' : 'Email'} &gt; {isSms ? 'SMS Templates' : 'Email Templates'} &gt; Create Template</div>
      <div className="max-w-xl overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b px-5 py-4">
          <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        </div>
        <div className="space-y-4 p-5">
          <label className="block text-sm text-gray-600">
            Name
            <input className={`${inputClass} mt-1`} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          {!isSms && (
            <label className="block text-sm text-gray-600">
              Subject
              <input className={`${inputClass} mt-1`} placeholder="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
            </label>
          )}
          <label className="block text-sm text-gray-600">
            {isSms ? 'SMS Content' : 'Email Content'}
            <textarea className="mt-1 h-56 w-full rounded border border-gray-300 p-3 text-sm outline-none focus:ring-2 focus:ring-blue-100" value={content} onChange={(event) => setContent(event.target.value)} />
          </label>
          <label className="block text-sm text-gray-600">
            Status
            <select className={`${inputClass} mt-1`}>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </label>
        </div>
        <div className="flex gap-3 border-t p-5">
          <Button type="button" onClick={submit}>Submit</Button>
          <Button type="button" variant="secondary" onClick={() => navigate(basePath)}>Close</Button>
        </div>
      </div>
    </div>
  );
};
