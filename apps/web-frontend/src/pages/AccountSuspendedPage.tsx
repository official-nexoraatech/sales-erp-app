import { useSearchParams } from 'react-router-dom';
import ERPEmptyState from '../components/erp/ERPEmptyState.js';

export default function AccountSuspendedPage() {
  const [searchParams] = useSearchParams();
  const isClosed = searchParams.get('reason') === 'closed';

  return (
    <div className="flex items-center justify-center min-h-screen bg-surface-page">
      <ERPEmptyState
        type="no-access"
        title={isClosed ? 'This account is closed' : 'Access suspended'}
        description={
          isClosed
            ? 'This organization’s account has been closed and is no longer accessible. Contact your administrator if you believe this is a mistake.'
            : 'Your organization’s access has been suspended. Contact your administrator for more information.'
        }
      />
    </div>
  );
}
