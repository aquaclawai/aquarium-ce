# Manual Testing Plan — Aquarium CE v1.1 (since v1.0.10)

## Pre-requisites
- Server running on `http://localhost:3001`
- At least one running OpenClaw instance (e.g., "test" instance)
- Docker running with the gateway container up
- At least one provider credential configured (e.g., OpenAI API key)

---

## Test Area 1: Extensions Tab (Phases 1-3)

The Extensions tab is entirely new — it manages skills and plugins with trust policy enforcement.

### T1.1 — Extensions Tab Loads
1. Navigate to an instance page (e.g., `http://localhost:3001/instances/<id>`)
2. Click the **"Extensions"** tab
3. **Verify**: Two sub-tabs appear: **"Skills"** (selected by default) and **"Plugins"**
4. **Verify**: Three sections visible: **INSTALLED**, **GATEWAY BUILT-INS (read-only)**, and **AVAILABLE**
5. **Verify**: A search box and category filter dropdown appear under AVAILABLE

### T1.2 — Plugins Sub-Tab
1. Click the **"Plugins"** sub-tab
2. **Verify**: Same three sections appear (INSTALLED, GATEWAY BUILT-INS, AVAILABLE)
3. **Note**: An RPC error `"unknown method: plugins.list"` may appear in a red banner if the gateway image doesn't support this RPC yet — this is expected on older gateway images

### T1.3 — Refresh Button
1. Click the **refresh icon** (circular arrow) in the top-right of the Extensions tab
2. **Verify**: The lists reload (may flash briefly)

### T1.4 — Search and Filter
1. Type a search term in the **"Search extensions..."** box (e.g., "calendar")
2. **Verify**: The available list filters to matching results (or shows "No extensions available" if no match)
3. Change the **category dropdown** from "All Categories" to another option
4. **Verify**: The list filters accordingly

---

## Test Area 2: Agent Management Panel (WebSocket Fix)

This was broken before — the Gateway Control UI showed "disconnected (1006): no reason".

### T2.1 — Panel Loads Successfully
1. On the instance page, click **"More"** dropdown
2. Click **"Agent Management"**
3. **Verify**: The OpenClaw Gateway Control UI loads inside an iframe showing:
   - Top nav: "OpenClaw > Chat"
   - Agent name (e.g., "test") with "Ready to chat" status
   - A message input at the bottom: "Message test (Enter to send)"
   - Suggestion buttons like "What can you do?", "Help me configure a channel"
4. **Verify**: No red "disconnected (1006): no reason" error

### T2.2 — Model Dropdown in Gateway UI
1. In the Agent Management panel, click the model dropdown (next to "main")
2. **Verify**: A dropdown appears showing models in `model-name · provider` format (e.g., `anthropic.claude-opus-4-6-v1 · amazon-bedrock`)
3. **Verify**: The list includes the configured default model with a checkmark

### T2.3 — Chat Through Gateway UI
1. In the Agent Management panel's message input, type a simple message (e.g., "hello")
2. Press Enter
3. **Verify**: The agent responds within the Gateway UI (not the platform's Chat tab)

---

## Test Area 3: Live Model List with Credential Status

### T3.1 — Models API Endpoint
1. Open browser DevTools > Network tab
2. Navigate to the instance page
3. **Verify**: A request to `GET /api/instances/<id>/models` appears with status 200
4. Click the request and inspect the response JSON:
   - `data.models` should be an array of 800+ models
   - Each model has: `id`, `name`, `provider`, `contextWindow`, `reasoning`, `usable`
   - `data.configuredProviders` should list your configured providers (e.g., `["openai"]`)
   - Models from configured providers should have `usable: true`
   - Models from other providers should have `usable: false`

### T3.2 — Chat Tab Model Picker
1. Click the **"Chat"** tab
2. Click the **"Settings"** button (top-right bar area)
3. **Verify**: A settings panel appears with **MODEL** and **THINKING LEVEL** fields
4. Click the MODEL text input and type a partial model name (e.g., "gpt")
5. **Verify**: The browser's autocomplete/datalist suggestions appear (behavior varies by browser)
6. Inspect via DevTools console: run `document.getElementById('model-suggestions').querySelectorAll('option').length`
   - **Verify**: Returns 800+ options
7. Run: `Array.from(document.getElementById('model-suggestions').querySelectorAll('option')).filter(o => !o.label.includes('no key')).slice(0,3).map(o => ({v: o.value, l: o.label}))`
   - **Verify**: Usable models show labels like `"GPT-4.1 · openai"` (no "(no key)" suffix)
8. Run: `Array.from(document.getElementById('model-suggestions').querySelectorAll('option')).filter(o => o.label.includes('no key')).slice(0,3).map(o => ({v: o.value, l: o.label}))`
   - **Verify**: Non-usable models show labels like `"Claude Haiku 3 · amazon-bedrock (no key)"`

### T3.3 — Model Picker Save
1. In the MODEL input, type a valid model name (e.g., `gpt-4o`)
2. Click **"Save"**
3. **Verify**: Settings panel closes without error
4. Click **"Settings"** again
5. **Verify**: The MODEL field shows the previously saved value `gpt-4o`

### T3.4 — Thinking Level
1. In the settings panel, change **THINKING LEVEL** to "High"
2. Click **"Save"**
3. Re-open settings
4. **Verify**: THINKING LEVEL shows "High"

---

## Test Area 4: Chat Functionality (Core Fixes)

### T4.1 — Send a Message
1. On the **Chat** tab, type a message in the input box (e.g., "What is 2+2?")
2. Click **"Send"** or press Enter
3. **Verify**: The message appears as a blue bubble on the right
4. **Verify**: A "Thinking" disclosure triangle appears (expandable)
5. **Verify**: The agent's response streams in below
6. **Verify**: A timestamp appears under the response

### T4.2 — Thinking Block Toggle
1. Click the **"Thinking"** disclosure triangle on any agent response
2. **Verify**: The thinking content expands/collapses

### T4.3 — Copy Message
1. Hover over any message
2. Click the **"Copy"** button
3. **Verify**: The message content is copied to clipboard

### T4.4 — Session Management
1. Click the **"Sessions"** button (hamburger icon, top-left of chat area)
2. **Verify**: A session drawer opens showing sessions grouped by date
3. Click **"+ New Chat"**
4. **Verify**: A fresh chat starts with no messages
5. Re-open sessions drawer and select a previous session
6. **Verify**: The previous messages load

### T4.5 — File Attachment
1. Click the **paperclip icon** (Attach file) next to the input
2. Select an image file (PNG/JPG, under 5MB)
3. **Verify**: A preview thumbnail appears above the input
4. Type a message and click Send
5. **Verify**: The image is sent with the message

---

## Test Area 5: Overview Tab & Instance Lifecycle

### T5.1 — Overview Information
1. Click the **"Overview"** tab
2. **Verify** the following details are displayed correctly:
   - Instance ID, Name, Agent Type, Image Tag
   - Status: "running" (green)
   - Security Profile: shown with a "Change" button
   - Deployment: Docker
   - AI Provider: matches configured provider
   - Created/Updated timestamps
   - Credential status (e.g., "openai authenticated")

### T5.2 — Export as Template
1. On the Overview tab, click **"Export as Template"**
2. **Verify**: A template is created (success notification or redirect to templates page)
3. Navigate to **Agent Market** in the sidebar
4. **Verify**: The exported template appears in the list

### T5.3 — Stop and Start
1. On the Overview tab, click **"Stop"**
2. **Verify**: Status transitions to "stopping" then "stopped"
3. Click **"Start"**
4. **Verify**: Status transitions to "starting" then "running"
5. **Verify**: The Chat tab works after restart

### T5.4 — Clone
1. On the Overview tab, click **"Clone"**
2. **Verify**: A new instance appears with the same configuration
3. Navigate to Dashboard or My Assistants to see both instances

---

## Test Area 6: Security Profile

### T6.1 — Change Security Profile
1. On the Overview tab, find **Security Profile** row showing "Unrestricted"
2. Click **"Change"**
3. **Verify**: A dialog/dropdown appears with options (strict, standard, developer, unrestricted)
4. Select a different profile (e.g., "standard")
5. **Verify**: The profile updates and the label changes

---

## Test Area 7: My Assistants Page

### T7.1 — Assistant List
1. Click **"My Assistants"** in the sidebar
2. **Verify**: All instances are listed with name, status (online/offline), and avatar

### T7.2 — Assistant Chat
1. Click on a running instance in the list
2. **Verify**: A full-page chat view opens with:
   - Instance name and status in the top bar
   - Chat suggestions (e.g., "What can you do?")
   - Session sidebar on the left
   - Model/Thinking settings panel (click Settings)
3. Send a message
4. **Verify**: The agent responds correctly

---

## Test Area 8: Vault Configuration (Phase 5)

### T8.1 — Vault Config Section
1. On the instance page, click **"Overview"** tab
2. Scroll down to find the **Vault Configuration** section
3. **Verify**: The section displays current vault/credential settings for the instance

---

## Test Area 9: API Smoke Tests (run in DevTools Console)

### T9.1 — Models Endpoint
```js
fetch('/api/instances/<id>/models').then(r=>r.json()).then(d=>console.log('Models:', d.data.models.length, 'Providers:', d.data.configuredProviders))
```
**Expect**: `Models: 800+ Providers: ["openai"]`

### T9.2 — Skills API
```js
fetch('/api/instances/<id>/skills').then(r=>r.json()).then(d=>console.log(d))
```
**Expect**: `{ ok: true, data: { installed: [...], catalog: [...] } }` or similar

### T9.3 — Plugins API
```js
fetch('/api/instances/<id>/plugins').then(r=>r.json()).then(d=>console.log(d))
```
**Expect**: `{ ok: true, data: {...} }` or RPC error if gateway doesn't support it

### T9.4 — RPC models.list (direct)
```js
fetch('/api/instances/<id>/rpc', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({method:'models.list',params:{}})}).then(r=>r.json()).then(d=>console.log('RPC models:', d.data?.models?.length))
```
**Expect**: `RPC models: 800+`

---

## Known Issues to Note During Testing

| Issue | Description |
|-------|-------------|
| Datalist with 807 models | Chrome limits `<datalist>` display for large option counts. The data is present (verifiable via console) but the dropdown may not render all options. A custom dropdown component is planned. |
| `plugins.list` RPC error | The red banner in the Extensions > Plugins tab is expected if the gateway image (2026.3.28) doesn't support this RPC method yet. |
| `web-dist` stale cache | If the UI shows stale content after rebuilding, check for and remove `apps/server/dist/web-dist/` which takes priority over `apps/web/dist/`. |
