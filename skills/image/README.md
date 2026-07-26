# Image Generation

Hosted image generation skill with provider-cost pricing and downloadable image
artifacts.

## Usage

```bash
skills setup --api-url <origin>
skills auth login
skills run image "editorial product photo on a white sweep"
```

Poll and download results:

```bash
skills runs status <run-id>
skills exports download <run-id>
```

## Boundary

The OSS package contains metadata, pricing, and client contracts only. Provider
credentials, model routing, prompts, moderation, billing, worker code, and
artifact storage are owned by the hosted platform.
