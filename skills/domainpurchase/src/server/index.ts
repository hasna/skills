/**
 * HTTP Server for service-domainpurchase
 * Exposes domain purchase functionality as REST API
 */

import { purchaseApi, formatPrice, type Contact } from "../lib/api-client";
import { loadConfig, saveConfig } from "../lib/config";

const PORT = parseInt(process.env.PORT || "3000");
const API_KEY = process.env.API_KEY || "";
const PATH_PREFIX = "/domainpurchase";

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
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
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
          service: "service-domainpurchase",
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

    // Check domain availability
    // GET /check?domain=example.com&transfer=false
    if (pathname === "/check" && method === "GET") {
      const domain = searchParams.get("domain");
      if (!domain) {
        return Response.json(
          { error: "domain parameter is required" },
          { status: 400, headers: corsHeaders() }
        );
      }

      const transfer = searchParams.get("transfer") === "true";
      const result = await purchaseApi.checkAvailability(domain, transfer);
      return Response.json(
        {
          ...result,
          priceFormatted: result.price ? formatPrice(result.price, result.currency) : null,
        },
        { headers: corsHeaders() }
      );
    }

    // Get legal agreements for TLDs
    // GET /agreements?tlds=com,net&privacy=true
    if (pathname === "/agreements" && method === "GET") {
      const tldsParam = searchParams.get("tlds");
      if (!tldsParam) {
        return Response.json(
          { error: "tlds parameter is required" },
          { status: 400, headers: corsHeaders() }
        );
      }

      const tlds = tldsParam.split(",").map((t) => t.trim());
      const privacy = searchParams.get("privacy") === "true";
      const agreements = await purchaseApi.getAgreements(tlds, privacy);
      return Response.json({ agreements }, { headers: corsHeaders() });
    }

    // Validate purchase request (dry run)
    // POST /validate { domain, contact, period, privacy, autoRenew }
    if (pathname === "/validate" && method === "POST") {
      const body = await req.json();
      if (!body.domain) {
        return Response.json(
          { error: "domain is required" },
          { status: 400, headers: corsHeaders() }
        );
      }

      // Get TLD from domain
      const tld = body.domain.split(".").slice(1).join(".");
      const agreements = await purchaseApi.getAgreements([tld], body.privacy);
      const agreementKeys = agreements.map((a: any) => a.agreementKey);

      // Get public IP for consent
      const ipResponse = await fetch("https://api.ipify.org?format=json");
      const ipData = (await ipResponse.json()) as { ip: string };

      const request = {
        domain: body.domain,
        consent: {
          agreedAt: new Date().toISOString(),
          agreedBy: ipData.ip,
          agreementKeys,
        },
        contactRegistrant: body.contact || getDefaultContact(),
        period: body.period || 1,
        privacy: body.privacy || false,
        renewAuto: body.autoRenew || false,
      };

      const result = await purchaseApi.validatePurchase(request);
      return Response.json(result, { headers: corsHeaders() });
    }

    // Purchase domain (CAUTION: This actually purchases!)
    // POST /purchase { domain, contact, period, privacy, autoRenew, nameservers }
    if (pathname === "/purchase" && method === "POST") {
      const body = await req.json();
      if (!body.domain || !body.contact) {
        return Response.json(
          { error: "domain and contact are required" },
          { status: 400, headers: corsHeaders() }
        );
      }

      // Check availability first
      const availability = await purchaseApi.checkAvailability(body.domain);
      if (!availability.available) {
        return Response.json(
          { error: `${body.domain} is not available for registration` },
          { status: 400, headers: corsHeaders() }
        );
      }

      // Get TLD from domain
      const tld = body.domain.split(".").slice(1).join(".");
      const agreements = await purchaseApi.getAgreements([tld], body.privacy);
      const agreementKeys = agreements.map((a: any) => a.agreementKey);

      // Get public IP for consent
      const ipResponse = await fetch("https://api.ipify.org?format=json");
      const ipData = (await ipResponse.json()) as { ip: string };

      const request = {
        domain: body.domain,
        consent: {
          agreedAt: new Date().toISOString(),
          agreedBy: ipData.ip,
          agreementKeys,
        },
        contactRegistrant: body.contact,
        contactAdmin: body.contact,
        contactBilling: body.contact,
        contactTech: body.contact,
        period: body.period || 1,
        privacy: body.privacy || false,
        renewAuto: body.autoRenew || false,
        ...(body.nameservers && { nameServers: body.nameservers }),
      };

      const result = await purchaseApi.purchaseDomain(request);
      return Response.json(result, { status: 201, headers: corsHeaders() });
    }

    // List owned domains
    // GET /list?limit=100
    if (pathname === "/list" && method === "GET") {
      const limit = parseInt(searchParams.get("limit") || "100");
      const domains = await purchaseApi.listOwnedDomains(limit);
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

      const details = await purchaseApi.getDomainDetails(domain);
      return Response.json(details, { headers: corsHeaders() });
    }

    // Update domain settings
    // PUT /update?domain=example.com { autoRenew, privacy, nameservers }
    if (pathname === "/update" && method === "PUT") {
      const domain = searchParams.get("domain");
      if (!domain) {
        return Response.json(
          { error: "domain parameter is required" },
          { status: 400, headers: corsHeaders() }
        );
      }

      const body = await req.json();
      const updates: any = {};

      if (body.autoRenew !== undefined) {
        updates.renewAuto = body.autoRenew;
      }
      if (body.privacy !== undefined) {
        updates.privacy = body.privacy;
      }
      if (body.nameservers) {
        updates.nameServers = body.nameservers;
      }

      const result = await purchaseApi.updateDomain(domain, updates);
      return Response.json(result, { headers: corsHeaders() });
    }

    // Renew domain
    // POST /renew { domain, period }
    if (pathname === "/renew" && method === "POST") {
      const body = await req.json();
      if (!body.domain) {
        return Response.json(
          { error: "domain is required" },
          { status: 400, headers: corsHeaders() }
        );
      }

      const result = await purchaseApi.renewDomain(body.domain, body.period || 1);
      return Response.json(result, { headers: corsHeaders() });
    }

    // Get contact template
    // GET /contact-template
    if (pathname === "/contact-template" && method === "GET") {
      return Response.json(
        {
          template: {
            nameFirst: "John",
            nameLast: "Doe",
            email: "john.doe@example.com",
            phone: "+1.5551234567",
            organization: "Example Corp",
            addressMailing: {
              address1: "123 Main Street",
              address2: "Suite 100",
              city: "San Francisco",
              state: "CA",
              postalCode: "94102",
              country: "US",
            },
            encoding: "UTF-8",
          },
        },
        { headers: corsHeaders() }
      );
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

function getDefaultContact(): Contact {
  return {
    nameFirst: "Test",
    nameLast: "User",
    email: "test@example.com",
    phone: "+1.5555555555",
    addressMailing: {
      address1: "123 Test St",
      city: "Test City",
      state: "CA",
      postalCode: "90210",
      country: "US",
    },
    encoding: "UTF-8",
  };
}

const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
});

console.log(`Service-Domainpurchase server running at http://localhost:${PORT}`);

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
