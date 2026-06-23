import type { ApiErrorResponse } from '../api/apiResponse';

export type FieldValidationErrors = Record<string, string>;

export const getValidationErrors = (error: unknown): FieldValidationErrors => {
  if (!error || typeof error !== 'object') return {};
  const apiError = error as ApiErrorResponse;
  if (!apiError.errors || typeof apiError.errors !== 'object') return {};
  return Object.fromEntries(
    Object.entries(apiError.errors).filter(
      ([field, message]) => Boolean(field) && typeof message === 'string' && Boolean(message.trim())
    )
  );
};

export const hasValidationErrors = (error: unknown) =>
  Object.keys(getValidationErrors(error)).length > 0;

