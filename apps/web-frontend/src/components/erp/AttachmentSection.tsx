import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { attachmentApi, type Attachment } from '../../api/endpoints.js';
import ERPFormSection from './ERPFormSection.js';
import ERPConfirmModal from './ERPConfirmModal.js';
import FileUpload, { type UploadFileItem } from '../ui/FileUpload.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = '.pdf,.jpg,.jpeg,.png,.xls,.xlsx';

interface Props {
  service: 'sales' | 'purchase';
  entityType: string;
  entityId: number;
}

export default function AttachmentSection({ service, entityType, entityId }: Props) {
  const api = attachmentApi(service);
  const qc = useQueryClient();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const queryKey = ['attachments', service, entityType, entityId];

  const { data } = useQuery({
    queryKey,
    queryFn: () => api.list(entityType, entityId),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => api.upload(entityType, entityId, file),
    onSuccess: () => {
      toast.success('File uploaded');
      void qc.invalidateQueries({ queryKey });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(id),
    onSuccess: () => {
      toast.success('Attachment deleted');
      void qc.invalidateQueries({ queryKey });
      setDeleteId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const attachments = data ?? [];

  async function handleDownload(attachment: Attachment) {
    try {
      const blob = await api.download(attachment.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download failed');
    }
  }

  const doneFiles: UploadFileItem[] = attachments.map((a) => ({
    id: `server-${a.id}`,
    name: a.fileName,
    size: a.fileSize,
    status: 'done',
  }));
  // react-query's own `variables`/`isPending`/`isError` already track the in-flight (or
  // last-failed) upload — no need for separate local state to mirror it.
  const pendingFile: UploadFileItem[] =
    uploadMutation.variables && (uploadMutation.isPending || uploadMutation.isError)
      ? [
          {
            id: 'pending',
            name: uploadMutation.variables.name,
            size: uploadMutation.variables.size,
            status: uploadMutation.isError ? 'error' : 'uploading',
            error: uploadMutation.isError ? uploadMutation.error?.message : undefined,
          },
        ]
      : [];

  return (
    <ERPFormSection
      title="Attachments"
      description="Upload PDF, JPG, PNG or Excel files (max 10MB)"
      columns={1}
    >
      <FileUpload
        files={[...doneFiles, ...pendingFile]}
        accept={ACCEPTED_TYPES}
        maxSizeBytes={MAX_FILE_SIZE}
        multiple={false}
        onFilesSelected={(picked) => {
          if (picked[0]) uploadMutation.mutate(picked[0]);
        }}
        onRetry={() => {
          if (uploadMutation.variables) uploadMutation.mutate(uploadMutation.variables);
        }}
        onDownload={(id) => {
          const attachment = attachments.find((a) => `server-${a.id}` === id);
          if (attachment) void handleDownload(attachment);
        }}
        onRemove={(id) => {
          if (id === 'pending') {
            uploadMutation.reset();
            return;
          }
          const attachment = attachments.find((a) => `server-${a.id}` === id);
          if (attachment) setDeleteId(attachment.id);
        }}
      />

      <ERPConfirmModal
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId !== null && deleteMutation.mutate(deleteId)}
        title="Delete Attachment"
        description="This will permanently delete the attachment. This action cannot be undone."
        isLoading={deleteMutation.isPending}
      />
    </ERPFormSection>
  );
}
