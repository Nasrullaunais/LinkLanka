import * as XLSX from 'xlsx';
import { BadRequestException } from '@nestjs/common';

/**
 * MIME types for Excel spreadsheets — both modern (.xlsx) and legacy (.xls).
 */
export const EXCEL_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
] as const;

/**
 * Check whether a MIME type represents an Excel spreadsheet.
 */
export function isExcelMimeType(mimeType?: string): boolean {
  return EXCEL_MIME_TYPES.includes(mimeType as (typeof EXCEL_MIME_TYPES)[number]);
}

/**
 * Convert an Excel workbook buffer to a CSV string.
 *
 * Each sheet is prepended with a `## Sheet: {name}` header.
 * Caps at `maxSheets` sheets (default 10) — sheets beyond the cap are silently dropped.
 *
 * @throws {BadRequestException} if the file is password-protected or corrupted.
 */
export function convertExcelToCsv(
  fileBuffer: Buffer,
  maxSheets = 10,
): string {
  let workbook: XLSX.WorkBook;

  try {
    workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === '2038' || e.code === '2036') {
      throw new BadRequestException('password-protected');
    }
    throw new BadRequestException('corrupted or unsupported format');
  }

  const sheetsToProcess = workbook.SheetNames.slice(0, maxSheets);

  const csvParts = sheetsToProcess.map(
    (sheetName) =>
      `## Sheet: ${sheetName}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName])}`,
  );

  return csvParts.join('\n\n');
}
