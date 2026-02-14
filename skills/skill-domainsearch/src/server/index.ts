/**
 * HTTP Server for service-domainsearch
 * Exposes domain search functionality as REST API
 */

import { domainApi, formatPrice } from "../lib/api-client";
import { loadConfig, saveConfig } from "../lib/config";

const PORT = parseInt(process.env.PORT || "3000");
const API_KEY = process.env.API_KEY || "";
const PATH_PREFIX = "/domainsearch";

// API Key validation
function validateApiKey(req: Request): boolean {
  if (!API_KEY) { console.warn("WARNING: API_KEY not set - all requests rejected"); return false; }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;

  return authHeader.slice(7) === API_KEY;
}

// CORS headers
function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { searchParams } = url;
  const method = req.method;

  // Strip path prefix if present (for ALB routing)
  let pathname = url.pathname;
  if (pathname.startsWith(PATH_PREFIX)) {
    pathname = pathname.slice(PATH_PREFIX.length) || "/";
  }

  // Handle CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  try {
    // Health check (no auth required)
    if (pathname === "/health" && method === "GET") {
      return Response.json(
        {
          status: "ok",
          service: "service-domainsearch",
          timestamp: new Date().toISOString(),
        },
        { headers: corsHeaders() }
      );
    }

    // All routes below require authentication
    if (!validateApiKey(req)) {
      return Response.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders() }
      );
    }

    // Check single domain availability
    // GET /check?domain=example.com&type=REGISTRATION&period=1
    if (pathname === "/check" && method === "GET") {
      const domain = searchParams.get("domain");
      if (!domain) {
        return Response.json(
          { error: "domain parameter is required" },
          { status: 400, headers: corsHeaders() }
        );
      }

      const type = (searchParams.get("type") as "REGISTRATION" | "RENEWAL" | "TRANSFER") || "REGISTRATION";
      const period = parseInt(searchParams.get("period") || "1");

      const result = await domainApi.checkAvailability(domain, type, period);
      return Response.json(
        {
          ...result,
          priceFormatted: result.price ? formatPrice(result.price, result.currency) : null,
        },
        { headers: corsHeaders() }
      );
    }

    // Bulk domain availability check
    // POST /bulk { domains: ["domain1.com", "domain2.com"] }
    if (pathname === "/bulk" && method === "POST") {
      const body = await req.json();
      if (!body.domains || !Array.isArray(body.domains)) {
        return Response.json(
          { error: "domains array is required" },
          { status: 400, headers: corsHeaders() }
        );
      }

      const result = await domainApi.checkBulkAvailability(body.domains);
      return Response.json(
        {
          ...result,
          domains: result.domains?.map((d) => ({
            ...d,
            priceFormatted: d.price ? formatPrice(d.price, d.currency) : null,
          })),
        },
        { headers: corsHeaders() }
      );
    }

    // Search across TLDs
    // GET /search?name=example&tlds=com,net,org
    if (pathname === "/search" && method === "GET") {
      const name = searchParams.get("name");
      if (!name) {
        return Response.json(
          { error: "name parameter is required" },
          { status: 400, headers: corsHeaders() }
        );
      }

      const tldsParam = searchParams.get("tlds") || "com,net,org,io,co,ai,dev";
      const tlds = tldsParam.split(",").map((t) => t.trim());
      const domains = tlds.map((tld) => `${name}.${tld}`);

      const result = await domainApi.checkBulkAvailability(domains);
      const available = result.domains?.filter((d) => d.available) || [];
      available.sort((a, b) => (a.price || 0) - (b.price || 0));

      return Response.json(
        {
          query: name,
          tlds,
          available: available.map((d) => ({
            ...d,
            priceFormatted: d.price ? formatPrice(d.price, d.currency) : null,
          })),
          taken: result.domains?.filter((d) => !d.available) || [],
          errors: result.errors,
        },
        { headers: corsHeaders() }
      );
    }

    // List owned domains
    // GET /list?limit=100
    if (pathname === "/list" && method === "GET") {
      const limit = parseInt(searchParams.get("limit") || "100");
      const domains = await domainApi.listOwnedDomains(limit);
      return Response.json({ domains, count: domains.length }, { headers: corsHeaders() });
    }

    // Get domain details
    // GET /info?domain=example.com
    if (pathname === "/info" && method === "GET") {
      const domain = searchParams.get("domain");
      if (!domain) {
        return Response.json(
          { error: "domain parameter is required" },
          { status: 400, headers: corsHeaders() }
        );
      }

      const details = await domainApi.getDomainDetails(domain);
      return Response.json(details, { headers: corsHeaders() });
    }

    // Get supported TLDs
    // GET /tlds?limit=50
    if (pathname === "/tlds" && method === "GET") {
      const limit = parseInt(searchParams.get("limit") || "50");
      const tlds = await domainApi.listTlds();
      return Response.json(
        { tlds: tlds.slice(0, limit), total: tlds.length },
        { headers: corsHeaders() }
      );
    }

    // Get domain suggestions
    // GET /suggest?query=mycompany&limit=20
    if (pathname === "/suggest" && method === "GET") {
      const query = searchParams.get("query");
      if (!query) {
        return Response.json(
          { error: "query parameter is required" },
          { status: 400, headers: corsHeaders() }
        );
      }

      const limit = parseInt(searchParams.get("limit") || "20");
      const suggestions = await domainApi.getSuggestions(query, limit);
      return Response.json({ suggestions }, { headers: corsHeaders() });
    }

    return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders() });
  } catch (error) {
    console.error("Request error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}

const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
});

console.log(`Service-Domainsearch server running at http://localhost:${PORT}`);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down gracefully...");
  server.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\nShutting down gracefully...");
  server.stop();
  process.exit(0);
});
