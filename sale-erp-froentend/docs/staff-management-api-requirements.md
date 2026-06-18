# Staff Management API Requirements

Use this document to generate Java Spring Boot + PostgreSQL backend APIs for the BillTop Staff Management module.

## Backend Stack

- Java 17+
- Spring Boot
- Spring Web
- Spring Data JPA
- PostgreSQL
- Bean Validation
- Existing auth/JWT and organization scoping if already available

## Standard Response Format

All APIs should return the existing BillTop response shape:

```json
{
  "success": true,
  "message": "Message",
  "data": {},
  "timestamp": "2026-06-16T18:19:48.7533195"
}
```

Paged APIs should return:

```json
{
  "success": true,
  "message": "Records retrieved successfully",
  "data": {
    "content": [],
    "page": 0,
    "size": 20,
    "totalElements": 0,
    "totalPages": 0,
    "last": true
  },
  "timestamp": "2026-06-16T18:19:48.7533195"
}
```

## Common Rules

- Every staff record should support `organizationId`.
- Use soft delete where possible: `deleted = false`.
- Use audit fields: `createdAt`, `createdBy`, `updatedAt`, `updatedBy`.
- Status enums should be stored as strings.
- Dates should use ISO format: `YYYY-MM-DD`.
- Date-times should use ISO timestamp.
- Money fields should use `BigDecimal`.

## 1. Employees

### Table: `employees`

Columns:

- `id BIGSERIAL PRIMARY KEY`
- `organization_id BIGINT NOT NULL`
- `employee_code VARCHAR(50) NOT NULL`
- `first_name VARCHAR(100) NOT NULL`
- `last_name VARCHAR(100) NOT NULL`
- `gender VARCHAR(20)`
- `dob DATE`
- `mobile VARCHAR(20) NOT NULL`
- `email VARCHAR(150) NOT NULL`
- `address TEXT`
- `department VARCHAR(100) NOT NULL`
- `designation VARCHAR(100) NOT NULL`
- `joining_date DATE NOT NULL`
- `employment_type VARCHAR(30) NOT NULL`
- `reporting_manager VARCHAR(150)`
- `basic_salary NUMERIC(14,2) DEFAULT 0`
- `hra NUMERIC(14,2) DEFAULT 0`
- `allowance NUMERIC(14,2) DEFAULT 0`
- `deductions NUMERIC(14,2) DEFAULT 0`
- `payment_mode VARCHAR(50)`
- `bank_name VARCHAR(150)`
- `account_number VARCHAR(50)`
- `ifsc_code VARCHAR(20)`
- `account_holder_name VARCHAR(150)`
- `status VARCHAR(20) NOT NULL`
- `deleted BOOLEAN DEFAULT FALSE`
- audit columns

Unique key:

- `(organization_id, employee_code)`

Enums:

- `status`: `ACTIVE`, `INACTIVE`
- `employmentType`: `FULL_TIME`, `PART_TIME`, `CONTRACT`, `INTERN`

### Employees List

`GET /api/v1/staff/employees?page=0&size=20&search=&status=&department=`

Search should match employee code, first name, last name, mobile, email.

Response row:

```json
{
  "id": 1,
  "employeeCode": "EMP-001",
  "firstName": "Anaya",
  "lastName": "Sharma",
  "gender": "Female",
  "dob": "1994-04-12",
  "mobile": "9876543210",
  "email": "anaya@example.com",
  "address": "Pune",
  "department": "Sales",
  "designation": "Sales Executive",
  "joiningDate": "2024-02-01",
  "employmentType": "FULL_TIME",
  "reportingManager": "Rohit Mehta",
  "basicSalary": 30000,
  "hra": 9000,
  "allowance": 4500,
  "deductions": 1200,
  "paymentMode": "Bank Transfer",
  "bankName": "HDFC Bank",
  "accountNumber": "50100234567890",
  "ifscCode": "HDFC0001234",
  "accountHolderName": "Anaya Sharma",
  "status": "ACTIVE",
  "createdAt": "2026-06-16T10:00:00"
}
```

### Employee Detail

`GET /api/v1/staff/employees/{id}`

Return the same fields as list row.

### Create Employee

`POST /api/v1/staff/employees`

Request:

```json
{
  "employeeCode": "EMP-001",
  "firstName": "Anaya",
  "lastName": "Sharma",
  "gender": "Female",
  "dob": "1994-04-12",
  "mobile": "9876543210",
  "email": "anaya@example.com",
  "address": "Pune",
  "department": "Sales",
  "designation": "Sales Executive",
  "joiningDate": "2024-02-01",
  "employmentType": "FULL_TIME",
  "reportingManager": "Rohit Mehta",
  "basicSalary": 30000,
  "hra": 9000,
  "allowance": 4500,
  "deductions": 1200,
  "paymentMode": "Bank Transfer",
  "bankName": "HDFC Bank",
  "accountNumber": "50100234567890",
  "ifscCode": "HDFC0001234",
  "accountHolderName": "Anaya Sharma",
  "status": "ACTIVE"
}
```

### Update Employee

`PUT /api/v1/staff/employees/{id}`

Use same request body as create.

### Delete Employee

`DELETE /api/v1/staff/employees/{id}`

Soft delete preferred.

## 2. Attendance

### Table: `staff_attendance`

Columns:

- `id BIGSERIAL PRIMARY KEY`
- `organization_id BIGINT NOT NULL`
- `employee_id BIGINT NOT NULL REFERENCES employees(id)`
- `attendance_date DATE NOT NULL`
- `check_in TIME`
- `check_out TIME`
- `total_hours NUMERIC(6,2) DEFAULT 0`
- `status VARCHAR(20) NOT NULL`
- `note TEXT`
- audit columns

Unique key:

- `(organization_id, employee_id, attendance_date)`

Enums:

- `PRESENT`, `ABSENT`, `HALF_DAY`, `LATE`, `LEAVE`

### Attendance List

`GET /api/v1/staff/attendance?date=2026-06-16&department=&employee=&status=`

Response row:

```json
{
  "id": 1,
  "employeeId": 1,
  "employeeCode": "EMP-001",
  "employeeName": "Anaya Sharma",
  "department": "Sales",
  "date": "2026-06-16",
  "checkIn": "09:30",
  "checkOut": "18:30",
  "totalHours": 9,
  "status": "PRESENT",
  "note": ""
}
```

### Mark Attendance

`POST /api/v1/staff/attendance`

Request:

```json
{
  "employeeId": 1,
  "date": "2026-06-16",
  "checkIn": "09:30",
  "checkOut": "18:30",
  "status": "PRESENT",
  "note": ""
}
```

If a record already exists for employee and date, update it.

### Update Attendance

`PUT /api/v1/staff/attendance/{id}`

Use same body as mark attendance.

### Attendance Summary

`GET /api/v1/staff/attendance/summary?month=6&year=2026`

Response:

```json
[
  { "status": "PRESENT", "count": 20 },
  { "status": "ABSENT", "count": 2 },
  { "status": "LEAVE", "count": 1 },
  { "status": "LATE", "count": 3 }
]
```

## 3. Leave Management

### Table: `staff_leave_requests`

Columns:

- `id BIGSERIAL PRIMARY KEY`
- `organization_id BIGINT NOT NULL`
- `employee_id BIGINT NOT NULL REFERENCES employees(id)`
- `leave_type VARCHAR(100) NOT NULL`
- `from_date DATE NOT NULL`
- `to_date DATE NOT NULL`
- `days NUMERIC(5,1) NOT NULL`
- `reason TEXT`
- `status VARCHAR(20) NOT NULL`
- `approved_by BIGINT`
- `approved_at TIMESTAMP`
- audit columns

Enums:

- `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`

### Leave Requests List

`GET /api/v1/staff/leaves?employee=&leaveType=&status=&fromDate=&toDate=`

Response row:

```json
{
  "id": 1,
  "employeeId": 1,
  "employeeCode": "EMP-001",
  "employeeName": "Anaya Sharma",
  "leaveType": "Casual Leave",
  "fromDate": "2026-06-16",
  "toDate": "2026-06-16",
  "days": 1,
  "reason": "Personal work",
  "status": "PENDING"
}
```

### Create Leave Request

`POST /api/v1/staff/leaves`

Request:

```json
{
  "employeeId": 1,
  "leaveType": "Casual Leave",
  "fromDate": "2026-06-16",
  "toDate": "2026-06-16",
  "reason": "Personal work"
}
```

Backend should calculate `days`.

### Approve Leave

`PUT /api/v1/staff/leaves/{id}/approve`

### Reject Leave

`PUT /api/v1/staff/leaves/{id}/reject`

Request optional:

```json
{
  "reason": "Insufficient leave balance"
}
```

### Cancel Leave

`PUT /api/v1/staff/leaves/{id}/cancel`

### Leave Balance

`GET /api/v1/staff/leaves/balance?employeeId=1`

Response:

```json
[
  { "leaveType": "Casual Leave", "allotted": 12, "used": 3, "remaining": 9 },
  { "leaveType": "Sick Leave", "allotted": 8, "used": 2, "remaining": 6 },
  { "leaveType": "Paid Leave", "allotted": 15, "used": 4, "remaining": 11 },
  { "leaveType": "Unpaid Leave", "allotted": 0, "used": 1, "remaining": 0 }
]
```

## 4. Payroll

### Table: `staff_payroll`

Columns:

- `id BIGSERIAL PRIMARY KEY`
- `organization_id BIGINT NOT NULL`
- `employee_id BIGINT NOT NULL REFERENCES employees(id)`
- `payroll_month VARCHAR(7) NOT NULL`
- `basic_salary NUMERIC(14,2) DEFAULT 0`
- `hra NUMERIC(14,2) DEFAULT 0`
- `allowance NUMERIC(14,2) DEFAULT 0`
- `overtime_amount NUMERIC(14,2) DEFAULT 0`
- `deductions NUMERIC(14,2) DEFAULT 0`
- `tax NUMERIC(14,2) DEFAULT 0`
- `gross_pay NUMERIC(14,2) NOT NULL`
- `net_pay NUMERIC(14,2) NOT NULL`
- `payment_date DATE`
- `status VARCHAR(20) NOT NULL`
- audit columns

Unique key:

- `(organization_id, employee_id, payroll_month)`

Enums:

- `DRAFT`, `GENERATED`, `PAID`

### Payroll List

`GET /api/v1/staff/payroll?month=06&year=2026`

Response row:

```json
{
  "id": 1,
  "employeeId": 1,
  "employeeCode": "EMP-001",
  "employeeName": "Anaya Sharma",
  "payrollMonth": "2026-06",
  "basicSalary": 30000,
  "hra": 9000,
  "allowance": 4500,
  "overtimeAmount": 1200,
  "deductions": 1200,
  "tax": 1800,
  "grossPay": 44700,
  "netPay": 41700,
  "paymentDate": "2026-06-30",
  "status": "GENERATED"
}
```

### Generate Payroll

`POST /api/v1/staff/payroll`

Request:

```json
{
  "employeeId": 1,
  "payrollMonth": "2026-06",
  "basicSalary": 30000,
  "hra": 9000,
  "allowance": 4500,
  "overtimeAmount": 1200,
  "deductions": 1200,
  "tax": 1800,
  "paymentDate": "2026-06-30",
  "status": "GENERATED"
}
```

Backend should calculate:

- `grossPay = basicSalary + hra + allowance + overtimeAmount`
- `netPay = grossPay - deductions - tax`

### Payroll Detail / Payslip

`GET /api/v1/staff/payroll/{id}`

### Mark Payroll Paid

`PUT /api/v1/staff/payroll/{id}/mark-paid`

## 5. Staff Settings

Use one generic settings table or separate tables.

Recommended generic table: `staff_settings`

Columns:

- `id BIGSERIAL PRIMARY KEY`
- `organization_id BIGINT NOT NULL`
- `type VARCHAR(50) NOT NULL`
- `name VARCHAR(150) NOT NULL`
- `description TEXT`
- `status VARCHAR(20) NOT NULL`
- `deleted BOOLEAN DEFAULT FALSE`
- audit columns

Types:

- `departments`
- `designations`
- `shifts`
- `holidays`
- `leaveTypes`
- `salaryComponents`

### List Settings

`GET /api/v1/staff/settings/{type}`

Example:

`GET /api/v1/staff/settings/departments`

Response row:

```json
{
  "id": 1,
  "name": "Sales",
  "description": "Sales team",
  "status": "ACTIVE"
}
```

### Create Setting

`POST /api/v1/staff/settings/{type}`

Request:

```json
{
  "name": "Sales",
  "description": "Sales team",
  "status": "ACTIVE"
}
```

### Update Setting

`PUT /api/v1/staff/settings/{type}/{id}`

### Delete Setting

`DELETE /api/v1/staff/settings/{type}/{id}`

## Optional Document Upload APIs

### Upload Employee Document

`POST /api/v1/staff/employees/{id}/documents`

Content type: `multipart/form-data`

Fields:

- `file`
- `documentType`

### List Employee Documents

`GET /api/v1/staff/employees/{id}/documents`

### Delete Employee Document

`DELETE /api/v1/staff/employees/{id}/documents/{documentId}`

## Backend Codex Prompt

```text
Build Java Spring Boot + PostgreSQL APIs for the BillTop Staff Management module using this API document.

Create entities, DTOs, repositories, services, controllers, validation, enum types, and PostgreSQL migrations for:
- Employees
- Attendance
- Leave Management
- Payroll
- Staff Settings
- Optional employee documents

Follow the existing project response format:
{ success, message, data, timestamp }

Use organizationId scoping on every table and query. If the existing auth context exposes organizationId, use it automatically. Otherwise accept organizationId temporarily from request/auth principal based on existing backend patterns.

Implement all endpoints exactly as documented under /api/v1/staff.

Use BigDecimal for money fields, LocalDate for dates, LocalTime for attendance time, and LocalDateTime for audit timestamps.

Add pagination for employees. Add filters for employee list, attendance, leaves, and payroll. Add unique constraints for employee code and payroll month per employee.

Return frontend-compatible JSON field names in camelCase.

Add validation:
- employeeCode, firstName, lastName, mobile, email, department, designation, joiningDate required
- attendance employeeId, date, status required
- leave employeeId, leaveType, fromDate, toDate required; toDate must be >= fromDate
- payroll employeeId, payrollMonth required
- setting name and status required

Generate database migration SQL for PostgreSQL.
```
