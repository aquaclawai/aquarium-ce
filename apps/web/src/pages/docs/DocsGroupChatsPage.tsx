import { Link } from 'react-router-dom';

export function DocsGroupChatsPage() {
  return (
    <div className="docs-page">
      <h1>Group Chats</h1>

      <p className="docs-lead">
        Group Chats let you create conversations between multiple AI agents — and human
        participants. Each agent can have different skills, personalities, and knowledge
        bases. They can @mention each other, collaborate on tasks, and form chains of
        reasoning. Humans can join too, working alongside bots in the same thread. This
        is our experimental feature for exploring multi-agent collaboration.
      </p>

      <div className="docs-info-box">
        <strong>Experimental feature:</strong> Group Chats are under active development.
        Behavior may change as we learn more about how agents work together effectively.
        Feedback is welcome.
      </div>

      <section className="docs-section">
        <h2>Creating a Group Chat</h2>
        <p>
          Before creating a group chat, make sure you have at least two instances running.
          Each instance becomes a "bot member" of the chat with its own personality and
          skills. You can also invite human members during or after creation.
        </p>

        <ol className="docs-steps">
          <li className="docs-step">
            Navigate to <strong>Group Chats</strong> from the sidebar menu on the left.
          </li>
          <li className="docs-step">
            Click <strong>"Create Group Chat"</strong>.
          </li>
          <li className="docs-step">
            Enter a name for the group — something descriptive works best, like "Research
            Team" or "Code Review Crew".
          </li>
          <li className="docs-step">
            Add member instances:
            <ul>
              <li>
                Select from your running instances in the dropdown.
              </li>
              <li>
                Give each member a <strong>display name</strong> for the chat. This is how
                other participants (and you) will reference them. For example, an instance
                configured as a researcher could be named "Researcher", while a data-focused
                one becomes "Analyst".
              </li>
              <li>
                Add at least 2 instances to make the group meaningful.
              </li>
            </ul>
          </li>
          <li className="docs-step">
            Click <strong>"Create"</strong>.
          </li>
          <li className="docs-step">
            You're redirected to the group chat room, ready to start the conversation.
          </li>
        </ol>
      </section>

      <section className="docs-section">
        <h2>Human Members</h2>
        <p>
          Group chats aren't just for bots. You can invite other platform users to participate
          as human members alongside your AI agents. This enables collaborative workflows
          where humans and bots work together in the same conversation.
        </p>

        <h3>Inviting Humans</h3>
        <p>
          You can add human members in two ways:
        </p>
        <ul>
          <li>
            <strong>During creation</strong>: When creating a new group chat, use the
            "Invite Human Members" section below the instance selector. Search for users
            by email address, select them from the results, and they'll be added
            automatically after the chat is created.
          </li>
          <li>
            <strong>After creation</strong>: In an existing group chat, open the member
            sidebar and click <strong>"Add Member"</strong>. Switch to the{' '}
            <strong>"Human"</strong> tab, search for a user by email, select them, and
            set a display name.
          </li>
        </ul>

        <h3>Human vs Bot Labels</h3>
        <p>
          Each member in the sidebar is labeled as either <strong>(Human)</strong> or{' '}
          <strong>(Bot)</strong> so you can always tell who's a real person and who's an
          AI agent. Human members also appear with a distinct color indicator.
        </p>

        <h3>Permissions</h3>
        <ul>
          <li>
            The <strong>chat creator</strong> (owner) can add and remove members, update
            chat settings, and delete the chat.
          </li>
          <li>
            <strong>Human members</strong> can send messages and @mention any bot or
            human in the group. They cannot manage membership or settings.
          </li>
          <li>
            <strong>Bot members</strong> respond when mentioned or when a message is
            broadcast. They don't manage the chat — they just participate.
          </li>
        </ul>

        <div className="docs-info-box">
          <strong>Note:</strong> Human members must have an account on the platform.
          You search for them by their registered email address.
        </div>
      </section>

      <section className="docs-section">
        <h2>Sending Messages</h2>
        <p>
          Type your message in the input field at the bottom of the chat. Press{' '}
          <strong>Enter</strong> or click <strong>Send</strong>.
        </p>
        <p>
          By default, messages are <strong>broadcast to all member instances</strong>. Every
          bot in the group receives your message and may respond. This is useful for
          open-ended questions where multiple perspectives help.
        </p>
        <p>
          Each bot's response appears in the chat with its display name. Responses arrive
          asynchronously — bots may respond at different speeds depending on the complexity
          of the question and their current load.
        </p>
      </section>

      <section className="docs-section">
        <h2>@Mention Targeting</h2>
        <p>
          When you want to direct a message to a specific bot rather than the whole group,
          use @mentions.
        </p>
        <ul>
          <li>
            Type <strong>@</strong> in the message input to open an autocomplete dropdown
            showing all member display names.
          </li>
          <li>
            Select a name to @mention them — the mention is highlighted in your message.
          </li>
          <li>
            When you @mention a specific instance, <strong>only that instance</strong>{' '}
            receives the message. The other members don't see it.
          </li>
        </ul>

        <div className="docs-feature-card">
          <strong>Example:</strong>
          <p>
            "@Researcher can you find recent studies on solar panel efficiency?"
          </p>
          <p>
            Only the instance named "Researcher" receives and responds to this message.
            "Analyst" won't be triggered.
          </p>
        </div>

        <p>
          This is the primary way to route specific tasks to the right expert agent.
        </p>
      </section>

      <section className="docs-section">
        <h2>Bot Chains</h2>
        <p>
          Here's where group chats get interesting. When a bot responds and @mentions another
          bot in its reply, the platform automatically routes that message to the mentioned
          bot. This creates <strong>chains of reasoning</strong> between agents.
        </p>

        <div className="docs-feature-card">
          <strong>Example chain:</strong>
          <ol>
            <li>You ask <em>@Researcher</em>: "Find data on solar panel efficiency trends"</li>
            <li>Researcher responds with raw data and says: "@Analyst please analyze these trends and summarize the key findings"</li>
            <li>Analyst receives that message automatically and provides a structured analysis</li>
            <li>The chain stops here (depth 3 reached) or when no further @mentions appear</li>
          </ol>
        </div>

        <ul>
          <li>
            <strong>Maximum chain depth is 3</strong> by default. This prevents runaway
            conversations where bots keep pinging each other indefinitely.
          </li>
          <li>
            The depth limit is configurable via <code>maxBotChainDepth</code> in the group
            chat settings.
          </li>
          <li>
            Chains only continue when a bot's response contains an @mention of another
            member. A plain response with no @mentions ends the chain.
          </li>
          <li>
            All messages in the chain — including bot-to-bot messages — appear in the chat
            thread so you can follow the full conversation.
          </li>
        </ul>
      </section>

      <section className="docs-section">
        <h2>Delivery Status</h2>
        <p>
          Each message in a group chat tracks delivery status per recipient. This helps you
          understand what's happening, especially when chains are in progress.
        </p>
        <ul>
          <li>
            <strong>Pending</strong>: Message is queued for delivery to this instance.
          </li>
          <li>
            <strong>Delivered</strong>: Message has been sent to the instance's gateway.
          </li>
          <li>
            <strong>Processing</strong>: The instance is generating a response.
          </li>
          <li>
            <strong>Completed</strong>: The instance has responded successfully.
          </li>
          <li>
            <strong>Error / Failed</strong>: Something went wrong during delivery or
            processing.
          </li>
        </ul>
        <p>
          Failed messages show a <strong>retry button</strong>. Click it to attempt
          redelivery — useful if an instance was temporarily unreachable.
        </p>
        <p>
          Status updates are pushed via WebSocket in real-time. No page refresh needed.
        </p>
      </section>

      <section className="docs-section">
        <h2>Tips</h2>
        <ul>
          <li>
            Give each bot a <strong>distinct personality</strong> via its{' '}
            <code>SOUL.md</code> and <code>IDENTITY.md</code> workspace files. The more
            differentiated the agents are, the more interesting their collaboration.
          </li>
          <li>
            Use <strong>specific @mentions</strong> to route tasks to the right expert.
            Broadcast mode is good for brainstorming; targeted mentions are better for
            execution.
          </li>
          <li>
            Watch the <strong>delivery status indicators</strong> to track message flow
            through the chain. It's a good way to debug if a bot isn't responding.
          </li>
          <li>
            Group chats work best when each bot has <strong>complementary skills</strong>.
            A researcher + analyst + writer combination, for example, can produce much richer
            output than asking one bot to do everything.
          </li>
          <li>
            Keep <strong>bot chain depth at 3</strong> until you're comfortable with how
            your agents interact. Deeper chains can produce surprising results — sometimes
            good, sometimes circular.
          </li>
          <li>
            Install relevant <strong>skills</strong> on each member instance to match their
            roles. A researcher benefits from web search; an analyst from data tools.
          </li>
        </ul>
      </section>

      <nav className="docs-page-nav">
        <Link to="/docs/channels" className="docs-page-nav__prev">
          &larr; Channels
        </Link>
        <Link to="/docs" className="docs-page-nav__next">
          Docs Home &rarr;
        </Link>
      </nav>
    </div>
  );
}
