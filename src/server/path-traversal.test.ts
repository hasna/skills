import { describe, expect, test } from "bun:test";
import { createSkillsFetchHandler } from "./app.js";
import { getServerSkill, getServerSkillMd, quoteServerSkill } from "./registry.js";
import { MemorySkillsStore } from "./store.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

// Regression guard for the authenticated path traversal reproduced on main (86ab611):
//
//   GET /api/v1/skills/..%2Fagent-skills%2Fskill-project-create/skill.md  (valid Bearer)
//     -> 200 returning agent-skills/skill-project-create/SKILL.md, a file OUTSIDE skills/.
//
// The router splits the pathname on '/' and only THEN decodeURIComponent's each segment,
// so an encoded `%2F` reconstitutes into a separator the split already treated as one
// opaque segment; `getServerSkillMd` then joined that raw slug onto the skills/ path with
// no validation. This suite pins the fix at both the router boundary and the registry layer.
//
// It deliberately runs against a single in-memory store: the vulnerability lives in URL
// routing and registry resolution, which are storage-agnostic, so parameterising over
// backends would only make the guard slower and load-sensitive for no extra coverage.

const TOKEN = "sk_test_traversal";
const SEED_PRINCIPAL = {
  orgId: "org_a",
  orgSlug: "org-a",
  orgName: "Org A",
  userId: "user_a",
  email: "a@example.com",
  apiKeyId: "key_a",
};

// A real, in-registry skill whose SKILL.md lives at skills/read-csv/SKILL.md. The POSITIVE
// CONTROL: proves the endpoint actually serves a 200 with real content, so a fix that broke
// the whole route (or a test blind to 200s) cannot masquerade as "traversal blocked".
const CONTROL_SLUG = "read-csv";
const CONTROL_MARKER = "name: read-csv"; // frontmatter unique to the control's SKILL.md

// The exact incident payload. The id segment is `..%2Fagent-skills%2Fskill-project-create`;
// the trailing `/skill.md` is a separate, literal segment.
const EXPLOIT_ID = "..%2Fagent-skills%2Fskill-project-create";
// The already-decoded slug, for calling the registry layer directly (bypasses HTTP decoding).
const TRAVERSAL_SLUG = "../agent-skills/skill-project-create";
// A string the escaped file (agent-skills/skill-project-create/SKILL.md) contains but no file
// under skills/ does. Asserting its ABSENCE is what makes a wrong-but-200 unable to pass: a
// bare status check would be fooled by traversing to a path that happens to 404.
const LEAK_MARKER = "skill-project-create";

// A syntactically valid slug that is simply not a registered skill. Its 404 is the baseline a
// traversal 404 must not be confused with — proving the block is real, not a generic miss.
const MISSING_SLUG = "definitely-not-a-real-skill-xyz";

async function startTestServer() {
  const store = new MemorySkillsStore();
  await store.ensureBootstrapApiKey(TOKEN, SEED_PRINCIPAL);
  const fetch = await createSkillsFetchHandler({
    store,
    config: { inlineWorker: false, allowEphemeralStore: true },
  });
  const server = Bun.serve({ port: 0, fetch });
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    async get(path: string) {
      return fetch(new Request(`http://127.0.0.1:${server.port}${path}`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      }));
    },
    async post(path: string) {
      return fetch(new Request(`http://127.0.0.1:${server.port}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      }));
    },
    stop() {
      server.stop(true);
    },
  };
}

describe("skill.md path traversal (HTTP boundary)", () => {
  test("POSITIVE CONTROL: an in-registry slug serves 200 with real SKILL.md content", async () => {
    const ctx = await startTestServer();
    try {
      const res = await ctx.get(`/api/v1/skills/${CONTROL_SLUG}/skill.md`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain(CONTROL_MARKER);
      // The endpoint really can 200 and the test really can see the content — so a
      // non-200 on the exploit below is a genuine block, not a route that never works.
    } finally {
      ctx.stop();
    }
  });

  test("EXPLOIT: the incident payload does NOT return 200 and leaks no escaped file", async () => {
    const ctx = await startTestServer();
    try {
      const res = await ctx.get(`/api/v1/skills/${EXPLOIT_ID}/skill.md`);
      expect(res.status).not.toBe(200);
      expect([400, 404]).toContain(res.status);
      const body = await res.text();
      // A wrong-but-200 (or a 4xx that still echoes the file) cannot pass: the escaped
      // file's marker must be absent from the response entirely.
      expect(body).not.toContain(LEAK_MARKER);
    } finally {
      ctx.stop();
    }
  });

  // A matrix of traversal encodings a refactor might otherwise reopen. Each must be
  // non-200 (blocked) AND non-500 (a clean rejection, not a crash that leaks a stack
  // trace) AND must not echo the escaped file. Includes malformed percent-encoding, which
  // makes decodeURIComponent throw — that must still be a 400/404, never an uncaught 500.
  const ENCODED_TRAVERSALS: Array<[string, string]> = [
    ["double-encoded %252F", "..%252Fagent-skills%252Fskill-project-create/skill.md"],
    ["backslash separators", "..%5Cagent-skills%5Cskill-project-create/skill.md"],
    ["absolute path", "%2Fetc%2Fpasswd/skill.md"],
    ["malformed overlong %c0%af", "..%c0%afagent-skills/skill.md"],
    ["malformed truncated %2", "read%2/skill.md"],
  ];
  for (const [label, path] of ENCODED_TRAVERSALS) {
    test(`traversal variant (${label}) is blocked cleanly and leaks nothing`, async () => {
      const ctx = await startTestServer();
      try {
        const res = await ctx.get(`/api/v1/skills/${path}`);
        expect(res.status).not.toBe(200);
        expect(res.status).not.toBe(500); // malformed input must not crash into a 500
        expect(await res.text()).not.toContain(LEAK_MARKER);
      } finally {
        ctx.stop();
      }
    });
  }

  test("a plain non-existent slug returns 404 (the traversal 404 is not this generic miss)", async () => {
    const ctx = await startTestServer();
    try {
      const res = await ctx.get(`/api/v1/skills/${MISSING_SLUG}/skill.md`);
      expect(res.status).toBe(404);
    } finally {
      ctx.stop();
    }
  });

  test("getServerSkill route: a traversal id does not 200 and leaks nothing", async () => {
    const ctx = await startTestServer();
    try {
      const res = await ctx.get(`/api/v1/skills/${EXPLOIT_ID}`);
      expect(res.status).not.toBe(200);
      expect(await res.text()).not.toContain(LEAK_MARKER);
    } finally {
      ctx.stop();
    }
  });

  test("quote route: a traversal id does not 200 and leaks nothing", async () => {
    const ctx = await startTestServer();
    try {
      const res = await ctx.post(`/api/v1/skills/${EXPLOIT_ID}/quote`);
      expect(res.status).not.toBe(200);
      expect(await res.text()).not.toContain(LEAK_MARKER);
    } finally {
      ctx.stop();
    }
  });
});

describe("skill.md path traversal (registry layer, HTTP decoding bypassed)", () => {
  // These call the registry functions with the already-decoded traversal slug. They prove
  // the fix does not depend on the router boundary alone: even if a future refactor fed a
  // raw slug straight in, the registry layer refuses to escape skills/.

  test("POSITIVE CONTROL: getServerSkillMd serves the in-registry control's content", () => {
    const md = getServerSkillMd(CONTROL_SLUG);
    expect(md).toBeTruthy();
    expect(md).toContain(CONTROL_MARKER);
  });

  test("getServerSkillMd refuses a traversal slug and returns null", () => {
    const md = getServerSkillMd(TRAVERSAL_SLUG);
    expect(md).toBeNull();
    expect(md ?? "").not.toContain(LEAK_MARKER);
  });

  test("getServerSkillMd returns null for a plain non-existent slug", () => {
    expect(getServerSkillMd(MISSING_SLUG)).toBeNull();
  });

  test("getServerSkill refuses a traversal slug and returns null", () => {
    expect(getServerSkill(TRAVERSAL_SLUG)).toBeNull();
  });

  test("quoteServerSkill refuses a traversal slug and leaks nothing", () => {
    const quote = quoteServerSkill(TRAVERSAL_SLUG);
    expect(quote).toMatchObject({ code: "SKILL_NOT_FOUND" });
    expect(JSON.stringify(quote)).not.toContain(LEAK_MARKER);
  });
});
