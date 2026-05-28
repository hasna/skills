import { basename } from "path";
import { fileToBase64, getMimeType } from "./file-utils";
import { OPENAI_API_URL, getOpenAIApiKey, log } from "./runtime";
import type { InvoiceData, Options } from "./types";

export async function extractInvoiceData(filePath: string, options: Options): Promise<InvoiceData> {
  const openAIApiKey = getOpenAIApiKey();
  if (!openAIApiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  const base64Content = fileToBase64(filePath);
  const mimeType = getMimeType(filePath);

  if (options.verbose) {
    log(`Processing ${basename(filePath)} (${mimeType})...`);
  }

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAIApiKey}`,
    },
    body: JSON.stringify(buildRequestBody(base64Content, mimeType, options)),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${error}`);
  }

  const result = await response.json();
  const content = result.choices[0]?.message?.content;

  if (!content) {
    throw new Error("No response from OpenAI API");
  }

  try {
    return JSON.parse(stripJsonFence(content));
  } catch {
    log(`Failed to parse API response: ${content}`, "error");
    throw new Error("Failed to parse invoice data from API response");
  }
}

function buildRequestBody(base64Content: string, mimeType: string, options: Options): Record<string, unknown> {
  const systemPrompt = `You are an expert invoice data extraction system. Extract all relevant information from the provided invoice image/document and return it as structured JSON.

Be thorough and extract:
- Invoice details (number, dates, PO number, payment terms)
- Vendor information (name, address, contact, tax ID)
- Customer/Bill-to information
- All line items with quantities, prices, and totals
- Tax calculations
- Discounts if any
- Grand total and currency
- Payment information (bank details, references)
- Any notes or special instructions

For amounts, extract numeric values without currency symbols.
For dates, use ISO format (YYYY-MM-DD) when possible.
Estimate your confidence in the extraction (0-100).

${options.language ? `The document is in ${options.language}.` : "Detect the document language automatically."}
${options.currency ? `Convert all amounts to ${options.currency} if possible.` : "Detect and preserve the original currency."}`;

  const userPrompt = `Extract all invoice data from this document and return it as JSON matching this structure:
{
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "due_date": "YYYY-MM-DD or null",
  "po_number": "string or null",
  "payment_terms": "string or null",
  "vendor": {
    "name": "string or null",
    "address": "string or null",
    "phone": "string or null",
    "email": "string or null",
    "tax_id": "string or null",
    "website": "string or null"
  },
  "customer": {
    "name": "string or null",
    "address": "string or null",
    "phone": "string or null",
    "email": "string or null"
  },
  "line_items": [
    {
      "description": "string",
      "quantity": number or null,
      "unit": "string or null",
      "unit_price": number or null,
      "tax_rate": number or null,
      "subtotal": number or null,
      "discount": number or null
    }
  ],
  "subtotal": number or null,
  "tax": {
    "rate": number or null,
    "amount": number,
    "type": "string or null"
  },
  "discount": {
    "type": "percentage or fixed or null",
    "value": number or null,
    "amount": number
  },
  "shipping": number or null,
  "total": number or null,
  "currency": "USD, EUR, etc.",
  "payment_info": {
    "method": "string or null",
    "bank_name": "string or null",
    "account_number": "string or null (masked if sensitive)",
    "routing_number": "string or null",
    "iban": "string or null (masked)",
    "swift": "string or null",
    "reference": "string or null"
  },
  "notes": "string or null",
  "confidence": number (0-100)
}

Return ONLY the JSON object, no markdown formatting or explanation.`;

  return {
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: userPrompt,
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${base64Content}`,
              detail: "high",
            },
          },
        ],
      },
    ],
    max_tokens: 4096,
    temperature: 0.1,
  };
}

function stripJsonFence(content: string): string {
  let jsonString = content.trim();
  if (jsonString.startsWith("```json")) {
    jsonString = jsonString.slice(7);
  } else if (jsonString.startsWith("```")) {
    jsonString = jsonString.slice(3);
  }
  if (jsonString.endsWith("```")) {
    jsonString = jsonString.slice(0, -3);
  }
  return jsonString.trim();
}
