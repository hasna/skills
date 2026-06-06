import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "readline";
import { getApiKey, getAuthConfig, saveAuthConfig, clearAuthConfig, getApiUrl } from "../../lib/auth-store.js";

const isTTY = process.stdin.isTTY && process.stdout.isTTY;
const DEFAULT_DEVICE_POLL_TIMEOUT_MS = 10 * 60 * 1000;

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function apiRequest(path: string, options?: RequestInit) {
  const url = getApiUrl();
  const res = await fetch(`${url}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  return res.json() as Promise<any>;
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

async function doLogin(email: string, code?: string) {
  if (!email || !email.includes("@")) {
    console.error(chalk.red("Invalid email"));
    process.exitCode = 1;
    return;
  }

  if (!code) {
    console.log(chalk.dim("Sending code..."));
    const sendRes = await apiRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email }),
    });

    if (sendRes.error) {
      console.error(chalk.red(sendRes.error));
      process.exitCode = 1;
      return;
    }

    console.log(chalk.green("✓ Code sent to " + email));

    if (!isTTY) {
      console.log(JSON.stringify({ status: "code_sent", email, message: "Check email for 6-digit code, then run: skills auth login --email " + email + " --code <CODE>" }));
      return;
    }

    code = await prompt(chalk.bold("Code: "));
  }

  const verifyRes = await apiRequest("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });

  if (verifyRes.error) {
    console.error(chalk.red(verifyRes.error));
    process.exitCode = 1;
    return;
  }

  const storedKey = await persistLoginResult(verifyRes);
  if (!storedKey) {
    console.error(chalk.red("Login succeeded but API key creation failed"));
    process.exitCode = 1;
    return;
  }

  printLoginSuccess(verifyRes, false);
}

interface DeviceLoginOptions {
  json?: boolean;
  open?: boolean;
  poll?: boolean;
  pollTimeoutMs?: string;
}

async function doDeviceLogin(options: DeviceLoginOptions) {
  const start = await apiRequest("/api/auth/device/start", {
    method: "POST",
    body: JSON.stringify({ client: "skills-cli" }),
  });

  if (start.error) {
    console.error(chalk.red(start.error));
    process.exitCode = 1;
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
    const tokenRes = await apiRequest("/api/auth/device/token", {
      method: "POST",
      body: JSON.stringify({ deviceCode: start.deviceCode }),
    });

    if (tokenRes.error === "authorization_pending" || tokenRes.status === "pending") {
      await sleep(intervalMs);
      continue;
    }

    if (tokenRes.error) {
      console.error(chalk.red(tokenRes.detail || tokenRes.error));
      process.exitCode = 1;
      return;
    }

    const storedKey = await persistLoginResult(tokenRes);
    if (!storedKey) {
      console.error(chalk.red("Login succeeded but API key creation failed"));
      process.exitCode = 1;
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
    .description("Manage hosted account authentication");

  auth
    .command("login")
    .description("Sign in with browser/device code or email code")
    .option("--email <email>", "Email address (non-interactive)")
    .option("--code <code>", "Verification code (non-interactive)")
    .option("--device", "Use browser/device-code login", false)
    .option("--no-open", "Do not open a browser for device-code login")
    .option("--poll", "Poll until browser authentication completes in non-interactive mode", false)
    .option("--poll-timeout-ms <ms>", "Maximum time to wait for device-code login")
    .option("--json", "Output result as JSON", false)
    .action(async (options: { email?: string; code?: string; device?: boolean; open?: boolean; poll?: boolean; pollTimeoutMs?: string; json?: boolean }) => {
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

      await doLogin(email, options.code);
    });

  auth
    .command("signup")
    .description("Create or sign in with your email (passwordless)")
    .option("--email <email>", "Email address (non-interactive)")
    .option("--code <code>", "Verification code (non-interactive)")
    .action(async (options: { email?: string; code?: string }) => {
      let email = options.email;

      if (!email && isTTY) {
        const existing = getAuthConfig();
        if (existing) {
          console.log(chalk.dim(`Already signed in as ${existing.email}`));
          const again = await prompt("Continue with a different account? (y/N) ");
          if (again.toLowerCase() !== "y") return;
        }
        email = await prompt(chalk.bold("Email: "));
      }

      if (!email) {
        console.error(chalk.red("Email required. Use: skills auth signup --email you@example.com"));
        process.exitCode = 1;
        return;
      }

      await doLogin(email, options.code);
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
    .action(async () => {
      const config = getAuthConfig();
      if (!config) {
        console.log(chalk.dim("Not signed in. Run: skills auth login"));
        return;
      }

      console.log(chalk.bold("Email:  ") + config.email);
      console.log(chalk.bold("Org:    ") + config.orgSlug);

      try {
        const res = await apiRequest("/api/auth/whoami", {
          headers: { Authorization: `Bearer ${config.apiKey}` },
        });
        if (res.user) {
          console.log(chalk.bold("Role:   ") + res.user.role);
        }
        if (res.organization) {
          console.log(chalk.bold("Name:   ") + res.organization.name);
        }
      } catch {
        console.log(chalk.dim("(offline — showing cached info)"));
      }
    });

  auth.command("status").description("Show hosted billing status").option("--json", "Output as JSON", false).action(handleBillingStatus);
  auth.command("checkout").description("Create a Pro checkout session").option("--json", "Output as JSON", false).action(handleCheckout);
  auth.command("portal").description("Create a customer portal session").option("--json", "Output as JSON", false).action(handlePortal);
  auth.command("buy-credits").description("Create a credit pack checkout session").argument("<amount>", "Credit pack amount: 1, 5, 20, 50, or 100").option("--json", "Output as JSON", false).action(handleBuyCredits);

  registerBilling(parent);
  registerCredits(parent);
}

function requireHostedAuth(json?: boolean) {
  const config = getAuthConfig();
  if (config) return config;
  const apiKey = getApiKey();
  if (apiKey) return { apiKey };
  const message = "Not signed in. Run: skills auth login";
  if (json) console.log(JSON.stringify({ error: message }));
  else console.log(chalk.dim(message));
  process.exitCode = 1;
  return null;
}

async function handleBillingStatus(options: { json?: boolean } = {}) {
  const config = requireHostedAuth(options.json);
  if (!config) return;

  try {
    const res = await apiRequest("/api/v1/billing/status", {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (options.json) {
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    console.log(chalk.bold("Plan:    ") + res.plan);
    console.log(chalk.bold("Balance: ") + res.balance);
  } catch {
    console.error(chalk.red("Failed to fetch billing status"));
    process.exitCode = 1;
  }
}

async function handleCheckout(options: { json?: boolean } = {}) {
  const config = requireHostedAuth(options.json);
  if (!config) return;

  const res = await apiRequest("/api/v1/billing/checkout", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (res.error || !res.url) {
    console.error(chalk.red(res.detail || res.error || "Failed to create checkout session"));
    process.exitCode = 1;
    return;
  }
  if (options.json) console.log(JSON.stringify(res, null, 2));
  else console.log(res.url);
}

async function handlePortal(options: { json?: boolean } = {}) {
  const config = requireHostedAuth(options.json);
  if (!config) return;

  const res = await apiRequest("/api/v1/billing/portal", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (res.error || !res.url) {
    console.error(chalk.red(res.detail || res.error || "Failed to create customer portal session"));
    process.exitCode = 1;
    return;
  }
  if (options.json) console.log(JSON.stringify(res, null, 2));
  else console.log(res.url);
}

async function handleBuyCredits(amount: string, options: { json?: boolean } = {}) {
  const config = requireHostedAuth(options.json);
  if (!config) return;

  const res = await apiRequest("/api/v1/billing/credits", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ amount }),
  });
  if (res.error || !res.url) {
    console.error(chalk.red(res.detail || res.error || "Failed to create credit checkout session"));
    process.exitCode = 1;
    return;
  }
  if (options.json) console.log(JSON.stringify(res, null, 2));
  else console.log(res.url);
}

async function handleListCreditPacks(options: { json?: boolean } = {}) {
  const config = requireHostedAuth(options.json);
  if (!config) return;

  const res = await apiRequest("/api/v1/billing/credits", {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (res.error) {
    console.error(chalk.red(res.detail || res.error || "Failed to list credit packs"));
    process.exitCode = 1;
    return;
  }
  if (options.json) {
    console.log(JSON.stringify(res, null, 2));
    return;
  }
  const packs = Array.isArray(res) ? res : res.packs;
  for (const pack of packs ?? []) {
    console.log(`${pack.amount}: ${pack.amountCents ? `$${(pack.amountCents / 100).toFixed(2)}` : pack.label || ""}`);
  }
}

function registerBilling(parent: Command) {
  const billing = parent.command("billing").description("Manage hosted billing");
  billing.command("status").description("Show billing status").option("--json", "Output as JSON", false).action(handleBillingStatus);
  billing.command("checkout").description("Create a Pro checkout session").option("--json", "Output as JSON", false).action(handleCheckout);
  billing.command("portal").description("Create a customer portal session").option("--json", "Output as JSON", false).action(handlePortal);
  billing.command("buy-credits").description("Create a credit pack checkout session").argument("<amount>", "Credit pack amount: 1, 5, 20, 50, or 100").option("--json", "Output as JSON", false).action(handleBuyCredits);
}

function registerCredits(parent: Command) {
  const credits = parent.command("credits").description("Manage hosted credit packs");
  credits.command("buy").description("Create a credit pack checkout session").argument("<amount>", "Credit pack amount: 1, 5, 20, 50, or 100").option("--json", "Output as JSON", false).action(handleBuyCredits);
  credits.command("packs").description("List available credit packs").option("--json", "Output as JSON", false).action(handleListCreditPacks);
}
