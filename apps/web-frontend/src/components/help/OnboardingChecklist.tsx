import { useState, useEffect } from 'react';
import { CheckCircle2, Circle, X, PartyPopper, ChevronDown, ChevronUp } from 'lucide-react';

interface ChecklistStep {
  id: string;
  label: string;
  description: string;
  path: string;
  cta: string;
}

const STEPS: ChecklistStep[] = [
  {
    id: 'org',
    label: 'Add organization details',
    description: 'Enter your company name, GSTIN, address, and upload your logo.',
    path: '/settings/organization',
    cta: 'Go to Organization',
  },
  {
    id: 'branches',
    label: 'Add your branches',
    description: 'Add your shop locations. Each branch has its own stock and reports.',
    path: '/settings/branches',
    cta: 'Add Branch',
  },
  {
    id: 'team',
    label: 'Create your team',
    description: 'Add your cashiers, accountants, and managers with the right roles.',
    path: '/users',
    cta: 'Add Users',
  },
  {
    id: 'customers',
    label: 'Add customers',
    description: 'Add your existing customers, or import them from Excel.',
    path: '/customers',
    cta: 'Add Customers',
  },
  {
    id: 'items',
    label: 'Add items',
    description: 'Add your cloth items with HSN codes and prices, or import from Excel.',
    path: '/items',
    cta: 'Add Items',
  },
  {
    id: 'balances',
    label: 'Enter opening balances',
    description: 'Enter your current bank balance and outstanding customer/supplier amounts.',
    path: '/accounting/opening-balances',
    cta: 'Opening Balances',
  },
  {
    id: 'first-invoice',
    label: 'Create your first invoice',
    description: 'Bill your first customer to confirm everything is working!',
    path: '/sales/invoices/new',
    cta: 'New Invoice',
  },
];

const STORAGE_KEY = 'erp_onboarding_completed';

function loadCompleted(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveCompleted(ids: Set<string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

interface OnboardingChecklistProps {
  onNavigate: (path: string) => void;
  onDismiss: () => void;
}

export function OnboardingChecklist({ onNavigate, onDismiss }: OnboardingChecklistProps) {
  const [completed, setCompleted] = useState<Set<string>>(loadCompleted);
  const [collapsed, setCollapsed] = useState(false);

  const completedCount = completed.size;
  const totalCount = STEPS.length;
  const progress = Math.round((completedCount / totalCount) * 100);
  const allDone = completedCount === totalCount;

  useEffect(() => {
    saveCompleted(completed);
  }, [completed]);

  function toggleStep(id: string) {
    setCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 bg-white dark:bg-neutral-900 rounded-xl shadow-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600">
        <div className="flex items-center gap-2">
          {allDone ? (
            <PartyPopper size={16} className="text-yellow-300" />
          ) : (
            <span className="text-xs font-bold text-white bg-white/20 rounded-full px-2 py-0.5">
              {completedCount}/{totalCount}
            </span>
          )}
          <span className="text-sm font-semibold text-white">
            {allDone ? 'Setup Complete! 🎉' : 'Get Started — Setup Checklist'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="text-blue-200 hover:text-white"
            aria-label="Toggle checklist"
          >
            {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          <button onClick={onDismiss} className="text-blue-200 hover:text-white ml-1" aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-neutral-100 dark:bg-neutral-800">
        <div
          className="h-1 bg-blue-500 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Steps */}
      {!collapsed && (
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800 max-h-96 overflow-y-auto">
          {STEPS.map((step) => {
            const done = completed.has(step.id);
            return (
              <div key={step.id} className="px-4 py-3 flex items-start gap-3">
                <button
                  onClick={() => toggleStep(step.id)}
                  className="mt-0.5 flex-shrink-0"
                  aria-label={done ? 'Mark incomplete' : 'Mark complete'}
                >
                  {done ? (
                    <CheckCircle2 size={18} className="text-green-500" />
                  ) : (
                    <Circle size={18} className="text-neutral-300 dark:text-neutral-600" />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${done ? 'line-through text-neutral-400' : 'text-neutral-800 dark:text-neutral-200'}`}>
                    {step.label}
                  </p>
                  {!done && (
                    <>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 leading-snug">
                        {step.description}
                      </p>
                      <button
                        onClick={() => {
                          onNavigate(step.path);
                        }}
                        className="mt-1 text-xs text-blue-600 dark:text-blue-400 font-medium hover:underline"
                      >
                        {step.cta} →
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* All done banner */}
      {allDone && !collapsed && (
        <div className="px-4 py-3 bg-green-50 dark:bg-green-950 text-center">
          <p className="text-sm text-green-700 dark:text-green-300 font-medium">
            Your ERP is fully set up! You can dismiss this checklist.
          </p>
          <button
            onClick={onDismiss}
            className="mt-2 text-xs text-green-600 dark:text-green-400 underline"
          >
            Dismiss forever
          </button>
        </div>
      )}
    </div>
  );
}

export default OnboardingChecklist;
