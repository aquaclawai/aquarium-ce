import { Link } from 'react-router-dom';

export function DocsSkillsPage() {
  return (
    <div className="docs-page">
      <h1>Skills &amp; ClaWHub</h1>

      <p className="docs-lead">
        ClaWHub is the skill registry for OpenClaw. Skills are pre-built capabilities that extend
        your bot — from web search to flight booking, code execution to data analysis. Browse,
        install, and manage skills directly from your instance's Skills tab.
      </p>

      <section className="docs-section">
        <h2>What Are Skills?</h2>
        <p>
          Skills are packages of tools, prompts, and configurations that give your bot new
          abilities. Think of them like apps for your AI agent — each one unlocks a specific
          capability or domain.
        </p>
        <ul>
          <li>
            Each skill defines one or more{' '}
            <strong>MCP (Model Context Protocol) tools</strong> that the AI can call during
            conversations.
          </li>
          <li>
            Skills can have <strong>requirements</strong> — certain API keys, provider
            configurations, or model capabilities your instance needs to support the skill.
          </li>
          <li>
            Skills are <strong>versioned and community-maintained</strong>. When a skill
            updates, you'll see an upgrade prompt in the Skills tab.
          </li>
          <li>
            Some skills are <strong>bundled</strong> with OpenClaw (built-in, no download
            needed). Others come from the ClaWHub registry and need to be installed.
          </li>
        </ul>
      </section>

      <section className="docs-section">
        <h2>The Skills Tab</h2>
        <p>
          Every instance page has a <strong>Skills / ClaWHub</strong> tab. Here's what you'll
          find there:
        </p>
        <ul>
          <li>
            <strong>Summary stats</strong> at the top: total skills available in ClaWHub,
            how many are installed on this instance, and how many your instance is eligible
            to use based on its current configuration.
          </li>
          <li>
            <strong>Filter tabs:</strong>
            <ul>
              <li><em>All</em> — browse every skill in the registry</li>
              <li><em>Eligible</em> — skills your instance can actually use right now</li>
              <li><em>Enabled</em> — skills that are currently active</li>
            </ul>
          </li>
          <li>
            A <strong>search bar</strong> lets you find skills by name or description.
          </li>
          <li>
            Each skill card shows the skill name, description, version, and whether it's
            bundled, installed, or available from the registry.
          </li>
        </ul>
      </section>

      <section className="docs-section">
        <h2>Enabling Bundled Skills</h2>
        <p>
          Bundled skills ship with OpenClaw itself. They don't need to be downloaded —
          they're already part of your instance's runtime.
        </p>
        <ol className="docs-steps">
          <li className="docs-step">Open your instance page and click the <strong>Skills / ClaWHub</strong> tab.</li>
          <li className="docs-step">Look for skills with the <strong>"bundled"</strong> badge.</li>
          <li className="docs-step">Click the toggle switch to enable the skill.</li>
          <li className="docs-step">The change takes effect immediately — no restart required.</li>
        </ol>
        <p>
          To disable, flip the toggle off. The skill's tools become unavailable to the AI
          but nothing is uninstalled.
        </p>
      </section>

      <section className="docs-section">
        <h2>Installing Community Skills</h2>
        <p>There are two ways to install a skill from ClaWHub.</p>

        <h3>Method 1 — Via the Skills Tab</h3>
        <ol className="docs-steps">
          <li className="docs-step">Open the <strong>Skills / ClaWHub</strong> tab on your instance page.</li>
          <li className="docs-step">Browse or search for a skill in the registry.</li>
          <li className="docs-step">
            Click the skill card to see its full description, version history, and
            requirements.
          </li>
          <li className="docs-step">
            If your instance meets all the requirements, the <strong>Install</strong> button
            will be active. Click it.
          </li>
          <li className="docs-step">
            Installation runs in the background. It may take <strong>up to 2 minutes</strong>{' '}
            for the skill to download, configure, and become active.
          </li>
          <li className="docs-step">
            Once installed, the skill card shows an "Enabled" badge and its tools are
            available to the AI.
          </li>
        </ol>

        <h3>Method 2 — Via Chat</h3>
        <ol className="docs-steps">
          <li className="docs-step">Open the <strong>Chat</strong> tab on your instance page.</li>
          <li className="docs-step">
            Type the install command:
            <div className="docs-code-block">clawhub install &lt;skill-name&gt;</div>
            For example:
            <div className="docs-code-block">clawhub install jinko-flight-search</div>
          </li>
          <li className="docs-step">
            The bot will handle the installation and confirm when the skill is ready.
          </li>
        </ol>

        <div className="docs-info-box">
          <strong>Note:</strong> Skill installation triggers a <code>session_spawn</code> in the
          gateway for isolated execution. Your instance needs the <code>sessions_spawn</code>{' '}
          permission configured, which is set automatically by the platform.
        </div>
      </section>

      <section className="docs-section">
        <h2>Skill Requirements</h2>
        <p>
          Some skills need external credentials or specific configuration before they'll
          work. The Skills tab makes this visible.
        </p>
        <ul>
          <li>
            Skills with unmet requirements show a <strong>warning icon</strong> on their
            card. Hover to see exactly what's missing.
          </li>
          <li>
            Most commonly, skills need <strong>API keys</strong> added to your instance's
            Credentials tab. For example:
            <ul>
              <li>
                <code>jinko-flight-search</code> requires a{' '}
                <strong>Travelfusion API key</strong> configured as a credential.
              </li>
            </ul>
          </li>
          <li>
            Add the required credentials first (via the <strong>Credentials</strong> tab),
            then return to Skills to install.
          </li>
          <li>
            Some skills require a specific <strong>AI provider</strong> or model capability.
            Check the skill's requirements section for details.
          </li>
        </ul>
        <p>
          Need help setting up credentials? See the{' '}
          <Link to="/docs/instances">Instances</Link> documentation.
        </p>
      </section>

      <section className="docs-section">
        <h2>Managing Installed Skills</h2>
        <ul>
          <li>
            <strong>Toggle on/off</strong> from the Skills tab at any time. Disabling a skill
            deactivates its tools without removing the installation.
          </li>
          <li>
            Re-enable a disabled skill instantly — no re-download needed.
          </li>
          <li>
            When a newer version is available, an <strong>Upgrade</strong> button appears on
            the skill card. Upgrades are applied in-place.
          </li>
          <li>
            To fully remove a skill, use the <strong>Uninstall</strong> option in the skill
            card's menu.
          </li>
        </ul>
      </section>

      <section className="docs-section">
        <h2>Tips</h2>
        <ul>
          <li>
            Start with <strong>bundled skills</strong> to explore what's possible before
            adding third-party integrations.
          </li>
          <li>
            Always check skill requirements before installing — missing credentials will
            cause the skill to fail silently.
          </li>
          <li>
            Some skills work better with specific AI models. For instance, tool-heavy skills
            benefit from models with strong function-calling support.
          </li>
          <li>
            If a skill install seems stuck, check the instance logs in the{' '}
            <strong>Logs</strong> tab for errors.
          </li>
          <li>
            The chat method (<code>clawhub install</code>) is handy if you already have a
            chat session open.
          </li>
        </ul>
      </section>

      <nav className="docs-page-nav">
        <Link to="/docs/templates" className="docs-page-nav__prev">
          &larr; Templates
        </Link>
        <Link to="/docs/channels" className="docs-page-nav__next">
          Channels &rarr;
        </Link>
      </nav>
    </div>
  );
}
