import { stateOptionName, useStates } from '../../hooks/useStates';

interface CountryStateSelectProps {
  stateId: number;
  onStateChange: (stateId: number) => void;
  className?: string;
  stateLabel?: string;
}

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

export const CountryStateSelect = ({
  stateId,
  onStateChange,
  className = inputClass,
  stateLabel = 'State of supply',
}: CountryStateSelectProps) => {
  const { states, isLoading, isError } = useStates();

  return (
    <label className="block text-sm text-gray-600">{stateLabel}
      <select
        className={`${className} mt-1`}
        value={stateId}
        disabled={isLoading || isError}
        onChange={(event) => onStateChange(Number(event.target.value))}
      >
        <option value={0}>{isLoading ? 'Loading states...' : isError ? 'Failed to load states' : 'Select state'}</option>
        {states.map((state) => <option key={state.id} value={state.id}>{stateOptionName(state)}</option>)}
      </select>
    </label>
  );
};
