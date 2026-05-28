# blog-article

Generate one or more SEO-ready blog article packages through the hosted Skills runtime.

Use via:

```bash
skills quote create-blog-article --count 8 --topic "SaaS onboarding"
skills run create-blog-article --count 8 --topic "SaaS onboarding" --audience "founders" --length long --seo
```

Hosted runs write Markdown, HTML, JSON, and manifest artifacts to the run export directory.
