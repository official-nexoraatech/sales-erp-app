import { stateOptionName, useStates } from '../../hooks/useStates';

interface CountryStateSelectProps {
  stateId: number;
  onStateChange: (stateId: number) => void;
  className?: string;
  stateLabel?: string;
}

const defaultInputClass = [
  'h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none',
  'transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100',
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400',
  'dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100',
  'dark:focus:border-blue-400 dark:focus:ring-blue-900/30',
  'dark:disabled:bg-slate-800 dark:disabled:text-slate-500',
].join(' ');

export const CountryStateSelect = ({
  stateId,
  onStateChange,
  className = defaultInputClass,
  stateLabel = 'State of supply',
}: CountryStateSelectProps) => {
  const { states, isLoading, isError } = useStates();

  return (
    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
      {stateLabel}
      <select
        className={`${className} mt-1.5`}
        value={stateId}
        disabled={isLoading || isError}
        onChange={(event) => onStateChange(Number(event.target.value))}
      >
        <option value={0}>
          {isLoading ? 'Loading states...' : isError ? 'Failed to load states' : 'Select state'}
        </option>
        {states.map((state) => (
          <option key={state.id} value={state.id}>
            {stateOptionName(state)}
          </option>
        ))}
      </select>
    </label>
  );
};
