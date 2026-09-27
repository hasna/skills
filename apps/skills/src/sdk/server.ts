/**
 * Server seam: router + handler types, and thin server factories over the shipped HTTP
 * API implementation (src/server/app.ts).
 *
 * The routing logic itself is untouched: createSkillsFetchHandler() owns the /api/v1
 * dispatcher and every durability guard. This module is the contract an embedder (the
 * SaaS control plane) builds against, and it re-exports the implementation.
 */
import {
  assertDurableStore,
  assertDurableTarget,
  createSkillsFetchHandler,
  skillsServeLimits,
  startSkillsServer,
  type SkillsServerOptions,
} from "../server/app.js";
import { resolveServerConfig, type SkillsServerConfig } from "../server/config.js";
import type { ApiPrincipal } from "../server/types.js";

/** A request handler: the unit the HTTP layer executes. */
export type SkillsRequestHandler = (request: Request) => Promise<Response>;

/** One additional route, matched exactly on method + pathname before the base handler. */
export interface SkillsRoute {
  method: string;
  pathname: string;
  handler: SkillsRequestHandler;
}

/**
 * Build the shipped API server as a plain fetch handler.
 *
 * Thin wrapper over createSkillsFetchHandler() — same store, same guards, same routes.
 */
export function createServer(options: SkillsServerOptions = {}): Promise<SkillsRequestHandler> {
  return createSkillsFetchHandler(options);
}

/**
 * Register additional routes in front of a base handler.
 *
 * Consulted before the base handler on exact method + pathname match; anything else
 * falls through to the shipped dispatcher. This is composition, not a rewrite of the
 * router.
 */
export function registerRoutes(base: SkillsRequestHandler, routes: SkillsRoute[]): SkillsRequestHandler {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const route = routes.find(
      (candidate) => candidate.method === request.method && candidate.pathname === url.pathname,
    );
    return route ? route.handler(request) : base(request);
  };
}

export {
  assertDurableStore,
  assertDurableTarget,
  createSkillsFetchHandler,
  skillsServeLimits,
  startSkillsServer,
  resolveServerConfig,
};
export type { ApiPrincipal, SkillsServerConfig, SkillsServerOptions };
