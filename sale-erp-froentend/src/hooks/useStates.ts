import { useQuery } from '@tanstack/react-query';
import { locationApi } from '../api/endpoints';
import type { State } from '../api/endpoints';

const STATES_CACHE_TIME = 24 * 60 * 60 * 1000;

export const stateOptionName = (state: State) =>
  state.name || state.stateName || `#${state.id}`;

export const useStates = () => {
  const query = useQuery({
    queryKey: ['states'],
    queryFn: locationApi.getStates,
    staleTime: Infinity,
    gcTime: STATES_CACHE_TIME,
  });

  return {
    ...query,
    states: query.data?.data || [],
  };
};
