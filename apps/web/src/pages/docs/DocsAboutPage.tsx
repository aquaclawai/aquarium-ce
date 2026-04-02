import { Link } from 'react-router-dom';

export function DocsAboutPage() {
  return (
    <div className="docs-about">
      <div className="docs-section docs-section--hero">
        <h1>About Aquarium</h1>
        <p className="docs-lead">
          A management platform that makes personal AI assistants accessible to everyone —
          no terminal, no YAML, no DevOps skills required.
        </p>
      </div>

      <div className="docs-section">
        <h2>The Story</h2>
        <p>
          Aquarium was born from a simple observation: the people who generate the
          electricity that powers AI don't have easy access to AI themselves.
        </p>
        <p>
          The creator's wife and her colleagues work in the energy industry in France. They
          produce the electricity consumed by data centers running large language models, yet
          most of them lack the technical background to install, configure, and maintain an
          AI assistant on their own. Setting up an OpenClaw Gateway normally requires a
          terminal, Docker knowledge, JSON config editing, and API key management — skills
          that are second nature to software engineers but a steep cliff for everyone else.
        </p>
        <p>
          Aquarium was built so that anyone — regardless of technical skill — can
          launch a fully configured AI bot in a few clicks. Pick a template, add your API
          key, press <strong>Start</strong>, and you're chatting with your personal assistant.
          No command line. No config files. No deployment pipelines.
        </p>
        <p>
          The platform also serves as a testbed for multi-agent collaboration research: can
          multiple AI agents work together effectively in group conversations? What happens
          when you let a coding bot and a research bot collaborate on the same task? These
          are the questions we explore with the <Link to="/docs/group-chats">Group Chat</Link> feature.
        </p>
      </div>

      <div className="docs-section">
        <h2>Our Vision</h2>
        <div className="docs-features-grid">
          <div className="docs-feature-card">
            <h3>Accessible AI</h3>
            <p>
              Lower the barrier to running personal AI assistants. If you can use a web
              browser, you can run an AI bot.
            </p>
          </div>
          <div className="docs-feature-card">
            <h3>User Ownership</h3>
            <p>
              Your data stays yours. Each instance runs in an isolated container with its
              own credentials, memory, and workspace — never shared with other users.
            </p>
          </div>
          <div className="docs-feature-card">
            <h3>Community Ecosystem</h3>
            <p>
              Share bot configurations through the <Link to="/docs/templates">template
              marketplace</Link>. Fork, customize, and republish — building on each
              other's work.
            </p>
          </div>
          <div className="docs-feature-card">
            <h3>Multi-Agent Research</h3>
            <p>
              Explore how AI agents collaborate in <Link to="/docs/group-chats">group
              chats</Link> — a testbed for multi-agent orchestration and emergent
              teamwork.
            </p>
          </div>
        </div>
      </div>

      <div className="docs-section">
        <h2>Multi-Agent Collaboration</h2>
        <p>
          One of the platform's unique features is its <Link to="/docs/group-chats">Group
          Chat</Link> system, designed as a research environment for multi-agent
          collaboration.
        </p>
        <p>
          You can create group conversations where multiple AI bot instances participate
          alongside human users. Messages are routed via @mentions, and bots can chain
          replies to each other — creating emergent workflows where a research bot gathers
          data, a coding bot processes it, and a writing bot drafts the final report.
        </p>
        <p>
          Key research questions we're exploring:
        </p>
        <ul className="docs-tech-list">
          <li>Can specialized bots outperform a single generalist bot on complex tasks?</li>
          <li>How should agents hand off context to each other?</li>
          <li>What @mention patterns lead to productive bot-to-bot conversations?</li>
          <li>How do different LLM providers perform in collaborative settings?</li>
        </ul>
      </div>

      <div className="docs-section">
        <h2>Technical Architecture</h2>
        <p>
          The platform follows a control-plane / data-plane architecture. The Platform
          Server manages metadata and orchestrates instance lifecycles, while each AI bot
          runs as an isolated OpenClaw Gateway in its own container or Kubernetes pod.
        </p>
        <div className="docs-code-block">
          <pre><code>{`┌─────────────────────────────────────────────────────────┐
│                      Browser                            │
│              React SPA + WebSocket                      │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTPS / WSS
                       ▼
┌──────────────────────┴──────────────────────────────────┐
│                  Platform Server                        │
│              Express + WebSocket Hub                    │
├─────────────┬─────────────────┬─────────────────────────┤
│             │                 │                         │
▼             ▼                 ▼                         │
┌─────────┐  ┌──────────────┐  ┌────────────────┐        │
│PostgreSQL│  │ Orchestrator │  │ Gateway Event  │        │
│  (Data)  │  │(Docker / K8s)│  │    Relay       │        │
└─────────┘  └──────┬───────┘  └───────┬────────┘        │
                    │                  │                  │
                    ▼                  ▼                  │
             ┌──────┴──────────────────┴───────┐         │
             │      Agent Instances            │         │
             │   (Isolated Containers / Pods)  │         │
             │  ┌─────────┐  ┌─────────┐       │         │
             │  │ Bot #1  │  │ Bot #2  │  ...  │         │
             │  └─────────┘  └─────────┘       │         │
             └─────────────────────────────────┘         │
└─────────────────────────────────────────────────────────┘`}</code></pre>
        </div>
      </div>

      <div className="docs-section">
        <h2>Tech Stack</h2>
        <ul className="docs-tech-list">
          <li><strong>Frontend</strong> — React 19 with React Router, vanilla CSS, Vite build</li>
          <li><strong>Backend</strong> — Node.js 22, Express 4, TypeScript 5.7+ (strict mode)</li>
          <li><strong>Database</strong> — PostgreSQL 15+ with Knex query builder, AES-256-GCM encryption for credentials</li>
          <li><strong>Runtime</strong> — Docker (local dev) or Kubernetes on Google Kubernetes Engine (production)</li>
          <li><strong>Real-time</strong> — WebSocket for live logs, status updates, QR codes, and gateway event relay</li>
          <li><strong>Security</strong> — JWT authentication, bcrypt password hashing, encrypted credential storage, instance isolation</li>
          <li><strong>AI Gateway</strong> — OpenClaw Gateway (open-source) with 18+ LLM provider integrations</li>
        </ul>
      </div>

      <div className="docs-section">
        <h2>Open Source</h2>
        <p>
          The <a href="https://github.com/openclaw/openclaw" target="_blank" rel="noopener noreferrer">
          OpenClaw Gateway</a> is an open-source AI assistant framework. It handles the
          core AI capabilities: language model routing, MCP tool execution, channel
          integrations (WhatsApp, Telegram), and workspace-based agent configuration.
        </p>
        <p>
          Aquarium adds the multi-tenant management layer on top: user accounts,
          instance lifecycle orchestration, credential encryption, template marketplace,
          real-time monitoring, and the web-based dashboard. Together, they provide a
          complete solution for running personal AI assistants at any scale — from a single
          bot on your laptop to hundreds of instances across a Kubernetes cluster.
        </p>
      </div>

      <div className="docs-section">
        <h2>Get Involved</h2>
        <p>
          Whether you want to run your own AI bot, share a template with the community, or
          explore multi-agent collaboration — we'd love to have you.
        </p>
        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-number">1</div>
            <div className="docs-step-content">
              <strong>Try it out</strong>
              <p>
                Head to <Link to="/docs/getting-started">Getting Started</Link> and launch
                your first bot in 5 minutes.
              </p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">2</div>
            <div className="docs-step-content">
              <strong>Share your bot</strong>
              <p>
                Built a great configuration? <Link to="/docs/templates">Publish it as a
                template</Link> so others can use it too.
              </p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">3</div>
            <div className="docs-step-content">
              <strong>Experiment with groups</strong>
              <p>
                Create a <Link to="/docs/group-chats">group chat</Link> with multiple bots
                and see what happens when AI agents collaborate.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="docs-link">
        <Link to="/docs">Back to Documentation</Link>
      </div>
    </div>
  );
}
