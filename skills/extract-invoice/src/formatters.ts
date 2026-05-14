import { basename } from "path";
import type { ExtractionResult, Options } from "./types";

export function formatAsJSON(results: ExtractionResult[], options: Options): string {
  if (results.length === 1 && !options.batch) {
    const result = results[0];
    if (result.success && result.data) {
      if (!options.confidence) {
        const { confidence, ...dataWithoutConfidence } = result.data;
        return JSON.stringify(dataWithoutConfidence, null, 2);
      }
      return JSON.stringify(result.data, null, 2);
    }
    return JSON.stringify({ error: result.error }, null, 2);
  }

  const output = {
    processed_at: new Date().toISOString(),
    total_files: results.length,
    successful: results.filter((result) => result.success).length,
    failed: results.filter((result) => !result.success).length,
    results: results.map((result) => ({
      file: basename(result.file),
      success: result.success,
      data: result.data,
      error: result.error,
      processing_time_ms: result.processing_time_ms,
    })),
  };

  return JSON.stringify(output, null, 2);
}

export function formatAsCSV(results: ExtractionResult[]): string {
  const headers = [
    "file",
    "invoice_number",
    "invoice_date",
    "due_date",
    "vendor_name",
    "vendor_address",
    "customer_name",
    "subtotal",
    "tax_amount",
    "total",
    "currency",
    "status",
  ];

  const rows: string[][] = [headers];

  for (const result of results) {
    if (result.success && result.data) {
      const data = result.data;
      rows.push([
        basename(result.file),
        data.invoice_number || "",
        data.invoice_date || "",
        data.due_date || "",
        data.vendor.name || "",
        data.vendor.address || "",
        data.customer.name || "",
        data.subtotal?.toString() || "",
        data.tax?.amount?.toString() || "",
        data.total?.toString() || "",
        data.currency || "",
        "success",
      ]);
    } else {
      rows.push([basename(result.file), "", "", "", "", "", "", "", "", "", "", `error: ${result.error}`]);
    }
  }

  return rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
}

export function formatAsMarkdown(results: ExtractionResult[], options: Options): string {
  let output = "# Invoice Extraction Results\n\n";
  output += `Processed: ${new Date().toISOString()}\n\n`;

  for (const result of results) {
    output += "---\n\n";
    output += `## ${basename(result.file)}\n\n`;

    if (!result.success) {
      output += `**Error:** ${result.error}\n\n`;
      continue;
    }

    const data = result.data!;

    output += "### Invoice Details\n\n";
    output += "| Field | Value |\n";
    output += "|-------|-------|\n";
    output += `| Invoice Number | ${data.invoice_number || "N/A"} |\n`;
    output += `| Date | ${data.invoice_date || "N/A"} |\n`;
    output += `| Due Date | ${data.due_date || "N/A"} |\n`;
    output += `| PO Number | ${data.po_number || "N/A"} |\n`;
    output += `| Payment Terms | ${data.payment_terms || "N/A"} |\n\n`;

    output += "### Vendor\n\n";
    output += `**${data.vendor.name || "Unknown Vendor"}**\n`;
    if (data.vendor.address) output += `${data.vendor.address}\n`;
    if (data.vendor.email) output += `Email: ${data.vendor.email}\n`;
    if (data.vendor.phone) output += `Phone: ${data.vendor.phone}\n`;
    if (data.vendor.tax_id) output += `Tax ID: ${data.vendor.tax_id}\n`;
    output += "\n";

    if (data.customer.name) {
      output += "### Customer\n\n";
      output += `**${data.customer.name}**\n`;
      if (data.customer.address) output += `${data.customer.address}\n`;
      if (data.customer.email) output += `Email: ${data.customer.email}\n`;
      output += "\n";
    }

    if (data.line_items.length > 0) {
      output += "### Line Items\n\n";
      output += "| Description | Qty | Unit Price | Subtotal |\n";
      output += "|-------------|-----|------------|----------|\n";
      for (const item of data.line_items) {
        output += `| ${item.description} | ${item.quantity || "-"} ${item.unit || ""} | ${item.unit_price?.toFixed(2) || "-"} | ${item.subtotal?.toFixed(2) || "-"} |\n`;
      }
      output += "\n";
    }

    output += "### Totals\n\n";
    if (data.subtotal) output += `- **Subtotal:** ${data.currency} ${data.subtotal.toFixed(2)}\n`;
    if (data.tax) output += `- **Tax${data.tax.rate ? ` (${data.tax.rate}%)` : ""}:** ${data.currency} ${data.tax.amount.toFixed(2)}\n`;
    if (data.discount) output += `- **Discount:** -${data.currency} ${data.discount.amount.toFixed(2)}\n`;
    if (data.shipping) output += `- **Shipping:** ${data.currency} ${data.shipping.toFixed(2)}\n`;
    output += `- **Total:** ${data.currency} ${data.total?.toFixed(2) || "N/A"}\n\n`;

    if (data.notes) {
      output += `### Notes\n\n${data.notes}\n\n`;
    }

    if (options.confidence) {
      output += `*Extraction confidence: ${data.confidence}%*\n\n`;
    }
  }

  return output;
}
