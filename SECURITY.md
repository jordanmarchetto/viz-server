# Security policy

## Report a vulnerability

Do not open a public issue for a suspected vulnerability.

Use [GitHub private vulnerability reporting](https://github.com/jordanmarchetto/viz-server/security/advisories/new) to share the affected version, reproduction steps, impact, and any suggested mitigation. You will receive a response through the advisory.

## Deployment scope

`viz-server` is a small self-hosted service. Operators are responsible for HTTPS, network access controls, token management, backups, retention, and reverse-proxy rate limiting. See [Configuration and deployment](docs/configuration.md#security-and-retention).
