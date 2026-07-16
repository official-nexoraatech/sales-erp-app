import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Menu, X, ChevronDown, ExternalLink, BookOpen } from 'lucide-react';
import Button from '../../../components/ui/Button.js';
import ModuleGlyph from '../../../components/marketing/ModuleGlyph.js';
import BrandMark from '../../../components/marketing/BrandMark.js';
import PublicThemeToggle from '../../../components/marketing/PublicThemeToggle.js';
import { MODULES } from './ProductModulesGrid.js';

// Same env-var convention HelpPanel.tsx already established for linking to the real,
// separately-deployed docs-site — not a fabricated "Resources" link.
const DOCS_SITE_URL = import.meta.env.VITE_DOCS_SITE_URL ?? 'http://localhost:5175';

const NAV_LINKS = [
  { label: 'Pricing', to: '/pricing' },
  { label: 'About', to: '/about' },
  { label: 'Contact', to: '/contact' },
];

function ProductMegaMenu() {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function openNow() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }
  function closeSoon() {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }

  return (
    <div
      className="relative"
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
      onFocus={openNow}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="flex items-center gap-1 text-sm font-medium text-secondary hover:text-primary transition-colors"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
      >
        Product{' '}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full pt-3 w-[42rem] z-dropdown">
          <div className="rounded-2xl border border-default bg-surface-card shadow-token-lg p-6 grid grid-cols-2 gap-1">
            {MODULES.map(({ id, icon, title, description }) => (
              <Link
                key={id}
                to={`/features#${id}`}
                onClick={() => setOpen(false)}
                className="flex items-start gap-3 rounded-xl p-3 hover:bg-surface-subtle transition-colors"
              >
                <ModuleGlyph icon={icon} size="sm" />
                <span>
                  <span className="block text-sm font-semibold text-primary">{title}</span>
                  <span className="block text-xs text-secondary mt-0.5">{description}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PublicNav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-header bg-surface-card/90 backdrop-blur supports-[backdrop-filter]:bg-surface-card/75 transition-shadow duration-normal ${
        scrolled ? 'border-b border-default shadow-token-sm' : 'border-b border-transparent'
      }`}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <Link to="/" aria-label="NEXORAA home">
            <BrandMark />
          </Link>

          <nav className="hidden md:flex items-center gap-8" aria-label="Primary">
            <ProductMegaMenu />
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="text-sm font-medium text-secondary hover:text-primary transition-colors"
              >
                {link.label}
              </Link>
            ))}
            <a
              href={DOCS_SITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm font-medium text-secondary hover:text-primary transition-colors"
            >
              <BookOpen className="h-3.5 w-3.5" /> Docs <ExternalLink className="h-3 w-3" />
            </a>
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <PublicThemeToggle />
            <Button variant="ghost" size="sm" onClick={() => navigate('/login')}>
              Sign In
            </Button>
            <Button size="sm" onClick={() => navigate('/signup')}>
              Start Free Trial
            </Button>
          </div>

          <button
            type="button"
            className="md:hidden p-2 -mr-2 text-secondary hover:text-primary"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav className="md:hidden border-t border-default px-4 py-4 space-y-1" aria-label="Mobile">
          <Link
            to="/features"
            onClick={() => setMobileOpen(false)}
            className="block rounded-md px-3 py-2.5 text-sm font-medium text-primary hover:bg-surface-subtle"
          >
            Product
          </Link>
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setMobileOpen(false)}
              className="block rounded-md px-3 py-2.5 text-sm font-medium text-primary hover:bg-surface-subtle"
            >
              {link.label}
            </Link>
          ))}
          <a
            href={DOCS_SITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md px-3 py-2.5 text-sm font-medium text-primary hover:bg-surface-subtle"
          >
            <BookOpen className="h-4 w-4" /> Documentation
          </a>
          <div className="flex items-center justify-between rounded-md px-3 py-2.5">
            <span className="text-sm font-medium text-primary">Appearance</span>
            <PublicThemeToggle />
          </div>
          <div className="pt-3 flex flex-col gap-2">
            <Button
              variant="secondary"
              className="w-full justify-center"
              onClick={() => navigate('/login')}
            >
              Sign In
            </Button>
            <Button className="w-full justify-center" onClick={() => navigate('/signup')}>
              Start Free Trial
            </Button>
          </div>
        </nav>
      )}
    </header>
  );
}
