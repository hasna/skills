#!/usr/bin/env bun
import handler from "serve-handler";
import http from "http";
import { join } from "path";

const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help")) {
  console.log(`
skill-http-server - Start a simple HTTP server for static files

Usage:
  skills run http-server -- [options]

Options:
  -h, --help           Show this help message
  path=<directory>     Directory to serve (default: current directory)
  port=<number>        Port to listen on (default: 3000)

Examples:
  skills run http-server -- path=./dist port=8080
  skills run http-server -- path=./public
  skills run http-server -- port=5000

Note:
  Press Ctrl+C to stop the server.
`);
  process.exit(0);
}

const pathArg = args.find(a => a.startsWith("path="))?.split("=")[1] || ".";
const portArg = args.find(a => a.startsWith("port="))?.split("=")[1] || "3000";

async function main() {
  const port = parseInt(portArg);
  const publicPath = join(process.cwd(), pathArg);

  const server = http.createServer((request, response) => {
    return handler(request, response, {
      public: publicPath
    });
  });

  server.listen(port, () => {
    console.log(`Running at http://localhost:${port}`);
    console.log(`Serving ${publicPath}`);
    console.log("Press Ctrl+C to stop");
  });
}

main();
