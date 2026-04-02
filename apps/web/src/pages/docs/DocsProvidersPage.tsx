import { Link } from 'react-router-dom';

export function DocsProvidersPage() {
  return (
    <div className="docs-page">
      <h1>AI Providers</h1>

      <p className="docs-intro">
        Aquarium supports 18+ AI providers. Each provider can be configured with API keys
        or, for select providers, via OAuth authentication. All credentials are encrypted at rest
        with AES-256-GCM.
      </p>

      <div className="docs-section">
        <h2>Provider Tiers</h2>
        <p>
          Providers are grouped into three tiers based on how they authenticate and how tightly
          they integrate with the platform.
        </p>

        <div className="docs-provider-grid docs-provider-grid--tiers">
          <div className="docs-provider-card docs-provider-card--tier1">
            <div className="docs-provider-card__badge">Tier 1</div>
            <h3>Deep Integration</h3>
            <p>
              Full OAuth support with automatic token refresh. Uses device-code or PKCE flows
              so you never have to copy-paste API keys manually. The platform handles token
              lifecycle end-to-end.
            </p>
            <p className="docs-provider-card__providers">OpenAI, Anthropic, Google Gemini, GitHub Copilot</p>
          </div>

          <div className="docs-provider-card docs-provider-card--tier2">
            <div className="docs-provider-card__badge">Tier 2</div>
            <h3>Standard Integration</h3>
            <p>
              API key authentication with a wide model selection. Generate a key from the
              provider's dashboard, paste it into the Credentials tab, and you're done.
            </p>
            <p className="docs-provider-card__providers">
              OpenRouter, Ollama, AWS Bedrock, xAI, Together AI, Venice AI, Groq, DeepSeek,
              Mistral, Moonshot/Kimi, MiniMax
            </p>
          </div>

          <div className="docs-provider-card docs-provider-card--tier3">
            <div className="docs-provider-card__badge">Tier 3</div>
            <h3>Proxy &amp; Custom</h3>
            <p>
              Connect to any OpenAI-compatible endpoint. Bring your own proxy server or point
              to a local deployment. Useful for enterprise setups, cost routing, or
              self-hosted models.
            </p>
            <p className="docs-provider-card__providers">LiteLLM, Custom Provider, Telegram Bot</p>
          </div>
        </div>
      </div>

      <div className="docs-section">
        <h2>Tier 1 Providers (OAuth + API Key)</h2>
        <p>
          These providers support OAuth flows alongside traditional API keys. OAuth is recommended
          when available because tokens rotate automatically and you don't need to manage key
          expiration manually.
        </p>

        <div className="docs-provider-card docs-provider-card--full">
          <h3>1. OpenAI</h3>
          <div className="docs-provider-card__meta">
            <span className="docs-badge">API Key</span>
            <span className="docs-badge docs-badge--oauth">OAuth (device-code)</span>
          </div>
          <p>
            The most widely used provider. Supports both a static API key from
            platform.openai.com and a device-code OAuth flow that issues a long-lived
            refresh token.
          </p>
          <div className="docs-provider-card__models">
            <strong>Popular models:</strong> gpt-4o, gpt-4-turbo, gpt-3.5-turbo, gpt-4o-mini
          </div>
          <div className="docs-info-box">
            <strong>OAuth flow:</strong> The platform generates a device code. You visit{' '}
            <code>openai.com/device</code>, enter the code, and approve. The platform receives
            a refresh token automatically and stores it encrypted.
          </div>
        </div>

        <div className="docs-provider-card docs-provider-card--full">
          <h3>2. Anthropic</h3>
          <div className="docs-provider-card__meta">
            <span className="docs-badge">API Key</span>
          </div>
          <p>
            Claude models from Anthropic. Get your API key from{' '}
            <code>console.anthropic.com</code>, then add it to the Credentials tab.
          </p>
          <div className="docs-provider-card__models">
            <strong>Popular models:</strong> claude-3.5-sonnet, claude-3-opus, claude-3-haiku
          </div>
        </div>

        <div className="docs-provider-card docs-provider-card--full">
          <h3>3. Google Gemini</h3>
          <div className="docs-provider-card__meta">
            <span className="docs-badge">API Key</span>
            <span className="docs-badge docs-badge--oauth">OAuth (PKCE redirect)</span>
          </div>
          <p>
            Google's Gemini model family. Supports a standard API key from Google AI Studio
            or a PKCE-based OAuth redirect flow tied to your Google account.
          </p>
          <div className="docs-provider-card__models">
            <strong>Popular models:</strong> gemini-1.5-pro, gemini-1.5-flash, gemini-2.0-flash
          </div>
          <div className="docs-info-box">
            <strong>OAuth flow:</strong> Click "Connect Google" in the Credentials tab. You're
            redirected to Google's consent screen. After approval, you're sent back to the
            platform and tokens are saved automatically.
          </div>
        </div>

        <div className="docs-provider-card docs-provider-card--full">
          <h3>4. GitHub Copilot</h3>
          <div className="docs-provider-card__meta">
            <span className="docs-badge docs-badge--oauth">OAuth only (device-code)</span>
          </div>
          <p>
            Access GPT-4o through your existing GitHub Copilot subscription. No separate API
            key needed. OAuth only.
          </p>
          <div className="docs-provider-card__models">
            <strong>Popular models:</strong> gpt-4o via Copilot
          </div>
          <div className="docs-warning-box">
            Requires an active GitHub Copilot subscription. Internally uses the{' '}
            <code>openai-codex</code> provider with a limited model set (gpt-5.1-codex-mini,
            gpt-5.1-codex-max, etc.).
          </div>
          <div className="docs-info-box">
            <strong>OAuth flow:</strong> The platform generates a device code. You visit{' '}
            <code>github.com/login/device</code>, enter the code, approve the authorization,
            and return to the platform. The token is saved automatically.
          </div>
        </div>
      </div>

      <div className="docs-section">
        <h2>Tier 2 Providers (API Key)</h2>
        <p>
          These providers use a static API key. Generate a key from the provider's dashboard
          and add it to your instance's Credentials tab.
        </p>

        <div className="docs-provider-grid">

          <div className="docs-provider-card">
            <h3>5. OpenRouter</h3>
            <div className="docs-provider-card__meta">
              <span className="docs-badge">API Key</span>
            </div>
            <p>
              An aggregator that routes to 100+ models through a single API. Get a key at{' '}
              <code>openrouter.ai/keys</code>.
            </p>
            <div className="docs-provider-card__models">
              <strong>Models:</strong> Any model on OpenRouter's catalog
            </div>
          </div>

          <div className="docs-provider-card">
            <h3>6. Ollama</h3>
            <div className="docs-provider-card__meta">
              <span className="docs-badge">No key required</span>
            </div>
            <p>
              Run open-source models locally or on your own server. No API key needed. Just
              provide the Ollama server URL (default: <code>http://localhost:11434</code>).
            </p>
            <div className="docs-provider-card__models">
              <strong>Models:</strong> llama3, mistral, codellama, and any model you've pulled
            </div>
          </div>

          <div className="docs-provider-card">
            <h3>7. AWS Bedrock</h3>
            <div className="docs-provider-card__meta">
              <span className="docs-badge">AWS credentials</span>
            </div>
            <p>
              Enterprise AI hosting inside AWS. Uses your AWS access key ID and secret access
              key. Models run in your AWS account's region.
            </p>
            <div className="docs-provider-card__models">
              <strong>Models:</strong> Claude, Titan, Llama via AWS
            </div>
          </div>

          <div className="docs-provider-card">
            <h3>8. xAI (Grok)</h3>
            <div className="docs-provider-card__meta">
              <span className="docs-badge">API Key</span>
            </div>
            <p>
              Elon Musk's AI lab. Get a key at <code>x.ai</code>.
            </p>
            <div className="docs-provider-card__models">
              <strong>Models:</strong> grok-beta
            </div>
          </div>

          <div className="docs-provider-card">
            <h3>9. Together AI</h3>
            <div className="docs-provider-card__meta">
              <span className="docs-badge">API Key</span>
            </div>
            <p>
              Hosted open-source model inference. Get a key at <code>together.xyz</code>.
            </p>
            <div className="docs-provider-card__models">
              <strong>Models:</strong> Llama, Mistral, Mixtral variants
            </div>
          </div>

          <div className="docs-provider-card">
            <h3>10. Venice AI</h3>
            <div className="docs-provider-card__meta">
              <span className="docs-badge">API Key</span>
            </div>
            <p>
              Privacy-focused AI inference. No training on your data. Get a key at{' '}
              <code>venice.ai</code>.
            </p>
            <div className="docs-provider-card__models">
              <strong>Models:</strong> Various open models
            </div>
          </div>

          <div className="docs-provider-card">
            <h3>11. Groq</h3>
            <div className="docs-provider-card__meta">
              <span className="docs-badge">API Key</span>
            </div>
            <p>
              Ultra-fast inference using LPU hardware. Get a key at{' '}
              <code>console.groq.com</code>.
            </p>
            <div className="docs-provider-card__models">
              <strong>Models:</strong> llama3-70b, mixtral-8x7b
            </div>
          </div>

          <div className="docs-provider-card">
            <h3>12. DeepSeek</h3>
            <div className="docs-provider-card__meta">
              <span className="docs-badge">API Key</span>
            </div>
            <p>
              Strong coding and reasoning models from a Chinese AI lab. Get a key at{' '}
              <code>platform.deepseek.com</code>.
            </p>
            <div className="docs-provider-card__models">
              <strong>Models:</strong> deepseek-chat, deepseek-coder
            </div>
          </div>

          <div className="docs-provider-card">
            <h3>13. Mistral</h3>
            <div className="docs-provider-card__meta">
              <span className="docs-badge">API Key</span>
            </div>
            <p>
              French AI lab known for efficient, high-quality models. Get a key at{' '}
              <code>console.mistral.ai</code>.
            </p>
            <div className="docs-provider-card__models">
              <strong>Models:</strong> mistral-large, mistral-medium, mistral-small
            </div>
          </div>

          <div className="docs-provider-card">
            <h3>14. Moonshot / Kimi</h3>
            <div className="docs-provider-card__meta">
              <span className="docs-badge">API Key</span>
            </div>
            <p>
              Chinese AI assistant optimized for long-context tasks. Get a key at{' '}
              <code>platform.moonshot.cn</code>.
            </p>
            <div className="docs-provider-card__models">
              <strong>Models:</strong> moonshot-v1-8k, moonshot-v1-32k
            </div>
          </div>

          <div className="docs-provider-card">
            <h3>15. MiniMax</h3>
            <div className="docs-provider-card__meta">
              <span className="docs-badge">API Key</span>
            </div>
            <p>
              Chinese AI provider with multimodal capabilities.
            </p>
            <div className="docs-provider-card__models">
              <strong>Models:</strong> abab5.5-chat
            </div>
          </div>

        </div>
      </div>

      <div className="docs-section">
        <h2>Tier 3 Providers (Proxy &amp; Custom)</h2>
        <p>
          These options let you connect to any OpenAI-compatible API or specialized integration.
          Useful for enterprise proxies, cost routing, or channel-specific tokens.
        </p>

        <div className="docs-provider-grid">

          <div className="docs-provider-card">
            <h3>16. LiteLLM</h3>
            <div className="docs-provider-card__meta">
              <span className="docs-badge">Proxy URL + API Key</span>
            </div>
            <p>
              A proxy server that normalizes 100+ model providers behind a single OpenAI-compatible
              interface. Run your own LiteLLM server, enter the URL and API key. One credential
              gives access to every model in your LiteLLM config.
            </p>
          </div>

          <div className="docs-provider-card">
            <h3>17. Custom Provider</h3>
            <div className="docs-provider-card__meta">
              <span className="docs-badge">Base URL + API Key</span>
            </div>
            <p>
              Connect to any service that implements the OpenAI chat completions API. Enter the
              base URL and your API key. Works with self-hosted vLLM, llama.cpp servers, Azure
              OpenAI, or any compatible endpoint.
            </p>
          </div>

          <div className="docs-provider-card">
            <h3>18. Telegram Bot</h3>
            <div className="docs-provider-card__meta">
              <span className="docs-badge">Bot API Token</span>
            </div>
            <p>
              A special provider for Telegram channel integration. Uses a Telegram Bot API token
              obtained from BotFather. This isn't a language model provider but enables the
              Telegram channel on your instance.
            </p>
          </div>

        </div>
      </div>

      <div className="docs-section">
        <h2>OAuth Authentication Flows</h2>
        <p>
          OAuth flows let you connect to a provider without ever seeing an API key. The platform
          handles token storage, encryption, and refresh automatically.
        </p>

        <h3>OpenAI Device-Code Flow</h3>
        <p>
          Device-code flows are designed for headless or embedded clients. The platform acts as
          the client and polls for approval while you authenticate in your browser.
        </p>
        <ol className="docs-steps">
          <li className="docs-step">
            In the Credentials tab, click <strong>"Connect OpenAI"</strong> (or choose OpenAI
            during the setup wizard).
          </li>
          <li className="docs-step">
            The platform displays a user code, for example <code>ABCD-1234</code>.
          </li>
          <li className="docs-step">
            Click the link to open <code>openai.com/device</code> in a new tab.
          </li>
          <li className="docs-step">
            Enter the user code on OpenAI's website.
          </li>
          <li className="docs-step">
            Approve the authorization request.
          </li>
          <li className="docs-step">
            Return to the platform. It detects the approval automatically within a few seconds.
          </li>
          <li className="docs-step">
            Your refresh token is saved and encrypted with AES-256-GCM.
          </li>
        </ol>

        <h3>Google PKCE Flow</h3>
        <p>
          PKCE (Proof Key for Code Exchange) is a redirect-based flow suited for web clients.
          No client secret is exposed.
        </p>
        <ol className="docs-steps">
          <li className="docs-step">
            In the Credentials tab, click <strong>"Connect Google"</strong>.
          </li>
          <li className="docs-step">
            You're redirected to Google's consent screen.
          </li>
          <li className="docs-step">
            Select your Google account and approve access to the requested scopes.
          </li>
          <li className="docs-step">
            You're redirected back to the platform.
          </li>
          <li className="docs-step">
            Tokens are saved and encrypted automatically. No further action needed.
          </li>
        </ol>

        <h3>GitHub Copilot Device-Code Flow</h3>
        <p>
          Same device-code pattern as OpenAI, but authenticates with GitHub's OAuth server
          to obtain a Copilot-scoped access token.
        </p>
        <ol className="docs-steps">
          <li className="docs-step">
            In the Credentials tab, click <strong>"Connect GitHub Copilot"</strong>.
          </li>
          <li className="docs-step">
            The platform displays a user code.
          </li>
          <li className="docs-step">
            Click the link to open <code>github.com/login/device</code>.
          </li>
          <li className="docs-step">
            Enter the user code.
          </li>
          <li className="docs-step">
            Approve the authorization request on GitHub.
          </li>
          <li className="docs-step">
            Return to the platform. The token is saved automatically.
          </li>
        </ol>
        <div className="docs-warning-box">
          GitHub Copilot requires an active subscription. Internally, the platform maps this
          to the <code>openai-codex</code> provider with a limited model selection:{' '}
          <code>gpt-5.1-codex-mini</code>, <code>gpt-5.1-codex-max</code>, and a few others.
          Standard OpenAI models aren't available through the Copilot token.
        </div>
      </div>

      <div className="docs-section">
        <h2>Credential Vault</h2>
        <p>
          The platform stores credentials at two levels. Understanding which level to use saves
          time when you're managing multiple instances or spinning up templates.
        </p>

        <h3>1. Instance Credentials</h3>
        <p>
          Tied to a specific instance. Added via the Credentials tab on the instance page. Only
          that instance can use them. Good for credentials you don't want to share across
          instances, or when different instances need different keys for the same provider.
        </p>

        <h3>2. User Credential Vault</h3>
        <p>
          A cross-instance credential store accessible from your profile. Add a credential once
          and reuse it across any template instantiation.
        </p>
        <ol className="docs-steps">
          <li className="docs-step">
            Navigate to your <strong>Profile</strong> page and find the Credential Vault section.
          </li>
          <li className="docs-step">
            Add a credential with: Provider, Credential Type, Value, and a Display Name.
          </li>
          <li className="docs-step">
            When instantiating a template that declares credential requirements via{' '}
            <code>{'${CREDENTIAL:provider:type}'}</code> placeholders, the platform checks your
            vault automatically and injects the matching values.
          </li>
        </ol>
        <div className="docs-info-box">
          <strong>Credential resolution order:</strong> Instance credentials are checked first.
          If not found, the platform checks your User Credential Vault. If still not found, you'll
          be prompted to add the missing credential before the instance can start.
        </div>
      </div>

      <div className="docs-section">
        <h2>Adding Credentials to an Instance</h2>
        <p>
          Most providers require a credential before your instance can use them. Here's the
          standard flow for adding an API key directly to an instance.
        </p>
        <ol className="docs-steps">
          <li className="docs-step">
            Navigate to your <Link to="/docs/instances">instance page</Link>.
          </li>
          <li className="docs-step">
            Click the <strong>"Credentials"</strong> tab.
          </li>
          <li className="docs-step">
            Click <strong>"Add Credential"</strong>.
          </li>
          <li className="docs-step">
            Select the provider, for example <code>openai</code>.
          </li>
          <li className="docs-step">
            Choose the credential type. For most providers this is <code>api_key</code>.
          </li>
          <li className="docs-step">
            Paste your API key into the value field.
          </li>
          <li className="docs-step">
            Click <strong>Save</strong>. The key is encrypted immediately before storage.
          </li>
          <li className="docs-step">
            Restart your instance for the new credential to take effect. See{' '}
            <Link to="/docs/instances">Managing Instances</Link> for restart steps.
          </li>
        </ol>
        <div className="docs-info-box">
          Credentials are written to the instance's config file on startup via the{' '}
          <Link to="/docs/workspace">workspace adapter</Link>. The raw key is never stored in
          plaintext on disk.
        </div>
      </div>
    </div>
  );
}
