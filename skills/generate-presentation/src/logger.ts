import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { envConfig } from "./runtime";

// Logging Utility
// ============================================================================

export class Logger {
  private logFile: string;
  private sessionId: string;

  constructor(private config = envConfig) {
    this.sessionId = new Date().toISOString().replace(/[:.]/g, "-");
    this.logFile = join(
      this.config.SKILLS_PROJECT_ROOT,
      this.config.SKILLS_OUTPUT_DIR,
      "logs",
      "generate-presentation",
      `${this.sessionId}.log`
    );
    this.initLogFile();
  }

  private async initLogFile() {
    const logDir = join(
      this.config.SKILLS_PROJECT_ROOT,
      this.config.SKILLS_OUTPUT_DIR,
      "logs",
      "generate-presentation"
    );
    await mkdir(logDir, { recursive: true });
  }

  private timestamp(): string {
    return new Date().toISOString().replace("T", " ").split(".")[0];
  }

  async log(message: string) {
    const logMessage = `[${this.timestamp()}] ${message}`;
    console.log(logMessage);
    try {
      await writeFile(this.logFile, logMessage + "\n", { flag: "a" });
    } catch (error) {
      // Silent fail for logging
    }
  }

  async error(message: string) {
    const errorMessage = `[${this.timestamp()}] ERROR: ${message}`;
    console.error(errorMessage);
    try {
      await writeFile(this.logFile, errorMessage + "\n", { flag: "a" });
    } catch (error) {
      // Silent fail for logging
    }
  }

  async success(message: string) {
    const successMessage = `[${this.timestamp()}] SUCCESS: ${message}`;
    console.log(successMessage);
    try {
      await writeFile(this.logFile, successMessage + "\n", { flag: "a" });
    } catch (error) {
      // Silent fail for logging
    }
  }
}
