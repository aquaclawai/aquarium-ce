import { Link } from 'react-router-dom';

export function DocsInstancesPage() {
  return (
    <div className="docs-page">
      <h1>Instance Management</h1>
      <p className="docs-lead">
        An instance is a single running OpenClaw gateway container. Each instance has its own
        configuration, credentials, workspace files, and messaging channel connections. You can
        run multiple instances under one account, each serving a different purpose or persona.
      </p>

      <div className="docs-section">
        <h2>Instance Lifecycle</h2>
        <p>
          Every instance moves through a defined set of states. Understanding these states helps
          you diagnose issues and know when an instance is ready to use.
        </p>

        <div className="docs-state-flow">
          <div className="docs-state-node docs-state-created">
            <span className="docs-state-label">created</span>
          </div>
          <div className="docs-state-arrow">→</div>
          <div className="docs-state-node docs-state-starting">
            <span className="docs-state-label">starting</span>
          </div>
          <div className="docs-state-arrow">→</div>
          <div className="docs-state-node docs-state-running">
            <span className="docs-state-label">running</span>
          </div>
          <div className="docs-state-arrow">→</div>
          <div className="docs-state-node docs-state-stopping">
            <span className="docs-state-label">stopping</span>
          </div>
          <div className="docs-state-arrow">→</div>
          <div className="docs-state-node docs-state-stopped">
            <span className="docs-state-label">stopped</span>
          </div>
          <div className="docs-state-arrow">⇢</div>
          <div className="docs-state-node docs-state-error">
            <span className="docs-state-label">error</span>
          </div>
        </div>

        <div className="docs-state-descriptions">
          <div className="docs-state-desc">
            <strong>created</strong>
            <p>
              A database record exists for the instance but no container or pod has been
              provisioned yet. The instance is ready to be started for the first time.
            </p>
          </div>
          <div className="docs-state-desc">
            <strong>starting</strong>
            <p>
              The platform has sent a start request to the orchestrator. The container image is
              being pulled (if not cached), the pod is being scheduled, and the gateway process
              is booting up. The health monitor polls every 5 seconds during this phase.
              First boot can take 1 to 3 minutes.
            </p>
          </div>
          <div className="docs-state-desc">
            <strong>running</strong>
            <p>
              The gateway health endpoint responded successfully. The instance is fully operational
              and accepting messages. The health monitor shifts to a 30-second polling interval.
            </p>
          </div>
          <div className="docs-state-desc">
            <strong>stopping</strong>
            <p>
              A termination signal has been sent to the container. The gateway is shutting down
              gracefully, flushing any in-flight messages before the process exits.
            </p>
          </div>
          <div className="docs-state-desc">
            <strong>stopped</strong>
            <p>
              The container is gone but all persistent data (workspace files, credentials,
              conversation history) is preserved on disk. The instance can be restarted at any time
              with no data loss.
            </p>
          </div>
          <div className="docs-state-desc">
            <strong>error</strong>
            <p>
              A state transition failed. Open the Events tab and check the <code>status_message</code> field
              for the specific failure reason. Common causes are image pull failures, port conflicts,
              or invalid configuration. Once the underlying issue is resolved, you can start the
              instance again. The health monitor will auto-recover the instance if the Kubernetes
              pod stabilizes on its own after a crash.
            </p>
          </div>
        </div>
      </div>

      <div className="docs-section">
        <h2>Instance Header Actions</h2>
        <p>
          The four action buttons at the top of every instance page control the instance lifecycle.
        </p>

        <div className="docs-tab-grid docs-action-grid">
          <div className="docs-tab-item">
            <div className="docs-tab-name docs-action-start">Start</div>
            <p>
              Provisions and boots the container or Kubernetes pod. Transitions the instance from
              <code>stopped</code> (or <code>created</code>) to <code>starting</code>, then to
              <code>running</code> once the health check passes. Available only when the instance
              is stopped or in error state.
            </p>
          </div>
          <div className="docs-tab-item">
            <div className="docs-tab-name docs-action-stop">Stop</div>
            <p>
              Sends a graceful shutdown signal to the running container. The gateway flushes
              pending operations before exiting. Persistent data is retained. Use this before
              making significant configuration changes if a restart isn't sufficient.
            </p>
          </div>
          <div className="docs-tab-item">
            <div className="docs-tab-name docs-action-restart">Restart</div>
            <p>
              Performs a stop followed immediately by a start. Useful after changing workspace
              files, credentials, or gateway config. The platform waits for the stop to complete
              before issuing the start request.
            </p>
          </div>
          <div className="docs-tab-item">
            <div className="docs-tab-name docs-action-delete">Delete</div>
            <p>
              Permanently removes the instance, its container, and its persistent volume.{' '}
              <strong>This action cannot be undone.</strong> All workspace files, credentials,
              conversation history, and WhatsApp session data are destroyed. Export anything
              you need before deleting.
            </p>
          </div>
        </div>

        <div className="docs-warning-box">
          <strong>Warning:</strong> Deleting an instance removes the persistent volume along with
          it. If you have a WhatsApp session linked, the phone will need to be re-paired after
          creating a new instance.
        </div>
      </div>

      <div className="docs-section">
        <h2>The 16 Tabs</h2>
        <p>
          Every instance page has 16 tabs. Here's what each one does.
        </p>

        <div className="docs-tab-grid">

          <div className="docs-tab-item">
            <div className="docs-tab-name">1. Overview</div>
            <p>
              The landing tab for every instance. Shows the instance name, current status badge,
              agent type, image tag, and deployment target (Docker or Kubernetes). Created and
              last-updated timestamps are displayed here too. Use this tab for a quick sanity check
              before diving into configuration or logs.
            </p>
          </div>

          <div className="docs-tab-item">
            <div className="docs-tab-name">2. Credentials</div>
            <p>
              Manage the AI provider API keys and OAuth tokens attached to this instance.
              You can add credentials for any supported provider — Anthropic, OpenAI, Google,
              Groq, and others. Each credential has a type (<code>api_key</code> or{' '}
              <code>refresh_token</code>) and a value. All values are encrypted with AES-256-GCM
              before being stored in the database. Credential values are never returned in API
              responses after creation; you can only replace or delete them.
            </p>
            <p>
              See the <Link to="/docs/providers">AI Providers</Link> page for provider-specific
              setup instructions, including which credential type each provider requires.
            </p>
          </div>

          <div className="docs-tab-item">
            <div className="docs-tab-name">3. Config</div>
            <p>
              A JSON editor showing the full instance configuration as stored in the database.
              Advanced users can edit this directly to set options that aren't exposed in the UI.
              The config is validated before saving to prevent invalid JSON from being persisted.
              Changes made here don't take effect until the instance is restarted — the gateway
              reads config on startup, not continuously.
            </p>
            <div className="docs-info-box">
              If you want to change the live gateway config without a full restart, use the
              Gateway Config tab instead, which sends a <code>config.patch</code> RPC call to the
              running gateway.
            </div>
          </div>

          <div className="docs-tab-item">
            <div className="docs-tab-name">4. Workspace</div>
            <p>
              Edit the eight workspace files that shape your agent's personality, knowledge, and
              behavior. Each file has a dedicated text editor in this tab:
            </p>
            <ul className="docs-file-list">
              <li><code>SOUL.md</code> — Core personality and values</li>
              <li><code>AGENTS.md</code> — Behavioral instructions and rules</li>
              <li><code>IDENTITY.md</code> — Who the agent is and how it presents itself</li>
              <li><code>USER.md</code> — Information about the user(s) it serves</li>
              <li><code>TOOLS.md</code> — Tool usage preferences and restrictions</li>
              <li><code>BOOTSTRAP.md</code> — Initialization instructions run on first session</li>
              <li><code>HEARTBEAT.md</code> — Periodic check-in behavior</li>
              <li><code>MEMORY.md</code> — Long-term memory the agent maintains</li>
            </ul>
            <p>
              Click "Save" on any file to persist it to the database. The platform syncs saved
              changes to the running instance's filesystem in real time without requiring a restart
              (except for SOUL.md and AGENTS.md, which are re-read at session start).
            </p>
            <p>
              See the <Link to="/docs/workspace">Workspace Files</Link> page for a detailed
              explanation of each file's purpose and format.
            </p>
          </div>

          <div className="docs-tab-item">
            <div className="docs-tab-name">5. Channels</div>
            <p>
              Connect the instance to messaging platforms. Currently supported channels are
              WhatsApp and Telegram; more channels are available through the Skills/ClaWHub tab.
            </p>
            <p>
              <strong>WhatsApp:</strong> Click "Connect", then scan the QR code with your phone
              using WhatsApp's linked devices flow. The platform relays the QR code from the
              gateway in real time. Once paired, the session is stored on the instance's persistent
              volume and survives restarts.
            </p>
            <p>
              <strong>Telegram:</strong> Paste the bot token you received from BotFather, then
              click "Save &amp; Restart". The instance will restart with the new token injected
              as an environment variable.
            </p>
            <p>
              For a full setup guide including permissions, group policies, and multi-account
              support, see the <Link to="/docs/channels">Channels</Link> page.
            </p>
          </div>

          <div className="docs-tab-item">
            <div className="docs-tab-name">6. Chat</div>
            <p>
              A built-in chat interface that lets you talk to the agent directly from the platform,
              without going through WhatsApp or Telegram. Type a message and press Enter or click
              Send. Responses render with full Markdown support, including code blocks, tables,
              and lists.
            </p>
            <p>
              Chat history persists across page reloads for the duration of a browser session.
              This tab is useful for testing changes to workspace files or credentials without
              needing a connected messaging channel.
            </p>
          </div>

          <div className="docs-tab-item">
            <div className="docs-tab-name">7. Sessions</div>
            <p>
              A list of all chat sessions tracked by the gateway, both active and historical.
              Each entry shows the session start time, the channel it originated from, the total
              message count, and whether the session is still open. Clicking a session shows its
              full message history.
            </p>
            <p>
              This is useful for reviewing what conversations happened in your absence, or for
              auditing what the agent said to specific users.
            </p>
          </div>

          <div className="docs-tab-item">
            <div className="docs-tab-name">8. Skills / ClaWHub</div>
            <p>
              Browse and manage skills from the ClaWHub registry. Skills extend the gateway with
              new tools, channel integrations, and behaviors. The top of this tab shows summary
              stats: total skills available in the registry, how many are installed on this
              instance, and how many are eligible to install based on the current provider.
            </p>
            <p>
              Use the filter buttons to view All, Eligible, or Enabled skills. Toggle the switch
              on any skill card to enable or disable it. Click "Install" on community skills to
              download and register them with the gateway.
            </p>
            <p>
              See the <Link to="/docs/skills">Skills</Link> page for a full registry overview
              and instructions on writing custom skills.
            </p>
          </div>

          <div className="docs-tab-item">
            <div className="docs-tab-name">9. Cron</div>
            <p>
              Configure scheduled tasks that the agent should run automatically. Each cron job
              has a name, a standard cron expression (e.g. <code>0 9 * * 1-5</code> for weekdays
              at 9am), and a message or action to trigger. The gateway's internal scheduler picks
              up these tasks and fires them at the specified times.
            </p>
            <p>
              Common uses: daily summaries, reminder messages, periodic web fetches, or any
              recurring task you'd normally ask the agent to do manually.
            </p>
          </div>

          <div className="docs-tab-item">
            <div className="docs-tab-name">10. Gateway Config</div>
            <p>
              View and edit the raw <code>openclaw.json</code> configuration file served by the
              running gateway. Unlike the Config tab (which shows the DB-stored config), changes
              here are applied to the live gateway via a <code>config.patch</code> RPC call,
              meaning they take effect immediately without a restart.
            </p>
            <p>
              This is the lowest-level config surface. The schema is strict — unknown keys will
              cause the gateway to reject the patch. Refer to the OpenClaw documentation for the
              full schema reference before making manual edits here.
            </p>
            <div className="docs-warning-box">
              Changes made in Gateway Config are live but ephemeral if they're not also saved
              to the DB config (Config tab). After a restart, the gateway re-reads from the DB.
              Always update both if you want the change to survive restarts.
            </div>
          </div>

          <div className="docs-tab-item">
            <div className="docs-tab-name">11. Health</div>
            <p>
              A monitoring dashboard showing the current health of the instance. Displays the
              overall health status (healthy, degraded, or unhealthy), the timestamp of the last
              successful health check, total uptime since the last start, and resource utilization
              metrics where available (CPU, memory).
            </p>
            <p>
              The platform's health monitor runs on a dual-speed schedule: every 5 seconds for
              instances in <code>starting</code> state, and every 30 seconds for instances that
              are <code>running</code> or in <code>error</code>. Auto-recovery kicks in here too
              — if a Kubernetes pod stabilizes after a crash, the monitor flips the status back
              to <code>running</code> automatically.
            </p>
          </div>

          <div className="docs-tab-item">
            <div className="docs-tab-name">12. Usage</div>
            <p>
              Token usage statistics broken down by provider and model. Shows the number of API
              calls made, input and output tokens consumed, and an estimated cost based on current
              provider pricing. Data is aggregated over configurable time windows (daily, weekly,
              monthly).
            </p>
            <p>
              Use this tab to track spend across providers, identify which models are being used
              most, and spot unexpected spikes in usage.
            </p>
          </div>

          <div className="docs-tab-item">
            <div className="docs-tab-name">13. Logs</div>
            <p>
              Real-time log streaming from the instance container. Logs are parsed intelligently:
              JSON-structured log lines are broken into individual fields (timestamp, log level,
              subsystem, message), while plain-text lines are displayed as-is.
            </p>
            <p>
              <strong>Filtering:</strong> Use the level checkboxes to show or hide trace, debug,
              info, warn, error, and fatal lines. The text search field filters by message content.
            </p>
            <p>
              <strong>Color coding:</strong> Each level gets its own color (gray for trace, blue
              for debug, green for info, yellow for warn, red for error, magenta for fatal), making
              it easy to spot problems at a glance.
            </p>
            <p>
              The viewer maintains a circular buffer of the last 2,000 log entries to keep memory
              usage bounded. For longer-term log retention, configure external log shipping in
              the Gateway Config tab.
            </p>
          </div>

          <div className="docs-tab-item">
            <div className="docs-tab-name">14. Events</div>
            <p>
              An audit log of every lifecycle event recorded for this instance. Events include
              things like <code>START_REQUESTED</code>, <code>HEALTH_CHECK_PASSED</code>,
              <code>CONFIG_UPDATED</code>, <code>CREDENTIALS_CHANGED</code>, and
              <code>ERROR_OCCURRED</code>. Each event has a precise timestamp, an event type,
              and a metadata object with context-specific details.
            </p>
            <p>
              This tab is the first place to check when an instance won't start or keeps falling
              into error state. The metadata on a failed health check event, for example, will
              show the exact HTTP status or connection error returned by the gateway.
            </p>
          </div>

          <div className="docs-tab-item">
            <div className="docs-tab-name">15. Approvals</div>
            <p>
              When exec approval mode is enabled, the agent pauses before executing certain tools
              and waits for explicit human approval. This tab lists all pending approval requests,
              showing the tool name, the arguments it wants to call with, and the session context
              in which it was triggered.
            </p>
            <p>
              Click "Approve" to allow the tool call to proceed, or "Reject" to cancel it and
              send a refusal message back to the agent. Approved and rejected decisions are logged
              with timestamps for auditing.
            </p>
            <div className="docs-info-box">
              Exec approval mode is configured in the Gateway Config tab under the{' '}
              <code>tools.approval</code> section. It's recommended for agents with access to
              sensitive tools like file writes, shell commands, or external API calls.
            </div>
          </div>

          <div className="docs-tab-item">
            <div className="docs-tab-name">16. Debug</div>
            <p>
              Advanced debugging tools for diagnosing tricky issues. This tab lets you inspect
              the environment variables currently set in the container, view the resolved
              configuration state as the gateway sees it (after env var substitution), and examine
              runtime details like the active plugin list and loaded skill registrations.
            </p>
            <p>
              Useful when a configuration change doesn't seem to take effect, or when troubleshooting
              credential injection issues. Not intended for everyday use.
            </p>
          </div>

        </div>
      </div>

      <div className="docs-section">
        <h2>Setup Wizard</h2>
        <p>
          After creating a brand new instance, the platform shows a setup wizard to get it
          configured quickly. The wizard walks through four steps before starting the instance
          for the first time.
        </p>

        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-number">1</div>
            <div className="docs-step-content">
              <h3>Select Provider &amp; Model</h3>
              <p>
                Choose the AI provider (Anthropic, OpenAI, Google, Groq, etc.) and the specific
                model you want the agent to use. The dropdown shows all providers supported by the
                current agent type. Your selection is saved to the instance config and will be
                used for all chat sessions.
              </p>
            </div>
          </div>

          <div className="docs-step">
            <div className="docs-step-number">2</div>
            <div className="docs-step-content">
              <h3>Configure Credentials</h3>
              <p>
                Enter the API key or OAuth token for the provider you selected in step 1. The
                wizard knows which credential type each provider needs, so it shows the correct
                input field. The value is encrypted and stored in the instance's credential vault.
                You can add credentials for additional providers later from the Credentials tab.
              </p>
              <p>
                Not sure which credential type to use? See the{' '}
                <Link to="/docs/providers">AI Providers</Link> page for per-provider instructions.
              </p>
            </div>
          </div>

          <div className="docs-step">
            <div className="docs-step-number">3</div>
            <div className="docs-step-content">
              <h3>Review &amp; Apply</h3>
              <p>
                A summary screen showing the choices made in the previous steps. Verify that
                the provider, model, and credential are correct. This step writes the final
                configuration to the database. You can go back to previous steps if anything
                needs adjusting.
              </p>
            </div>
          </div>

          <div className="docs-step">
            <div className="docs-step-number">4</div>
            <div className="docs-step-content">
              <h3>Restart</h3>
              <p>
                The wizard triggers a restart (or first start) of the instance with the new
                configuration applied. The page transitions to the Overview tab and shows the
                instance moving through <code>starting</code> to <code>running</code>. On first
                boot this can take a few minutes while the container image is pulled and the
                gateway initializes.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="docs-section">
        <h2>Tips</h2>

        <div className="docs-info-box">
          <strong>First boot is slow.</strong> Expect 1 to 3 minutes on a fresh instance.
          The container image needs to be pulled, the gateway process needs to initialize, and
          the startup probe has up to 310 seconds to pass before the health check is recorded.
          Subsequent starts from a warm image cache are much faster.
        </div>

        <div className="docs-info-box">
          <strong>Workspace file changes sync live.</strong> Saving a workspace file writes
          it to the database and pushes it to the running instance's filesystem. You don't
          need to restart for most file changes. SOUL.md and AGENTS.md are re-read at each
          new session start, so existing open sessions won't see changes until they start fresh.
        </div>

        <div className="docs-info-box">
          <strong>Credentials stay secret.</strong> Credential values are encrypted before
          being written to the database and are never returned in any API response after
          creation. They never appear in application logs. If you suspect a credential was
          compromised, delete it and create a new one.
        </div>

        <div className="docs-info-box">
          <strong>Use the Events tab to troubleshoot.</strong> If an instance won't start or
          keeps flipping to error state, the Events tab shows exactly what happened and when.
          Check the metadata on the most recent error event for the specific failure message
          from the orchestrator or health check.
        </div>

        <div className="docs-info-box">
          <strong>Health monitor polling rates.</strong> The platform checks{' '}
          <code>starting</code> instances every 5 seconds to catch startup completion quickly.
          Once an instance is <code>running</code>, checks drop to every 30 seconds. An instance
          in <code>error</code> state is also polled every 30 seconds so that auto-recovery
          can happen if the underlying pod stabilizes on its own.
        </div>
      </div>
    </div>
  );
}
