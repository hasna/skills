# Image Generation

Hosted image generation skill with credit-quoted execution and downloadable
image artifacts.

## Usage

```bash
skills setup --mode self-hosted --api-url https://operator.example
skills auth login
skills run image "editorial product photo on a white sweep"
```

Poll and download results:

```bash
skills runs status <run-id>
skills exports download <run-id>
```

## Boundary

The OSS package contains metadata, credit contracts, and client contracts only.
Provider credentials, model routing, prompts, moderation, credit accounting,
worker code, and artifact storage are owned by the hosted platform.
