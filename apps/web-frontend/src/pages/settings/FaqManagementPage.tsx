import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Trash2, Pencil, ArrowUp, ArrowDown } from 'lucide-react';
import { faqApi, type FaqItem } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPDrawer from '../../components/erp/ERPDrawer.js';
import Input from '../../components/ui/Input.js';
import Button from '../../components/ui/Button.js';
import Checkbox from '../../components/ui/Checkbox.js';
import { Textarea } from '@erp/ui';

interface FaqForm {
  category: string;
  question: string;
  answer: string;
  isPublished: boolean;
}

export default function FaqManagementPage() {
  const qc = useQueryClient();
  const [drawerItem, setDrawerItem] = useState<FaqItem | 'new' | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['faq-admin'],
    queryFn: () => faqApi.listAll(),
  });
  const items = useMemo(() => data?.content ?? [], [data]);
  const grouped = useMemo(() => {
    const map = new Map<string, FaqItem[]>();
    for (const item of items) {
      if (!map.has(item.category)) map.set(item.category, []);
      map.get(item.category)!.push(item);
    }
    return map;
  }, [items]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FaqForm>({
    defaultValues: { category: '', question: '', answer: '', isPublished: true },
  });

  const createMutation = useMutation({
    mutationFn: (payload: FaqForm) => faqApi.create({ ...payload, sortOrder: items.length }),
    onSuccess: () => {
      toast.success('FAQ created');
      setDrawerItem(null);
      reset();
      void qc.invalidateQueries({ queryKey: ['faq-admin'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: Partial<FaqItem> & { id: number; version: number }) => {
      const { id, ...rest } = payload;
      return faqApi.update(id, rest);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['faq-admin'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => faqApi.delete(id),
    onSuccess: () => {
      toast.success('FAQ removed');
      void qc.invalidateQueries({ queryKey: ['faq-admin'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function swapOrder(a: FaqItem, b: FaqItem) {
    updateMutation.mutate({ id: a.id, version: a.version, sortOrder: b.sortOrder });
    updateMutation.mutate({ id: b.id, version: b.version, sortOrder: a.sortOrder });
  }

  function onSubmit(formData: FaqForm) {
    if (drawerItem && drawerItem !== 'new') {
      updateMutation.mutate({ id: drawerItem.id, version: drawerItem.version, ...formData });
      setDrawerItem(null);
    } else {
      createMutation.mutate(formData);
    }
  }

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="FAQ Management"
        subtitle="Manage the public marketing site's FAQ content — categories, ordering and publish state."
        actions={
          <Button
            size="sm"
            onClick={() => {
              reset({ category: '', question: '', answer: '', isPublished: true });
              setDrawerItem('new');
            }}
          >
            <Plus className="h-4 w-4" /> Add FAQ
          </Button>
        }
      />

      {isLoading ? (
        <ERPTableSkeleton />
      ) : items.length === 0 ? (
        <ERPEmptyState
          type="no-data"
          title="No FAQs yet"
          description="Add your first FAQ to show it on the public pricing and landing pages."
          action={{ label: 'Add FAQ', onClick: () => setDrawerItem('new') }}
        />
      ) : (
        <div className="space-y-8">
          {[...grouped.entries()].map(([category, categoryItems]) => (
            <div key={category}>
              <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide mb-3">
                {category}
              </h2>
              <div className="rounded-lg border border-default bg-surface-card divide-y divide-default">
                {categoryItems.map((item, i) => (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex flex-col">
                      <button
                        type="button"
                        aria-label="Move up"
                        disabled={i === 0}
                        onClick={() => swapOrder(item, categoryItems[i - 1]!)}
                        className="text-secondary hover:text-primary disabled:opacity-30"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Move down"
                        disabled={i === categoryItems.length - 1}
                        onClick={() => swapOrder(item, categoryItems[i + 1]!)}
                        className="text-secondary hover:text-primary disabled:opacity-30"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-primary truncate">{item.question}</p>
                      <p className="text-xs text-secondary truncate">{item.answer}</p>
                    </div>
                    <Checkbox
                      label="Published"
                      checked={item.isPublished}
                      onChange={(e) =>
                        updateMutation.mutate({
                          id: item.id,
                          version: item.version,
                          isPublished: e.target.checked,
                        })
                      }
                    />
                    <button
                      type="button"
                      aria-label="Edit FAQ"
                      onClick={() => {
                        reset({
                          category: item.category,
                          question: item.question,
                          answer: item.answer,
                          isPublished: item.isPublished,
                        });
                        setDrawerItem(item);
                      }}
                      className="text-secondary hover:text-primary"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete FAQ"
                      onClick={() => {
                        if (window.confirm('Remove this FAQ from the public site?')) {
                          deleteMutation.mutate(item.id);
                        }
                      }}
                      className="text-secondary hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <ERPDrawer
        open={drawerItem !== null}
        onClose={() => setDrawerItem(null)}
        title={drawerItem === 'new' ? 'Add FAQ' : 'Edit FAQ'}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input
            label="Category"
            {...register('category', { required: 'Required' })}
            error={errors.category?.message}
          />
          <Input
            label="Question"
            {...register('question', { required: 'Required' })}
            error={errors.question?.message}
          />
          <Textarea
            label="Answer"
            rows={5}
            {...register('answer', { required: 'Required' })}
            error={errors.answer?.message}
          />
          <Checkbox label="Published" {...register('isPublished')} />
          <Button type="submit" className="w-full justify-center" loading={isSubmitting}>
            {drawerItem === 'new' ? 'Create FAQ' : 'Save changes'}
          </Button>
        </form>
      </ERPDrawer>
    </div>
  );
}
