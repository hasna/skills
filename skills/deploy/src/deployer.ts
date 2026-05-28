/**
 * Deployment Module
 *
 * Handles the deployment process: pull, restart, health check
 */

import type { HostConfig, DeploymentOptions, DeploymentResult } from './types';
import { healthCheck, checkService } from './health';

/**
 * Run SSH command and return output
 */
async function runSSH(
  sshHost: string,
  command: string,
  verbose: boolean = false
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (verbose) {
    console.log(`  → Running: ${command}`);
  }

  const cmd = `ssh ${sshHost} "${command.replace(/"/g, '\\"')}"`;

  const proc = Bun.spawn(['sh', '-c', cmd], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;

  if (verbose && stdout) {
    console.log(`  ← ${stdout.trim()}`);
  }

  if (verbose && stderr) {
    console.error(`  ! ${stderr.trim()}`);
  }

  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode: proc.exitCode || 0,
  };
}

/**
 * Get current git commit hash
 */
async function getGitStatus(
  sshHost: string,
  deployPath: string,
  verbose: boolean = false
): Promise<string> {
  const { stdout } = await runSSH(
    sshHost,
    `cd ${deployPath} && git rev-parse --short HEAD`,
    verbose
  );
  return stdout;
}

/**
 * Pull latest code from git
 */
async function gitPull(
  sshHost: string,
  deployPath: string,
  branch: string,
  useSudo: boolean = false,
  verbose: boolean = false
): Promise<{ before: string; after: string; changes: boolean }> {
  console.log(`📦 Pulling latest code from ${branch}...`);

  const before = await getGitStatus(sshHost, deployPath, verbose);

  const sudoPrefix = useSudo ? 'sudo ' : '';
  const commands = [
    `cd ${deployPath}`,
    `${sudoPrefix}git fetch origin`,
    `${sudoPrefix}git pull origin ${branch}`,
  ].join(' && ');

  const { exitCode, stderr } = await runSSH(sshHost, commands, verbose);

  if (exitCode !== 0) {
    throw new Error(`Git pull failed: ${stderr}`);
  }

  const after = await getGitStatus(sshHost, deployPath, verbose);
  const changes = before !== after;

  if (changes) {
    console.log(`✅ Updated from ${before} to ${after}`);
  } else {
    console.log(`ℹ️  Already up to date at ${after}`);
  }

  return { before, after, changes };
}

/**
 * Restart systemd service
 */
async function restartService(
  sshHost: string,
  serviceName: string,
  verbose: boolean = false
): Promise<void> {
  console.log(`🔄 Restarting service ${serviceName}...`);

  const { exitCode, stderr } = await runSSH(
    sshHost,
    `sudo systemctl restart ${serviceName}`,
    verbose
  );

  if (exitCode !== 0) {
    throw new Error(`Service restart failed: ${stderr}`);
  }

  // Wait a bit for service to start
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log(`✅ Service restarted`);
}

/**
 * Run health check
 */
async function runHealthCheck(
  sshHost: string,
  healthUrl: string,
  verbose: boolean = false
): Promise<{ passed: boolean; response?: any; error?: string }> {
  console.log(`🏥 Running health check: ${healthUrl}...`);

  const result = await healthCheck(sshHost, healthUrl);

  if (result.passed) {
    console.log(`✅ Health check passed (${result.duration}ms)`);
    if (verbose && result.response) {
      console.log(`   Response:`, JSON.stringify(result.response, null, 2));
    }
    return { passed: true, response: result.response };
  } else {
    console.error(`❌ Health check failed: ${result.error}`);
    return { passed: false, error: result.error };
  }
}

/**
 * Deploy to a host
 */
export async function deploy(
  host: HostConfig,
  options: DeploymentOptions = {}
): Promise<DeploymentResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  console.log(`\n🚀 Deploying to ${host.name} (${host.sshHost})`);
  console.log(`   Path: ${host.deployPath}`);
  if (host.service) {
    console.log(`   Service: ${host.service}`);
  }
  console.log('');

  try {
    // Step 1: Pull latest code
    const gitStatus = await gitPull(
      host.sshHost,
      host.deployPath,
      host.gitBranch || 'main',
      host.user === 'root',
      options.verbose
    );

    // Step 2: Restart service (if configured and not skipped)
    let serviceStatus: { running: boolean; uptime?: string } | undefined;
    if (host.service && !options.skipRestart) {
      try {
        await restartService(host.sshHost, host.service, options.verbose);

        // Check service status
        const status = await checkService(host.sshHost, host.service);
        serviceStatus = {
          running: status.running,
          uptime: status.status,
        };

        if (!status.running) {
          errors.push(`Service ${host.service} is not running after restart`);
        }
      } catch (error: any) {
        errors.push(`Service restart failed: ${error.message}`);
      }
    }

    // Step 3: Health check (if configured and not skipped)
    let healthCheckResult:
      | { passed: boolean; url?: string; response?: any }
      | undefined;
    if (host.healthUrl && !options.skipHealthCheck) {
      try {
        const result = await runHealthCheck(
          host.sshHost,
          host.healthUrl,
          options.verbose
        );
        healthCheckResult = {
          passed: result.passed,
          url: host.healthUrl,
          response: result.response,
        };

        if (!result.passed) {
          errors.push(`Health check failed: ${result.error}`);
        }
      } catch (error: any) {
        errors.push(`Health check error: ${error.message}`);
      }
    }

    const duration = Date.now() - startTime;
    const success = errors.length === 0;

    if (success) {
      console.log(`\n✅ Deployment completed successfully in ${duration}ms\n`);
    } else {
      console.error(`\n❌ Deployment completed with errors in ${duration}ms\n`);
    }

    return {
      success,
      host: host.sshHost,
      service: host.service,
      gitStatus,
      serviceStatus,
      healthCheck: healthCheckResult,
      errors: errors.length > 0 ? errors : undefined,
      duration,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`\n❌ Deployment failed: ${error.message}\n`);

    return {
      success: false,
      host: host.sshHost,
      errors: [error.message],
      duration,
    };
  }
}
