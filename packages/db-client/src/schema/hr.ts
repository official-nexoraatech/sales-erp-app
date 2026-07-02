import {
  bigserial,
  boolean,
  date,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  time,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// ─── Departments ───────────────────────────────────────────────────────────────
export const departments = pgTable(
  'departments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    code: varchar('code', { length: 30 }).notNull(),
    description: text('description'),
    managerId: integer('manager_id'),
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: integer('deleted_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
  },
  (t) => [
    unique('departments_tenant_code').on(t.tenantId, t.code),
    index('idx_departments_tenant').on(t.tenantId, t.isActive),
  ]
);

// ─── Designations ──────────────────────────────────────────────────────────────
export const designations = pgTable(
  'designations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    code: varchar('code', { length: 30 }).notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: integer('deleted_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
  },
  (t) => [
    unique('designations_tenant_code').on(t.tenantId, t.code),
    index('idx_designations_tenant').on(t.tenantId, t.isActive),
  ]
);

// ─── Employees ────────────────────────────────────────────────────────────────
// Sensitive fields: panEncrypted, bankAccountNoEncrypted
// Hash companion columns for exact-match lookup (HMAC-SHA256)
// Aadhaar: last 4 digits only — NEVER store full 12
export const employees = pgTable(
  'employees',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    employeeCode: varchar('employee_code', { length: 30 }).notNull(),
    firstName: varchar('first_name', { length: 100 }).notNull(),
    lastName: varchar('last_name', { length: 100 }).notNull(),
    displayName: varchar('display_name', { length: 200 }).notNull(),
    phone: varchar('phone', { length: 20 }).notNull(),
    email: varchar('email', { length: 200 }),
    gender: varchar('gender', { length: 10 }).$type<'MALE' | 'FEMALE' | 'OTHER'>(),
    dateOfBirth: date('date_of_birth'),
    aadhaarLast4: varchar('aadhaar_last4', { length: 4 }),
    panEncrypted: varchar('pan_encrypted', { length: 500 }),
    panHash: varchar('pan_hash', { length: 64 }),
    bankAccountNoEncrypted: varchar('bank_account_no_encrypted', { length: 500 }),
    bankAccountNoHash: varchar('bank_account_no_hash', { length: 64 }),
    bankName: varchar('bank_name', { length: 200 }),
    bankIfsc: varchar('bank_ifsc', { length: 20 }),
    employmentType: varchar('employment_type', { length: 30 })
      .notNull()
      .default('FULL_TIME')
      .$type<'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'DAILY_WAGE' | 'TRAINEE' | 'TAILOR'>(),
    departmentId: integer('department_id'),
    designationId: integer('designation_id'),
    branchId: integer('branch_id'),
    managerId: integer('manager_id'),
    shiftId: integer('shift_id'),
    joiningDate: date('joining_date').notNull(),
    exitDate: date('exit_date'),
    exitReason: text('exit_reason'),
    photoUrl: varchar('photo_url', { length: 500 }),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('ACTIVE')
      .$type<'ACTIVE' | 'INACTIVE' | 'EXITED'>(),
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: integer('deleted_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('employees_tenant_code').on(t.tenantId, t.employeeCode),
    index('idx_employees_tenant_status').on(t.tenantId, t.status),
    index('idx_employees_department').on(t.departmentId, t.tenantId),
    index('idx_employees_pan_hash').on(t.panHash, t.tenantId),
    index('idx_employees_phone').on(t.phone, t.tenantId),
  ]
);

// ─── Shifts ───────────────────────────────────────────────────────────────────
export const shifts = pgTable(
  'shifts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    gracePeriodMinutes: integer('grace_period_minutes').notNull().default(15),
    halfDayHours: decimal('half_day_hours', { precision: 4, scale: 2 }).notNull().default('4'),
    standardHours: decimal('standard_hours', { precision: 4, scale: 2 }).notNull().default('8'),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
  },
  (t) => [
    unique('shifts_tenant_name').on(t.tenantId, t.name),
    index('idx_shifts_tenant').on(t.tenantId, t.isActive),
  ]
);

// ─── Attendance ───────────────────────────────────────────────────────────────
export const attendance = pgTable(
  'attendance',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    employeeId: integer('employee_id').notNull(),
    attendanceDate: date('attendance_date').notNull(),
    checkInTime: timestamp('check_in_time', { withTimezone: true }),
    checkOutTime: timestamp('check_out_time', { withTimezone: true }),
    source: varchar('source', { length: 20 })
      .notNull()
      .default('MANUAL')
      .$type<'MANUAL' | 'BIOMETRIC' | 'MOBILE_APP'>(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('PRESENT')
      .$type<'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'LATE' | 'LEAVE' | 'HOLIDAY' | 'WEEKLY_OFF'>(),
    workHours: decimal('work_hours', { precision: 4, scale: 2 }).notNull().default('0'),
    overtimeHours: decimal('overtime_hours', { precision: 4, scale: 2 }).notNull().default('0'),
    shiftId: integer('shift_id'),
    isLate: boolean('is_late').notNull().default(false),
    correctionReason: text('correction_reason'),
    correctedBy: integer('corrected_by'),
    correctedAt: timestamp('corrected_at', { withTimezone: true }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('attendance_employee_date').on(t.tenantId, t.employeeId, t.attendanceDate),
    index('idx_attendance_employee_date').on(t.employeeId, t.attendanceDate, t.tenantId),
    index('idx_attendance_tenant_date').on(t.tenantId, t.attendanceDate),
  ]
);

// ─── Leave Types ──────────────────────────────────────────────────────────────
export const leaveTypes = pgTable(
  'leave_types',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    code: varchar('code', { length: 20 }).notNull(),
    daysPerYear: decimal('days_per_year', { precision: 6, scale: 2 }).notNull().default('0'),
    canCarryForward: boolean('can_carry_forward').notNull().default(false),
    maxCarryForwardDays: decimal('max_carry_forward_days', { precision: 6, scale: 2 }).notNull().default('0'),
    isGenderSpecific: boolean('is_gender_specific').notNull().default(false),
    genderAllowed: varchar('gender_allowed', { length: 10 }).$type<'MALE' | 'FEMALE'>(),
    minServiceMonths: integer('min_service_months').notNull().default(0),
    requiresDocument: boolean('requires_document').notNull().default(false),
    documentRequiredAfterDays: integer('document_required_after_days').notNull().default(0),
    expiryDays: integer('expiry_days').notNull().default(0),
    isPaidLeave: boolean('is_paid_leave').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
  },
  (t) => [
    unique('leave_types_tenant_code').on(t.tenantId, t.code),
    index('idx_leave_types_tenant').on(t.tenantId, t.isActive),
  ]
);

// ─── Employee Leave Balance ────────────────────────────────────────────────────
export const employeeLeaveBalance = pgTable(
  'employee_leave_balance',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    employeeId: integer('employee_id').notNull(),
    leaveTypeId: integer('leave_type_id').notNull(),
    year: integer('year').notNull(),
    totalDays: decimal('total_days', { precision: 6, scale: 2 }).notNull().default('0'),
    usedDays: decimal('used_days', { precision: 6, scale: 2 }).notNull().default('0'),
    pendingDays: decimal('pending_days', { precision: 6, scale: 2 }).notNull().default('0'),
    carriedForwardDays: decimal('carried_forward_days', { precision: 6, scale: 2 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('leave_balance_unique').on(t.tenantId, t.employeeId, t.leaveTypeId, t.year),
    index('idx_leave_balance_employee').on(t.employeeId, t.tenantId, t.year),
  ]
);

// ─── Leave Applications ───────────────────────────────────────────────────────
export const leaveApplications = pgTable(
  'leave_applications',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    employeeId: integer('employee_id').notNull(),
    leaveTypeId: integer('leave_type_id').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    days: decimal('days', { precision: 4, scale: 1 }).notNull(),
    reason: text('reason'),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('PENDING')
      .$type<'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'>(),
    approvedBy: integer('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectedBy: integer('rejected_by'),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    cancelledBy: integer('cancelled_by'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    documentUrl: varchar('document_url', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
  },
  (t) => [
    index('idx_leave_app_employee').on(t.employeeId, t.tenantId, t.status),
    index('idx_leave_app_tenant_status').on(t.tenantId, t.status, t.createdAt),
    index('idx_leave_app_dates').on(t.startDate, t.endDate, t.tenantId),
  ]
);

// ─── Salary Structures ────────────────────────────────────────────────────────
export const salaryStructures = pgTable(
  'salary_structures',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    code: varchar('code', { length: 30 }).notNull(),
    basicPercent: decimal('basic_percent', { precision: 5, scale: 2 }).notNull().default('50'),
    hraPercent: decimal('hra_percent', { precision: 5, scale: 2 }).notNull().default('20'),
    daPercent: decimal('da_percent', { precision: 5, scale: 2 }).notNull().default('10'),
    allowances: jsonb('allowances').$type<Array<{ name: string; amount: number; percent?: number }>>().default([]),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
  },
  (t) => [
    unique('salary_structures_tenant_code').on(t.tenantId, t.code),
    index('idx_salary_structures_tenant').on(t.tenantId, t.isActive),
  ]
);

// ─── Employee Salaries (encrypted gross/net figures) ──────────────────────────
// salary details encrypted — NEVER cache in Redis, NEVER log, NEVER in list API
export const employeeSalaries = pgTable(
  'employee_salaries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    employeeId: integer('employee_id').notNull(),
    salaryStructureId: integer('salary_structure_id'),
    ctcEncrypted: varchar('ctc_encrypted', { length: 500 }).notNull(),
    basicEncrypted: varchar('basic_encrypted', { length: 500 }).notNull(),
    hraEncrypted: varchar('hra_encrypted', { length: 500 }),
    daEncrypted: varchar('da_encrypted', { length: 500 }),
    allowancesEncrypted: varchar('allowances_encrypted', { length: 2000 }),
    grossEncrypted: varchar('gross_encrypted', { length: 500 }).notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
  },
  (t) => [
    index('idx_emp_salaries_employee').on(t.employeeId, t.tenantId, t.isActive),
  ]
);

// ─── Payroll Runs ─────────────────────────────────────────────────────────────
export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    periodMonth: integer('period_month').notNull(),
    periodYear: integer('period_year').notNull(),
    workingDays: integer('working_days').notNull().default(26),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('DRAFT')
      .$type<'DRAFT' | 'CALCULATING' | 'CALCULATED' | 'APPROVED' | 'DISBURSED'>(),
    totalEmployees: integer('total_employees').notNull().default(0),
    totalGross: decimal('total_gross', { precision: 15, scale: 2 }).notNull().default('0'),
    totalDeductions: decimal('total_deductions', { precision: 15, scale: 2 }).notNull().default('0'),
    totalNet: decimal('total_net', { precision: 15, scale: 2 }).notNull().default('0'),
    salaryJournalId: varchar('salary_journal_id', { length: 26 }),
    disbursalJournalId: varchar('disbursal_journal_id', { length: 26 }),
    approvedBy: integer('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    disbursedAt: timestamp('disbursed_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('payroll_runs_tenant_period').on(t.tenantId, t.periodMonth, t.periodYear),
    index('idx_payroll_runs_tenant').on(t.tenantId, t.status, t.periodYear),
  ]
);

// ─── Payroll Slips (individual salary slips) ──────────────────────────────────
// Net salary details stored — salary NEVER cached in Redis or logged
export const payrollSlips = pgTable(
  'payroll_slips',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    payrollRunId: integer('payroll_run_id').notNull(),
    employeeId: integer('employee_id').notNull(),
    presentDays: decimal('present_days', { precision: 4, scale: 1 }).notNull().default('0'),
    paidLeaveDays: decimal('paid_leave_days', { precision: 4, scale: 1 }).notNull().default('0'),
    lopDays: decimal('lop_days', { precision: 4, scale: 1 }).notNull().default('0'),
    workingDays: integer('working_days').notNull().default(26),
    basicSalary: decimal('basic_salary', { precision: 15, scale: 2 }).notNull().default('0'),
    hraAmount: decimal('hra_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    daAmount: decimal('da_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    otherAllowances: decimal('other_allowances', { precision: 15, scale: 2 }).notNull().default('0'),
    pieceRateAmount: decimal('piece_rate_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    grossSalary: text('gross_salary').notNull().default(''),
    pfEmployee: decimal('pf_employee', { precision: 15, scale: 2 }).notNull().default('0'),
    pfEmployer: decimal('pf_employer', { precision: 15, scale: 2 }).notNull().default('0'),
    esiEmployee: decimal('esi_employee', { precision: 15, scale: 2 }).notNull().default('0'),
    esiEmployer: decimal('esi_employer', { precision: 15, scale: 2 }).notNull().default('0'),
    professionalTax: decimal('professional_tax', { precision: 15, scale: 2 }).notNull().default('0'),
    loanDeduction: decimal('loan_deduction', { precision: 15, scale: 2 }).notNull().default('0'),
    tdsDeduction: decimal('tds_deduction', { precision: 15, scale: 2 }).notNull().default('0'),
    totalDeductions: decimal('total_deductions', { precision: 15, scale: 2 }).notNull().default('0'),
    netSalary: text('net_salary').notNull().default(''),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('DRAFT')
      .$type<'DRAFT' | 'APPROVED' | 'PAID'>(),
    slipSentAt: timestamp('slip_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('payroll_slips_run_employee').on(t.tenantId, t.payrollRunId, t.employeeId),
    index('idx_payroll_slips_run').on(t.payrollRunId, t.tenantId),
    index('idx_payroll_slips_employee').on(t.employeeId, t.tenantId),
  ]
);

// ─── Alteration Orders ────────────────────────────────────────────────────────
export const alterationOrders = pgTable(
  'alteration_orders',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    orderNumber: varchar('order_number', { length: 30 }).notNull(),
    branchId: integer('branch_id'),
    customerId: integer('customer_id'),
    customerName: varchar('customer_name', { length: 200 }).notNull(),
    customerPhone: varchar('customer_phone', { length: 20 }).notNull(),
    receivedDate: date('received_date').notNull(),
    promisedDate: date('promised_date').notNull(),
    items: jsonb('items')
      .$type<Array<{ description: string; quantity: number; rate: number; amount: number }>>()
      .notNull()
      .default([]),
    totalAmount: decimal('total_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    advanceAmount: decimal('advance_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    balanceDue: decimal('balance_due', { precision: 15, scale: 2 }).notNull().default('0'),
    assignedToId: integer('assigned_to_id'),
    status: varchar('status', { length: 30 })
      .notNull()
      .default('RECEIVED')
      .$type<'RECEIVED' | 'ASSIGNED' | 'IN_PROGRESS' | 'QUALITY_CHECK' | 'READY' | 'DELIVERED' | 'CANCELLED'>(),
    notes: text('notes'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    deliveryPaymentReceived: decimal('delivery_payment_received', { precision: 15, scale: 2 }).notNull().default('0'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    readyNotifiedAt: timestamp('ready_notified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('alteration_orders_tenant_number').on(t.tenantId, t.orderNumber),
    index('idx_alteration_orders_tenant_status').on(t.tenantId, t.status, t.createdAt),
    index('idx_alteration_orders_assigned').on(t.assignedToId, t.tenantId, t.status),
    index('idx_alteration_orders_promised').on(t.promisedDate, t.status, t.tenantId),
    index('idx_alteration_orders_customer_phone').on(t.customerPhone, t.tenantId),
  ]
);

// ─── Alteration Tasks ─────────────────────────────────────────────────────────
export const alterationTasks = pgTable(
  'alteration_tasks',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    alterationOrderId: integer('alteration_order_id').notNull(),
    taskDescription: text('task_description').notNull(),
    tailorId: integer('tailor_id'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('PENDING')
      .$type<'PENDING' | 'IN_PROGRESS' | 'DONE'>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
  },
  (t) => [
    index('idx_alteration_tasks_order').on(t.alterationOrderId, t.tenantId),
    index('idx_alteration_tasks_tailor').on(t.tailorId, t.tenantId, t.status),
  ]
);

// ─── Tailor Work Log (piece-rate, feature-flagged: hr.tailoring.enabled) ──────
export const tailorWorkLog = pgTable(
  'tailor_work_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    employeeId: integer('employee_id').notNull(),
    alterationOrderId: integer('alteration_order_id'),
    workDate: date('work_date').notNull(),
    taskDescription: text('task_description').notNull(),
    units: decimal('units', { precision: 8, scale: 2 }).notNull().default('1'),
    ratePerUnit: decimal('rate_per_unit', { precision: 10, scale: 2 }).notNull().default('0'),
    amount: decimal('amount', { precision: 15, scale: 2 }).notNull().default('0'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
  },
  (t) => [
    index('idx_tailor_work_log_employee').on(t.employeeId, t.tenantId, t.workDate),
    index('idx_tailor_work_log_order').on(t.alterationOrderId, t.tenantId),
  ]
);

// ─── Holiday Calendars ────────────────────────────────────────────────────────
export const holidayCalendars = pgTable(
  'holiday_calendars',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    holidayDate: date('holiday_date').notNull(),
    holidayType: varchar('holiday_type', { length: 20 }).notNull().$type<'NATIONAL' | 'STATE' | 'OPTIONAL'>(),
    branchId: integer('branch_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_holiday_calendars_tenant_date').on(t.tenantId, t.holidayDate),
    unique('holiday_calendars_tenant_name_date').on(t.tenantId, t.name, t.holidayDate),
  ]
);

// ─── Type Exports ──────────────────────────────────────────────────────────────
export type Department = typeof departments.$inferSelect;
export type NewDepartment = typeof departments.$inferInsert;
export type Designation = typeof designations.$inferSelect;
export type NewDesignation = typeof designations.$inferInsert;
export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
export type Shift = typeof shifts.$inferSelect;
export type NewShift = typeof shifts.$inferInsert;
export type Attendance = typeof attendance.$inferSelect;
export type NewAttendance = typeof attendance.$inferInsert;
export type LeaveType = typeof leaveTypes.$inferSelect;
export type NewLeaveType = typeof leaveTypes.$inferInsert;
export type EmployeeLeaveBalance = typeof employeeLeaveBalance.$inferSelect;
export type LeaveApplication = typeof leaveApplications.$inferSelect;
export type NewLeaveApplication = typeof leaveApplications.$inferInsert;
export type SalaryStructure = typeof salaryStructures.$inferSelect;
export type EmployeeSalary = typeof employeeSalaries.$inferSelect;
export type PayrollRun = typeof payrollRuns.$inferSelect;
export type NewPayrollRun = typeof payrollRuns.$inferInsert;
export type PayrollSlip = typeof payrollSlips.$inferSelect;
export type AlterationOrder = typeof alterationOrders.$inferSelect;
export type NewAlterationOrder = typeof alterationOrders.$inferInsert;
export type AlterationTask = typeof alterationTasks.$inferSelect;
export type TailorWorkLog = typeof tailorWorkLog.$inferSelect;
export type NewTailorWorkLog = typeof tailorWorkLog.$inferInsert;
export type HolidayCalendar = typeof holidayCalendars.$inferSelect;
export type NewHolidayCalendar = typeof holidayCalendars.$inferInsert;
