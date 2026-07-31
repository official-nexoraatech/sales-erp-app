import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Download, Upload } from 'lucide-react';
import { importApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Button from '../../components/ui/Button.js';
import Select from '../../components/ui/Select.js';

// Purchase audit 2026-07-21 gap-fix: drives scheduler-service's existing ImportEngine
// (upload -> map -> validate -> execute), which already fully supported 'supplier' but had
// zero frontend anywhere in the app. Kept intentionally single-flow (auto-map, then one
// validate+execute pass) rather than a multi-step wizard — the underlying engine supports
// more (SSE progress, rollback), but this is the 80% case for a first-time supplier import.

const TARGET_FIELDS = ['name', 'phone', 'email', 'gstin', 'openingBalance'];

interface ParsedCsv {
  headers: string[];
  rows: string[][];
  raw: string;
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

export default function SupplierImportPage() {
  const navigate = useNavigate();
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [jobId, setJobId] = useState<string | null>(null);
  const [validation, setValidation] = useState<{
    validRows: number;
    errorRows: number;
    errors: unknown[];
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
    const blob = await importApi.template('supplier');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'supplier-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleUploadAndValidate = async () => {
    if (!csv) return;
    try {
      const uploadRes = (await importApi.upload({
        entityType: 'supplier',
        csvData: csv.raw,
        fileName: fileName || 'suppliers.csv',
      })) as { jobId: string };
      const newJobId = uploadRes.jobId;
      setJobId(newJobId);

      const mappings = csv.headers
        .filter((h) => mapping[h])
        .map((h) => ({ sourceColumn: h, targetField: mapping[h]! }));
      await importApi.mapColumns(newJobId, { mappings });

      const validationRes = (await importApi.validate(newJobId)) as {
        validRows: number;
        errorRows: number;
        errors: unknown[];
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
      toast.success(`Imported ${res.successRows} of ${res.totalRows} suppliers`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title="Import Suppliers"
        subtitle="Bulk-create suppliers from a CSV file"
        backTo="/suppliers"
      />

      <div className="bg-surface-card rounded-xl border border-default p-5 space-y-4">
        <Button variant="ghost" size="sm" onClick={handleDownloadTemplate}>
          <Download size={14} className="mr-1.5" /> Download CSV Template
        </Button>

        <div>
          <label
            htmlFor="supplier-import-file"
            className="block text-sm font-medium text-primary mb-1.5"
          >
            CSV File
          </label>
          <input
            id="supplier-import-file"
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
              <div className="rounded-lg border border-default p-4">
                <p className="text-sm text-primary">
                  <span className="font-semibold text-success">{validation.validRows}</span> valid
                  rows,{' '}
                  <span
                    className={`font-semibold ${validation.errorRows > 0 ? 'text-danger' : 'text-secondary'}`}
                  >
                    {validation.errorRows}
                  </span>{' '}
                  error rows
                </p>
                {!result && (
                  <Button
                    className="mt-3"
                    isLoading={executing}
                    disabled={validation.validRows === 0}
                    onClick={handleExecute}
                  >
                    Import {validation.validRows} Suppliers
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
        <Button variant="secondary" onClick={() => navigate('/suppliers')}>
          {result ? 'Done' : 'Cancel'}
        </Button>
      </ERPStickyFooter>
    </div>
  );
}
