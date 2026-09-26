/** Finish pipe writes before an async command returns, including under backpressure. */
export async function writeCliOutput(text: string, newline = true): Promise<void> {
  // After isTTY probes, Bun 1.3.14 can exit with console.log bytes still queued
  // in a kernel pipe. Its stream callback confirms the entire write completed.
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(newline ? `${text}\n` : text, error => error ? reject(error) : resolve());
  });
}
