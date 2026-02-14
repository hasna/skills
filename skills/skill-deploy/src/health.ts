/**
 * Health Check Module
 *
 * Performs health checks on deployed services via SSH
 */

import type { HealthCheckResult } from './types';

/**
 * Run health check via SSH
 */
export async function healthCheck(
  sshHost: string,
  healthUrl: string,
  timeout: number = 5000
): Promise<HealthCheckResult> {
  const startTime = Date.now();

  try {
    // Run curl command via SSH to check health endpoint
    const cmd = `ssh ${sshHost} "curl -s -w '\\n%{http_code}' -m ${timeout / 1000} ${healthUrl}"`;

    const proc = Bun.spawn(['sh', '-c', cmd], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    const duration = Date.now() - startTime;

    // Parse response (last line is status code)
    const lines = output.trim().split('\n');
    const statusCode = parseInt(lines[lines.length - 1] || '0');
    const body = lines.slice(0, -1).join('\n');

    if (proc.exitCode === 0 && statusCode >= 200 && statusCode < 300) {
      // Try to parse JSON response
      let response: any = body;
      try {
        response = JSON.parse(body);
      } catch {
        // Not JSON, keep as string
      }

      return {
        passed: true,
        url: healthUrl,
        status: statusCode,
        response,
        duration,
      };
    }

    return {
      passed: false,
      url: healthUrl,
      status: statusCode || undefined,
      error: stderr || `Unexpected status code: ${statusCode}`,
      duration,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    return {
      passed: false,
      url: healthUrl,
      error: error.message,
      duration,
    };
  }
}

/**
 * Check if a systemd service is running
 */
export async function checkService(
  sshHost: string,
  serviceName: string
): Promise<{ running: boolean; status?: string; error?: string }> {
  try {
    const cmd = `ssh ${sshHost} "sudo systemctl is-active ${serviceName}"`;

    const proc = Bun.spawn(['sh', '-c', cmd], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    const status = output.trim();
    const running = status === 'active';

    return { running, status };
  } catch (error: any) {
    return {
      running: false,
      error: error.message,
    };
  }
}
