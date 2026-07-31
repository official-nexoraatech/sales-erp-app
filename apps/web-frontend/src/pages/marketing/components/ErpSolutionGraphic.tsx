import { Store, Truck, Factory } from 'lucide-react';
import ModuleGlyph from '../../../components/marketing/ModuleGlyph.js';

const INDUSTRIES = [
  {
    icon: Store,
    label: 'Retail',
    description: 'Streamline sales, inventory & billing for retail stores.',
    dot: 'bg-[#14b8a6]',
    top: '0%',
  },
  {
    icon: Truck,
    label: 'Distribution',
    description: 'Manage stock, orders & deliveries with ease.',
    dot: 'bg-[#f59e0b]',
    top: '38%',
  },
  {
    icon: Factory,
    label: 'Manufacturing',
    description: 'Plan production, manage costing & improve efficiency.',
    dot: 'bg-[#0ea5e9]',
    top: '76%',
  },
];

/** Decorative recreation of the reference screenshot's "All-in-One ERP Solution" graphic —
 * a central badge with three branch lines fanning out to Retail/Distribution/Manufacturing
 * cards. Purely illustrative (aria-hidden), built the same way as the isometric panel it
 * replaces: absolute-positioned divs + ModuleGlyph, no new dependency. */
export default function ErpSolutionGraphic() {
  return (
    <div className="hidden lg:block relative h-[420px]" aria-hidden="true">
      <div
        className="absolute left-0 top-1/2 -translate-y-1/2 w-56 h-56 rounded-full border-2 border-dashed border-accent/40"
        aria-hidden="true"
      />
      <div className="absolute left-4 top-1/2 -translate-y-1/2 w-48 h-48 rounded-full bg-surface-card border border-default shadow-xl flex flex-col items-center justify-center text-center px-6">
        <span className="text-xs font-medium text-secondary">All-in-One</span>
        <span className="mt-1 font-display font-semibold text-2xl text-primary leading-tight">
          ERP
          <br />
          Solution
        </span>
      </div>

      {INDUSTRIES.map(({ icon, label, description, dot, top }) => (
        <div key={label} className="absolute right-0 w-72" style={{ top }}>
          <div className="flex items-center">
            <span className={`h-2 w-2 rounded-full ${dot} shrink-0`} />
            <span className="h-px flex-1 bg-border max-w-10" />
          </div>
          <div className="mt-2 rounded-xl border border-default bg-surface-card shadow-md p-4 flex gap-3">
            <ModuleGlyph icon={icon} size="md" />
            <div>
              <p className="font-semibold text-sm text-primary">{label}</p>
              <p className="mt-0.5 text-xs text-secondary">{description}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
