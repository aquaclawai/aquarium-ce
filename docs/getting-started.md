# Getting Started

This guide walks you through installing and running Aquarium CE for the first time.

## Installation

### Option 1: npx (Recommended)

Run Aquarium directly without installing:

```bash
npx @aquaclawai/aquarium
```

This downloads and starts the server. Open http://localhost:3001 in your browser.

### Option 2: Global Install

Install globally for repeated use:

```bash
npm install -g @aquaclawai/aquarium
aquarium
```

### Option 3: Docker

Run as a Docker container:

```bash
docker run -d \
  --name aquarium \
  -p 3001:3001 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v aquarium-data:/app/data \
  ghcr.io/aquaclawai/aquarium:latest
```

Note: The Docker socket mount is required so Aquarium can manage agent containers.

## What Happens on First Run

When you start Aquarium CE for the first time:

1. **Data directory created**: `~/.aquarium/` is created in your home directory (or the path specified by `--data-dir`)
2. **SQLite database initialized**: `~/.aquarium/aquarium.db` is created and all migrations run automatically
3. **Server starts**: Express server binds to port 3001 (or the port specified by `--port`)
4. **Docker check**: Aquarium verifies Docker is available for running agent instances

The startup banner shows all paths and connection status:

```
  Aquarium CE
  -----------
  Data:   /home/user/.aquarium
  DB:     /home/user/.aquarium/aquarium.db
  Server: http://localhost:3001

  Docker: connected
```

## Creating Your First Agent Instance

1. **Open the web UI** at http://localhost:3001
2. **Sign up** with an email and password (stored locally in SQLite)
3. **Go to Templates** to browse pre-built agent configurations, or click "Create Instance" for a blank setup
4. **Choose an agent type** (OpenClaw is the primary supported type)
5. **Configure your instance**:
   - Give it a name
   - Select a default AI provider and model
   - Optionally configure messaging channels (WhatsApp, Telegram, etc.)
6. **Start the instance** -- Aquarium pulls the Docker image and launches the container
7. **Chat directly** with your agent using the built-in chat interface

## Configuring API Keys (BYOK)

Aquarium CE uses a Bring-Your-Own-Key model. You provide API keys for the AI providers you want to use.

### Adding Provider Credentials

1. Navigate to **Credentials** in the sidebar
2. Click **Add Credential**
3. Select the provider (e.g., OpenAI, Anthropic, Google)
4. Enter your API key
5. The credential is encrypted and stored in your local SQLite database

### Supported Providers

Aquarium supports 27+ providers through the OpenClaw gateway, including:

- **OpenAI** (GPT-4, GPT-4o, o1, o3, etc.)
- **Anthropic** (Claude 4, Claude 3.5, etc.)
- **Google** (Gemini 2.5, Gemini 2.0, etc.)
- **OpenRouter** (aggregator for 100+ models)
- **Mistral**, **Cohere**, **Groq**, **Together AI**, and more

### How Credentials Work

When you start an agent instance, Aquarium resolves credential placeholders in the gateway configuration:

1. Checks instance-level credentials first
2. Falls back to your user credential vault
3. Raises an error if no matching credential is found

This means you can set credentials once at the user level and they apply to all your instances, or override per-instance for specific needs.

## Next Steps

- [Configuration Reference](configuration.md) -- CLI flags, environment variables, data directory
- [Architecture](architecture.md) -- How the platform works under the hood
- [Development](development.md) -- Set up a dev environment to contribute
