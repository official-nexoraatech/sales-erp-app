import type { ReactNode } from 'react';
import { ShieldCheck, BarChart3, Boxes } from 'lucide-react';
import BrandMark from '../marketing/BrandMark.js';

const FEATURES = [
  { icon: Boxes, text: 'Multi-branch inventory & warehouse control' },
  { icon: BarChart3, text: 'Real-time sales, GST & financial reporting' },
  { icon: ShieldCheck, text: '2FA, session management & audit logging' },
];

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-subtle flex">
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 text-white bg-gradient-ink relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-accent-glow" aria-hidden="true" />
        <BrandMark inverse className="relative" />
        <div className="relative max-w-sm">
          <h2 className="font-display font-semibold text-display-sm leading-tight mb-4">
            Run your whole business from one place.
          </h2>
          <ul className="space-y-3">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-white/90">
                <Icon className="h-5 w-5 shrink-0 mt-0.5" />
                <span className="text-sm">{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/60">
          &copy; {new Date().getFullYear()} NEXORAA Technologies
        </p>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-surface-card rounded-2xl shadow-xl p-8">{children}</div>
      </div>
    </div>
  );
}
