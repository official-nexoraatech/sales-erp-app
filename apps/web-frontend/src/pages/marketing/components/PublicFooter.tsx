import { Link } from 'react-router-dom';
import { BookOpen, ExternalLink } from 'lucide-react';
import BrandMark from '../../../components/marketing/BrandMark.js';
import { MODULES } from './ProductModulesGrid.js';

const DOCS_SITE_URL = import.meta.env.VITE_DOCS_SITE_URL ?? 'http://localhost:5175';

const COMPANY_LINKS = [
  { label: 'Pricing', to: '/pricing' },
  { label: 'About', to: '/about' },
  { label: 'Contact', to: '/contact' },
];

const ACCOUNT_LINKS = [
  { label: 'Sign In', to: '/login' },
  { label: 'Start Free Trial', to: '/signup' },
];

export default function PublicFooter() {
  return (
    <footer className="border-t border-default bg-marketing-ink text-marketing-ink">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          <div className="col-span-2">
            <BrandMark inverse />
            <p className="mt-4 text-sm text-marketing-ink-muted max-w-xs">
              One connected platform for sales, inventory, accounting, HR and more — built for
              growing, multi-branch businesses.
            </p>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-marketing-ink-muted mb-3">
              Product
            </h3>
            <ul className="space-y-2.5">
              {MODULES.slice(0, 5).map((m) => (
                <li key={m.id}>
                  <Link
                    to={`/features#${m.id}`}
                    className="text-sm text-marketing-ink-muted hover:text-white"
                  >
                    {m.title}
                  </Link>
                </li>
              ))}
              <li>
                <Link to="/features" className="text-sm text-accent hover:text-white">
                  View all modules →
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-marketing-ink-muted mb-3">
              Company
            </h3>
            <ul className="space-y-2.5">
              {COMPANY_LINKS.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className="text-sm text-marketing-ink-muted hover:text-white">
                    {link.label}
                  </Link>
                </li>
              ))}
              <li>
                <a
                  href={DOCS_SITE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-marketing-ink-muted hover:text-white"
                >
                  <BookOpen className="h-3.5 w-3.5" /> Documentation{' '}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-marketing-ink-muted mb-3">
              Account
            </h3>
            <ul className="space-y-2.5">
              {ACCOUNT_LINKS.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className="text-sm text-marketing-ink-muted hover:text-white">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-14 pt-6 border-t border-marketing-ink flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-marketing-ink-muted">
            &copy; {new Date().getFullYear()} NEXORAA Technologies. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
