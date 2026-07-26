# Browse

Hosted browser automation skill for page interaction, research, and structured
data extraction.

## Usage

```bash
skills setup --api-url <origin>
skills auth login
skills run browse --task "Find the top three announcements on example.com"
```

Poll and download results:

```bash
skills runs status <run-id>
skills exports download <run-id>
```

## Boundary

The OSS package contains metadata and documentation only. Browser execution,
proxy handling, model routing, provider credentials, logs, and artifacts are
owned by the hosted runtime.
