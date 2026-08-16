// Multi-vertical platform audit 2026-08-16, Phase 3 — moved to @erp/sdk as the single source
// of truth for Trial Balance/P&L/Balance Sheet/Cash Flow, shared with report-service's
// ReportEngine.ts (which used to duplicate this logic by hand). Re-exported here so every
// existing import in this service (routes, FinancialYearService, tests) keeps working unchanged.
export {
  ReportsEngine,
  type TrialBalanceLine,
  type TrialBalanceReport,
  type PLLine,
  type ProfitLossReport,
  type BalanceSheetSection,
  type BalanceSheetReport,
  type PLByCostCenterLine,
  type ProfitLossByCostCenterReport,
  type CashFlowReport,
} from '@erp/sdk';
