import { Link } from 'react-router-dom';

export function DocsGettingStartedPage() {
  return (
    <div className="docs-getting-started">
      <div className="docs-section">
        <h1>Getting Started</h1>
        <p>
          This guide walks you through everything from creating an account to sending your
          first message to an AI bot. The whole process takes about 5 minutes once you have
          an API key ready.
        </p>
      </div>

      <div className="docs-section">
        <h2>Create Your Account</h2>
        <p>
          Head to the platform at{' '}
          <a href="https://agent.jinkomcp.com/signup" target="_blank" rel="noopener noreferrer">
            agent.jinkomcp.com/signup
          </a>{' '}
          and fill in the registration form. You'll need three things:
        </p>

        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-number">1</div>
            <div className="docs-step-content">
              <strong>Email address</strong> — used as your login identity. No verification
              email is required; you can sign in immediately after registering.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">2</div>
            <div className="docs-step-content">
              <strong>Password</strong> — pick something strong. The platform stores only a
              bcrypt hash, never the raw password.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">3</div>
            <div className="docs-step-content">
              <strong>Display name</strong> — shown in the dashboard header and activity logs.
              You can change it later in your profile settings.
            </div>
          </div>
        </div>

        <p>
          Click <strong>Sign Up</strong>. The platform creates your account and redirects you
          to the dashboard where you'll manage all your bot instances.
        </p>
      </div>

      <div className="docs-section">
        <h2>Create Your First Instance</h2>
        <p>
          An <em>instance</em> is a single running bot, contained in its own Docker container
          with isolated credentials, workspace files, and message history. You can run multiple
          instances simultaneously, each configured for a different purpose.
        </p>
        <p>
          From the dashboard, click the <strong>New Instance</strong> button in the top-right
          corner. A creation form appears with several fields:
        </p>

        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-number">1</div>
            <div className="docs-step-content">
              <strong>Name</strong> — give it a short, memorable label like "My Assistant"
              or "Work Bot". This is just for your own reference in the dashboard list.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">2</div>
            <div className="docs-step-content">
              <strong>Agent Type</strong> — select <em>OpenClaw</em>. This is the default and
              currently the only available agent type on the platform.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">3</div>
            <div className="docs-step-content">
              <strong>Image Tag</strong> — leave this as the default value. It points to the
              latest stable release of the OpenClaw gateway. Only change this if you need a
              specific version for testing or compatibility reasons.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">4</div>
            <div className="docs-step-content">
              <strong>AI Provider</strong> — choose the company whose language model you want
              to use. Common choices are <em>OpenAI</em>, <em>Anthropic</em>, or{' '}
              <em>Google</em>. The platform supports 18 providers in total; see{' '}
              <Link to="/docs/providers">AI Providers</Link> for the full list.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">5</div>
            <div className="docs-step-content">
              <strong>Default Model</strong> — pick a specific model from your chosen provider.
              For OpenAI you might pick <em>gpt-4o</em>; for Anthropic,{' '}
              <em>claude-3.5-sonnet</em>; for Google, <em>gemini-2.0-flash</em>. The dropdown
              shows all models available for the selected provider.
            </div>
          </div>
        </div>

        <p>
          Click <strong>Create</strong>. The platform provisions the instance record in the
          database and opens the instance detail page. The bot isn't running yet — that happens
          when you click Start.
        </p>
      </div>

      <div className="docs-section">
        <h2>Setup Wizard</h2>
        <p>
          The first time you open a new instance, a Setup Wizard appears automatically. It
          walks you through the minimum configuration needed before the bot can start. The
          wizard has four steps:
        </p>

        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-number">1</div>
            <div className="docs-step-content">
              <strong>Select Provider &amp; Model</strong> — confirm or change the AI provider
              and model you chose during instance creation. If you haven't decided yet, this
              is your chance to browse the options before committing.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">2</div>
            <div className="docs-step-content">
              <strong>Configure Credentials</strong> — enter your API key for the selected
              provider. For OpenAI, Google, and GitHub Copilot you can also authenticate via
              OAuth instead of pasting an API key directly. OAuth is recommended when you
              don't want to create or manage API keys manually.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">3</div>
            <div className="docs-step-content">
              <strong>Review &amp; Apply</strong> — the wizard shows a summary of all settings
              it's about to write to the instance configuration. Take a moment to confirm
              everything looks correct. You can go back to any previous step if something
              needs adjusting.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">4</div>
            <div className="docs-step-content">
              <strong>Restart</strong> — after the configuration is applied to the gateway,
              the wizard prompts you to restart the instance so the new settings take effect.
              Click the restart button and the instance will reboot with the fresh
              configuration loaded.
            </div>
          </div>
        </div>

        <div className="docs-info-box">
          You can re-run the Setup Wizard at any time from the instance's Config tab. It's
          useful when you want to switch providers or update your credentials without
          manually editing the configuration JSON.
        </div>
      </div>

      <div className="docs-section">
        <h2>Add Your API Key</h2>
        <p>
          If you skipped the Setup Wizard or want to manage credentials directly, go to the
          <strong> Credentials</strong> tab on the instance page. Click <strong>Add Credential</strong>,
          choose your provider from the dropdown, and paste your API key into the value field.
        </p>
        <p>
          Credentials are encrypted with AES-256-GCM before being stored in the database. The
          raw key value is never written to disk unencrypted and is only decrypted in memory
          at runtime when the gateway container starts.
        </p>

        <div className="docs-feature-card">
          <h3>OAuth Authentication</h3>
          <p>
            For OpenAI, Google, and GitHub Copilot you can authenticate via OAuth instead of
            an API key. On the Credentials tab, click <strong>Connect with OAuth</strong> next
            to the provider name. You'll be redirected to the provider's authorization page,
            and after granting access the platform stores the OAuth refresh token automatically.
            No API key required.
          </p>
        </div>

        <p>
          Once credentials are saved, they're injected into the gateway container as
          environment variables when the instance starts. If you update a credential while the
          instance is running, you'll need to restart the instance for the change to take
          effect.
        </p>
      </div>

      <div className="docs-section">
        <h2>Start Your Instance</h2>
        <p>
          With credentials in place, you're ready to start the bot. At the top of the instance
          page, click the green <strong>Start</strong> button in the instance header.
        </p>
        <p>
          The status badge changes to <em>starting</em>. On a first boot, the platform needs
          to pull the Docker image and initialize the gateway, which typically takes 1 to 3
          minutes depending on network speed and server load. Subsequent starts are faster
          because the image is already cached.
        </p>
        <p>
          While the instance is starting, you can watch progress in the <strong>Logs</strong>{' '}
          tab. You'll see the container output stream in real time, including any errors if
          something goes wrong. Common startup issues are usually a missing or invalid API key
          — check the Credentials tab if the logs show an authentication error.
        </p>

        <div className="docs-info-box">
          Once the status badge turns green and shows <em>running</em>, the gateway is fully
          initialized and ready to accept messages.
        </div>

        <div className="docs-warning-box">
          If startup takes longer than 5 minutes and the status hasn't changed, check the
          Logs tab for error messages. The most common cause is an invalid API key or a
          provider that's temporarily unavailable.
        </div>
      </div>

      <div className="docs-section">
        <h2>Start Chatting</h2>
        <p>
          Once the instance is running, switch to the <strong>Chat</strong> tab. You'll see a
          text input at the bottom of the screen. Type any message and press{' '}
          <kbd>Enter</kbd> (or click the send button) to send it to your bot.
        </p>
        <p>
          Your bot's response appears in the message thread above. Responses are streamed in
          real time as the model generates them, so you'll see the text appear progressively
          rather than waiting for the full response.
        </p>
        <p>
          The chat interface renders markdown, so your bot can format responses with headers,
          bold text, bullet lists, and code blocks. If you're using a model that supports tool
          calling, you'll also see tool invocations appear inline in the thread when the bot
          runs a search, reads a file, or uses any other installed skill.
        </p>

        <div className="docs-feature-card">
          <h3>Chat History</h3>
          <p>
            The gateway maintains conversation context automatically. Your bot remembers
            everything said in the current session. Sessions are managed by the gateway's
            built-in session system, which also handles compaction (summarizing older messages)
            to keep the context window from getting too large over long conversations.
          </p>
        </div>
      </div>

      <div className="docs-section">
        <h2>Next Steps</h2>
        <p>
          You now have a working AI bot. Here are a few directions you can take it from here:
        </p>

        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-number">1</div>
            <div className="docs-step-content">
              <Link to="/docs/templates"><strong>Browse Templates</strong></Link> — the template
              marketplace has pre-configured bot personalities covering everything from coding
              assistants to customer support agents. Forking a template is the fastest way to
              get a purpose-built bot running without starting from scratch.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">2</div>
            <div className="docs-step-content">
              <Link to="/docs/skills"><strong>Install Skills</strong></Link> — skills are
              plugin packages that extend what your bot can do. The ClaWHub marketplace has
              community-built skills for web search, calendar access, code execution, and
              much more.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">3</div>
            <div className="docs-step-content">
              <Link to="/docs/workspace"><strong>Configure Workspace Files</strong></Link> —
              workspace files let you define your bot's personality, give it persistent memory,
              set behavioral rules, and pre-load context it should always have available.
              This is where you shape how your bot thinks and responds.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">4</div>
            <div className="docs-step-content">
              <Link to="/docs/channels"><strong>Connect Channels</strong></Link> — once you're
              happy with how your bot behaves in the Chat tab, connect it to WhatsApp or
              Telegram so you can talk to it from your phone just like a regular contact.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
