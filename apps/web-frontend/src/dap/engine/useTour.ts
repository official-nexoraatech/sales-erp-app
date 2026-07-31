import { createContext, useContext } from 'react';
import type { TourDefinition, TourStep } from '../content/schema.js';

export interface TourContextValue {
  activeTour: TourDefinition | null;
  visibleSteps: TourStep[];
  activeStep: TourStep | null;
  stepIndex: number;
  startTour: (tourId: string, options?: { resumeAtStepId?: string }) => void;
  next: () => void;
  prev: () => void;
  skip: () => void;
  finish: () => void;
  isTourAvailable: (tour: TourDefinition) => boolean;
}

export const TourContext = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour must be used within a TourProvider');
  return ctx;
}
