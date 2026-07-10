import { useRef, useState, type ChangeEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Download, Trash2, Upload, FileText } from 'lucide-react';
import { attachmentApi, type Attachment } from '../../api/endpoints.js';
import { formatDate } from '../../lib/format.js';
import ERPFormSection from './ERPFormSection.js';
import ERPConfirmModal from './ERPConfirmModal.js';
import Button from '../ui/Button.js';

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const queryKey = ['attachments', service, entityType, entityId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => api.list(entityType, entityId),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => api.upload(entityType, entityId, file),
    onSuccess: () => {
      toast.success('File uploaded');
      void qc.invalidateQueries({ queryKey });
    },
    onError: (e: Error) => toast.error(e.message),
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

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      toast.error('File exceeds the 10MB size limit');
      return;
    }
    uploadMutation.mutate(file);
  };

  const handleDownload = async (attachment: Attachment) => {
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
  };

  const attachments = data ?? [];

  return (
    <ERPFormSection title="Attachments" description="Upload PDF, JPG, PNG or Excel files (max 10MB)" columns={1}>
      <div className="flex flex-col gap-3">
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
          >
            <Upload size={14} className="mr-1.5" />
            {uploadMutation.isPending ? 'Uploading…' : 'Upload File'}
          </Button>
        </div>

        {isLoading && <p className="text-xs text-secondary">Loading attachments…</p>}
        {!isLoading && attachments.length === 0 && (
          <p className="text-xs text-secondary">No attachments yet.</p>
        )}

        {attachments.map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-default bg-surface-hover"
          >
            <div className="flex items-center gap-2 min-w-0">
              <FileText size={16} className="text-secondary shrink-0" />
              <div className="min-w-0">
                <div className="text-sm text-primary truncate">{a.fileName}</div>
                <div className="text-xs text-secondary">
                  {(a.fileSize / 1024).toFixed(0)} KB · {formatDate(a.createdAt)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => void handleDownload(a)}
                className="p-1.5 rounded hover:bg-surface-card text-secondary hover:text-primary"
                title="Download"
              >
                <Download size={15} />
              </button>
              <button
                type="button"
                onClick={() => setDeleteId(a.id)}
                className="p-1.5 rounded hover:bg-surface-card text-secondary hover:text-danger"
                title="Delete"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>

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
