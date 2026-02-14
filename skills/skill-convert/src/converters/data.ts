/**
 * Data format conversion utilities (CSV, Excel, JSON, YAML)
 */

import ExcelJS from 'exceljs';
import { parse as csvParse } from 'csv-parse/sync';
import { stringify as csvStringify } from 'csv-stringify/sync';
import { readFile, writeFile, stat } from 'fs/promises';
import { extname, basename, dirname, join } from 'path';
import * as yaml from 'yaml';
import type { ConvertOptions, ConvertResult } from '../types';

/**
 * Parse CSV file to array of objects
 */
export async function parseCsv(filePath: string): Promise<Record<string, string>[]> {
  const content = await readFile(filePath, 'utf-8');
  return csvParse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

/**
 * Parse TSV file to array of objects
 */
export async function parseTsv(filePath: string): Promise<Record<string, string>[]> {
  const content = await readFile(filePath, 'utf-8');
  return csvParse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    delimiter: '\t',
  });
}

/**
 * Convert CSV to JSON
 */
export async function csvToJson(csvPath: string): Promise<string> {
  const data = await parseCsv(csvPath);
  return JSON.stringify(data, null, 2);
}

/**
 * Convert JSON to CSV
 */
export async function jsonToCsv(jsonPath: string): Promise<string> {
  const content = await readFile(jsonPath, 'utf-8');
  const data = JSON.parse(content);

  if (!Array.isArray(data)) {
    throw new Error('JSON must be an array of objects to convert to CSV');
  }

  return csvStringify(data, {
    header: true,
  });
}

/**
 * Convert CSV to Excel
 */
export async function csvToExcel(csvPath: string, outputPath: string): Promise<void> {
  const data = await parseCsv(csvPath);
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');

  if (data.length > 0) {
    // Add headers
    const headers = Object.keys(data[0]);
    worksheet.addRow(headers);

    // Style headers
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    // Add data rows
    data.forEach((row) => {
      worksheet.addRow(headers.map((h) => row[h]));
    });

    // Auto-fit columns
    worksheet.columns.forEach((column) => {
      let maxLength = 0;
      column.eachCell?.({ includeEmpty: true }, (cell) => {
        const cellLength = cell.value ? String(cell.value).length : 10;
        maxLength = Math.max(maxLength, cellLength);
      });
      column.width = Math.min(maxLength + 2, 50);
    });
  }

  await workbook.xlsx.writeFile(outputPath);
}

/**
 * Convert Excel to CSV
 */
export async function excelToCsv(excelPath: string): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(excelPath);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('No worksheets found in Excel file');
  }

  const rows: string[][] = [];
  worksheet.eachRow((row, rowNumber) => {
    const rowData: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      rowData[colNumber - 1] = cell.text || '';
    });
    rows.push(rowData);
  });

  return csvStringify(rows);
}

/**
 * Convert Excel to JSON
 */
export async function excelToJson(excelPath: string): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(excelPath);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('No worksheets found in Excel file');
  }

  const rows: Record<string, string>[] = [];
  let headers: string[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      // First row is headers
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        headers[colNumber - 1] = cell.text || `Column${colNumber}`;
      });
    } else {
      const rowData: Record<string, string> = {};
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const header = headers[colNumber - 1] || `Column${colNumber}`;
        rowData[header] = cell.text || '';
      });
      rows.push(rowData);
    }
  });

  return JSON.stringify(rows, null, 2);
}

/**
 * Convert JSON to YAML
 */
export async function jsonToYaml(jsonPath: string): Promise<string> {
  const content = await readFile(jsonPath, 'utf-8');
  const data = JSON.parse(content);
  return yaml.stringify(data);
}

/**
 * Convert YAML to JSON
 */
export async function yamlToJson(yamlPath: string): Promise<string> {
  const content = await readFile(yamlPath, 'utf-8');
  const data = yaml.parse(content);
  return JSON.stringify(data, null, 2);
}

/**
 * Convert data format
 */
export async function convertData(options: ConvertOptions): Promise<ConvertResult> {
  const startTime = Date.now();
  const inputStat = await stat(options.input);
  const inputExt = extname(options.input).slice(1).toLowerCase();

  const outputPath = options.output || join(
    dirname(options.input),
    `${basename(options.input, extname(options.input))}.${options.format}`
  );

  try {
    let content: string | undefined;

    // CSV conversions
    if (inputExt === 'csv') {
      switch (options.format) {
        case 'json':
          content = await csvToJson(options.input);
          break;
        case 'xlsx':
          await csvToExcel(options.input, outputPath);
          break;
        case 'yaml':
          const csvData = await parseCsv(options.input);
          content = yaml.stringify(csvData);
          break;
        case 'tsv':
          const csvContent = await parseCsv(options.input);
          content = csvStringify(csvContent, { header: true, delimiter: '\t' });
          break;
        default:
          throw new Error(`Cannot convert CSV to ${options.format}`);
      }
    }
    // TSV conversions
    else if (inputExt === 'tsv') {
      switch (options.format) {
        case 'csv':
          const tsvData = await parseTsv(options.input);
          content = csvStringify(tsvData, { header: true });
          break;
        case 'json':
          const tsvJson = await parseTsv(options.input);
          content = JSON.stringify(tsvJson, null, 2);
          break;
        case 'xlsx':
          // Convert TSV to CSV first, then to Excel
          const tsvCsv = await parseTsv(options.input);
          const tempCsv = csvStringify(tsvCsv, { header: true });
          const tempPath = options.input + '.temp.csv';
          await writeFile(tempPath, tempCsv);
          await csvToExcel(tempPath, outputPath);
          await Bun.file(tempPath).text().then(() => {}).catch(() => {});
          break;
        default:
          throw new Error(`Cannot convert TSV to ${options.format}`);
      }
    }
    // Excel conversions
    else if (inputExt === 'xlsx' || inputExt === 'xls') {
      switch (options.format) {
        case 'csv':
          content = await excelToCsv(options.input);
          break;
        case 'json':
          content = await excelToJson(options.input);
          break;
        case 'yaml':
          const xlsJson = await excelToJson(options.input);
          content = yaml.stringify(JSON.parse(xlsJson));
          break;
        case 'tsv':
          const xlsCsv = await excelToCsv(options.input);
          // Replace commas with tabs (simple conversion)
          const rows = csvParse(xlsCsv);
          content = rows.map((row: string[]) => row.join('\t')).join('\n');
          break;
        default:
          throw new Error(`Cannot convert Excel to ${options.format}`);
      }
    }
    // JSON conversions
    else if (inputExt === 'json') {
      switch (options.format) {
        case 'csv':
          content = await jsonToCsv(options.input);
          break;
        case 'yaml':
          content = await jsonToYaml(options.input);
          break;
        case 'xlsx':
          // JSON to CSV to Excel
          const jsonCsv = await jsonToCsv(options.input);
          const tempCsvPath = options.input + '.temp.csv';
          await writeFile(tempCsvPath, jsonCsv);
          await csvToExcel(tempCsvPath, outputPath);
          break;
        default:
          throw new Error(`Cannot convert JSON to ${options.format}`);
      }
    }
    // YAML conversions
    else if (inputExt === 'yaml' || inputExt === 'yml') {
      switch (options.format) {
        case 'json':
          content = await yamlToJson(options.input);
          break;
        case 'csv':
          const yamlJson = await yamlToJson(options.input);
          const yamlData = JSON.parse(yamlJson);
          if (!Array.isArray(yamlData)) {
            throw new Error('YAML must contain an array to convert to CSV');
          }
          content = csvStringify(yamlData, { header: true });
          break;
        default:
          throw new Error(`Cannot convert YAML to ${options.format}`);
      }
    }
    // XML conversions (basic)
    else if (inputExt === 'xml') {
      throw new Error('XML conversion not yet implemented');
    }
    else {
      throw new Error(`Unsupported input format: ${inputExt}`);
    }

    // Write content if not already written (Excel writes directly)
    if (content !== undefined) {
      await writeFile(outputPath, content);
    }

    const outputStat = await stat(outputPath);

    return {
      success: true,
      input: options.input,
      output: outputPath,
      inputFormat: inputExt,
      outputFormat: options.format,
      inputSize: inputStat.size,
      outputSize: outputStat.size,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      input: options.input,
      output: outputPath,
      inputFormat: inputExt,
      outputFormat: options.format,
      inputSize: inputStat.size,
      outputSize: 0,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}
