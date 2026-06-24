import { useEffect, useRef } from 'react';

export type AppLanguage = 'en' | 'hi' | 'gu' | 'mr';

export const LANGUAGE_OPTIONS: Array<{ value: AppLanguage; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'gu', label: 'Gujarati' },
  { value: 'mr', label: 'Marathi' },
];

export const TRANSLATION_RESET_EVENT = 'billtop:translation-reset';

interface GoogleTranslateOptions {
  pageLanguage: string;
  includedLanguages: string;
  autoDisplay: boolean;
}

interface GoogleTranslateConstructor {
  new (options: GoogleTranslateOptions, elementId: string): unknown;
}

declare global {
  interface Window {
    google?: {
      translate?: {
        TranslateElement: GoogleTranslateConstructor;
      };
    };
    googleTranslateElementInit?: () => void;
    __googleTranslateInitialized?: boolean;
    __googleTranslateLoadPromise?: Promise<void>;
  }
}

const PAGE_LANGUAGE: AppLanguage = 'en';
const TRANSLATE_ELEMENT_ID = 'google_translate_element';
const TRANSLATE_SCRIPT_ID = 'google-translate-script';
const TRANSLATE_SCRIPT_SRC = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';

const ensureTranslateElement = () => {
  if (document.getElementById(TRANSLATE_ELEMENT_ID)) return;

  const element = document.createElement('div');
  element.id = TRANSLATE_ELEMENT_ID;
  element.setAttribute('aria-hidden', 'true');
  element.style.position = 'fixed';
  element.style.left = '-9999px';
  element.style.top = '-9999px';
  element.style.width = '1px';
  element.style.height = '1px';
  element.style.overflow = 'hidden';
  document.body.appendChild(element);
};

const initializeGoogleTranslate = () => {
  if (window.__googleTranslateInitialized) return;

  const TranslateElement = window.google?.translate?.TranslateElement;
  if (!TranslateElement) return;

  ensureTranslateElement();
  new TranslateElement(
    {
      pageLanguage: PAGE_LANGUAGE,
      includedLanguages: LANGUAGE_OPTIONS.map((language) => language.value).join(','),
      autoDisplay: false,
    },
    TRANSLATE_ELEMENT_ID,
  );
  window.__googleTranslateInitialized = true;
};

const loadGoogleTranslate = () => {
  if (window.__googleTranslateLoadPromise) return window.__googleTranslateLoadPromise;

  window.__googleTranslateLoadPromise = new Promise<void>((resolve) => {
    window.googleTranslateElementInit = () => {
      initializeGoogleTranslate();
      resolve();
    };

    if (window.google?.translate?.TranslateElement) {
      initializeGoogleTranslate();
      resolve();
      return;
    }

    const existingScript = document.getElementById(TRANSLATE_SCRIPT_ID);
    if (existingScript) {
      existingScript.addEventListener('load', () => {
        initializeGoogleTranslate();
        resolve();
      }, { once: true });
      existingScript.addEventListener('error', () => resolve(), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = TRANSLATE_SCRIPT_ID;
    script.src = TRANSLATE_SCRIPT_SRC;
    script.async = true;
    script.addEventListener('error', () => resolve(), { once: true });
    document.body.appendChild(script);
  });

  return window.__googleTranslateLoadPromise;
};

const cookieDomain = () => {
  const { hostname } = window.location;
  if (hostname === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return '';
  const parts = hostname.split('.');
  return parts.length > 1 ? `; domain=.${parts.slice(-2).join('.')}` : '';
};

const setTranslateCookie = (language: AppLanguage) => {
  const domain = cookieDomain();
  const expiry = language === PAGE_LANGUAGE ? 'Thu, 01 Jan 1970 00:00:00 GMT' : 'Fri, 31 Dec 9999 23:59:59 GMT';
  const maxAge = language === PAGE_LANGUAGE ? '; max-age=0' : '';
  const value = language === PAGE_LANGUAGE ? '' : `/${PAGE_LANGUAGE}/${language}`;

  document.cookie = `googtrans=${value}; expires=${expiry}${maxAge}; path=/`;
  if (domain) {
    document.cookie = `googtrans=${value}; expires=${expiry}${maxAge}; path=/${domain}`;
  }
};

const hasActiveTranslation = () => {
  const combo = document.querySelector<HTMLSelectElement>('.goog-te-combo');

  return (
    document.cookie.includes('googtrans=/') ||
    document.documentElement.className.includes('translated-') ||
    document.body.className.includes('translated-') ||
    Boolean(combo?.value)
  );
};

const dispatchLanguageChange = (language: AppLanguage) => {
  const combo = document.querySelector<HTMLSelectElement>('.goog-te-combo');
  if (!combo) return false;

  combo.value = language === PAGE_LANGUAGE ? '' : language;
  combo.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
};

const clearTranslationMarkers = () => {
  document.documentElement.classList.remove('translated-ltr', 'translated-rtl');
  document.body.classList.remove('translated-ltr', 'translated-rtl');
  document.body.style.top = '';
};

const resetToPageLanguage = async (shouldRepaint: boolean) => {
  const hasTranslation = hasActiveTranslation();

  setTranslateCookie(PAGE_LANGUAGE);

  if (window.__googleTranslateInitialized || document.querySelector('.goog-te-combo')) {
    dispatchLanguageChange(PAGE_LANGUAGE);
  } else if (hasTranslation) {
    await loadGoogleTranslate();
    dispatchLanguageChange(PAGE_LANGUAGE);
  }

  clearTranslationMarkers();

  if (shouldRepaint && hasTranslation) {
    window.dispatchEvent(new Event(TRANSLATION_RESET_EVENT));
  }
};

const applyTranslation = async (language: AppLanguage, shouldRepaintOnReset: boolean) => {
  if (language === PAGE_LANGUAGE) {
    await resetToPageLanguage(shouldRepaintOnReset);
    return;
  }

  setTranslateCookie(language);
  await loadGoogleTranslate();

  [0, 250, 750, 1500].forEach((delay) => {
    window.setTimeout(() => dispatchLanguageChange(language), delay);
  });
};

export const usePageTranslation = (language: AppLanguage) => {
  const previousLanguage = useRef<AppLanguage | null>(null);

  useEffect(() => {
    const isFirstRun = previousLanguage.current === null;
    const languageChanged = previousLanguage.current !== language;
    previousLanguage.current = language;

    if (!isFirstRun && !languageChanged) return;

    void applyTranslation(language, language === PAGE_LANGUAGE);
  }, [language]);
};
