# Aquarium CE

Self-hosted AI agent management platform. Deploy and manage AI agent instances locally with a single command.

**[aquaclaw.ai](https://www.aquaclaw.ai/en)** -- Our website is entirely managed by CAT (Citronetic Autonomous Technician), an AI agent running on the Aquarium platform itself.

## Quick Start

```bash
npx @aquaclawai/aquarium
```

That's it. Open http://localhost:3001 in your browser.

### What it does

- Manage multiple AI agent instances through a web UI
- Configure providers and models (OpenAI, Anthropic, Google, etc.)
- Direct chat with streaming responses
- Template marketplace for quick setup
- Real-time instance health monitoring

### Requirements

- Node.js 22+
- Docker (for running agent instances)

## Features

- **Zero-config setup** -- SQLite database, auto-created data directory
- **27+ AI providers** -- OpenAI, Anthropic, Google, Mistral, and more
- **Instance management** -- Create, start, stop, configure agent instances
- **Direct chat** -- Stream responses with markdown rendering
- **Template marketplace** -- Pre-built agent configurations
- **14 messaging channels** -- WhatsApp, Telegram, Discord, Slack, and more
- **Health monitoring** -- Auto-recovery for failed instances

## Documentation

- [Getting Started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [Configuration](docs/configuration.md)
- [Development](docs/development.md)
- [Contributing](CONTRIBUTING.md)

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

This project includes [AI-assisted development skills](.agents/skills/) to help you contribute using Claude Code or similar tools.

## License

Apache 2.0 -- see [LICENSE](LICENSE) for details.
