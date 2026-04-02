import { Link } from 'react-router-dom';

export function DocsHomePage() {
  return (
    <div className="docs-home">
      <div className="docs-section">
        <h1>Aquarium Documentation</h1>
        <p>
          Aquarium is a web-based management interface for running and configuring
          OpenClaw AI gateway instances. You can spin up personal AI assistants connected to
          18+ language model providers, link them to WhatsApp or Telegram, customize their
          personalities with workspace files, and share bot templates with the community.
          Everything runs in isolated containers, so each instance has its own credentials,
          memory, and configuration.
        </p>
        <p>
          Pick a topic below to get started, or jump straight to{' '}
          <Link to="/docs/getting-started">Getting Started</Link> if this is your first time
          on the platform.
        </p>
      </div>

      <div className="docs-nav-cards">
        <Link to="/docs/getting-started" className="docs-nav-card">
          <h3>Getting Started</h3>
          <p>Create your account and launch your first AI bot in minutes</p>
        </Link>

        <Link to="/docs/instances" className="docs-nav-card">
          <h3>Instances</h3>
          <p>Manage your AI bot instances — start, stop, configure, monitor</p>
        </Link>

        <Link to="/docs/providers" className="docs-nav-card">
          <h3>AI Providers</h3>
          <p>Connect 18+ AI providers including OpenAI, Anthropic, Google, and more</p>
        </Link>

        <Link to="/docs/workspace" className="docs-nav-card">
          <h3>Workspace Files</h3>
          <p>Customize your bot's personality, memory, and behavior</p>
        </Link>

        <Link to="/docs/templates" className="docs-nav-card">
          <h3>Templates</h3>
          <p>Browse and share bot templates in the marketplace</p>
        </Link>

        <Link to="/docs/skills" className="docs-nav-card">
          <h3>Skills &amp; ClaWHub</h3>
          <p>Extend your bot with community skills and integrations</p>
        </Link>

        <Link to="/docs/channels" className="docs-nav-card">
          <h3>Channels</h3>
          <p>Connect your bot to WhatsApp and Telegram</p>
        </Link>

        <Link to="/docs/group-chats" className="docs-nav-card">
          <h3>Group Chats</h3>
          <p>Create conversations between multiple AI agents</p>
        </Link>

        <Link to="/docs/about" className="docs-nav-card">
          <h3>About</h3>
          <p>The story behind Aquarium</p>
        </Link>
      </div>
    </div>
  );
}
