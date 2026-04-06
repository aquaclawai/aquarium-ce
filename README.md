<div align="center">

# 🐠 Aquarium CE

### Self-hosted AI Agent Management Platform

Deploy, orchestrate, and manage AI agent instances with a single command.

[![npm version](https://img.shields.io/npm/v/@aquaclawai/aquarium?color=cb3837&logo=npm)](https://www.npmjs.com/package/@aquaclawai/aquarium)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-required-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![GitHub Stars](https://img.shields.io/github/stars/aquaclawai/aquarium-ce?style=social)](https://github.com/aquaclawai/aquarium-ce)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**[Website](https://www.aquaclaw.ai/en)** · **[Documentation](docs/getting-started.md)** · **[Contributing](CONTRIBUTING.md)** · **[中文](README.zh-CN.md)**

</div>

---

## Quick Start

```bash
npx @aquaclawai/aquarium
```

Open **http://localhost:3001** — that's it.

## Why Aquarium?

Most AI agent platforms lock you into their cloud. Aquarium gives you **full control** — run it on your own machine, your own server, your own rules.

- **One command to start** — No config files, no environment variables, no setup wizard
- **Your data stays yours** — SQLite database stored locally, zero telemetry
- **Any provider, any model** — Connect 27+ AI providers through a unified interface
- **Production-ready channels** — Ship agents to WhatsApp, Telegram, Discord, Slack, and 10+ more

## Features

| Feature | Description |
|---|---|
| **Zero-config Setup** | SQLite database, auto-created data directory, just works |
| **27+ AI Providers** | OpenAI, Anthropic, Google, Mistral, DeepSeek, and more |
| **Instance Management** | Create, start, stop, configure, and monitor agent instances |
| **Direct Chat** | Built-in chat UI with streaming and markdown rendering |
| **Template Marketplace** | Pre-built agent configurations to get started fast |
| **14 Messaging Channels** | WhatsApp, Telegram, Discord, Slack, LINE, Messenger, and more |
| **MCP Tool Support** | Extend agents with Model Context Protocol tools |
| **Credential Vault** | Encrypted storage for API keys and secrets |
| **Health Monitoring** | Real-time status tracking with auto-recovery |
| **Multi-language UI** | English, Chinese, French, German, Spanish, Italian |

## Architecture

```
┌─────────────────────────────────────────────┐
│              Aquarium CE                     │
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐ │
│  │ React UI │  │ Express  │  │  SQLite   │ │
│  │ (Vite)   │◄─┤ Backend  ├──┤ Database  │ │
│  └──────────┘  └────┬─────┘  └───────────┘ │
│                     │                       │
│         ┌───────────┼───────────┐           │
│         ▼           ▼           ▼           │
│    ┌─────────┐ ┌─────────┐ ┌─────────┐     │
│    │ Agent 1 │ │ Agent 2 │ │ Agent N │     │
│    │(Docker) │ │(Docker) │ │(Docker) │     │
│    └─────────┘ └─────────┘ └─────────┘     │
└─────────────────────────────────────────────┘
```

## Requirements

| Requirement | Version |
|---|---|
| Node.js | 22+ |
| Docker | Latest recommended |

## Documentation

- **[Getting Started](docs/getting-started.md)** — Installation and first steps
- **[Architecture](docs/architecture.md)** — System design and data flow
- **[Configuration](docs/configuration.md)** — CLI flags and environment options
- **[Development](docs/development.md)** — Contributing to the codebase

## CLI Options

```bash
npx @aquaclawai/aquarium --port 8080       # Custom port
npx @aquaclawai/aquarium --host 0.0.0.0    # Expose to network
npx @aquaclawai/aquarium --data-dir ./data  # Custom data directory
npx @aquaclawai/aquarium --open             # Auto-open browser
```

## Contributing

We welcome contributions! See **[CONTRIBUTING.md](CONTRIBUTING.md)** for guidelines.

This project includes [AI-assisted development skills](.agents/skills/) to help you contribute using Claude Code or similar tools.

## License

[Apache 2.0](LICENSE) — Use it freely, commercially or personally.

---

<div align="center">

**[aquaclaw.ai](https://www.aquaclaw.ai/en)** — Our website is entirely managed by CAT (Citronetic Autonomous Technician), an AI agent running on Aquarium.

</div>
