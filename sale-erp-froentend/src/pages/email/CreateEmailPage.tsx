import React, { useRef, useState } from 'react';
import { Paperclip, Send, X } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { emailApi } from '../../api/endpoints';
import { Button } from '../../components/ui/Button';
import { Textarea } from '../../components/ui/Textarea';

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

export const CreateEmailPage: React.FC = () => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [emailIds, setEmailIds] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const resetForm = () => {
    setEmailIds('');
    setSubject('');
    setMessage('');
    resetFile();
  };

  const sendEmail = useMutation({
    mutationFn: () => emailApi.send({ emailIds, subject, message, file }),
    onSuccess: () => {
      toast.success('Email sent successfully');
      resetForm();
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to send email'),
  });

  const send = () => {
    if (!emailIds.trim()) return toast.error('Email id is required');
    if (!subject.trim()) return toast.error('Subject is required');
    if (!message.trim()) return toast.error('Message is required');
    sendEmail.mutate();
  };

  const resetFile = () => {
    setFile(null);
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
            <input className={`${inputClass} mt-1`} placeholder="Comma separated email addresses" value={emailIds} onChange={(event) => setEmailIds(event.target.value)} disabled={sendEmail.isPending} />
          </label>
          <label className="block text-sm text-gray-600">
            Subject
            <input className={`${inputClass} mt-1`} placeholder="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} disabled={sendEmail.isPending} />
          </label>
          <Textarea label="Message" className="h-44 md:h-52" value={message} onChange={(event) => setMessage(event.target.value)} disabled={sendEmail.isPending} />
          <label className="block text-sm text-gray-600">
            Attachment
            <div className="mt-1 flex">
              <input
                ref={fileRef}
                type="file"
                className="h-10 flex-1 rounded-l border border-gray-300 px-3 py-2 text-sm"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
                disabled={sendEmail.isPending}
              />
              <button type="button" onClick={resetFile} className="inline-flex h-10 items-center gap-2 rounded-r border border-l-0 border-gray-300 px-5 text-sm text-gray-500 hover:bg-gray-50" disabled={sendEmail.isPending} title="Remove attachment">
                <X size={15} />
                Remove
              </button>
            </div>
            {file && <span className="mt-2 inline-flex items-center gap-2 text-xs text-gray-500"><Paperclip size={13} />{file.name}</span>}
          </label>
        </div>
        <div className="flex gap-3 px-5 pb-5">
          <Button type="button" onClick={send} isLoading={sendEmail.isPending} className="inline-flex items-center gap-2">
            {!sendEmail.isPending && <Send size={16} />}
            Send
          </Button>
          <Button type="button" variant="secondary" onClick={resetForm} disabled={sendEmail.isPending}>Close</Button>
        </div>
      </div>
    </div>
  );
};
