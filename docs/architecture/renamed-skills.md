# Canonical Skill Slugs And Aliases

Skill slugs are canonical runtime identities. Aliases are metadata-only lookup
helpers for old or common task names, and they never create compatibility
folders, copied source trees, or alternate commands. The resolver maps an alias
to a canonical slug only when the requested slug is not already a real skill.

## Current Alias Table

| Legacy slug | Canonical slug | Reason |
| --- | --- | --- |
| `transcribe` | `transcript` | Common verb form for the transcript skill. |
| `speech-to-text` | `transcript` | Common task name for transcript generation. |
| `generate-pdf` | `pdf-generate` | Verb-first naming compatibility. |
| `create-pdf` | `pdf-generate` | Common creator wording. |
| `generate-doc` | `doc-generate` | Verb-first naming compatibility. |
| `generate-document` | `doc-generate` | Expanded document wording. |
| `read-document` | `doc-read` | Verb-first naming compatibility. |
| `document-read` | `doc-read` | Expanded document wording. |
| `pdf-reader` | `read-pdf` | Tool noun compatibility. |
| `generate-image` | `image` | Common AI image generation wording. |
| `image-generator` | `image` | Tool noun compatibility. |
| `create-blog-article` | `blog-article` | Product command wording for hosted blog article generation. |
| `generate-video` | `video` | Common AI video generation wording. |

## Resolution Rules

1. Exact canonical slugs win. If `pdf-read` exists as a real skill, it remains
   `pdf-read` and is not redirected.
2. If no exact skill exists, lookup falls back to the alias table.
3. Project pins, runs, usage records, billing records, and artifacts use the
   canonical slug.
4. CLI and API responses should return the canonical skill slug while accepting
   alias input.
5. New aliases must target an existing registered skill.
6. New aliases must not shadow an existing registered skill.

## SaaS Migration Behavior

The SaaS registry should store aliases in a separate alias table or JSON field,
not by duplicating skills. Pin and run requests should preserve both:

- `requestedSlug`: what the agent or user asked for.
- `canonicalSlug`: the skill actually pinned or executed.

Audit logs and billing records should use `canonicalSlug` for entitlement and
pricing, while keeping `requestedSlug` for debugging and migration analysis.

## Removing An Alias

Aliases may be removed only after:

1. Usage reaches zero or falls below the documented threshold.
2. A release note announces the removal.
3. The SaaS API has returned deprecation metadata for at least one release
   cycle.
4. CLI/MCP tests no longer rely on the alias.

Do not delete aliases silently.
