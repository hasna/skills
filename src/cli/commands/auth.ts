import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "readline";
import { getAuthConfig, saveAuthConfig, clearAuthConfig, getApiUrl } from "../../lib/auth-store.js";

const isTTY = process.stdin.isTTY && process.stdout.isTTY;
const DEFAULT_DEVICE_POLL_TIMEOUT_MS = 10 * 60 * 1000;

const MAX_ERROR_DETAIL_LENGTH = 200;
const CONFIG_HINT_STATUSES = new Set([401, 403, 404, 405, 501]);

class HostedApiError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly detail?: string;
  readonly endpoint?: string;
  readonly apiUrl?: string;

  constructor(
    message: string,
    options: { status?: number; code?: string; detail?: string; endpoint?: string; apiUrl?: string } = {},
  ) {
    super(message);
    this.name = "HostedApiError";
    this.status = options.status;
    this.code = options.code;
    this.detail = options.detail;
    this.endpoint = options.endpoint;
    this.apiUrl = options.apiUrl;
  }
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// The configured API URL may embed credentials (https://user:pass@host); never echo those.
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.username && !parsed.password) return url;
    parsed.username = "";
    parsed.password = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return url;
  }
}

async function apiRequest(path: string, options?: RequestInit) {
  // Throws MissingApiUrlError when nothing is configured. Credentials are never
  // sent to a default host, so the command fails before any request is made.
  const url = getApiUrl(`${(options?.method || "GET").toUpperCase()} ${path}`);
  const safeUrl = redactUrl(url);
  const endpoint = `${(options?.method || "GET").toUpperCase()} ${safeUrl}${path}`;
  let res: Response;
  try {
    res = await fetch(`${url}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
    });
  } catch (err) {
    throw new HostedApiError(`Unable to reach the Skills API: ${(err as Error).message}`, {
      endpoint,
      apiUrl: safeUrl,
    });
  }

  const text = await res.text();
  const body = text ? parseJsonBody(text) : {};
  if (!res.ok) {
    const record = isRecord(body) ? body : {};
    const detail = typeof record.detail === "string" ? record.detail : undefined;
    const error = typeof record.error === "string" ? record.error : undefined;
    const code = typeof record.code === "string" ? record.code : undefined;
    throw new HostedApiError(detail || error || `${res.status} ${res.statusText}`, {
      status: res.status,
      code,
      detail,
      endpoint,
      apiUrl: safeUrl,
    });
  }

  return body as any;
}

function parseJsonBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { detail: condenseErrorBody(text) };
  }
}

// Error bodies are frequently HTML pages from a proxy/CDN rather than API JSON.
// Dumping the raw page hides the real message, so keep a short single-line summary.
function condenseErrorBody(text: string): string {
  const stripped = /<[a-z!/]/i.test(text)
    ? text
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]*>/g, " ")
    : text;
  const collapsed = stripped.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_ERROR_DETAIL_LENGTH) return collapsed;
  return `${collapsed.slice(0, MAX_ERROR_DETAIL_LENGTH - 1).trimEnd()}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function commandErrorPayload(err: unknown, fallback: string): Record<string, unknown> {
  if (err instanceof HostedApiError) {
    return {
      error: err.message || fallback,
      ...(err.status !== undefined ? { status: err.status } : {}),
      ...(err.code ? { code: err.code } : {}),
      ...(err.detail && err.detail !== err.message ? { detail: err.detail } : {}),
      ...(err.endpoint ? { endpoint: err.endpoint } : {}),
      ...(err.apiUrl ? { apiUrl: err.apiUrl } : {}),
    };
  }
  const code = isRecord(err) && typeof err.code === "string" ? err.code : undefined;
  return {
    error: (err as Error)?.message || fallback,
    ...(code ? { code } : {}),
  };
}

function writeCommandError(err: unknown, fallback: string, json?: boolean): void {
  const payload = commandErrorPayload(err, fallback);
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    process.exitCode = 1;
    return;
  }

  const message = String(payload.detail || payload.error || fallback);
  const status = typeof payload.status === "number" ? payload.status : undefined;
  const showStatus = status !== undefined && !message.startsWith(String(status));
  console.error(chalk.red(showStatus ? `${message} (HTTP ${status})` : message));
  if (payload.endpoint) console.error(chalk.dim(`Endpoint: ${payload.endpoint}`));
  if (status !== undefined && CONFIG_HINT_STATUSES.has(status)) {
    console.error(chalk.dim(`Hint: check SKILLS_API_URL (currently ${payload.apiUrl}) or run: skills setup`));
  }
  process.exitCode = 1;
}

function envApiKey(): string | null {
  const key = process.env.SKILLS_API_KEY || process.env.SKILL_API_KEY;
  const trimmed = key?.trim();
  return trimmed || null;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function recordField(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function authIdentityPayload(
  authSource: "stored" | "env",
  live: unknown,
  cached?: ReturnType<typeof getAuthConfig>,
  offline = false,
): Record<string, unknown> {
  const root = recordField(live) ?? {};
  const data = recordField(root.data);
  const user = recordField(root.user) ?? recordField(data?.user);
  const organization = recordField(root.organization) ?? recordField(root.org) ?? recordField(data?.organization);
  const email = stringField(user?.email) ?? cached?.email;
  const orgSlug = stringField(organization?.slug) ?? cached?.orgSlug;
  const orgName = stringField(organization?.name);
  const userId = stringField(user?.id) ?? cached?.userId;
  const orgId = stringField(organization?.id) ?? cached?.orgId;
  const role = stringField(user?.role);

  return {
    status: "authenticated",
    authSource,
    ...(offline ? { offline: true } : {}),
    ...(email ? { email } : {}),
    ...(orgSlug ? { organization: orgSlug } : {}),
    ...(orgName ? { organizationName: orgName } : {}),
    ...(userId ? { userId } : {}),
    ...(orgId ? { orgId } : {}),
    ...(role ? { role } : {}),
  };
}

function printWhoami(payload: Record<string, unknown>): void {
  if (payload.email) console.log(chalk.bold("Email:  ") + payload.email);
  if (payload.organization) console.log(chalk.bold("Org:    ") + payload.organization);
  if (payload.role) console.log(chalk.bold("Role:   ") + payload.role);
  if (payload.organizationName) console.log(chalk.bold("Name:   ") + payload.organizationName);
  if (payload.authSource === "env") console.log(chalk.dim("Auth:   SKILLS_API_KEY"));
  if (payload.offline) console.log(chalk.dim("(offline — showing cached info)"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function browserCommand(url: string): string[] | null {
  if (process.platform === "darwin") return ["open", url];
  if (process.platform === "win32") return ["cmd", "/c", "start", "", url];
  return ["xdg-open", url];
}

function openBrowser(url: string): void {
  const command = browserCommand(url);
  if (!command) return;
  try {
    Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
  } catch {}
}

async function ensureApiKey(loginResult: any): Promise<string | undefined> {
  if (loginResult.apiKey) return loginResult.apiKey;
  if (!loginResult.token) return undefined;
  const keyRes = await apiRequest("/api/auth/keys", {
    method: "POST",
    headers: { Authorization: `Bearer ${loginResult.token}` },
    body: JSON.stringify({ name: "cli" }),
  });
  return keyRes.key;
}

async function persistLoginResult(loginResult: any): Promise<string | undefined> {
  const storedKey = await ensureApiKey(loginResult);
  if (!storedKey) return undefined;

  saveAuthConfig({
    apiKey: storedKey,
    email: loginResult.user.email,
    orgId: loginResult.organization.id,
    orgSlug: loginResult.organization.slug,
    userId: loginResult.user.id,
  });

  return storedKey;
}

function printLoginSuccess(loginResult: any, json: boolean) {
  if (json || !isTTY) {
    console.log(JSON.stringify({
      status: "authenticated",
      email: loginResult.user.email,
      organization: loginResult.organization.slug,
      firstLogin: loginResult.firstLogin,
    }));
    return;
  }

  console.log(chalk.green(`\n✓ Signed in as ${loginResult.user.email}`));
  console.log(chalk.dim(`  Organization: ${loginResult.organization.name}`));
  if (loginResult.firstLogin) {
    console.log(chalk.dim(`  API key saved to ~/.hasna/skills/auth.json`));
  }
}

async function doLogin(email: string, code?: string, json?: boolean) {
  if (!email || !email.includes("@")) {
    writeCommandError(new Error("Invalid email"), "Invalid email", json);
    process.exitCode = 1;
    return;
  }

  if (!code) {
    if (!json) console.log(chalk.dim("Sending code..."));
    let sendRes: any;
    try {
      sendRes = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
    } catch (err) {
      writeCommandError(err, "Failed to request login code", json);
      return;
    }

    if (sendRes.error) {
      writeCommandError(new Error(sendRes.error), "Failed to request login code", json);
      return;
    }

    if (!json) console.log(chalk.green("✓ Code sent to " + email));

    if (json || !isTTY) {
      console.log(JSON.stringify({ status: "code_sent", email, message: "Check email for 6-digit code, then run: skills auth login --email " + email + " --code <CODE>" }));
      return;
    }

    code = await prompt(chalk.bold("Code: "));
  }

  let verifyRes: any;
  try {
    verifyRes = await apiRequest("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    });
  } catch (err) {
    writeCommandError(err, "Failed to verify login code", json);
    return;
  }

  if (verifyRes.error) {
    writeCommandError(new Error(verifyRes.error), "Failed to verify login code", json);
    return;
  }

  let storedKey: string | undefined;
  try {
    storedKey = await persistLoginResult(verifyRes);
  } catch (err) {
    writeCommandError(err, "Login succeeded but API key creation failed", json);
    return;
  }
  if (!storedKey) {
    writeCommandError(new Error("Login succeeded but API key creation failed"), "Login succeeded but API key creation failed", json);
    return;
  }

  printLoginSuccess(verifyRes, Boolean(json));
}

async function doApiKeyLogin(apiKey: string, json?: boolean) {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    writeCommandError(new Error("API key required"), "API key required", json);
    return;
  }

  let whoami: any;
  try {
    whoami = await apiRequest("/api/auth/whoami", {
      headers: { Authorization: `Bearer ${trimmed}` },
    });
  } catch (err) {
    writeCommandError(err, "Failed to verify API key", json);
    return;
  }

  const identity = authIdentityPayload("stored", whoami);
  const email = stringField(identity.email);
  const orgId = stringField(identity.orgId);
  const orgSlug = stringField(identity.organization);
  const userId = stringField(identity.userId);

  // Only what `whoami` actually returned is stored. Filling a missing identity
  // field with a placeholder both invents a fact about the user and, when the
  // placeholder names a deployment variant, hands every later reader of
  // `auth.json` a fingerprint of the instance the key belongs to.
  saveAuthConfig({
    apiKey: trimmed,
    ...(email ? { email } : {}),
    ...(orgId ? { orgId } : {}),
    ...(orgSlug ? { orgSlug } : {}),
    ...(userId ? { userId } : {}),
  });

  if (json || !isTTY) {
    console.log(JSON.stringify({ ...identity, status: "authenticated" }, null, 2));
    return;
  }

  printWhoami(identity);
}

interface DeviceLoginOptions {
  json?: boolean;
  open?: boolean;
  poll?: boolean;
  pollTimeoutMs?: string;
}

async function doDeviceLogin(options: DeviceLoginOptions) {
  let start: any;
  try {
    start = await apiRequest("/api/auth/device/start", {
      method: "POST",
      body: JSON.stringify({ client: "skills-cli" }),
    });
  } catch (err) {
    writeCommandError(err, "Failed to start device login", options.json);
    return;
  }

  if (start.error) {
    writeCommandError(new Error(start.error), "Failed to start device login", options.json);
    return;
  }

  const verificationUrl = start.verificationUriComplete || start.verificationUri;
  const shouldPoll = Boolean(options.poll || (isTTY && !options.json));

  if (options.open !== false && isTTY && verificationUrl) {
    openBrowser(verificationUrl);
  }

  if (!shouldPoll) {
    const payload = {
      status: "pending",
      userCode: start.userCode,
      verificationUri: start.verificationUri,
      verificationUriComplete: start.verificationUriComplete,
      expiresIn: start.expiresIn,
      interval: start.interval,
      poll: "skills auth login --device --poll",
    };
    if (options.json || !isTTY) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(chalk.bold("\nSign in in your browser\n"));
      console.log(`${chalk.dim("Code:")} ${start.userCode}`);
      console.log(`${chalk.dim("URL:")}  ${verificationUrl}`);
    }
    return;
  }

  if (!options.json) {
    console.log(chalk.bold("\nSign in in your browser\n"));
    console.log(`${chalk.dim("Code:")} ${start.userCode}`);
    console.log(`${chalk.dim("URL:")}  ${verificationUrl}`);
    console.log(chalk.dim("\nWaiting for authentication..."));
  }

  const intervalMs = Math.max(1000, Number(start.interval || 5) * 1000);
  const timeoutMs = Number(options.pollTimeoutMs || DEFAULT_DEVICE_POLL_TIMEOUT_MS);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let tokenRes: any;
    try {
      tokenRes = await apiRequest("/api/auth/device/token", {
        method: "POST",
        body: JSON.stringify({ deviceCode: start.deviceCode }),
      });
    } catch (err) {
      writeCommandError(err, "Failed to poll device login", options.json);
      return;
    }

    if (tokenRes.error === "authorization_pending" || tokenRes.status === "pending") {
      await sleep(intervalMs);
      continue;
    }

    if (tokenRes.error) {
      writeCommandError(new Error(tokenRes.detail || tokenRes.error), "Failed to poll device login", options.json);
      return;
    }

    let storedKey: string | undefined;
    try {
      storedKey = await persistLoginResult(tokenRes);
    } catch (err) {
      writeCommandError(err, "Login succeeded but API key creation failed", options.json);
      return;
    }
    if (!storedKey) {
      writeCommandError(new Error("Login succeeded but API key creation failed"), "Login succeeded but API key creation failed", options.json);
      return;
    }

    printLoginSuccess(tokenRes, Boolean(options.json));
    return;
  }

  const error = "Device login timed out before browser authentication completed";
  if (options.json || !isTTY) console.log(JSON.stringify({ status: "expired", error }));
  else console.error(chalk.red(error));
  process.exitCode = 1;
}

export function registerAuth(parent: Command) {
  const auth = parent
    .command("auth")
    .description("Manage account authentication");

  auth
    .command("login")
    .description("Sign in with browser/device code or email code")
    .option("--email <email>", "Email address (non-interactive)")
    .option("--code <code>", "Verification code (non-interactive)")
    .option("--api-key <key>", "Verify and store an API key")
    .option("--device", "Use browser/device-code login", false)
    .option("--no-open", "Do not open a browser for device-code login")
    .option("--poll", "Poll until browser authentication completes in non-interactive mode", false)
    .option("--poll-timeout-ms <ms>", "Maximum time to wait for device-code login")
    .option("--json", "Output result as JSON", false)
    .action(async (options: { email?: string; code?: string; apiKey?: string; device?: boolean; open?: boolean; poll?: boolean; pollTimeoutMs?: string; json?: boolean }) => {
      if (options.apiKey) {
        await doApiKeyLogin(options.apiKey, options.json);
        return;
      }
      if (options.device || (!options.email && !options.code)) {
        await doDeviceLogin(options);
        return;
      }

      let email = options.email;

      if (!email && isTTY) {
        const existing = getAuthConfig();
        if (existing) {
          console.log(chalk.dim(`Already signed in as ${existing.email}`));
          const again = await prompt("Sign in with a different account? (y/N) ");
          if (again.toLowerCase() !== "y") return;
        }
        email = await prompt(chalk.bold("Email: "));
      }

      if (!email) {
        console.error(chalk.red("Email required. Use: skills auth login --email you@example.com"));
        process.exitCode = 1;
        return;
      }

      await doLogin(email, options.code, options.json);
    });

  auth
    .command("logout")
    .description("Sign out and remove stored credentials")
    .action(() => {
      const existing = getAuthConfig();
      if (!existing) {
        console.log(chalk.dim("Not signed in"));
        return;
      }
      clearAuthConfig();
      console.log(chalk.green(`✓ Signed out (was ${existing.email})`));
    });

  auth
    .command("whoami")
    .description("Show current account info")
    .option("--json", "Output as JSON", false)
    .action(async (options: { json?: boolean }) => {
      const envKey = envApiKey();
      const config = getAuthConfig();
      const apiKey = envKey ?? config?.apiKey;
      if (!apiKey) {
        const payload = { status: "unauthenticated", error: "Not signed in. Run: skills auth login" };
        if (options.json) console.log(JSON.stringify(payload, null, 2));
        else console.log(chalk.dim(payload.error));
        return;
      }

      const authSource = envKey ? "env" : "stored";
      try {
        const res = await apiRequest("/api/auth/whoami", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const payload = authIdentityPayload(authSource, res, envKey ? null : config);
        if (options.json) {
          console.log(JSON.stringify(payload, null, 2));
        } else {
          printWhoami(payload);
        }
      } catch (err) {
        if (config && !envKey) {
          const payload = authIdentityPayload("stored", {}, config, true);
          if (options.json) console.log(JSON.stringify(payload, null, 2));
          else printWhoami(payload);
          return;
        }
        writeCommandError(err, "Failed to fetch current account", options.json);
      }
    });

}
