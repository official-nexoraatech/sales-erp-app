import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Radio } from '@erp/ui';
import { authApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';

type SidebarStyle = 'modern' | 'classic';

const OPTIONS: Array<{ value: SidebarStyle; label: string; description: string }> = [
  { value: 'modern', label: 'Modern', description: 'Clean, compact ERP navigation.' },
  { value: 'classic', label: 'Classic', description: 'Use the original Nexoraa sidebar.' },
];

export default function PersonalizationPage() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const sidebarStyle: SidebarStyle = user?.preferences?.sidebarStyle ?? 'modern';

  const saveMutation = useMutation({
    mutationFn: (value: SidebarStyle) => authApi.updateMe({ preferences: { sidebarStyle: value } }),
    onSuccess: (_data, value) => {
      if (user) setUser({ ...user, preferences: { ...user.preferences, sidebarStyle: value } });
      toast.success('Sidebar style updated');
    },
    onError: () => toast.error('Failed to update sidebar style'),
  });

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Personalization"
        subtitle="Choose how the ERP navigation looks for you."
      />

      <div className="bg-surface-card border border-default rounded-xl p-5 max-w-lg">
        <h2 className="text-sm font-semibold text-primary mb-3">Sidebar Style</h2>
        <div className="space-y-3">
          {OPTIONS.map((option) => (
            <Radio
              key={option.value}
              name="sidebarStyle"
              label={option.label}
              description={option.description}
              checked={sidebarStyle === option.value}
              disabled={saveMutation.isPending}
              onChange={() => saveMutation.mutate(option.value)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
