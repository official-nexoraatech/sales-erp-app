import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { messageTemplateApi } from '../../api/endpoints';
import type { MessageTemplate, MessageTemplateStatus } from '../../types/api.types';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';

interface Props {
  type: 'sms' | 'email';
  mode?: 'create' | 'edit';
}

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

export const MessageTemplateFormPage: React.FC<Props> = ({ type, mode = 'create' }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const id = Number(useParams<{ id: string }>().id);
  const state = location.state as MessageTemplate | undefined;
  const isSms = type === 'sms';
  const isEdit = mode === 'edit';
  const label = isSms ? 'SMS template' : 'Email template';
  const basePath = isSms ? '/sms/templates' : '/email/templates';
  const [name, setName] = useState(isEdit ? state?.name || '' : '');
  const [subject, setSubject] = useState(isEdit ? state?.subject || '' : '');
  const [content, setContent] = useState(isEdit ? state?.content || '' : '');
  const [status, setStatus] = useState<MessageTemplateStatus>(state?.status || 'ACTIVE');

  const template = useQuery({
    queryKey: ['message-template-detail', type, id],
    queryFn: () => messageTemplateApi.getById(type, id),
    enabled: isEdit && Number.isFinite(id) && !state,
  });

  useEffect(() => {
    if (!template.data?.data) return;
    setName(template.data.data.name || '');
    setSubject(template.data.data.subject || '');
    setContent(template.data.data.content || '');
    setStatus(template.data.data.status || 'ACTIVE');
  }, [template.data]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        subject: isSms ? undefined : subject.trim(),
        content: content.trim(),
        status,
      };
      return isEdit ? messageTemplateApi.update(type, id, payload) : messageTemplateApi.create(type, payload);
    },
    onSuccess: async () => {
      toast.success(`${label} ${isEdit ? 'updated' : 'created'} successfully`);
      await queryClient.invalidateQueries({ queryKey: ['message-template', type] });
      await queryClient.invalidateQueries({ queryKey: ['message-template-detail', type, id] });
      navigate(basePath);
    },
    onError: (error: any) => toast.error(error?.message || `Failed to ${isEdit ? 'update' : 'create'} ${label}`),
  });

  const submit = () => {
    if (!name.trim()) return toast.error('Name is required');
    if (!isSms && !subject.trim()) return toast.error('Subject is required');
    if (!content.trim()) return toast.error(`${isSms ? 'SMS' : 'Email'} content is required`);
    mutation.mutate();
  };

  const title = isEdit ? 'Edit Template' : 'Create Template';

  if (template.isLoading) {
    return <div className="p-10"><Loader /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; {isSms ? 'SMS' : 'Email'} &gt; {isSms ? 'SMS Templates' : 'Email Templates'} &gt; {title}</div>
      <div className="max-w-xl overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b px-5 py-4">
          <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        </div>
        <div className="space-y-4 p-5">
          <label className="block text-sm text-gray-600">
            Name
            <input className={`${inputClass} mt-1`} value={name} onChange={(event) => setName(event.target.value)} disabled={mutation.isPending} />
          </label>
          {!isSms && (
            <label className="block text-sm text-gray-600">
              Subject
              <input className={`${inputClass} mt-1`} placeholder="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} disabled={mutation.isPending} />
            </label>
          )}
          <label className="block text-sm text-gray-600">
            {isSms ? 'SMS Content' : 'Email Content'}
            <textarea className="mt-1 h-56 w-full rounded border border-gray-300 p-3 text-sm outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50" value={content} onChange={(event) => setContent(event.target.value)} disabled={mutation.isPending} />
          </label>
          <label className="block text-sm text-gray-600">
            Status
            <select className={`${inputClass} mt-1`} value={status} onChange={(event) => setStatus(event.target.value as MessageTemplateStatus)} disabled={mutation.isPending}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
        </div>
        <div className="flex gap-3 border-t p-5">
          <Button type="button" onClick={submit} isLoading={mutation.isPending}>Submit</Button>
          <Button type="button" variant="secondary" onClick={() => navigate(basePath)} disabled={mutation.isPending}>Close</Button>
        </div>
      </div>
    </div>
  );
};
