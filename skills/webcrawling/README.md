# Web Crawling

Hosted web crawling and page extraction skill.

## Usage

```bash
skills setup --mode self-hosted --api-url https://operator.example
skills auth login
skills run webcrawling --url https://example.com --depth 2
```

Poll and download results:

```bash
skills runs status <run-id>
skills exports download <run-id>
```

## Boundary

The OSS package contains metadata and documentation only. Crawling providers,
credentials, rate limits, worker orchestration, logs, and artifacts are owned by
the hosted runtime.
