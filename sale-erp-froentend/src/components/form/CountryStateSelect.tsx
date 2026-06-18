import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { locationApi } from '../../api/endpoints';
import type { Country, State } from '../../api/endpoints';

interface CountryStateSelectProps {
  stateId: number;
  onStateChange: (stateId: number) => void;
  className?: string;
  countryLabel?: string;
  stateLabel?: string;
}

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

const optionName = (option: Country | State) => option.name || ('stateName' in option ? option.stateName : undefined) || ('countryName' in option ? option.countryName : undefined) || `#${option.id}`;

export const CountryStateSelect = ({
  stateId,
  onStateChange,
  className = inputClass,
  countryLabel = 'Country',
  stateLabel = 'State of supply',
}: CountryStateSelectProps) => {
  const [countryId, setCountryId] = useState(0);
  const countries = useQuery({ queryKey: ['countries'], queryFn: locationApi.getCountries });
  const states = useQuery({
    queryKey: ['states', countryId],
    queryFn: () => locationApi.getStates(countryId),
    enabled: countryId > 0,
  });

  return (
    <>
      <label className="block text-sm text-gray-600">{countryLabel}
        <select
          className={`${className} mt-1`}
          value={countryId}
          disabled={countries.isLoading}
          onChange={(event) => {
            setCountryId(Number(event.target.value));
            onStateChange(0);
          }}
        >
          <option value={0}>{countries.isLoading ? 'Loading countries...' : 'Select country'}</option>
          {(countries.data?.data || []).map((country) => <option key={country.id} value={country.id}>{optionName(country)}</option>)}
        </select>
      </label>
      <label className="block text-sm text-gray-600">{stateLabel}
        <select
          className={`${className} mt-1`}
          value={stateId}
          disabled={!countryId || states.isLoading}
          onChange={(event) => onStateChange(Number(event.target.value))}
        >
          <option value={0}>{!countryId ? 'Select country first' : states.isLoading ? 'Loading states...' : 'Select state'}</option>
          {(states.data?.data || []).map((state) => <option key={state.id} value={state.id}>{optionName(state)}</option>)}
        </select>
      </label>
    </>
  );
};
