// Capability registry — see ERP-PLANNING/multi-industry-platform/21-capability-resolution-architecture.md
// and ERP-PLANNING/implementation/phase-01-capability-foundation/02-capability-model.md /
// 03-capability-registry.md.
//
// One registry entry, one PR — never registered speculatively ahead of the code/flag it
// describes.

export interface CapabilityDefinition {
  key: string;
  name: string;
  domain: string;
  owningService: string;
  flagKey: string;
  requires: string[];
  status: 'GA' | 'BETA' | 'DEPRECATED';
  applicableBusinessTypes: string[];
  permissions: string[];
}

export const CAPABILITY_REGISTRY: Record<string, CapabilityDefinition> = {
  HR_PAYROLL: {
    key: 'HR_PAYROLL',
    name: 'HR Payroll',
    domain: 'HR',
    owningService: 'hr-service',
    flagKey: 'hr.payroll.enabled',
    requires: [],
    status: 'GA',
    applicableBusinessTypes: ['CLOTH_RETAIL', 'GROCERY', 'DISTRIBUTION'],
    permissions: ['PAYROLL_VIEW', 'PAYROLL_PROCESS'],
  },
  POS: {
    key: 'POS',
    name: 'Point of Sale',
    domain: 'Sales',
    owningService: 'sales-service',
    flagKey: 'pos.enabled',
    requires: [],
    status: 'GA',
    applicableBusinessTypes: ['CLOTH_RETAIL', 'GROCERY'],
    permissions: ['POS_ACCESS', 'POS_MANAGE'],
  },
  INVENTORY_BATCH: {
    key: 'INVENTORY_BATCH',
    name: 'Batch & Expiry Tracking',
    domain: 'Inventory',
    owningService: 'inventory-service',
    flagKey: 'inventory.batch.enabled',
    requires: [],
    status: 'BETA',
    applicableBusinessTypes: ['GROCERY', 'DISTRIBUTION', 'MANUFACTURING'],
    permissions: ['BATCH_VIEW', 'BATCH_CONFIGURE'],
  },
  // Manufacturing vertical, Phase A — the first capability registered that is genuinely new
  // (not a re-flag of an existing GA capability), per the Phase 12 expansion-framework review's
  // own recommendation that Manufacturing be the vertical to test this.
  BOM: {
    key: 'BOM',
    name: 'Bill of Materials',
    domain: 'Production',
    owningService: 'production-service',
    flagKey: 'manufacturing.bom.enabled',
    requires: [],
    status: 'BETA',
    applicableBusinessTypes: ['MANUFACTURING'],
    permissions: ['BOM_VIEW', 'BOM_CREATE', 'BOM_DELETE'],
  },
  // Manufacturing vertical, Phase B — Work Centers. Foundation for the later-deferred Routing/MRP
  // slices; standalone useful on its own (a Job Work Order can optionally reference one for
  // capacity tracking/reporting).
  WORK_CENTERS: {
    key: 'WORK_CENTERS',
    name: 'Work Centers',
    domain: 'Production',
    owningService: 'production-service',
    flagKey: 'manufacturing.work_centers.enabled',
    requires: [],
    status: 'BETA',
    applicableBusinessTypes: ['MANUFACTURING'],
    permissions: ['WORK_CENTER_VIEW', 'WORK_CENTER_CREATE', 'WORK_CENTER_UPDATE'],
  },
  // Manufacturing vertical — standalone Production Order: in-house manufacturing, distinct from
  // Job Work Order (always outsourced to a supplier/job worker). Doesn't require WORK_CENTERS or
  // BOM — both are optional inputs (workCenterId/bomId), same as Job Work Order's own pattern.
  PRODUCTION_ORDER: {
    key: 'PRODUCTION_ORDER',
    name: 'Production Order',
    domain: 'Production',
    owningService: 'production-service',
    flagKey: 'manufacturing.production_order.enabled',
    requires: [],
    status: 'BETA',
    applicableBusinessTypes: ['MANUFACTURING'],
    permissions: [
      'PRODUCTION_ORDER_VIEW',
      'PRODUCTION_ORDER_CREATE',
      'PRODUCTION_ORDER_UPDATE',
      'PRODUCTION_ORDER_ISSUE_MATERIALS',
      'PRODUCTION_ORDER_QUALITY_CHECK',
      'PRODUCTION_ORDER_COMPLETE',
      'PRODUCTION_ORDER_CANCEL',
    ],
  },
  // Manufacturing vertical — Routing: multi-step operation sequences (Cut -> Stitch -> Finish),
  // each step optionally assigned to a Work Center. Independent of BOM (routing describes HOW,
  // BOM describes WHAT) — a Production Order can reference either, both, or neither.
  ROUTING: {
    key: 'ROUTING',
    name: 'Routing',
    domain: 'Production',
    owningService: 'production-service',
    flagKey: 'manufacturing.routing.enabled',
    requires: [],
    status: 'BETA',
    applicableBusinessTypes: ['MANUFACTURING'],
    permissions: ['ROUTING_VIEW', 'ROUTING_CREATE', 'ROUTING_DELETE'],
  },
  // Manufacturing vertical — MRP: nets planned demand for a finished item through its (possibly
  // multi-level) BOM against on-hand stock, open Purchase Orders, and open Production Orders,
  // producing two shortage lists — sub-assemblies to produce, raw materials to buy. Ties BOM,
  // Production Order, and stock/PO state together, so it requires all three.
  MRP: {
    key: 'MRP',
    name: 'Material Requirements Planning',
    domain: 'Production',
    owningService: 'production-service',
    flagKey: 'manufacturing.mrp.enabled',
    requires: ['BOM', 'PRODUCTION_ORDER'],
    status: 'BETA',
    applicableBusinessTypes: ['MANUFACTURING'],
    permissions: ['MRP_VIEW', 'MRP_CREATE_REQUISITION'],
  },
};

export function getCapabilityDefinition(key: string): CapabilityDefinition | undefined {
  return CAPABILITY_REGISTRY[key];
}
