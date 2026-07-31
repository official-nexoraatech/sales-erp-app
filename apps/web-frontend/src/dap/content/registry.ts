import { validateTourDefinition, type TourDefinition } from './schema.js';

// Auto-discovers every `*.tour.ts` file under content/tours/** and validates it against the
// Zod schema at module-load time — adding a new tour means adding a file, never touching a
// central list (see ERP-PLANNING/DAP-Planning/01_ARCHITECTURE.md ADR-1: this is the fix for
// HELP_CONTENT's growing-object-literal anti-pattern). Each file must `export default` one
// TourDefinition.
const modules = import.meta.glob<{ default: unknown }>('./tours/**/*.tour.ts', { eager: true });

const tours: TourDefinition[] = Object.entries(modules).map(([path, mod]) => {
  try {
    return validateTourDefinition(mod.default);
  } catch (err) {
    throw new Error(
      `Invalid tour content in ${path}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
});

const byId = new Map(tours.map((t) => [t.id, t]));
if (byId.size !== tours.length) {
  throw new Error('Duplicate tour id found across content/tours/** — ids must be globally unique');
}

export function getAllTours(): TourDefinition[] {
  return tours;
}

export function getTourById(id: string): TourDefinition | undefined {
  return byId.get(id);
}

export function getToursForModule(module: string): TourDefinition[] {
  return tours.filter((t) => t.module === module);
}
