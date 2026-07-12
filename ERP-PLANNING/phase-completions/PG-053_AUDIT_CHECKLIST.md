# PG-053 — Mobile Responsiveness Audit Checklist

Page-by-page record of the audit performed across all 118 non-test pages under
`apps/web-frontend/src/pages/`. Six parallel workers each owned a disjoint set of files (no file
overlap), auditing at 375px (phone) and 820px (tablet) against the anti-patterns defined in the
gap-prompt (`ERP-PLANNING/production-gap-prompts/014-Web/49-mobile-responsiveness-audit.md`):
(a) toolbar/filter `flex` rows with no `flex-wrap`, (b) bare `grid-cols-N` with no responsive
prefix, (c) an outer container defeating an existing table scroll wrapper, (d) raw `<table>`
elements with no scroll wrapper at all (a related but distinct failure mode found repeatedly,
worse than (c) since there was no wrapper to defeat).

Priority-1 pages (dashboards, detail/view pages, approval-workflow pages) got the full fix pass.
Priority-2 (multi-line creation/edit forms) and Priority-3 (low-traffic admin/ops pages) were
audited but only fixed for severe, guaranteed page-level overflow — everything else deferred, per
the gap-prompt's explicit scope decision (see "Deferred" notes below).

Legend: **Fixed** = gap found and corrected · **Clean** = no gap found · **Deferred** = gap found,
intentionally left per Priority-2/3 scope rule.

## accounting/

| File                       | Priority | Result                   | Notes                                                                                                            |
| -------------------------- | -------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| AccountFormPage.tsx        | P2       | Clean                    | `ERPFormSection` handles its own grid                                                                            |
| BalanceSheetPage.tsx       | P1       | Fixed                    | flex-wrap on date-filter row + isBalanced banner                                                                 |
| BankReconciliationPage.tsx | P1       | Fixed                    | flex-wrap on finalize banner; `max-w-[92vw]` on floating toast                                                   |
| CashFlowPage.tsx           | P1       | Fixed                    | table wrapped in `overflow-x-auto` (was defeated by outer `overflow-hidden`)                                     |
| ChartOfAccountsPage.tsx    | P1       | Fixed                    | flex-wrap on header actions; table scroll wrapper                                                                |
| FinancialYearsPage.tsx     | P1       | Clean                    | ERPDataGrid + already-responsive grid                                                                            |
| FixedAssetDetailPage.tsx   | P1       | Fixed                    | flex-wrap on header actions                                                                                      |
| FixedAssetFormPage.tsx     | P2       | Clean                    | `ERPFormSection` handles its own grid                                                                            |
| FixedAssetsPage.tsx        | P1       | Fixed                    | flex-wrap on header actions; modal grid → responsive                                                             |
| JournalsPage.tsx           | P1       | Fixed                    | raw table had zero scroll wrapper — added                                                                        |
| LedgerPage.tsx             | P1       | Fixed                    | raw table had zero scroll wrapper — added                                                                        |
| OpeningBalancesPage.tsx    | P2       | Fixed (severe exception) | 5 wizard-step rows summed 450–550px fixed widths — guaranteed clip at 375px, escalated past normal P2 defer rule |
| ProfitLossPage.tsx         | P1       | Clean                    | already fully responsive                                                                                         |
| TDSPage.tsx                | P1       | Clean                    | already fully responsive                                                                                         |
| TrialBalancePage.tsx       | P1       | Fixed                    | flex-wrap on date-filter row + isBalanced banner                                                                 |

## gst/

| File                  | Priority | Result   | Notes                                                                              |
| --------------------- | -------- | -------- | ---------------------------------------------------------------------------------- |
| EInvoicePage.tsx      | P1       | Clean    | already fully responsive                                                           |
| GSTR9Page.tsx         | P1       | Clean    | already fully responsive                                                           |
| GstCompliancePage.tsx | P1       | Clean    | already fully responsive                                                           |
| GstConfigPage.tsx     | P2       | Deferred | 2 bare `grid-cols-3` calculator grids — most likely mobile pain point if revisited |
| GstRegisterPage.tsx   | P1       | Fixed    | flex-wrap on filter row                                                            |
| Gstr1Page.tsx         | P1       | Fixed    | flex-wrap on filter row                                                            |
| Gstr2aPage.tsx        | P1       | Clean    | already fully responsive                                                           |
| Gstr3bPage.tsx        | P1       | Fixed    | 2 tables wrapped in `overflow-x-auto`; set-off grid → responsive                   |

## admin/ (incl. distributed/)

| File                               | Priority                | Result | Notes                                                                            |
| ---------------------------------- | ----------------------- | ------ | -------------------------------------------------------------------------------- |
| AuditLogPage.tsx                   | P3                      | Fixed  | table scroll wrapper added                                                       |
| FeatureFlagsPage.tsx               | P3                      | Clean  | —                                                                                |
| SearchAnalyticsPage.tsx            | P3                      | Clean  | already responsive                                                               |
| SecurityAuditLogPage.tsx           | P3                      | Fixed  | table scroll wrapper added                                                       |
| TenantsPage.tsx                    | P3                      | Clean  | ERPDataGrid                                                                      |
| distributed/DLQPage.tsx            | P3 (explicit, ops-only) | Clean  | already responsive                                                               |
| distributed/EventStorePage.tsx     | P3                      | Fixed  | table scroll wrapper added; replay-form row deferred (borderline, not egregious) |
| distributed/PerformancePage.tsx    | P3                      | Fixed  | table scroll wrapper added                                                       |
| distributed/ProjectionsPage.tsx    | P3                      | Clean  | already responsive                                                               |
| distributed/SagaMonitorPage.tsx    | P3                      | Fixed  | table scroll wrapper added                                                       |
| distributed/SchemaRegistryPage.tsx | P3                      | Fixed  | table scroll wrapper added; modal grid deferred                                  |

## auth/ / settings/ / users/

| File                          | Priority         | Result         | Notes                                                 |
| ----------------------------- | ---------------- | -------------- | ----------------------------------------------------- |
| auth/LoginPage.tsx            | P1 (entry point) | Clean          | single-column form                                    |
| auth/ResetPasswordPage.tsx    | P1 (entry point) | Clean          | single-column form                                    |
| auth/SecuritySettingsPage.tsx | P1               | Fixed          | MFA backup-codes grid → responsive                    |
| settings/BranchesPage.tsx     | P2               | Clean/Deferred | filter div single-child, no risk; modal grid deferred |
| settings/OrganizationPage.tsx | P2               | Clean          | already fully responsive — reference example          |
| settings/SsoConfigPage.tsx    | P2               | Clean          | already responsive                                    |
| settings/WarehousesPage.tsx   | P2               | Clean/Deferred | same shape as BranchesPage                            |
| users/UserFormPage.tsx        | P2               | Clean          | `ERPFormSection` handles its own grid                 |
| users/UsersPage.tsx           | P1               | Clean          | no filter toolbar present                             |

## crm/

| File                 | Priority | Result | Notes                                           |
| -------------------- | -------- | ------ | ----------------------------------------------- |
| CampaignFormPage.tsx | P2       | Clean  | already responsive                              |
| CampaignsPage.tsx    | P1       | Fixed  | flex-wrap on campaign row                       |
| SeasonsPage.tsx      | P1       | Fixed  | flex-wrap on banner; 2 modal grids → responsive |
| SegmentsPage.tsx     | P1       | Fixed  | flex-wrap on 3 row types                        |

## customers/

| File                 | Priority | Result                       | Notes                                                                                                    |
| -------------------- | -------- | ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| CustomerFormPage.tsx | P2       | Clean                        | `ERPFormSection` handles its own grid                                                                    |
| CustomerViewPage.tsx | P1       | Fixed                        | flex-wrap on header/health-score rows; details grid → responsive                                         |
| CustomersPage.tsx    | P1       | Fixed (pre-existing finding) | `flex-wrap` added to filter toolbar — this was the confirmed first fix identified before this pass began |

## hr/

| File                     | Priority | Result        | Notes                                                                                           |
| ------------------------ | -------- | ------------- | ----------------------------------------------------------------------------------------------- |
| AlterationDetailPage.tsx | P1       | Fixed         | main layout grid → responsive                                                                   |
| AlterationFormPage.tsx   | P2       | Deferred      | 12-col line-item grid + 2-col totals grid, will be cramped at 375px, intentionally out of scope |
| AlterationsPage.tsx      | P1       | Fixed         | raw table scroll wrapper added                                                                  |
| AttendancePage.tsx       | P1       | Fixed         | grid + filter row + day-grid + table all fixed                                                  |
| ESIChallanPage.tsx       | P1       | Fixed         | flex-wrap + table scroll wrapper                                                                |
| EmployeeFormPage.tsx     | P2       | Clean         | `ERPFormSection` handles its own grid                                                           |
| EmployeeViewPage.tsx     | P1       | Fixed         | flex-wrap rows; main grid → responsive; table scroll wrapper                                    |
| EmployeesPage.tsx        | P1       | Fixed (minor) | flex-wrap on header actions                                                                     |
| Form16Page.tsx           | P1       | Fixed         | flex-wrap; 2 grids → responsive; table scroll wrapper                                           |
| HolidayCalendarPage.tsx  | P1       | Fixed         | flex-wrap; table scroll wrapper                                                                 |
| LeavesPage.tsx           | P1       | Fixed         | main grid + inner date grid → responsive                                                        |
| PFChallanPage.tsx        | P1       | Fixed         | flex-wrap; table scroll wrapper                                                                 |
| PayrollPage.tsx          | P1       | Fixed         | flex-wrap; table scroll wrapper; 3 modal grids → responsive                                     |
| PayslipViewPage.tsx      | P1       | Fixed         | flex-wrap; 3 grids → responsive                                                                 |

## inventory/

| File                               | Priority | Result   | Notes                                        |
| ---------------------------------- | -------- | -------- | -------------------------------------------- |
| FabricRollsPage.tsx                | P1       | Clean    | —                                            |
| PhysicalVerificationDetailPage.tsx | P1       | Fixed    | raw table wrapped in `overflow-x-auto`       |
| PhysicalVerificationPage.tsx       | P1       | Clean    | —                                            |
| StockAdjustmentFormPage.tsx        | P2       | Deferred | raw table, not egregious                     |
| StockAdjustmentsPage.tsx           | P1       | Clean    | —                                            |
| StockLevelsPage.tsx                | P1       | Fixed    | flex-wrap on toolbar                         |
| StockTransferDetailPage.tsx        | P1       | Clean    | minimal placeholder                          |
| StockTransferFormPage.tsx          | P2       | Deferred | raw table, not egregious                     |
| StockTransferReceivePage.tsx       | P1       | Fixed    | raw table wrapped in `overflow-x-auto`       |
| StockTransfersPage.tsx             | P1       | Fixed    | flex-wrap on toolbar                         |
| StockValuationPage.tsx             | P1       | Clean    | already compliant (`flex flex-wrap` toolbar) |

## items/

| File               | Priority | Result | Notes                                 |
| ------------------ | -------- | ------ | ------------------------------------- |
| BrandsPage.tsx     | P1       | Clean  | —                                     |
| CategoriesPage.tsx | P1       | Clean  | —                                     |
| ItemFormPage.tsx   | P2       | Clean  | `ERPFormSection` handles its own grid |
| ItemsPage.tsx      | P1       | Fixed  | flex-wrap on toolbar                  |
| PriceListsPage.tsx | P1       | Fixed  | 2 modal grids → responsive            |
| UnitsPage.tsx      | P1       | Fixed  | 1 modal grid → responsive             |

## production/

| File                           | Priority | Result   | Notes                                                  |
| ------------------------------ | -------- | -------- | ------------------------------------------------------ |
| BarcodeLabelsPage.tsx          | P3       | Deferred | bare `grid-cols-4` on generate form                    |
| ConsignmentSettlementsPage.tsx | P1       | Fixed    | form grid → responsive; raw table scroll wrapper       |
| ConsignmentStockPage.tsx       | P1       | Fixed    | form grid → responsive; raw table scroll wrapper       |
| JobWorkOrderCreatePage.tsx     | P2       | Deferred | 2 bare grids, action row not severe                    |
| JobWorkOrdersPage.tsx          | P1       | Fixed    | stat-tiles grid → responsive; raw table scroll wrapper |
| JobWorkQualityCheckPage.tsx    | P1       | Fixed    | 2 flex rows + 2 grids fixed                            |
| ReorderReportPage.tsx          | P1       | Fixed    | flex-wrap on toolbar; raw table scroll wrapper         |

## purchase/

| File                      | Priority | Result                   | Notes                                                             |
| ------------------------- | -------- | ------------------------ | ----------------------------------------------------------------- |
| ExpensesPage.tsx          | P1       | Clean                    | ERPDataGrid, single-select toolbar                                |
| GRNCreatePage.tsx         | P1       | Fixed                    | flex-wrap on PO-selector row                                      |
| GRNsPage.tsx              | P1       | Fixed                    | flex-wrap on toolbar                                              |
| PurchaseOrderFormPage.tsx | P2       | Fixed (severe exception) | order-lines table had no scroll wrapper — egregious overflow risk |
| PurchaseOrdersPage.tsx    | P1       | Fixed                    | flex-wrap on toolbar                                              |
| PurchaseReturnsPage.tsx   | P1       | Clean                    | ERPTabs + ERPDataGrid only                                        |
| SupplierPaymentsPage.tsx  | P1       | Clean                    | ERPDataGrid only                                                  |

## suppliers/

| File                 | Priority | Result | Notes                                 |
| -------------------- | -------- | ------ | ------------------------------------- |
| SupplierFormPage.tsx | P2       | Clean  | `ERPFormSection` handles its own grid |
| SuppliersPage.tsx    | P1       | Clean  | ERPDataGrid + single search input     |

## reports/

| File                       | Priority | Result   | Notes                                         |
| -------------------------- | -------- | -------- | --------------------------------------------- |
| ApAgingPage.tsx            | P1       | Clean    | already responsive                            |
| ArAgingPage.tsx            | P1       | Clean    | already responsive                            |
| HRAnalyticsPage.tsx        | P1       | Clean    | already responsive                            |
| InventoryAnalyticsPage.tsx | P1       | Fixed    | flex-wrap on threshold-input row              |
| ReportViewerPage.tsx       | P1       | Fixed    | flex-wrap on header; params grid → responsive |
| ReportsPage.tsx            | P1       | Clean    | already responsive                            |
| SalesAnalyticsPage.tsx     | P1       | Clean    | already responsive                            |
| SchedulesPage.tsx          | P3       | Deferred | recipients row no wrap — minor                |

## sales/

| File                          | Priority | Result                   | Notes                                                        |
| ----------------------------- | -------- | ------------------------ | ------------------------------------------------------------ |
| DeliveryChallanDetailPage.tsx | P1       | Fixed                    | flex-wrap + summary grid → responsive                        |
| DeliveryChallanFormPage.tsx   | P2       | Fixed (severe exception) | line-items table had no scroll wrapper                       |
| DeliveryChallansPage.tsx      | P1       | Clean                    | header + ERPDataGrid only                                    |
| InvoiceDetailPage.tsx         | P1       | Fixed                    | flex-wrap + summary grid → responsive + table scroll wrapper |
| InvoiceFormPage.tsx           | P2       | Fixed (severe exception) | line-items table had no scroll wrapper                       |
| InvoicesPage.tsx              | P1       | Fixed                    | filter bar → `flex-col sm:flex-row`                          |
| PaymentsPage.tsx              | P1       | Clean                    | —                                                            |
| QuotationDetailPage.tsx       | P1       | Fixed                    | flex-wrap + summary grid → responsive + table scroll wrapper |
| QuotationsPage.tsx            | P1       | Fixed                    | filter bar → `flex-col sm:flex-row`                          |
| SaleReturnsPage.tsx           | P1       | Clean                    | —                                                            |

## Top level

| File                      | Priority            | Result | Notes                                                                                               |
| ------------------------- | ------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| DashboardPage.tsx         | P1 (reference page) | Fixed  | one un-prefixed `grid-cols-2` row found despite being the original "positive reference" — corrected |
| NotFoundPage.tsx          | P1                  | Clean  | —                                                                                                   |
| AccountSuspendedPage.tsx  | P1                  | Clean  | —                                                                                                   |
| NoModulesAssignedPage.tsx | P1                  | Clean  | —                                                                                                   |

## Deferred items (Priority 2/3, intentionally out of scope this pass)

- `gst/GstConfigPage.tsx` — 2 bare `grid-cols-3` calculator grids.
- `hr/AlterationFormPage.tsx` — 12-col line-item grid, 2-col totals grid (will be cramped at 375px).
- `inventory/StockAdjustmentFormPage.tsx`, `inventory/StockTransferFormPage.tsx` — raw tables with no scroll wrapper, not assessed as egregious.
- `production/BarcodeLabelsPage.tsx`, `production/JobWorkOrderCreatePage.tsx` — bare grids on P2/P3 forms.
- `settings/BranchesPage.tsx`, `settings/WarehousesPage.tsx` — bare grids inside create/edit modals.
- `admin/distributed/EventStorePage.tsx`, `admin/distributed/SchemaRegistryPage.tsx` — minor flex/grid gaps on ops-only P3 pages.
- `reports/SchedulesPage.tsx` — recipients row no wrap (minor, P3).

These were left per the gap-prompt's explicit scope decision: full phone-optimized data-entry
parity is out of scope for a B2B back-office ERP. Revisit only if a specific page is reported as
actually broken in use.
