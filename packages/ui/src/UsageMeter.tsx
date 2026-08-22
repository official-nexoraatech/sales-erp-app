interface Props {
  label: string;
  current: number;
  /** null = unlimited (renders "Unlimited" instead of a filled bar). */
  max: number | null;
}

/** Entitlement usage bar (e.g. "Users 3/5") — per PG-027 Session 3. No reusable progress-bar
 * component existed anywhere in this design system before this; every prior usage hand-rolled
 * its own inline styled div, so this is the first shared one, co-located with StatCard. */
export default function UsageMeter({ label, current, max }: Props) {
  const pct = max !== null && max > 0 ? Math.min((current / max) * 100, 100) : 0;
  const overCap = max !== null && current > max;

  return (
    <div className="bg-surface-card rounded-xl border border-default p-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-secondary uppercase tracking-wide">{label}</p>
        <p className={`text-xs font-medium ${overCap ? 'text-error' : 'text-secondary'}`}>
          {current}
          {max !== null ? ` / ${max}` : ' / Unlimited'}
        </p>
      </div>
      {max !== null ? (
        <div className="h-1.5 bg-surface-raised rounded-full overflow-hidden">
          <div
            className={`h-1.5 rounded-full transition-all duration-500 ${overCap ? 'bg-error' : 'bg-brand'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : (
        <p className="text-xs text-disabled">No cap on this plan</p>
      )}
    </div>
  );
}
