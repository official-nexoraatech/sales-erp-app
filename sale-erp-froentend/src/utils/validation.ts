import { z } from 'zod';

export const MOBILE_REGEX = /^[6-9]\d{9}$/;
export const MOBILE_VALIDATION_MESSAGE = 'Enter a valid 10-digit mobile number.';
export const WHATSAPP_VALIDATION_MESSAGE = 'Enter a valid 10-digit WhatsApp number.';
export const PHONE_VALIDATION_MESSAGE = 'Enter a valid 10-digit phone number.';

export const isValidMobileNumber = (value: string) => MOBILE_REGEX.test(value.trim());

export const requiredMobileNumberSchema = (message: string = MOBILE_VALIDATION_MESSAGE) =>
  z.string().trim().regex(MOBILE_REGEX, message);

export const optionalMobileNumberSchema = (message: string = MOBILE_VALIDATION_MESSAGE) =>
  z.string().optional().or(z.literal('')).refine((value) => !value || isValidMobileNumber(value), { message });

export const getInvalidMobileNumbers = (commaSeparated: string): string[] =>
  commaSeparated
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => !isValidMobileNumber(value));
