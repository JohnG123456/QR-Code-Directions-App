"use client";

import { useState } from "react";
import Papa from "papaparse";
import type { ImportResult } from "@/app/(admin)/admin/(protected)/resorts/[resortId]/sites/actions";

const TEMPLATE = "site_number,label,latitude,longitude\n42,Lakeview Cabin,-31.9505,115.8605\n";

interface Row {
  site_number: string;
  label: string;
  latitude: string;
  longitude: string;
}

function validateRow(row: Row): string | null {
  if (!row.site_number?.trim()) return "Missing site_number";
  const lat = Number(row.latitude);
  const lng = Number(row.longitude);
  if (Number.isNaN(lat) || lat < -90 || lat > 90) return "Invalid latitude";
  if (Number.isNaN(lng) || lng < -180 || lng > 180) return "Invalid longitude";
  return null;
}

export function CsvImportTool({
  resortId,
  bulkUpsertSites,
}: {
  resortId: string;
  bulkUpsertSites: (resortId: string, rows: Record<string, string>[]) => Promise<ImportResult>;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  function handleFile(file: File) {
    setFileName(file.name);
    setResult(null);
    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => setRows(results.data),
    });
  }

  async function handleImport() {
    setIsImporting(true);
    const res = await bulkUpsertSites(resortId, rows as unknown as Record<string, string>[]);
    setResult(res);
    setIsImporting(false);
  }

  const validCount = rows.filter((r) => !validateRow(r)).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-4">
        <p className="text-sm">
          CSV columns: <code>site_number, label, latitude, longitude</code>
        </p>
        <a
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
          download="sites-template.csv"
          className="w-fit text-sm text-neutral-900 underline"
        >
          Download template
        </a>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="text-sm"
        />
      </div>

      {fileName && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-neutral-600">
            {fileName}: {rows.length} rows, {validCount} valid
          </p>

          <div className="max-h-64 overflow-auto rounded-md border border-neutral-200">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 border-b border-neutral-200 bg-neutral-50">
                <tr>
                  <th className="px-3 py-2">Site #</th>
                  <th className="px-3 py-2">Label</th>
                  <th className="px-3 py-2">Lat</th>
                  <th className="px-3 py-2">Lng</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rows.map((row, i) => {
                  const error = validateRow(row);
                  return (
                    <tr key={i} className={error ? "bg-red-50" : undefined}>
                      <td className="px-3 py-1.5">{row.site_number}</td>
                      <td className="px-3 py-1.5">{row.label}</td>
                      <td className="px-3 py-1.5">{row.latitude}</td>
                      <td className="px-3 py-1.5">{row.longitude}</td>
                      <td className="px-3 py-1.5 text-red-700">{error ?? "OK"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={handleImport}
            disabled={validCount === 0 || isImporting}
            className="w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isImporting ? "Importing..." : `Import ${validCount} sites`}
          </button>

          {result && (
            <div className="text-sm">
              <p className="text-green-700">Imported/updated {result.inserted} sites.</p>
              {result.errors.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-red-600">
                  {result.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
