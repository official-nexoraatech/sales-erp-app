import { useNavigate } from 'react-router-dom';
import ERPEmptyState from '../components/erp/ERPEmptyState.js';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="flex items-center justify-center min-h-screen bg-surface-page">
      <ERPEmptyState
        type="no-data"
        title="Page not found"
        description="The page you're looking for doesn't exist or has been moved."
        action={{ label: 'Go to Dashboard', onClick: () => navigate('/dashboard') }}
      />
    </div>
  );
}
