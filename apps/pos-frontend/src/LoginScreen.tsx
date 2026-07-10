import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ShoppingBag } from 'lucide-react';
import { setTokens } from './auth.js';
import POSInput from './components/pos/POSInput.js';
import POSButton from './components/pos/POSButton.js';

const AUTH_API = (import.meta.env['VITE_AUTH_API_URL'] ?? 'http://localhost:3010') + '/api/v2';

export default function LoginScreen() {
  const navigate = useNavigate();
  const [tenantId, setTenantId] = useState('1');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${AUTH_API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: Number(tenantId), email, password }),
      });
      const body = await res.json();
      if (!res.ok) {
        const err = body.error;
        throw new Error(typeof err === 'string' ? err : (err?.message ?? 'Login failed'));
      }
      const result = body.data as { accessToken?: string; refreshToken?: string; requiresMFA?: boolean };
      if (result.requiresMFA) {
        throw new Error('Two-factor accounts must sign in via the main ERP app first');
      }
      if (!result.accessToken || !result.refreshToken) {
        throw new Error('Login failed');
      }
      setTokens(result.accessToken, result.refreshToken);
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-surface-page font-sans">
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="bg-surface-card rounded-2xl shadow-token-lg p-8 w-full max-w-sm space-y-5"
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex items-center justify-center w-12 h-12 rounded-2xl bg-primary-subtle text-brand">
            <ShoppingBag size={24} />
          </span>
          <h1 className="text-xl font-bold text-primary">POS Sign In</h1>
        </div>
        <POSInput
          label="Tenant ID"
          type="number"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          required
        />
        <POSInput
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        <POSInput
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
        <POSButton type="submit" size="lg" loading={loading} className="w-full">
          {loading ? 'Signing in…' : 'Sign In'}
        </POSButton>
      </form>
    </div>
  );
}
