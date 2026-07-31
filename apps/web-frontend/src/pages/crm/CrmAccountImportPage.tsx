import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Download, Upload } from 'lucide-react';
import { importApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Button from '../../components/ui/Button.js';
import Select from '../../components/ui/Select.js';

// CRM-ROADMAP Phase 1, Feature 7 (Data Import/Dedupe/Merge Tooling) — drives scheduler-service's
// existing ImportEngine (upload -> map -> validate -> execute), same single-flow pattern as
// SupplierImportPage.tsx. The one addition over that pattern: validate() can return
// WARNING-severity entries (possible-duplicate suggestions, reusing Feature 1's
// AccountService dedupe scoring) alongside blocking ERROR entries — warnings never prevent
// import, they're shown so the user can review before committing, per this feature's own
// "suggested, not auto-merged" requirement.

const TARGET_FIELDS = ['name', 'accountType', 'gstin', 'primaryPhone', 'primaryEmail'];

interface ParsedCsv {
  headers: string[];
  rows: string[][];
  raw: string;
}

interface ImportRowIssue {
  row: number;
  column: string;
  value: unknown;
  message: string;
  severity?: 'ERROR' | 'WARNING';
}

function parseCsv(text: string): ParsedCsv {
  const lines = text.trim().split(/\r?\n/);
  const headers = (lines[0] ?? '').split(',').map((h) => h.trim());
  const rows = lines.slice(1).map((line) => line.split(',').map((c) => c.trim()));
  return { headers, rows, raw: text };
}

function autoMapField(header: string): string {
  const h = header.toLowerCase().replace(/[^a-z]/g, '');
  const match = TARGET_FIELDS.find((f) => f.toLowerCase() === h);
  return match ?? '';
}

export default function CrmAccountImportPage() {
  const navigate = useNavigate();
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [jobId, setJobId] = useState<string | null>(null);
  const [validation, setValidation] = useState<{
    validRows: number;
    errors: ImportRowIssue[];
  } | null>(null);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<{
    successRows: number;
    totalRows: number;
    status: string;
  } | null>(null);

  const handleFile = (file: File) => {
    setFileName(file.name);
    setJobId(null);
    setValidation(null);
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result ?? ''));
      setCsv(parsed);
      const initialMapping: Record<string, string> = {};
      for (const h of parsed.headers) initialMapping[h] = autoMapField(h);
      setMapping(initialMapping);
    };
    reader.readAsText(file);
  };

  const handleDownloadTemplate = async () => {
    const blob = await importApi.template('account');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'account-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleUploadAndValidate = async () => {
    if (!csv) return;
    try {
      const uploadRes = (await importApi.upload({
        entityType: 'account',
        csvData: csv.raw,
        fileName: fileName || 'accounts.csv',
      })) as { jobId: string };
      const newJobId = uploadRes.jobId;
      setJobId(newJobId);

      const mappings = csv.headers
        .filter((h) => mapping[h])
        .map((h) => ({ sourceColumn: h, targetField: mapping[h]! }));
      await importApi.mapColumns(newJobId, { mappings });

      const validationRes = (await importApi.validate(newJobId)) as {
        validRows: number;
        errors: ImportRowIssue[];
      };
      setValidation(validationRes);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Validation failed');
    }
  };

  const handleExecute = async () => {
    if (!jobId) return;
    setExecuting(true);
    try {
      const res = (await importApi.execute(jobId)) as {
        successRows: number;
        totalRows: number;
        status: string;
      };
      setResult(res);
      toast.success(`Imported ${res.successRows} of ${res.totalRows} accounts`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setExecuting(false);
    }
  };

  const blockingErrors = validation?.errors.filter((e) => e.severity !== 'WARNING') ?? [];
  const dedupeWarnings = validation?.errors.filter((e) => e.severity === 'WARNING') ?? [];

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title="Import Accounts"
        subtitle="Bulk-create CRM accounts from a CSV file"
        backTo="/crm/accounts"
      />

      <div className="bg-surface-card rounded-xl border border-default p-5 space-y-4">
        <Button variant="ghost" size="sm" onClick={handleDownloadTemplate}>
          <Download size={14} className="mr-1.5" /> Download CSV Template
        </Button>

        <div>
          <label
            htmlFor="account-import-file"
            className="block text-sm font-medium text-primary mb-1.5"
          >
            CSV File
          </label>
          <input
            id="account-import-file"
            type="file"
            accept=".csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
            className="block w-full text-sm text-secondary file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-brand file:text-white file:text-sm"
          />
        </div>

        {csv && (
          <>
            <div>
              <h3 className="text-sm font-semibold text-primary mb-2">
                Column Mapping ({csv.rows.length} rows detected)
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {csv.headers.map((h) => (
                  <div key={h} className="flex items-center gap-2">
                    <span className="text-sm text-secondary w-32 truncate" title={h}>
                      {h}
                    </span>
                    <Select
                      value={mapping[h] ?? ''}
                      onChange={(e) => setMapping((prev) => ({ ...prev, [h]: e.target.value }))}
                      className="flex-1"
                    >
                      <option value="">Ignore this column</option>
                      {TARGET_FIELDS.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            {!validation && (
              <Button onClick={handleUploadAndValidate}>
                <Upload size={14} className="mr-1.5" /> Upload &amp; Validate
              </Button>
            )}

            {validation && (
              <div className="rounded-lg border border-default p-4 space-y-3">
                <p className="text-sm text-primary">
                  <span className="font-semibold text-success">{validation.validRows}</span> valid
                  rows,{' '}
                  <span
                    className={`font-semibold ${blockingErrors.length > 0 ? 'text-danger' : 'text-secondary'}`}
                  >
                    {blockingErrors.length}
                  </span>{' '}
                  error rows
                  {dedupeWarnings.length > 0 && (
                    <>
                      {', '}
                      <span className="font-semibold text-warning">
                        {dedupeWarnings.length}
                      </span>{' '}
                      possible duplicate{dedupeWarnings.length === 1 ? '' : 's'}
                    </>
                  )}
                </p>

                {dedupeWarnings.length > 0 && (
                  <div className="rounded-md border border-warning bg-warning-subtle p-3 text-xs text-primary space-y-1 max-h-40 overflow-y-auto">
                    {dedupeWarnings.map((w, i) => (
                      <p key={i}>
                        Row {w.row}: {w.message}
                      </p>
                    ))}
                  </div>
                )}

                {blockingErrors.length > 0 && (
                  <div className="rounded-md border border-danger bg-danger-subtle p-3 text-xs text-primary space-y-1 max-h-40 overflow-y-auto">
                    {blockingErrors.map((e, i) => (
                      <p key={i}>
                        Row {e.row} ({e.column}): {e.message}
                      </p>
                    ))}
                  </div>
                )}

                {!result && (
                  <Button
                    isLoading={executing}
                    disabled={validation.validRows === 0}
                    onClick={handleExecute}
                  >
                    Import {validation.validRows} Accounts
                  </Button>
                )}
              </div>
            )}

            {result && (
              <div className="rounded-lg border border-success bg-success-subtle p-4 text-sm text-primary">
                Imported {result.successRows} of {result.totalRows} rows. Status: {result.status}
              </div>
            )}
          </>
        )}
      </div>

      <ERPStickyFooter>
        <Button variant="secondary" onClick={() => navigate('/crm/accounts')}>
          {result ? 'Done' : 'Cancel'}
        </Button>
      </ERPStickyFooter>
    </div>
  );
}
