import { Link } from 'react-router-dom';

export function DocsTemplatesPage() {
  return (
    <div className="docs-templates">
      <div className="docs-section">
        <h1>Bot Templates</h1>
        <p>
          The Template Marketplace lets you browse, share, and reuse pre-configured bot
          setups. A template packages workspace files, MCP server configurations, skill
          definitions, and credential requirements into a reusable unit you can instantiate
          with a few clicks.
        </p>
      </div>

      <div className="docs-section">
        <h2>Browsing the Marketplace</h2>
        <p>
          The marketplace is accessible from the dashboard sidebar or the top navigation bar.
          You can search or filter to find what you need:
        </p>
        <ul>
          <li>
            <strong>Search</strong> by name or keyword to find templates matching a specific
            use case.
          </li>
          <li>
            <strong>Filter by category:</strong> Customer Service, Sales, Coding, Personal,
            Education, Research, Creative, or Custom.
          </li>
          <li>
            Each template card shows its name, description, author, category, install count,
            and fork count at a glance.
          </li>
          <li>
            Click any template to open the detail page, which shows the full description,
            workspace file previews, required credentials, and included MCP server configs.
          </li>
        </ul>
      </div>

      <div className="docs-section">
        <h2>Instantiating a Template</h2>
        <p>
          Instantiating creates a new bot instance pre-loaded with everything in the template.
          No manual setup needed for the workspace files or MCP configs.
        </p>

        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-number">1</div>
            <div className="docs-step-content">
              Find a template you like in the marketplace.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">2</div>
            <div className="docs-step-content">
              Click <strong>Use Template</strong> (also labeled "Instantiate" on some views).
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">3</div>
            <div className="docs-step-content">
              Enter a name for your new instance.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">4</div>
            <div className="docs-step-content">
              Choose a <strong>deployment target</strong> — Docker or Kubernetes. This defaults
              to whatever the platform is currently configured to use.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">5</div>
            <div className="docs-step-content">
              If the template declares credential requirements (for example, an OpenAI API key),
              you'll see a warning listing any missing credentials. You can proceed anyway and
              add them after creation.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">6</div>
            <div className="docs-step-content">
              Click <strong>Create</strong>. The platform provisions a new instance with all
              the template's workspace files and configuration pre-loaded.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">7</div>
            <div className="docs-step-content">
              If any credentials were flagged as missing, go to the <strong>Credentials</strong>{' '}
              tab and add them now.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">8</div>
            <div className="docs-step-content">
              Click <strong>Start</strong>. The instance boots up with the template's full
              configuration active from the first session.
            </div>
          </div>
        </div>

        <div className="docs-info-box">
          Instances created from a template are fully independent from that point on. Changes
          you make to the instance don't affect the original template, and template updates
          don't automatically propagate to existing instances.
        </div>
      </div>

      <div className="docs-section">
        <h2>Forking a Template</h2>
        <p>
          Forking creates a personal copy of any marketplace template under your own account.
          Use it when you want to start from someone else's template but make significant
          customizations.
        </p>
        <ul>
          <li>You become the author of the forked copy.</li>
          <li>You can modify the fork freely without affecting the original template.</li>
          <li>
            The forked template appears in your template list alongside any templates you
            created from scratch.
          </li>
          <li>
            Click the <strong>Fork</strong> button on any template's detail page to create
            your copy immediately.
          </li>
        </ul>

        <div className="docs-info-box">
          The original template's fork count increments when you fork it, giving authors
          visibility into how widely their templates are being used.
        </div>
      </div>

      <div className="docs-section">
        <h2>Creating a Template</h2>
        <p>There are two ways to create a template: from scratch, or by exporting a live instance.</p>

        <h3>Option A — From Scratch</h3>
        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-number">1</div>
            <div className="docs-step-content">
              Navigate to the Templates page and click <strong>Create Template</strong>.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">2</div>
            <div className="docs-step-content">
              Fill in the basic metadata: <strong>Name</strong>, <strong>Slug</strong>{' '}
              (the URL-friendly identifier, like <code>my-coding-assistant</code>),{' '}
              <strong>Description</strong>, <strong>Category</strong>, and{' '}
              <strong>Tags</strong>.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">3</div>
            <div className="docs-step-content">
              Define the content for each workspace file. At minimum, fill in SOUL.md to give
              the bot a personality. See{' '}
              <Link to="/docs/workspace">Workspace Files</Link> for what each file does.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">4</div>
            <div className="docs-step-content">
              Optionally configure MCP servers and skills that the template should include.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">5</div>
            <div className="docs-step-content">
              Set the <strong>license</strong>: <em>Public</em> (visible to everyone in the
              marketplace), <em>Private</em> (only accessible to you), or{' '}
              <em>Unlisted</em> (accessible via direct link but not listed in search results).
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">6</div>
            <div className="docs-step-content">
              Click <strong>Publish</strong>.
            </div>
          </div>
        </div>

        <h3>Option B — Export from an Existing Instance</h3>
        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-number">1</div>
            <div className="docs-step-content">
              Navigate to the instance you want to export.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">2</div>
            <div className="docs-step-content">
              Use the <strong>Export as Template</strong> action from the instance settings or
              actions menu.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">3</div>
            <div className="docs-step-content">
              The platform captures all workspace files, MCP server configs, and skill settings
              from the running instance and pre-fills the template form.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">4</div>
            <div className="docs-step-content">
              Edit the template metadata: name, description, category, and any other fields
              you want to set before publishing.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">5</div>
            <div className="docs-step-content">
              Credential values are <strong>not</strong> exported. Only placeholder declarations
              are captured. This ensures you never accidentally share API keys or tokens when
              publishing a template.
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-number">6</div>
            <div className="docs-step-content">
              Click <strong>Publish</strong>.
            </div>
          </div>
        </div>
      </div>

      <div className="docs-section">
        <h2>Template Versioning</h2>
        <p>
          Templates use semantic versioning. Every time you update a published template, the
          platform creates a new row with a bumped version number rather than overwriting the
          existing one.
        </p>
        <ul>
          <li>
            The <code>is_latest</code> flag marks the currently active version. The marketplace
            always shows the latest version to users browsing.
          </li>
          <li>
            Instances created from older versions are not affected when you publish an update.
            They keep running against the config they were created with.
          </li>
          <li>
            If you need to roll back a template, contact support — previous versions are
            retained in the database and can be re-flagged as latest.
          </li>
        </ul>

        <div className="docs-warning-box">
          Publishing a template update doesn't automatically update any instances that were
          created from previous versions. Users who want the latest version need to create
          a new instance from the updated template.
        </div>
      </div>

      <div className="docs-section">
        <h2>Credential Placeholders</h2>
        <p>
          Templates can declare that they require certain credentials without embedding the
          actual secret values. Placeholders use the syntax{' '}
          <code>{'${CREDENTIAL:provider:type}'}</code>.
        </p>
        <p>
          For example, <code>{'${CREDENTIAL:openai:api_key}'}</code> tells the platform that
          this template needs an OpenAI API key. When someone instantiates the template, the
          platform resolves credentials in three layers:
        </p>
        <ol>
          <li>
            <strong>Instance credentials</strong> — credentials already attached to the newly
            created instance.
          </li>
          <li>
            <strong>User vault</strong> — credentials stored in your profile's User Vault (see
            the Profile page). If a matching credential is found here, it's automatically
            applied to the instance without any extra steps.
          </li>
          <li>
            <strong>Prompt user</strong> — if no matching credential is found in either place,
            the platform shows a warning listing what's missing so you know what to add after
            creation.
          </li>
        </ol>

        <div className="docs-info-box">
          Adding your API keys to the <strong>User Vault</strong> on your Profile page means
          you'll never be prompted for credentials again when instantiating templates that
          need the same provider. The platform handles the wiring automatically.
        </div>
      </div>

      <div className="docs-section">
        <h2>Related</h2>
        <ul>
          <li>
            <Link to="/docs/workspace">Workspace Files</Link> — understand what goes inside a
            template's workspace file set and how each file shapes bot behavior.
          </li>
          <li>
            <Link to="/docs/instances">Instances</Link> — the full instance lifecycle,
            including how template-created instances are managed after creation.
          </li>
          <li>
            <Link to="/docs/skills">Skills</Link> — skill packages that can be bundled with
            templates to give bots pre-built capabilities out of the box.
          </li>
          <li>
            <Link to="/docs/providers">AI Providers</Link> — provider setup details, including
            which credential types the placeholder syntax supports.
          </li>
        </ul>
      </div>
    </div>
  );
}
