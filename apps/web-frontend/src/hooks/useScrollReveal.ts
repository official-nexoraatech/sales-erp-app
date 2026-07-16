import { useEffect, useRef, useState } from 'react';

/** Reveals an element once it scrolls into view (fires once, never re-hides on scroll-out).
 * Returns a ref to attach and a boolean to gate a CSS transition — the transition itself
 * should read the --duration-* tokens (e.g. `transition-all duration-slow`) so Reduced
 * Motion already zeroes it out for free, with no special-casing needed here. */
export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(
  options: IntersectionObserverInit = { threshold: 0.15 }
): { ref: React.RefObject<T | null>; isVisible: boolean } {
  const ref = useRef<T | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setIsVisible(true);
        observer.disconnect();
      }
    }, options);

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, isVisible };
}
