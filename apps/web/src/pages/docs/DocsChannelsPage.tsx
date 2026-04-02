import { Link } from 'react-router-dom';

export function DocsChannelsPage() {
  return (
    <div className="docs-page">
      <h1>Channels</h1>

      <p className="docs-lead">
        Connect your AI bot to messaging platforms so you can chat with it from your phone or
        any messaging app. Aquarium currently supports <strong>WhatsApp</strong> and{' '}
        <strong>Telegram</strong> channels.
      </p>

      <section className="docs-section">
        <h2>WhatsApp Setup</h2>
        <p>
          WhatsApp connects your bot to your personal (or business) WhatsApp account via a
          linked-device session. No separate phone number needed — your existing account
          works.
        </p>

        <div className="docs-info-box">
          <strong>Before you start:</strong> Make sure your instance is in the{' '}
          <strong>running</strong> state. WhatsApp login requires the gateway to be active.
        </div>

        <ol className="docs-steps">
          <li className="docs-step">
            Confirm your instance is running. You'll see a green "Running" badge on the
            instance card.
          </li>
          <li className="docs-step">Navigate to your instance page.</li>
          <li className="docs-step">Click the <strong>Channels</strong> tab.</li>
          <li className="docs-step">
            In the WhatsApp section, click <strong>"Connect WhatsApp"</strong>.
          </li>
          <li className="docs-step">
            A QR code appears on screen. It's streamed in real-time via WebSocket, so it
            stays live as long as your browser tab is open.
          </li>
          <li className="docs-step">Open <strong>WhatsApp</strong> on your phone.</li>
          <li className="docs-step">
            Go to <strong>Settings &rarr; Linked Devices &rarr; Link a Device</strong>.
          </li>
          <li className="docs-step">
            Point your camera at the QR code displayed on the platform.
          </li>
          <li className="docs-step">
            Wait for the connection to establish. This usually takes 5–10 seconds.
          </li>
          <li className="docs-step">
            Once connected, you'll see a green <strong>"Connected"</strong> status
            indicator in the Channels tab.
          </li>
          <li className="docs-step">
            Send yourself a message on WhatsApp — your bot should respond.
          </li>
        </ol>

        <h3>Important Notes</h3>
        <ul>
          <li>
            The QR code <strong>expires after ~60 seconds</strong>. If it times out before
            you scan it, click "Connect" again to generate a fresh one.
          </li>
          <li>
            Your phone needs an <strong>active internet connection</strong> to maintain the
            linked session. If your phone goes offline for an extended period, the session
            may drop.
          </li>
          <li>
            Linking a device through the platform works the same as WhatsApp Web. If you
            already have other linked devices (e.g., WhatsApp Desktop), they'll continue
            working side by side.
          </li>
          <li>
            To disconnect, click <strong>"Disconnect WhatsApp"</strong> in the Channels tab.
            This removes the linked session from both the platform and your WhatsApp account.
          </li>
          <li>
            <strong>Session data persists</strong> across instance restarts. The linked
            device credentials are stored on the instance's persistent volume, so you don't
            need to re-scan after a restart.
          </li>
        </ul>

        <div className="docs-feature-card">
          <strong>Who can message the bot?</strong>
          <p>
            By default, only your own number can message the bot (pairing policy). You can
            configure this in your instance's workspace config to allow other numbers or
            open it more broadly.
          </p>
        </div>
      </section>

      <section className="docs-section">
        <h2>Telegram Setup</h2>
        <p>
          Telegram uses a bot token rather than QR codes. You create a Telegram bot through
          BotFather, copy the token, and paste it into the platform. The whole process takes
          about two minutes.
        </p>

        <h3>Step 1 — Create a Telegram Bot</h3>
        <ol className="docs-steps">
          <li className="docs-step">
            Open Telegram and search for <strong>@BotFather</strong> (the official bot
            creation service from Telegram).
          </li>
          <li className="docs-step">
            Start a chat and send: <div className="docs-code-block">/newbot</div>
          </li>
          <li className="docs-step">
            BotFather will ask for a <strong>name</strong> (the display name, e.g.
            "My Assistant") and a <strong>username</strong> (must end in "bot", e.g.
            "myassistant_bot").
          </li>
          <li className="docs-step">
            Once created, BotFather sends you a <strong>bot token</strong>. It looks like:
            <div className="docs-code-block">123456789:ABCdefGHIjklMNOpqrsTUVwxyz</div>
            Copy this token.
          </li>
        </ol>

        <h3>Step 2 — Configure in Aquarium</h3>
        <ol className="docs-steps">
          <li className="docs-step">Navigate to your instance page.</li>
          <li className="docs-step">Click the <strong>Channels</strong> tab.</li>
          <li className="docs-step">
            In the Telegram section, paste your bot token into the input field.
          </li>
          <li className="docs-step">
            Click <strong>"Save &amp; Restart"</strong>. The instance will restart to apply
            the new token.
          </li>
          <li className="docs-step">Wait for the instance to return to "Running" status.</li>
        </ol>

        <h3>Step 3 — Test the Connection</h3>
        <ol className="docs-steps">
          <li className="docs-step">
            Find your bot on Telegram by searching for its username (the one you set in
            BotFather).
          </li>
          <li className="docs-step">Send it a message.</li>
          <li className="docs-step">The bot should respond within a few seconds.</li>
        </ol>

        <h3>Important Notes</h3>
        <ul>
          <li>
            Each bot token can only be active on <strong>one instance at a time</strong>.
            Assigning the same token to two instances will cause conflicts.
          </li>
          <li>
            If you change the token, the old bot username will stop responding immediately.
          </li>
          <li>
            Your bot token is stored <strong>encrypted (AES-256-GCM)</strong> in the
            platform database. It's never sent back to the browser after you save it.
          </li>
          <li>
            By default, Telegram bots respond to direct messages. To use the bot in group
            chats, disable <strong>Group Privacy mode</strong> via BotFather (send{' '}
            <code>/setprivacy</code> to BotFather).
          </li>
        </ul>
      </section>

      <section className="docs-section">
        <h2>Channel Status</h2>
        <p>
          The Channels tab shows real-time connection status for each channel. You don't
          need to refresh the page — status updates are pushed via WebSocket as they happen.
        </p>
        <ul>
          <li>
            <strong>Green indicator</strong>: connected and active. Messages are flowing.
          </li>
          <li>
            <strong>Red indicator</strong>: disconnected or in an error state. Check the
            instance logs for details.
          </li>
          <li>
            <strong>Yellow/orange indicator</strong>: connecting or in a transitional state
            (e.g., waiting for QR scan).
          </li>
        </ul>
      </section>

      <section className="docs-section">
        <h2>Tips</h2>
        <ul>
          <li>
            You can connect <strong>both WhatsApp and Telegram simultaneously</strong> on
            the same instance. They operate independently.
          </li>
          <li>
            Channel connections survive instance restarts. WhatsApp credentials are stored
            on the persistent volume; Telegram token is in the encrypted database.
          </li>
          <li>
            If WhatsApp disconnects frequently, check your phone's internet connection and
            battery optimization settings (some phones kill background apps aggressively).
          </li>
          <li>
            For Telegram groups, remember to disable Group Privacy mode via BotFather,
            then remove and re-add the bot to the group.
          </li>
          <li>
            Only one WhatsApp session per instance. If you need multiple WhatsApp numbers,
            create separate instances.
          </li>
        </ul>
      </section>

      <nav className="docs-page-nav">
        <Link to="/docs/skills" className="docs-page-nav__prev">
          &larr; Skills &amp; ClaWHub
        </Link>
        <Link to="/docs/group-chats" className="docs-page-nav__next">
          Group Chats &rarr;
        </Link>
      </nav>
    </div>
  );
}
