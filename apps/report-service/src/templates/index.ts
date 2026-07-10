export const TAX_INVOICE_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; font-family: Arial, sans-serif; font-size: 12px; }
  body { padding: 10px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border: 1px solid #000; padding: 10px; }
  .company-name { font-size: 18px; font-weight: bold; color: #1a1a1a; }
  .gstin { font-size: 11px; color: #555; }
  .title { text-align: center; font-size: 16px; font-weight: bold; background: #f0f0f0; padding: 5px; border: 1px solid #000; border-top: none; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #000; border-top: none; }
  .meta-left, .meta-right { padding: 8px; }
  .meta-left { border-right: 1px solid #000; }
  .label { font-weight: bold; color: #333; }
  table { width: 100%; border-collapse: collapse; margin-top: 0; border: 1px solid #000; border-top: none; }
  th { background: #e8e8e8; padding: 5px; text-align: center; border: 1px solid #000; font-size: 11px; }
  td { padding: 4px 6px; border: 1px solid #ccc; vertical-align: top; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .total-row { font-weight: bold; background: #f5f5f5; }
  .gst-summary { border: 1px solid #000; border-top: none; padding: 8px; }
  .footer { border: 1px solid #000; border-top: none; padding: 8px; font-size: 10px; color: #555; }
  .amount-words { font-style: italic; }
  .logo { max-height: 60px; }
</style>
</head>
<body>
  <div class="header">
    <div>
      {{#if org.logoUrl}}<img src="{{org.logoUrl}}" class="logo" alt="Logo"><br>{{/if}}
      <div class="company-name">{{org.name}}</div>
      <div>{{org.address.line1}}, {{org.address.city}}, {{org.address.state}} - {{org.address.pincode}}</div>
      <div>Phone: {{org.phone}} | Email: {{org.email}}</div>
      <div class="gstin">GSTIN: {{org.gstin}} | PAN: {{org.pan}}</div>
    </div>
    <div style="text-align:right;">
      <div><span class="label">Invoice #:</span> {{invoiceNumber}}</div>
      <div><span class="label">Date:</span> {{dateFormat invoiceDate}}</div>
      <div><span class="label">Due Date:</span> {{dateFormat dueDate}}</div>
      <div><span class="label">Place of Supply:</span> {{placeOfSupply}}</div>
    </div>
  </div>
  <div class="title">TAX INVOICE</div>
  <div class="meta">
    <div class="meta-left">
      <div class="label">Bill To:</div>
      <div><strong>{{customer.name}}</strong></div>
      <div>{{customer.address.line1}}, {{customer.address.city}}</div>
      <div>{{customer.address.state}} - {{customer.address.pincode}}</div>
      {{#if customer.gstin}}<div>GSTIN: {{customer.gstin}}</div>{{/if}}
      {{#if customer.phone}}<div>Phone: {{customer.phone}}</div>{{/if}}
    </div>
    <div class="meta-right">
      {{#if deliveryAddress}}
      <div class="label">Ship To:</div>
      <div>{{deliveryAddress.line1}}, {{deliveryAddress.city}}</div>
      <div>{{deliveryAddress.state}} - {{deliveryAddress.pincode}}</div>
      {{/if}}
      {{#if vehicleNumber}}<div><span class="label">Vehicle:</span> {{vehicleNumber}}</div>{{/if}}
      {{#if poReference}}<div><span class="label">PO Ref:</span> {{poReference}}</div>{{/if}}
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Description</th>
        <th>HSN</th>
        <th>Qty</th>
        <th>Unit</th>
        <th>Rate</th>
        <th>Disc%</th>
        <th>Taxable Amt</th>
        {{#if isInterstate}}
        <th>IGST%</th><th>IGST Amt</th>
        {{else}}
        <th>CGST%</th><th>CGST Amt</th>
        <th>SGST%</th><th>SGST Amt</th>
        {{/if}}
        <th>Total</th>
      </tr>
    </thead>
    <tbody>
      {{#each lines}}
      <tr>
        <td class="text-center">{{add @index 1}}</td>
        <td>{{itemName}}{{#if description}}<br><small>{{description}}</small>{{/if}}</td>
        <td class="text-center">{{hsnCode}}</td>
        <td class="text-right">{{qty}}</td>
        <td class="text-center">{{unit}}</td>
        <td class="text-right">{{inrFormat rate}}</td>
        <td class="text-center">{{discountPercent}}%</td>
        <td class="text-right">{{inrFormat taxableAmount}}</td>
        {{#if ../isInterstate}}
        <td class="text-center">{{igstRate}}%</td><td class="text-right">{{inrFormat igstAmount}}</td>
        {{else}}
        <td class="text-center">{{cgstRate}}%</td><td class="text-right">{{inrFormat cgstAmount}}</td>
        <td class="text-center">{{sgstRate}}%</td><td class="text-right">{{inrFormat sgstAmount}}</td>
        {{/if}}
        <td class="text-right">{{inrFormat lineTotal}}</td>
      </tr>
      {{/each}}
    </tbody>
    <tfoot>
      <tr class="total-row">
        <td colspan="7" class="text-right">Sub Total:</td>
        <td class="text-right">{{inrFormat subTotal}}</td>
        {{#if isInterstate}}
        <td colspan="2" class="text-right">{{inrFormat totalIgst}}</td>
        {{else}}
        <td colspan="2" class="text-right">{{inrFormat totalCgst}}</td>
        <td colspan="2" class="text-right">{{inrFormat totalSgst}}</td>
        {{/if}}
        <td class="text-right">{{inrFormat grandTotal}}</td>
      </tr>
    </tfoot>
  </table>
  <div class="gst-summary">
    <div class="amount-words"><strong>Amount in Words:</strong> {{numberWords grandTotal}}</div>
    {{#if roundingAdjustment}}<div>Rounding Adjustment: {{inrFormat roundingAdjustment}}</div>{{/if}}
    {{#if notes}}<div style="margin-top:5px;"><strong>Notes:</strong> {{notes}}</div>{{/if}}
  </div>
  {{#if irn}}
  <div class="meta" style="border-top:none;">
    <div class="meta-left">
      <div class="label">e-Invoice Details:</div>
      <div>IRN: {{irn}}</div>
      {{#if ackNumber}}<div>Ack No: {{ackNumber}}</div>{{/if}}
    </div>
    {{#if qrCodeDataUri}}
    <div class="meta-right" style="text-align:right;">
      <img src="{{qrCodeDataUri}}" style="max-height:90px;" alt="e-Invoice QR">
    </div>
    {{/if}}
  </div>
  {{/if}}
  <div class="meta" style="border-top:none;">
    <div class="meta-left">
      <div class="label">Bank Details:</div>
      <div>Bank: {{org.bankDetails.bankName}}</div>
      <div>A/C No: {{org.bankDetails.accountNumber}}</div>
      <div>IFSC: {{org.bankDetails.ifscCode}}</div>
    </div>
    <div class="meta-right" style="text-align:right;">
      <div>For <strong>{{org.name}}</strong></div>
      <br><br>
      <div>Authorised Signatory</div>
    </div>
  </div>
  <div class="footer">
    {{#if org.termsAndConditions}}<div><strong>Terms:</strong> {{org.termsAndConditions}}</div>{{/if}}
    <div style="margin-top:4px;">This is a computer generated document. No signature required.</div>
  </div>
</body>
</html>`;

export const QUOTATION_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; font-family: Arial, sans-serif; font-size: 12px; }
  body { padding: 10px; }
  .header { border: 1px solid #000; padding: 10px; display: flex; justify-content: space-between; }
  .title { text-align: center; font-size: 16px; font-weight: bold; background: #e8f4e8; padding: 5px; border: 1px solid #000; border-top: none; }
  table { width: 100%; border-collapse: collapse; border: 1px solid #000; border-top: none; }
  th { background: #d4edd4; padding: 5px; border: 1px solid #000; }
  td { padding: 4px 6px; border: 1px solid #ccc; }
  .text-right { text-align: right; }
  .total-row { font-weight: bold; background: #f0f8f0; }
  .validity { padding: 8px; border: 1px solid #000; border-top: none; background: #fffde7; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div style="font-size:18px;font-weight:bold;">{{org.name}}</div>
      <div>{{org.address.line1}}, {{org.address.city}} - {{org.address.pincode}}</div>
      <div>GSTIN: {{org.gstin}}</div>
    </div>
    <div style="text-align:right;">
      <div><strong>Quotation #:</strong> {{quotationNumber}}</div>
      <div><strong>Date:</strong> {{dateFormat quotationDate}}</div>
      <div><strong>Valid Until:</strong> {{dateFormat validUntil}}</div>
    </div>
  </div>
  <div class="title">QUOTATION / ESTIMATE</div>
  <div style="border:1px solid #000;border-top:none;padding:8px;">
    <strong>To:</strong> {{customer.name}} | {{customer.address.city}} | {{customer.phone}}
  </div>
  <table>
    <thead>
      <tr><th>#</th><th>Item</th><th>HSN</th><th>Qty</th><th>Rate</th><th>Disc%</th><th>GST%</th><th>Amount</th></tr>
    </thead>
    <tbody>
      {{#each lines}}
      <tr>
        <td>{{add @index 1}}</td>
        <td>{{itemName}}</td>
        <td>{{hsnCode}}</td>
        <td class="text-right">{{qty}} {{unit}}</td>
        <td class="text-right">{{inrFormat rate}}</td>
        <td class="text-right">{{discountPercent}}%</td>
        <td class="text-right">{{gstRate}}%</td>
        <td class="text-right">{{inrFormat lineTotal}}</td>
      </tr>
      {{/each}}
    </tbody>
    <tfoot>
      <tr class="total-row"><td colspan="7" class="text-right">Grand Total:</td><td class="text-right">{{inrFormat grandTotal}}</td></tr>
    </tfoot>
  </table>
  <div class="validity">
    <strong>Amount in Words:</strong> {{numberWords grandTotal}}<br>
    <strong>Validity:</strong> This quotation is valid until {{dateFormat validUntil}}<br>
    {{#if notes}}<strong>Notes:</strong> {{notes}}{{/if}}
  </div>
</body>
</html>`;

export const DELIVERY_CHALLAN_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8">
<style>
  * { margin:0;padding:0;box-sizing:border-box;font-family:Arial,sans-serif;font-size:12px; }
  body { padding:10px; }
  .header { border:1px solid #000;padding:10px;display:flex;justify-content:space-between; }
  .title { text-align:center;font-size:16px;font-weight:bold;background:#fff3e0;padding:5px;border:1px solid #000;border-top:none; }
  table { width:100%;border-collapse:collapse;border:1px solid #000;border-top:none; }
  th { background:#ffe0b2;padding:5px;border:1px solid #000; }
  td { padding:4px 6px;border:1px solid #ccc; }
  .text-right { text-align:right; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div style="font-size:18px;font-weight:bold;">{{org.name}}</div>
      <div>{{org.address.line1}}, {{org.address.city}}</div>
      <div>GSTIN: {{org.gstin}}</div>
    </div>
    <div style="text-align:right;">
      <div><strong>DC #:</strong> {{dcNumber}}</div>
      <div><strong>Date:</strong> {{dateFormat dcDate}}</div>
      {{#if vehicleNumber}}<div><strong>Vehicle:</strong> {{vehicleNumber}}</div>{{/if}}
      {{#if invoiceReference}}<div><strong>Against Invoice:</strong> {{invoiceReference}}</div>{{/if}}
    </div>
  </div>
  <div class="title">DELIVERY CHALLAN</div>
  <div style="border:1px solid #000;border-top:none;padding:8px;">
    <strong>Deliver To:</strong> {{customer.name}}<br>
    {{customer.address.line1}}, {{customer.address.city}} - {{customer.address.pincode}}
  </div>
  <table>
    <thead><tr><th>#</th><th>Description</th><th>Qty</th><th>Unit</th><th>Remarks</th></tr></thead>
    <tbody>
      {{#each lines}}
      <tr>
        <td>{{add @index 1}}</td>
        <td>{{itemName}}</td>
        <td class="text-right">{{qty}}</td>
        <td>{{unit}}</td>
        <td>{{remarks}}</td>
      </tr>
      {{/each}}
    </tbody>
  </table>
  <div style="border:1px solid #000;border-top:none;padding:8px;display:flex;justify-content:space-between;">
    <div><strong>Received By:</strong><br><br>_______________________</div>
    <div><strong>For {{org.name}}</strong><br><br>_______________________<br>Authorised Signatory</div>
  </div>
</body>
</html>`;

export const PURCHASE_ORDER_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8">
<style>
  * { margin:0;padding:0;box-sizing:border-box;font-family:Arial,sans-serif;font-size:12px; }
  body { padding:10px; }
  .header { border:1px solid #000;padding:10px;display:flex;justify-content:space-between; }
  .title { text-align:center;font-size:16px;font-weight:bold;background:#e3f2fd;padding:5px;border:1px solid #000;border-top:none; }
  table { width:100%;border-collapse:collapse;border:1px solid #000;border-top:none; }
  th { background:#bbdefb;padding:5px;border:1px solid #000; }
  td { padding:4px 6px;border:1px solid #ccc; }
  .text-right { text-align:right; }
  .total-row { font-weight:bold;background:#e3f2fd; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div style="font-size:18px;font-weight:bold;">{{org.name}}</div>
      <div>{{org.address.line1}}, {{org.address.city}} - {{org.address.pincode}}</div>
      <div>GSTIN: {{org.gstin}}</div>
    </div>
    <div style="text-align:right;">
      <div><strong>PO #:</strong> {{poNumber}}</div>
      <div><strong>Date:</strong> {{dateFormat poDate}}</div>
      <div><strong>Expected Delivery:</strong> {{dateFormat expectedDelivery}}</div>
    </div>
  </div>
  <div class="title">PURCHASE ORDER</div>
  <div style="border:1px solid #000;border-top:none;padding:8px;">
    <strong>To Supplier:</strong> {{supplier.name}}<br>
    {{supplier.address.line1}}, {{supplier.address.city}}<br>
    GSTIN: {{supplier.gstin}} | Phone: {{supplier.phone}}
  </div>
  <table>
    <thead><tr><th>#</th><th>Item</th><th>HSN</th><th>Qty</th><th>Unit</th><th>Rate</th><th>GST%</th><th>Amount</th></tr></thead>
    <tbody>
      {{#each lines}}
      <tr>
        <td>{{add @index 1}}</td><td>{{itemName}}</td><td>{{hsnCode}}</td>
        <td class="text-right">{{qty}}</td><td>{{unit}}</td>
        <td class="text-right">{{inrFormat rate}}</td>
        <td class="text-right">{{gstRate}}%</td>
        <td class="text-right">{{inrFormat lineTotal}}</td>
      </tr>
      {{/each}}
    </tbody>
    <tfoot>
      <tr class="total-row"><td colspan="7" class="text-right">Total:</td><td class="text-right">{{inrFormat grandTotal}}</td></tr>
    </tfoot>
  </table>
  <div style="border:1px solid #000;border-top:none;padding:8px;">
    <strong>Amount in Words:</strong> {{numberWords grandTotal}}<br>
    {{#if paymentTerms}}<strong>Payment Terms:</strong> {{paymentTerms}}<br>{{/if}}
    {{#if notes}}<strong>Notes:</strong> {{notes}}{{/if}}
  </div>
</body>
</html>`;

export const PAYMENT_RECEIPT_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8">
<style>
  * { margin:0;padding:0;box-sizing:border-box;font-family:Arial,sans-serif;font-size:13px; }
  body { padding:20px; }
  .receipt { border:2px solid #333;padding:20px;max-width:600px;margin:0 auto; }
  .header { text-align:center;border-bottom:1px dashed #999;padding-bottom:10px;margin-bottom:10px; }
  .org-name { font-size:22px;font-weight:bold; }
  .title { font-size:18px;font-weight:bold;color:#555;margin-top:5px; }
  .row { display:flex;justify-content:space-between;margin:6px 0; }
  .label { font-weight:bold;color:#444; }
  .amount-box { background:#f5f5f5;border:1px solid #ccc;padding:10px;text-align:center;margin-top:10px; }
  .amount { font-size:24px;font-weight:bold;color:#2e7d32; }
  .words { font-size:11px;color:#555;font-style:italic; }
</style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <div class="org-name">{{org.name}}</div>
      <div>{{org.address.line1}}, {{org.address.city}}</div>
      <div class="title">PAYMENT RECEIPT</div>
    </div>
    <div class="row"><span class="label">Receipt #:</span><span>{{receiptNumber}}</span></div>
    <div class="row"><span class="label">Date:</span><span>{{dateFormat receiptDate}}</span></div>
    <div class="row"><span class="label">Received From:</span><span>{{customer.name}}</span></div>
    <div class="row"><span class="label">Payment Mode:</span><span>{{paymentMode}}</span></div>
    {{#if chequeNumber}}<div class="row"><span class="label">Cheque #:</span><span>{{chequeNumber}} / {{chequeBank}}</span></div>{{/if}}
    {{#if utrNumber}}<div class="row"><span class="label">UTR #:</span><span>{{utrNumber}}</span></div>{{/if}}
    {{#if invoiceReference}}<div class="row"><span class="label">Against Invoice:</span><span>{{invoiceReference}}</span></div>{{/if}}
    <div class="amount-box">
      <div class="amount">{{inrFormat amount}}</div>
      <div class="words">{{numberWords amount}}</div>
    </div>
    <div style="text-align:right;margin-top:30px;">
      <div>For {{org.name}}</div>
      <br><br>
      <div>Authorised Signatory</div>
    </div>
  </div>
</body>
</html>`;

export const SALARY_SLIP_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8">
<style>
  * { margin:0;padding:0;box-sizing:border-box;font-family:Arial,sans-serif;font-size:12px; }
  body { padding:10px; }
  .header { border:1px solid #000;padding:10px;display:flex;justify-content:space-between;background:#f5f5f5; }
  .title { text-align:center;font-size:15px;font-weight:bold;background:#e8eaf6;padding:5px;border:1px solid #000;border-top:none; }
  .employee-info { border:1px solid #000;border-top:none;padding:8px;display:grid;grid-template-columns:1fr 1fr; }
  table { width:100%;border-collapse:collapse;border:1px solid #000;border-top:none; }
  th { background:#c5cae9;padding:5px;border:1px solid #000; }
  td { padding:4px 8px;border:1px solid #ccc; }
  .text-right { text-align:right; }
  .net-pay { font-size:16px;font-weight:bold;color:#1a237e; }
  .earnings { background:#e8f5e9; }
  .deductions { background:#fce4ec; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div style="font-size:18px;font-weight:bold;">{{org.name}}</div>
      <div>{{org.address.line1}}, {{org.address.city}}</div>
    </div>
    <div style="text-align:right;"><div style="font-size:14px;font-weight:bold;">SALARY SLIP</div>
      <div>Month: {{monthName}} {{year}}</div>
    </div>
  </div>
  <div class="title">PAYSLIP — CONFIDENTIAL</div>
  <div class="employee-info">
    <div>
      <div><strong>Name:</strong> {{employee.name}}</div>
      <div><strong>Designation:</strong> {{employee.designation}}</div>
      <div><strong>Department:</strong> {{employee.department}}</div>
    </div>
    <div>
      <div><strong>Employee ID:</strong> {{employee.code}}</div>
      <div><strong>Join Date:</strong> {{dateFormat employee.joinDate}}</div>
      <div><strong>Bank A/C:</strong> XXXX{{last4 employee.bankAccount}}</div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;">
    <table>
      <thead><tr><th colspan="2" class="earnings">EARNINGS</th></tr><tr><th>Component</th><th>Amount</th></tr></thead>
      <tbody>
        {{#each earnings}}
        <tr class="earnings"><td>{{component}}</td><td class="text-right">{{inrFormat amount}}</td></tr>
        {{/each}}
      </tbody>
      <tfoot><tr><td><strong>Gross Salary</strong></td><td class="text-right"><strong>{{inrFormat grossSalary}}</strong></td></tr></tfoot>
    </table>
    <table>
      <thead><tr><th colspan="2" class="deductions">DEDUCTIONS</th></tr><tr><th>Component</th><th>Amount</th></tr></thead>
      <tbody>
        {{#each deductions}}
        <tr class="deductions"><td>{{component}}</td><td class="text-right">{{inrFormat amount}}</td></tr>
        {{/each}}
      </tbody>
      <tfoot><tr><td><strong>Total Deductions</strong></td><td class="text-right"><strong>{{inrFormat totalDeductions}}</strong></td></tr></tfoot>
    </table>
  </div>
  <div style="border:1px solid #000;border-top:none;padding:8px;display:flex;justify-content:space-between;align-items:center;">
    <div>
      <span class="net-pay">Net Pay: {{inrFormat netPay}}</span><br>
      <span style="font-size:10px;font-style:italic;">{{numberWords netPay}}</span>
    </div>
    <div><strong>Working Days:</strong> {{workingDays}} / {{totalDays}}<br>
      <strong>LOP Days:</strong> {{lopDays}}
    </div>
  </div>
  <div style="border:1px solid #000;border-top:none;padding:8px;font-size:10px;color:#666;">
    This is a computer generated salary slip. No signature required.
  </div>
</body>
</html>`;

export const PROFIT_LOSS_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8">
<style>
  * { margin:0;padding:0;box-sizing:border-box;font-family:Arial,sans-serif;font-size:12px; }
  body { padding:10px; }
  .header { border:1px solid #000;padding:10px;text-align:center; }
  .company-name { font-size:16px;font-weight:bold; }
  .period { font-size:11px;color:#555; }
  table { width:100%;border-collapse:collapse;border:1px solid #000;border-top:none; }
  th { background:#e8e8e8;padding:5px;border:1px solid #000;text-align:left; }
  td { padding:4px 8px;border:1px solid #ccc; }
  .text-right { text-align:right; }
  .section-header td { background:#f0f0f0;font-weight:bold; }
  .total-row td { font-weight:bold;border-top:2px solid #000; }
</style>
</head>
<body>
  <div class="header">
    <div class="company-name">{{org.name}}</div>
    <div>Profit &amp; Loss Statement</div>
    <div class="period">For the period {{dateFormat from}} to {{dateFormat to}}</div>
  </div>
  <table>
    <thead><tr><th>Account</th><th class="text-right">Amount</th></tr></thead>
    <tbody>
      <tr class="section-header"><td colspan="2">Revenue</td></tr>
      {{#each revenue}}
      <tr><td>{{accountCode}} — {{accountName}}</td><td class="text-right">{{inrFormat amount}}</td></tr>
      {{/each}}
      <tr class="total-row"><td>Total Revenue</td><td class="text-right">{{inrFormat totalRevenue}}</td></tr>

      <tr class="section-header"><td colspan="2">Cost of Goods Sold</td></tr>
      {{#each cogs}}
      <tr><td>{{accountCode}} — {{accountName}}</td><td class="text-right">{{inrFormat amount}}</td></tr>
      {{/each}}
      <tr class="total-row"><td>Total COGS</td><td class="text-right">{{inrFormat totalCogs}}</td></tr>
      <tr class="total-row"><td>Gross Profit</td><td class="text-right">{{inrFormat grossProfit}}</td></tr>

      <tr class="section-header"><td colspan="2">Operating Expenses</td></tr>
      {{#each operatingExpenses}}
      <tr><td>{{accountCode}} — {{accountName}}</td><td class="text-right">{{inrFormat amount}}</td></tr>
      {{/each}}
      <tr class="total-row"><td>Total Operating Expenses</td><td class="text-right">{{inrFormat totalOperatingExpenses}}</td></tr>
      <tr class="total-row"><td>Operating Profit</td><td class="text-right">{{inrFormat operatingProfit}}</td></tr>

      <tr class="section-header"><td colspan="2">Other Income</td></tr>
      {{#each otherIncome}}
      <tr><td>{{accountCode}} — {{accountName}}</td><td class="text-right">{{inrFormat amount}}</td></tr>
      {{/each}}
      <tr class="total-row"><td>Total Other Income</td><td class="text-right">{{inrFormat totalOtherIncome}}</td></tr>

      <tr class="section-header"><td colspan="2">Financial Charges</td></tr>
      {{#each financialCharges}}
      <tr><td>{{accountCode}} — {{accountName}}</td><td class="text-right">{{inrFormat amount}}</td></tr>
      {{/each}}
      <tr class="total-row"><td>Total Financial Charges</td><td class="text-right">{{inrFormat totalFinancialCharges}}</td></tr>

      <tr class="total-row"><td>Net Profit</td><td class="text-right">{{inrFormat netProfit}}</td></tr>
    </tbody>
  </table>
  <div style="border:1px solid #000;border-top:none;padding:8px;font-size:10px;color:#666;">
    Generated {{dateFormat generatedAt}}. This is a computer generated statement.
  </div>
</body>
</html>`;
