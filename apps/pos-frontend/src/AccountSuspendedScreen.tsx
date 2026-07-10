import { useSearchParams } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';

export default function AccountSuspendedScreen() {
  const [searchParams] = useSearchParams();
  const isClosed = searchParams.get('reason') === 'closed';

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 text-center bg-surface-page">
      <ShieldAlert className="w-12 h-12 text-red-500" />
      <h1 className="text-xl font-semibold">
        {isClosed ? 'This account is closed' : 'Access suspended'}
      </h1>
      <p className="text-secondary max-w-md">
        {isClosed
          ? 'This organization’s account has been closed and POS checkout is no longer available. Contact your administrator.'
          : 'Your organization’s access has been suspended. Contact your administrator for more information.'}
      </p>
    </div>
  );
}
