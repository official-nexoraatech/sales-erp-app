import type { ReactNode } from 'react';
import { ShieldCheck, BarChart3, Boxes } from 'lucide-react';

const FEATURES = [
  { icon: Boxes, text: 'Multi-branch inventory & warehouse control' },
  { icon: BarChart3, text: 'Real-time sales, GST & financial reporting' },
  { icon: ShieldCheck, text: '2FA, session management & audit logging' },
];

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-subtle flex">
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 text-white bg-[image:linear-gradient(135deg,var(--brand-primary),var(--brand-primary-active))]">
        <div className="inline-flex items-center gap-2 w-fit">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-white/15 text-white text-lg font-bold backdrop-blur">
            N
          </div>
          <span className="text-lg font-semibold">NEXORAA ERP</span>
        </div>
        <div className="max-w-sm">
          <h2 className="text-3xl font-bold leading-tight mb-4">Run your whole business from one place.</h2>
          <ul className="space-y-3">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-white/90">
                <Icon className="h-5 w-5 shrink-0 mt-0.5" />
                <span className="text-sm">{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-white/60">&copy; {new Date().getFullYear()} NEXORAA Technologies</p>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-surface-card rounded-2xl shadow-xl p-8">{children}</div>
      </div>
    </div>
  );
}
