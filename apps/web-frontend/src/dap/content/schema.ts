import { z } from 'zod';
import { PERMISSIONS } from '../../constants/permissions.js';

// Validates against the *real*, current permission constants — a typo'd or retired
// permission in tour content fails schema validation immediately (see registry.test.ts),
// not silently at runtime. See ERP-PLANNING/DAP-Planning/01_ARCHITECTURE.md ADR-2: the DAP
// gates on PERMISSIONS.*, never on role names.
const PERMISSION_VALUES = Object.values(PERMISSIONS) as [string, ...string[]];
const PermissionSchema = z.enum(PERMISSION_VALUES);

export const TOUR_TYPES = [
  'quick',
  'complete',
  'interactive',
  'advanced',
  'role-based',
  'whats-new',
  'feature-announcement',
  'troubleshooting',
  'business-workflow',
] as const;
export const TourTypeSchema = z.enum(TOUR_TYPES);
export type TourType = z.infer<typeof TourTypeSchema>;

export const RequiredActionSchema = z.object({
  type: z.enum(['click', 'route-reached', 'custom-event']),
  selector: z.string().min(1).optional(),
  eventName: z.string().min(1).optional(),
});
export type RequiredAction = z.infer<typeof RequiredActionSchema>;

export const TourStepSchema = z
  .object({
    id: z.string().min(1),
    route: z.string().min(1),
    target: z.string().min(1).optional(),
    title: z.string().min(1),
    body: z.string().min(1),
    placement: z.enum(['top', 'bottom', 'left', 'right', 'center']).default('center'),
    mode: z.enum(['informational', 'interactive']).default('informational'),
    requiredAction: RequiredActionSchema.optional(),
    requiredPermission: PermissionSchema.optional(),
    businessImpact: z.array(z.string().min(1)).optional(),
    // Optional relabeling of the businessImpact bullet box — defaults to 'Business impact' /
    // info styling in TourTooltipCard when unset, so all 88 existing tours render unchanged.
    // Lets deep-dive content reuse the same bullet-box UI for "Common mistakes" (warning) and
    // "Best practices" (success) instead of needing a second schema field per callout type.
    calloutTitle: z.string().min(1).optional(),
    // Not `.default(...)` — every *.tour.ts file authors the strict post-default TourStep
    // shape as a literal object (never parsed through this schema at authoring time), so a
    // default here would force all 88 existing tours to add this field explicitly. `.optional()`
    // + `?? 'info'` in TourTooltipCard achieves the same fallback without that migration.
    calloutVariant: z.enum(['info', 'warning', 'success']).optional(),
  })
  .refine((step) => step.mode !== 'interactive' || step.requiredAction !== undefined, {
    message: 'interactive steps must declare requiredAction',
    path: ['requiredAction'],
  })
  .refine((step) => step.placement !== 'center' || step.target === undefined, {
    message:
      "placement 'center' is only valid when target is absent — set a real placement once a target is added",
    path: ['placement'],
  });
export type TourStep = z.infer<typeof TourStepSchema>;

export const WhatsNewEntrySchema = z.object({
  fromVersion: z.number().int().min(1),
  changes: z.array(z.string().min(1)).min(1),
});

export const TourDefinitionSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/, 'id must be a kebab-case slug'),
    version: z.number().int().min(1),
    type: TourTypeSchema,
    title: z.string().min(1),
    description: z.string().min(1),
    module: z.string().min(1),
    estimatedMinutes: z.number().int().min(1).max(60),
    requiredPermissions: z.array(PermissionSchema).optional(),
    whatsNewSince: z.array(WhatsNewEntrySchema).optional(),
    steps: z.array(TourStepSchema).min(1),
  })
  .refine((tour) => new Set(tour.steps.map((s) => s.id)).size === tour.steps.length, {
    message: 'step ids must be unique within a tour',
    path: ['steps'],
  });
export type TourDefinition = z.infer<typeof TourDefinitionSchema>;

export function validateTourDefinition(input: unknown): TourDefinition {
  return TourDefinitionSchema.parse(input);
}
