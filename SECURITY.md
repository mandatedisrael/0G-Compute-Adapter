# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public GitHub issue**
2. Email: security@claraverse.ai
3. Include steps to reproduce and potential impact

We will respond within 48 hours and work with you on a fix before public disclosure.

## Security Considerations

### Private Key
- The `OG_PRIVATE_KEY` env var controls a wallet with real funds
- Never commit `.env` files — use `.env.example` as a template
- In production, use secrets management (AWS Secrets Manager, Docker secrets, etc.)

### API Keys
- API keys are stored in memory only (not persisted to disk)
- Rotate keys by updating `OG_API_KEYS` and restarting
- Use unique keys per client for usage tracking

### Logs
- Request logs may contain message content (first 100 chars)
- Log files are stored locally in `./logs/`
- Ensure log directory permissions are restrictive in production

### Network
- The proxy communicates with 0G network providers over HTTPS
- In production, put the proxy behind a reverse proxy (Nginx) with TLS
- Enable rate limiting to prevent abuse
