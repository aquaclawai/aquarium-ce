import { Link } from 'react-router-dom';

export function DocsWorkspacePage() {
  return (
    <div className="docs-workspace">
      <div className="docs-section">
        <h1>Workspace Files</h1>
        <p>
          OpenClaw uses 8 markdown files to define your bot's personality, behavior, and
          capabilities. These files are edited directly in the platform via the Workspace tab
          on your instance page. Changes are saved to the database and synced to your running
          instance.
        </p>
      </div>

      <div className="docs-section">
        <h2>SOUL.md</h2>
        <p>
          The personality and values file. This is the most important workspace file — it
          defines your bot's core character, communication style, ethical boundaries, and
          guiding principles. The gateway loads SOUL.md at session start and uses it as the
          foundation for every interaction.
        </p>
        <p>
          Spend real time on this file. A vague SOUL.md produces an inconsistent bot. A
          specific, opinionated one produces a bot that feels deliberate and trustworthy.
        </p>
        <pre className="docs-code-block"><code>{`You are a helpful and friendly AI assistant.
You speak in a warm, professional tone.
You never provide medical, legal, or financial advice.
You always cite your sources when sharing factual information.`}</code></pre>
      </div>

      <div className="docs-section">
        <h2>AGENTS.md</h2>
        <p>
          Task-to-model mapping. AGENTS.md tells the gateway which AI model to use for
          different categories of tasks. This is useful when you want to route complex queries
          to a more capable (and more expensive) model while keeping simple questions on a
          cheaper one.
        </p>
        <p>
          The gateway reads this file when deciding how to handle each incoming request. If
          no match is found, it falls back to the default model configured in the provider
          settings.
        </p>
        <pre className="docs-code-block"><code>{`## Task Routing
- Simple questions: gpt-4o-mini
- Complex analysis: gpt-4o
- Code generation: claude-3.5-sonnet`}</code></pre>
      </div>

      <div className="docs-section">
        <h2>IDENTITY.md</h2>
        <p>
          Name and persona. Sets the bot's name and self-image. The bot refers to itself
          using this identity when introducing itself, responding to "who are you" questions,
          or signing off in conversations.
        </p>
        <p>
          IDENTITY.md is loaded once at session start alongside SOUL.md. Changing the bot's
          name here takes effect after the next restart.
        </p>
        <pre className="docs-code-block"><code>{`Name: Luna
Role: Personal Research Assistant
I help users find, summarize, and analyze information.`}</code></pre>
      </div>

      <div className="docs-section">
        <h2>USER.md</h2>
        <p>
          User context. Store information about yourself that the bot should always have in
          mind. This could include your name, job, technical background, preferred language,
          or any recurring context that helps personalize responses.
        </p>
        <p>
          The gateway injects USER.md into the context at the start of each session. Unlike
          MEMORY.md, this file is intended for stable facts — the bot won't write back to it.
        </p>
        <pre className="docs-code-block"><code>{`Name: Alice
Role: Data Scientist at TechCorp
Interests: Machine learning, Python, data visualization
Preferred language: English`}</code></pre>
      </div>

      <div className="docs-section">
        <h2>TOOLS.md</h2>
        <p>
          Function definitions. TOOLS.md declares custom tools or functions the bot can call
          during a conversation. Tools extend the bot's capabilities beyond text generation —
          they let it take actions, retrieve live data, or run calculations.
        </p>
        <p>
          The gateway reads TOOLS.md at startup and registers each declared tool with the
          model's function-calling system. For skills installed via the marketplace, this file
          acts as the reference for what's available. See{' '}
          <Link to="/docs/skills">Skills</Link> for more on extending your bot with pre-built
          tool packages.
        </p>
        <pre className="docs-code-block"><code>{`## Available Tools
- web_search: Search the web for current information
- calculator: Perform mathematical calculations`}</code></pre>
      </div>

      <div className="docs-section">
        <h2>BOOTSTRAP.md</h2>
        <p>
          Initialization instructions. These are the first instructions the bot sees when
          starting a new session. Use this file for setup tasks, a welcome routine, or any
          one-time work that should happen before the user says anything.
        </p>
        <p>
          BOOTSTRAP.md runs once per session start, not on every message. If you want
          repeating background tasks, use HEARTBEAT.md instead.
        </p>
        <pre className="docs-code-block"><code>{`On startup:
1. Greet the user by name (from USER.md)
2. Summarize any pending tasks from MEMORY.md
3. Ask how you can help today`}</code></pre>
      </div>

      <div className="docs-section">
        <h2>HEARTBEAT.md</h2>
        <p>
          Background tasks. The bot checks HEARTBEAT.md on a regular interval and runs any
          periodic tasks you've defined. This is how you give your bot proactive behavior —
          checking emails, updating task lists, or sending reminders without being asked.
        </p>
        <p>
          Keep heartbeat tasks lightweight. They run on a timer in the background, so heavy
          operations can interfere with normal conversation responsiveness.
        </p>
        <pre className="docs-code-block"><code>{`Every 30 minutes:
- Check for new emails and summarize them
- Update the daily task list in MEMORY.md`}</code></pre>
      </div>

      <div className="docs-section">
        <h2>MEMORY.md</h2>
        <p>
          Long-term notes. A persistent scratchpad where the bot stores information across
          sessions. MEMORY.md is the only workspace file the bot reads <em>and writes to</em>.
          Anything the bot records here survives session restarts and is available next time
          the conversation picks up.
        </p>
        <p>
          Don't put static configuration in this file. Because the bot can overwrite it, any
          manual changes you make might be replaced the next time the bot updates its memory.
          Static context belongs in USER.md; instructions belong in SOUL.md or BOOTSTRAP.md.
        </p>
        <pre className="docs-code-block"><code>{`## User Preferences
- Prefers bullet points over paragraphs
- Likes code examples in Python

## Ongoing Tasks
- Research report on renewable energy (due Friday)`}</code></pre>
      </div>

      <div className="docs-section">
        <h2>How to Edit Workspace Files</h2>
        <p>
          All workspace files are editable directly in the platform without any external
          tooling. Here's the full flow:
        </p>

        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-number">1</div>
            <div className="docs-step-content">
              Navigate to your instance page by clicking the instance name on the dashboard.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">2</div>
            <div className="docs-step-content">
              Click the <strong>Workspace</strong> tab in the instance navigation bar.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">3</div>
            <div className="docs-step-content">
              Select the file you want to edit from the file list on the left side of the editor.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">4</div>
            <div className="docs-step-content">
              Edit the content in the text editor. The editor accepts plain markdown with no
              special syntax requirements.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">5</div>
            <div className="docs-step-content">
              Click <strong>Save</strong> to persist your changes to the database.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">6</div>
            <div className="docs-step-content">
              Changes are automatically synced to the running instance. Some changes (like
              provider configuration) require a restart to take effect, but personality and
              behavior files typically apply on the next session.
            </div>
          </div>
        </div>
      </div>

      <div className="docs-section">
        <h2>Tips</h2>
        <ul>
          <li>
            <strong>SOUL.md is your highest-leverage file.</strong> Spend time crafting it.
            Specificity beats generality — "be concise" works, but "respond in 3 sentences or
            fewer unless asked to elaborate" works better.
          </li>
          <li>
            <strong>MEMORY.md is the only file the bot writes to.</strong> Don't put static
            config here, or the bot may overwrite it.
          </li>
          <li>
            <strong>Use BOOTSTRAP.md for one-time setup.</strong> If you want something to
            happen at the start of every session but only once, not repeatedly, that's what
            BOOTSTRAP.md is for.
          </li>
          <li>
            <strong>Keep HEARTBEAT.md tasks lightweight.</strong> They run on a timer in the
            background, so avoid anything that blocks for a long time.
          </li>
        </ul>

        <div className="docs-info-box">
          If you want to reset a file to its default content, delete everything in the editor
          and save an empty file. The platform treats an empty file as "not configured" and
          the gateway falls back to sensible defaults.
        </div>
      </div>

      <div className="docs-section">
        <h2>Related</h2>
        <p>
          Workspace files work alongside other configuration systems. For more context, see:
        </p>
        <ul>
          <li>
            <Link to="/docs/instances">Instances</Link> — how instances are created, started,
            and stopped, and where workspace files live in the broader instance lifecycle.
          </li>
          <li>
            <Link to="/docs/templates">Bot Templates</Link> — pre-packaged workspace file sets
            you can fork and customize rather than writing from scratch.
          </li>
          <li>
            <Link to="/docs/skills">Skills</Link> — tool packages that pair with TOOLS.md to
            give your bot concrete capabilities like web search or calendar access.
          </li>
        </ul>
      </div>
    </div>
  );
}
