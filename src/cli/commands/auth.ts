import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "readline";
import { getAuthConfig, saveAuthConfig, clearAuthConfig, getApiUrl } from "../../lib/auth-store.js";

const isTTY = process.stdin.isTTY && process.stdout.isTTY;

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

  let storedKey = verifyRes.apiKey;

  if (!storedKey) {
    const keyRes = await apiRequest("/api/auth/keys", {
      method: "POST",
      headers: { Authorization: `Bearer ${verifyRes.token}` },
      body: JSON.stringify({ name: "cli" }),
    });
    storedKey = keyRes.key;
  }

  saveAuthConfig({
    apiKey: storedKey,
    email: verifyRes.user.email,
    orgId: verifyRes.organization.id,
    orgSlug: verifyRes.organization.slug,
    userId: verifyRes.user.id,
  });

  if (isTTY) {
    console.log(chalk.green(`\n✓ Signed in as ${verifyRes.user.email}`));
    console.log(chalk.dim(`  Organization: ${verifyRes.organization.name}`));
    if (verifyRes.firstLogin) {
      console.log(chalk.dim(`  API key saved to ~/.skills/auth.json`));
    }
  } else {
    console.log(JSON.stringify({
      status: "authenticated",
      email: verifyRes.user.email,
      organization: verifyRes.organization.slug,
      firstLogin: verifyRes.firstLogin,
    }));
  }
}

export function registerAuth(parent: Command) {
  const auth = parent
    .command("auth")
    .description("Manage your skills.md account");

  auth
    .command("login")
    .description("Sign in with your email (passwordless)")
    .option("--email <email>", "Email address (non-interactive)")
    .option("--code <code>", "Verification code (non-interactive)")
    .action(async (options: { email?: string; code?: string }) => {
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

  auth
    .command("status")
    .description("Show billing status and credits")
    .action(async () => {
      const config = getAuthConfig();
      if (!config) {
        console.log(chalk.dim("Not signed in. Run: skills auth login"));
        return;
      }

      try {
        const res = await apiRequest("/api/v1/billing/status", {
          headers: { Authorization: `Bearer ${config.apiKey}` },
        });
        console.log(chalk.bold("Plan:    ") + res.plan);
        console.log(chalk.bold("Balance: ") + res.balance);
      } catch {
        console.error(chalk.red("Failed to fetch billing status"));
      }
    });

  auth
    .command("checkout")
    .description("Create a Pro checkout session")
    .action(async () => {
      const config = getAuthConfig();
      if (!config) {
        console.log(chalk.dim("Not signed in. Run: skills auth login"));
        return;
      }

      const res = await apiRequest("/api/v1/billing/checkout", {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });
      if (res.error || !res.url) {
        console.error(chalk.red(res.detail || res.error || "Failed to create checkout session"));
        process.exitCode = 1;
        return;
      }
      console.log(res.url);
    });

  auth
    .command("portal")
    .description("Create a customer portal session")
    .action(async () => {
      const config = getAuthConfig();
      if (!config) {
        console.log(chalk.dim("Not signed in. Run: skills auth login"));
        return;
      }

      const res = await apiRequest("/api/v1/billing/portal", {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });
      if (res.error || !res.url) {
        console.error(chalk.red(res.detail || res.error || "Failed to create customer portal session"));
        process.exitCode = 1;
        return;
      }
      console.log(res.url);
    });

  auth
    .command("buy-credits")
    .description("Create a credit pack checkout session")
    .argument("<amount>", "Credit pack amount: 1, 5, 20, 50, or 100")
    .action(async (amount: string) => {
      const config = getAuthConfig();
      if (!config) {
        console.log(chalk.dim("Not signed in. Run: skills auth login"));
        return;
      }

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
      console.log(res.url);
    });
}
