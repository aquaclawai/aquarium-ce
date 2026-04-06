# Channel Hub — Detailed Design (v2)

> Unified chat-channel management UI for Aquarium CE.
> Lets users connect their AI agent instances to WhatsApp, Telegram, Discord, Feishu, QQ, Slack, WeChat, and more — all from a single tab.

**Revision notes (v2)**: Addresses all findings from adversarial review. Key changes:
- Removed multi-account claims (scoped to v2)
- Registry is explicitly UI catalog, not authoritative — derives supported set from `CHANNEL_REQUIRED_FIELDS`
- Removed manifest-based filtering (manifest only lists 2 channels but adapter supports 12+)
- Removed parallel plugin install endpoint — reuses existing plugin API
- Added gateway restart awareness (applying state) to mutation flows
- Replaced WS event assumption with polling-only status refresh
- Extended `ChannelPolicyUpdate` with `allowFrom` / `groupAllowFrom`
- Added Phase 0 (backend alignment) before UI work
- Added plugin compatibility metadata
- Added server-side validation and audit context

---

## Table of Contents

1. [Goals & Non-Goals](#1-goals--non-goals)
2. [Architecture Overview](#2-architecture-overview)
3. [Channel Registry — The Data Model](#3-channel-registry--the-data-model)
4. [Backend API Changes](#4-backend-api-changes)
5. [Shared Type Additions](#5-shared-type-additions)
6. [Frontend Component Hierarchy](#6-frontend-component-hierarchy)
7. [Component Specifications](#7-component-specifications)
8. [State Management & Data Flow](#8-state-management--data-flow)
9. [Status Refresh Strategy](#9-status-refresh-strategy)
10. [CSS & Visual Design](#10-css--visual-design)
11. [i18n Strategy](#11-i18n-strategy)
12. [Security Considerations](#12-security-considerations)
13. [Implementation Phases](#13-implementation-phases)
14. [Migration & Backward Compatibility](#14-migration--backward-compatibility)
15. [Future Work (v2)](#15-future-work-v2)

---

## 1. Goals & Non-Goals

### Goals

- **Unified entry point**: A single "Channels" tab on the Instance detail page where users manage all messaging platform connections.
- **Data-driven UI**: The server returns a channel registry (metadata + field schemas); the frontend renders forms dynamically — no per-channel page code.
- **Three setup flows**: Token-based (Telegram, Discord, Feishu, Slack, QQ, etc.), QR-code-based (WhatsApp, WeChat), and plugin-required channels (Feishu, QQ, WeChat require OpenClaw plugin installation first).
- **Polled status**: Channel connection state refreshed via periodic polling. No dependency on unguaranteed gateway WS events.
- **Policy management**: Users can configure DM policy, group policy, and allowlists per channel from the UI.
- **Single-account model**: v1 supports one account per channel per instance (matching the current credential storage model).

### Non-Goals

- Implementing new backend channel adapters (those live in OpenClaw).
- Modifying OpenClaw gateway code.
- Building a marketplace/store for discovering new channel plugins (uses existing Extensions tab plugin catalog).
- **Multi-account support** (deferred to v2 — requires credential storage and status type changes; see §15).

### Design boundaries

The channel registry is a **UI presentation catalog**, not an authoritative route generator. Backend behavior (route handling, seed config, policy shape) is driven by existing code in `CHANNEL_REQUIRED_FIELDS`, `NESTED_DM_POLICY_CHANNELS`, and `openclawAdapter.seedConfig()`. The registry only describes channels that are already wired in those systems. Adding a channel to the registry without backend route support has no effect — the registry endpoint validates this at startup.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Browser (React SPA)                          │
│                                                                     │
│  InstancePage                                                       │
│  └─ ChannelsTab                                                     │
│     ├─ ChannelGrid            (card grid of all channels)           │
│     │  └─ ChannelCard ×N      (one per registry entry)              │
│     ├─ ChannelConfigDrawer    (slide-out config panel)              │
│     │  ├─ TokenSetupForm      (dynamic form for token channels)     │
│     │  ├─ QrSetupFlow         (QR code scanner for WA/WeChat)       │
│     │  ├─ PluginGate          (install via existing plugin API)     │
│     │  └─ PolicySection       (DM/group policy + allowlist)         │
│     └─ (polling timer for status refresh)                           │
├─────────────────────────────────────────────────────────────────────┤
│                          HTTP only                                   │
├─────────────────────────────────────────────────────────────────────┤
│                     Aquarium Server (Express)                        │
│                                                                     │
│  GET  /instances/:id/channels/registry   ← NEW: returns registry    │
│  GET  /instances/:id/channels/status     ← existing                 │
│  POST /instances/:id/channels/:ch/configure  ← existing (generic)   │
│  POST /instances/:id/channels/:ch/disconnect ← existing (generic)   │
│  PATCH /instances/:id/channels/:ch/enable    ← existing             │
│  PATCH /instances/:id/channels/:ch/policies  ← existing (extended)  │
│  POST /instances/:id/channels/telegram/configure   ← existing       │
│  POST /instances/:id/channels/telegram/disconnect  ← existing       │
│  POST /instances/:id/channels/whatsapp/start       ← existing       │
│  POST /instances/:id/channels/whatsapp/wait        ← existing       │
│  POST /instances/:id/channels/whatsapp/disconnect  ← existing       │
│  POST /instances/:id/plugins/install     ← existing (reused)        │
│                                                                     │
│  pushChannelConfigToGateway() + waitForReconnect()                  │
│    → OpenClaw gateway (RFC 7396 merge-patch + SIGUSR1 restart)      │
└─────────────────────────────────────────────────────────────────────┘
```

### Key design decisions

| Decision | Rationale |
|----------|-----------|
| Registry as UI catalog | Presentation metadata only. Backend route support (`CHANNEL_REQUIRED_FIELDS`) is the gate — registry describes what's already wirable. Prevents drift between UI and actual capability. |
| Drawer for configuration | Focused single-channel config without losing grid context. On mobile (<640px), renders as full-width detail view. |
| Polling-only status | OpenClaw gateway does NOT emit dedicated channel state change events. The relay forwards raw gateway events but channel-specific semantics are not guaranteed. Polling at 30s is reliable and sufficient for channel status which changes infrequently. |
| Reuse existing plugin install API | Channel plugin installation goes through `POST /plugins/install` which enforces trust policy, version pinning, and integrity checks. No parallel install path. |
| Wait for reconnect on mutation | Channel config changes trigger gateway SIGUSR1 restart (2s delay). Backend now waits for reconnect before returning success, matching plugin-store behavior. |
| Credentials stored server-side | Secrets (bot tokens, app secrets) are stored in encrypted credential store (AES-256-GCM) via existing `credential-store.ts`. Never returned to browser after save. |

---

## 3. Channel Registry — The Data Model

The registry is a UI catalog. Each entry describes everything the frontend needs to render one channel's card and configuration form.

### 3.1 ChannelRegistryEntry

```typescript
interface ChannelRegistryEntry {
  /** Unique channel ID (e.g., 'telegram', 'discord', 'feishu') */
  id: string;

  /** Display name (e.g., 'Telegram', '飞书 / Lark') */
  label: string;

  /** i18n key for label */
  labelKey: string;

  /** Short description */
  description: string;

  /** i18n key for description */
  descriptionKey: string;

  /** Setup flow type */
  setupType: 'token' | 'qr' | 'token+qr';

  /** Whether an OpenClaw plugin must be installed first */
  pluginRequired: boolean;

  /**
   * Full plugin install descriptor (reuses existing plugin API model).
   * Only present when pluginRequired=true.
   */
  pluginInstall?: {
    pluginId: string;
    source: PluginSource;
    minVersion?: string;
  };

  /** Category for grouping in the UI */
  category: 'popular' | 'enterprise' | 'community' | 'experimental';

  /** Sort order within category (lower = first) */
  order: number;

  /** Fields required for token-based setup */
  fields: ChannelFieldDef[];

  /** External help URL */
  helpUrl?: string;

  /** i18n key for help link text */
  helpTextKey?: string;

  /** Channel-specific capabilities (informational, shown on card) */
  capabilities: {
    dm: boolean;
    groups: boolean;
    media: boolean;
    reactions: boolean;
    threads: boolean;
    streaming: boolean;
  };

  /** Supported DM policies for this channel */
  supportedDmPolicies: Array<'open' | 'pairing' | 'allowlist' | 'disabled'>;

  /** Supported group policies for this channel */
  supportedGroupPolicies: Array<'open' | 'allowlist' | 'disabled'>;

  /** Whether this channel uses nested dm: {policy, allowFrom} format (Discord, Slack, etc.) */
  nestedDmPolicy: boolean;

  /** Icon identifier (maps to CSS class or SVG import) */
  icon: string;

  /**
   * Server-side validation patterns for critical fields.
   * Duplicated from ChannelFieldDef.pattern so the server
   * can enforce them independently of the browser.
   */
  serverValidation?: Record<string, { pattern: string; message: string }>;
}
```

### 3.2 ChannelFieldDef

```typescript
interface ChannelFieldDef {
  /** Field key (matches credential provider or config key) */
  key: string;

  /** Display label */
  label: string;

  /** i18n key for label */
  labelKey: string;

  /** Input type */
  type: 'text' | 'password' | 'textarea' | 'select' | 'number';

  /** Placeholder text */
  placeholder?: string;

  /** i18n key for placeholder */
  placeholderKey?: string;

  /** Whether the field is required */
  required: boolean;

  /** Help text shown below the input */
  helpText?: string;

  /** i18n key for help text */
  helpTextKey?: string;

  /** External link for "how to get this" */
  helpUrl?: string;

  /** For 'select' type — available options */
  options?: Array<{ value: string; label: string; labelKey?: string }>;

  /** Validation pattern (regex string) — enforced client AND server side */
  pattern?: string;

  /** Validation error message when pattern fails */
  patternError?: string;
}
```

### 3.3 Registry construction — deriving from backend support

The registry is built at startup by intersecting static UI metadata with actual backend route support:

```typescript
// apps/server/src/services/channel-registry.ts

import { CHANNEL_REQUIRED_FIELDS } from '../routes/channels.js';

// Static UI metadata for all known channels
const CHANNEL_UI_METADATA: ChannelRegistryEntry[] = [ /* ... all entries ... */ ];

// Channels with dedicated routes (not in CHANNEL_REQUIRED_FIELDS)
const DEDICATED_ROUTE_CHANNELS = new Set(['telegram', 'whatsapp']);

/**
 * Build the effective registry by intersecting UI metadata
 * with actual backend support. A channel appears in the registry
 * ONLY if it has route support.
 */
export function buildChannelRegistry(): ChannelRegistryEntry[] {
  const supportedIds = new Set([
    ...Object.keys(CHANNEL_REQUIRED_FIELDS),
    ...DEDICATED_ROUTE_CHANNELS,
  ]);

  return CHANNEL_UI_METADATA.filter(entry => supportedIds.has(entry.id));
}
```

This guarantees: **no channel appears in the UI unless the backend can actually handle it.**

### 3.4 Full Registry — UI Metadata

```typescript
export const CHANNEL_UI_METADATA: ChannelRegistryEntry[] = [
  // ─── Popular ───
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    labelKey: 'channels.whatsapp.label',
    description: 'Connect via QR code — uses your existing WhatsApp account as a linked device.',
    descriptionKey: 'channels.whatsapp.description',
    setupType: 'qr',
    pluginRequired: true,
    pluginInstall: {
      pluginId: 'whatsapp',
      source: { type: 'bundled' },
    },
    category: 'popular',
    order: 1,
    fields: [],
    helpUrl: 'https://docs.openclaw.ai/channels/whatsapp',
    capabilities: { dm: true, groups: true, media: true, reactions: true, threads: false, streaming: true },
    supportedDmPolicies: ['pairing', 'allowlist', 'open', 'disabled'],
    supportedGroupPolicies: ['open', 'allowlist', 'disabled'],
    nestedDmPolicy: false,
    icon: 'whatsapp',
  },
  {
    id: 'telegram',
    label: 'Telegram',
    labelKey: 'channels.telegram.label',
    description: 'Create a bot via @BotFather and paste the token.',
    descriptionKey: 'channels.telegram.description',
    setupType: 'token',
    pluginRequired: false,
    category: 'popular',
    order: 2,
    fields: [
      {
        key: 'botToken',
        label: 'Bot Token',
        labelKey: 'channels.telegram.fields.botToken',
        type: 'password',
        placeholder: '123456789:ABCdefGHI...',
        placeholderKey: 'channels.telegram.fields.botTokenPlaceholder',
        required: true,
        helpText: 'Get this from @BotFather on Telegram.',
        helpTextKey: 'channels.telegram.fields.botTokenHelp',
        helpUrl: 'https://t.me/BotFather',
        pattern: '^\\d+:[A-Za-z0-9_-]+$',
        patternError: 'Token should look like 123456789:ABCdef...',
      },
    ],
    helpUrl: 'https://docs.openclaw.ai/channels/telegram',
    capabilities: { dm: true, groups: true, media: true, reactions: true, threads: true, streaming: true },
    supportedDmPolicies: ['pairing', 'allowlist', 'open', 'disabled'],
    supportedGroupPolicies: ['open', 'allowlist', 'disabled'],
    nestedDmPolicy: false,
    icon: 'telegram',
    serverValidation: {
      botToken: { pattern: '^\\d+:[A-Za-z0-9_-]+$', message: 'Invalid Telegram bot token format' },
    },
  },
  {
    id: 'discord',
    label: 'Discord',
    labelKey: 'channels.discord.label',
    description: 'Create a bot in the Discord Developer Portal.',
    descriptionKey: 'channels.discord.description',
    setupType: 'token',
    pluginRequired: false,
    category: 'popular',
    order: 3,
    fields: [
      {
        key: 'token',
        label: 'Bot Token',
        labelKey: 'channels.discord.fields.token',
        type: 'password',
        required: true,
        helpText: 'From Discord Developer Portal > Bot > Token.',
        helpTextKey: 'channels.discord.fields.tokenHelp',
        helpUrl: 'https://discord.com/developers/applications',
      },
    ],
    helpUrl: 'https://docs.openclaw.ai/channels/discord',
    capabilities: { dm: true, groups: true, media: true, reactions: true, threads: true, streaming: true },
    supportedDmPolicies: ['pairing', 'allowlist', 'open', 'disabled'],
    supportedGroupPolicies: ['open', 'allowlist', 'disabled'],
    nestedDmPolicy: true,
    icon: 'discord',
  },

  // ─── Enterprise ───
  {
    id: 'feishu',
    label: '飞书 / Lark',
    labelKey: 'channels.feishu.label',
    description: 'Connect via Feishu Open Platform enterprise app.',
    descriptionKey: 'channels.feishu.description',
    setupType: 'token',
    pluginRequired: true,
    pluginInstall: {
      pluginId: 'feishu',
      source: { type: 'bundled' },
    },
    category: 'enterprise',
    order: 10,
    fields: [
      {
        key: 'appId', label: 'App ID', labelKey: 'channels.feishu.fields.appId',
        type: 'text', required: true,
        helpText: 'From Feishu Open Platform console.',
        helpTextKey: 'channels.feishu.fields.appIdHelp',
        helpUrl: 'https://open.feishu.cn/app',
      },
      {
        key: 'appSecret', label: 'App Secret', labelKey: 'channels.feishu.fields.appSecret',
        type: 'password', required: true,
      },
      {
        key: 'domain', label: 'Domain', labelKey: 'channels.feishu.fields.domain',
        type: 'select', required: false,
        options: [
          { value: 'feishu', label: '飞书 (China)', labelKey: 'channels.feishu.fields.domainFeishu' },
          { value: 'lark', label: 'Lark (Global)', labelKey: 'channels.feishu.fields.domainLark' },
        ],
      },
    ],
    helpUrl: 'https://docs.openclaw.ai/channels/feishu',
    capabilities: { dm: true, groups: true, media: true, reactions: false, threads: false, streaming: true },
    supportedDmPolicies: ['pairing', 'allowlist', 'open', 'disabled'],
    supportedGroupPolicies: ['open', 'allowlist', 'disabled'],
    nestedDmPolicy: false,
    icon: 'feishu',
  },
  {
    id: 'slack',
    label: 'Slack',
    labelKey: 'channels.slack.label',
    description: 'Connect via Slack Socket Mode with a Slack App.',
    descriptionKey: 'channels.slack.description',
    setupType: 'token',
    pluginRequired: false,
    category: 'enterprise',
    order: 11,
    fields: [
      {
        key: 'appToken', label: 'App Token', labelKey: 'channels.slack.fields.appToken',
        type: 'password', placeholder: 'xapp-...', required: true,
        helpText: 'App-Level Token (starts with xapp-).',
        helpTextKey: 'channels.slack.fields.appTokenHelp',
        helpUrl: 'https://api.slack.com/apps',
        pattern: '^xapp-', patternError: 'App Token must start with xapp-',
      },
      {
        key: 'botToken', label: 'Bot Token', labelKey: 'channels.slack.fields.botToken',
        type: 'password', placeholder: 'xoxb-...', required: true,
        helpText: 'Bot User OAuth Token (starts with xoxb-).',
        helpTextKey: 'channels.slack.fields.botTokenHelp',
        pattern: '^xoxb-', patternError: 'Bot Token must start with xoxb-',
      },
    ],
    helpUrl: 'https://docs.openclaw.ai/channels/slack',
    capabilities: { dm: true, groups: true, media: true, reactions: true, threads: true, streaming: true },
    supportedDmPolicies: ['pairing', 'allowlist', 'open', 'disabled'],
    supportedGroupPolicies: ['open', 'allowlist', 'disabled'],
    nestedDmPolicy: true,
    icon: 'slack',
    serverValidation: {
      appToken: { pattern: '^xapp-', message: 'App Token must start with xapp-' },
      botToken: { pattern: '^xoxb-', message: 'Bot Token must start with xoxb-' },
    },
  },
  {
    id: 'msteams',
    label: 'Microsoft Teams',
    labelKey: 'channels.msteams.label',
    description: 'Connect via Azure Bot Framework.',
    descriptionKey: 'channels.msteams.description',
    setupType: 'token',
    pluginRequired: false,
    category: 'enterprise',
    order: 12,
    fields: [
      { key: 'appId', label: 'App ID', labelKey: 'channels.msteams.fields.appId', type: 'text', required: true, helpText: 'Azure Bot Service Application ID.', helpUrl: 'https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps' },
      { key: 'appPassword', label: 'App Password', labelKey: 'channels.msteams.fields.appPassword', type: 'password', required: true },
      { key: 'tenantId', label: 'Tenant ID', labelKey: 'channels.msteams.fields.tenantId', type: 'text', required: true },
    ],
    helpUrl: 'https://docs.openclaw.ai/channels/msteams',
    capabilities: { dm: true, groups: true, media: true, reactions: false, threads: true, streaming: false },
    supportedDmPolicies: ['pairing', 'allowlist', 'open', 'disabled'],
    supportedGroupPolicies: ['open', 'allowlist', 'disabled'],
    nestedDmPolicy: false,
    icon: 'msteams',
  },
  {
    id: 'googlechat',
    label: 'Google Chat',
    labelKey: 'channels.googlechat.label',
    description: 'Connect via Google Workspace service account.',
    descriptionKey: 'channels.googlechat.description',
    setupType: 'token',
    pluginRequired: false,
    category: 'enterprise',
    order: 13,
    fields: [
      { key: 'serviceAccountJson', label: 'Service Account JSON', labelKey: 'channels.googlechat.fields.serviceAccountJson', type: 'textarea', required: true, helpText: 'Paste the full JSON key file contents from Google Cloud Console.', helpUrl: 'https://console.cloud.google.com/iam-admin/serviceaccounts' },
    ],
    helpUrl: 'https://docs.openclaw.ai/channels/googlechat',
    capabilities: { dm: true, groups: true, media: true, reactions: false, threads: true, streaming: false },
    supportedDmPolicies: ['pairing', 'allowlist', 'open', 'disabled'],
    supportedGroupPolicies: ['open', 'allowlist', 'disabled'],
    nestedDmPolicy: true,
    icon: 'googlechat',
  },

  // ─── Community ───
  {
    id: 'qqbot',
    label: 'QQ Bot',
    labelKey: 'channels.qqbot.label',
    description: 'Connect via official QQ Bot API (QQ Open Platform).',
    descriptionKey: 'channels.qqbot.description',
    setupType: 'token',
    pluginRequired: true,
    pluginInstall: {
      pluginId: 'qqbot',
      source: { type: 'npm', spec: '@tencent-connect/openclaw-qqbot' },
    },
    category: 'community',
    order: 20,
    fields: [
      { key: 'appId', label: 'App ID', labelKey: 'channels.qqbot.fields.appId', type: 'text', required: true, helpText: 'From QQ Open Platform developer console.', helpUrl: 'https://q.qq.com/wiki/develop/nodesdk' },
      { key: 'clientSecret', label: 'Client Secret', labelKey: 'channels.qqbot.fields.clientSecret', type: 'password', required: true },
    ],
    helpUrl: 'https://docs.openclaw.ai/channels/qqbot',
    capabilities: { dm: true, groups: true, media: true, reactions: false, threads: false, streaming: false },
    supportedDmPolicies: ['pairing', 'allowlist', 'open', 'disabled'],
    supportedGroupPolicies: ['open', 'allowlist', 'disabled'],
    nestedDmPolicy: false,
    icon: 'qqbot',
  },
  {
    id: 'wechat',
    label: 'WeChat',
    labelKey: 'channels.wechat.label',
    description: 'Connect via Tencent iLink Bot plugin (QR code login).',
    descriptionKey: 'channels.wechat.description',
    setupType: 'qr',
    pluginRequired: true,
    pluginInstall: {
      pluginId: 'wechat',
      source: { type: 'npm', spec: '@openclaw/wechat' },
    },
    category: 'community',
    order: 21,
    fields: [],
    helpUrl: 'https://docs.openclaw.ai/channels/wechat',
    capabilities: { dm: true, groups: true, media: true, reactions: false, threads: false, streaming: false },
    supportedDmPolicies: ['pairing', 'allowlist', 'open', 'disabled'],
    supportedGroupPolicies: ['open', 'allowlist', 'disabled'],
    nestedDmPolicy: false,
    icon: 'wechat',
  },
  {
    id: 'signal',
    label: 'Signal', labelKey: 'channels.signal.label',
    description: 'Connect via signal-cli with a registered phone number.',
    descriptionKey: 'channels.signal.description',
    setupType: 'token', pluginRequired: false, category: 'community', order: 22,
    fields: [
      { key: 'account', label: 'Phone Number', labelKey: 'channels.signal.fields.account', type: 'text', placeholder: '+15551234567', required: true, helpText: 'E.164 format phone number registered with signal-cli.', pattern: '^\\+\\d{7,15}$', patternError: 'Must be E.164 format (+country code + number)' },
    ],
    helpUrl: 'https://docs.openclaw.ai/channels/signal',
    capabilities: { dm: true, groups: true, media: true, reactions: true, threads: false, streaming: false },
    supportedDmPolicies: ['pairing', 'allowlist', 'open', 'disabled'],
    supportedGroupPolicies: ['open', 'allowlist', 'disabled'],
    nestedDmPolicy: false, icon: 'signal',
    serverValidation: { account: { pattern: '^\\+\\d{7,15}$', message: 'Invalid E.164 phone number' } },
  },
  {
    id: 'line',
    label: 'LINE', labelKey: 'channels.line.label',
    description: 'Connect via LINE Messaging API.',
    descriptionKey: 'channels.line.description',
    setupType: 'token', pluginRequired: false, category: 'community', order: 23,
    fields: [
      { key: 'channelAccessToken', label: 'Channel Access Token', labelKey: 'channels.line.fields.channelAccessToken', type: 'password', required: true, helpUrl: 'https://developers.line.biz/console/' },
      { key: 'channelSecret', label: 'Channel Secret', labelKey: 'channels.line.fields.channelSecret', type: 'password', required: true },
    ],
    helpUrl: 'https://docs.openclaw.ai/channels/line',
    capabilities: { dm: true, groups: true, media: true, reactions: false, threads: false, streaming: false },
    supportedDmPolicies: ['pairing', 'allowlist', 'open', 'disabled'],
    supportedGroupPolicies: ['open', 'allowlist', 'disabled'],
    nestedDmPolicy: false, icon: 'line',
  },
  {
    id: 'matrix',
    label: 'Matrix', labelKey: 'channels.matrix.label',
    description: 'Connect to any Matrix homeserver.',
    descriptionKey: 'channels.matrix.description',
    setupType: 'token', pluginRequired: false, category: 'community', order: 24,
    fields: [
      { key: 'homeserver', label: 'Homeserver URL', labelKey: 'channels.matrix.fields.homeserver', type: 'text', placeholder: 'https://matrix.org', required: true },
      { key: 'accessToken', label: 'Access Token', labelKey: 'channels.matrix.fields.accessToken', type: 'password', required: true },
    ],
    helpUrl: 'https://docs.openclaw.ai/channels/matrix',
    capabilities: { dm: true, groups: true, media: true, reactions: true, threads: true, streaming: false },
    supportedDmPolicies: ['pairing', 'allowlist', 'open', 'disabled'],
    supportedGroupPolicies: ['open', 'allowlist', 'disabled'],
    nestedDmPolicy: true, icon: 'matrix',
  },
];
```

---

## 4. Backend API Changes

### 4.0 Phase 0 — Backend alignment (before any UI work)

These changes make existing routes reliable enough for the new UI:

1. **Add `waitForReconnect()` to `pushChannelConfigToGateway()`** in `channels.ts`.
   Currently, `patchGatewayConfig()` triggers a SIGUSR1 restart with 2s delay and returns immediately. Plugin-store already calls `waitForReconnect()` after patching. Channel routes must do the same so the API response means "change applied", not "change queued".

2. **Add `feishu` and `qqbot` to `CHANNEL_REQUIRED_FIELDS`**:
   ```typescript
   feishu: {
     fields: ['appId', 'appSecret'],
     credentialFields: [
       { provider: 'feishu_app', envKey: 'appId' },
       { provider: 'feishu_secret', envKey: 'appSecret' },
     ],
   },
   qqbot: {
     fields: ['appId', 'clientSecret'],
     credentialFields: [
       { provider: 'qqbot_app', envKey: 'appId' },
       { provider: 'qqbot_secret', envKey: 'clientSecret' },
     ],
   },
   ```

3. **Extend `ChannelPolicyUpdate` and the policies route** to support `allowFrom` and `groupAllowFrom` (see §5).

4. **Pass audit context** in all channel credential mutations:
   ```typescript
   // In every addCredential / deleteCredential call in channels.ts:
   await addCredential(instance.id, provider, type, value.trim(), {}, {
     userId: req.auth!.userId,
     source: 'channel-config',
     ipAddress: req.ip,
   });
   ```

5. **Add server-side validation** for critical fields in the generic configure endpoint:
   ```typescript
   // Look up serverValidation from registry, enforce patterns before storing
   if (registryEntry.serverValidation) {
     for (const [key, rule] of Object.entries(registryEntry.serverValidation)) {
       if (body[key] && !new RegExp(rule.pattern).test(body[key])) {
         return res.status(400).json({ ok: false, error: rule.message });
       }
     }
   }
   ```

6. **Add config-field-meta entries** for new channels:
   ```typescript
   { key: 'enableDiscord',   label: 'Discord',   labelKey: 'configFields.enableDiscord',   category: 'channel' },
   { key: 'enableFeishu',    label: 'Feishu',     labelKey: 'configFields.enableFeishu',    category: 'channel' },
   { key: 'enableSlack',     label: 'Slack',      labelKey: 'configFields.enableSlack',     category: 'channel' },
   { key: 'enableQQBot',     label: 'QQ Bot',     labelKey: 'configFields.enableQQBot',     category: 'channel' },
   ```

### 4.1 New Endpoint: `GET /instances/:id/channels/registry`

Returns the channel registry enriched with live status and plugin state.

**Response shape**:

```typescript
interface ChannelRegistryResponse {
  channels: Array<ChannelRegistryEntry & {
    /** Live status (null if instance is not running or RPC failed) */
    status: ChannelStatusDetail | null;
    /** Whether the required plugin is installed on this instance */
    pluginInstalled: boolean;
    /** Whether the channel has stored credentials */
    hasCredentials: boolean;
    /** Whether the channel is compatible with the instance image tag */
    compatible: boolean;
    /** If !compatible, reason string */
    incompatibleReason?: string;
  }>;
}
```

**Implementation logic** (no manifest filtering):

```
1. Call buildChannelRegistry() — intersects UI metadata with CHANNEL_REQUIRED_FIELDS keys + dedicated routes
2. For each entry where pluginRequired=true:
   a. Check plugin-store for installation status → pluginInstalled
   b. If pluginInstall.minVersion set, check installed version → compatible
3. For each entry:
   a. Check credential-store for hasCredentials (any credential matching channel's providers)
4. If instance is running:
   a. Call channels.status RPC (probe=false for speed, 3s timeout)
   b. Merge status into each entry
   c. On RPC failure → status: null (not empty array — distinguishes "no data" from "no channels")
5. Return merged array
```

**Why no manifest filtering**: The OpenClaw manifest's `channelTypes` only lists `['whatsapp', 'telegram']`, but the adapter's `seedConfig()` supports 12+ channels. The manifest is informational — the actual route support (`CHANNEL_REQUIRED_FIELDS` + dedicated routes) is the authoritative gate.

### 4.2 Plugin Installation — Reuse existing API

**No new plugin install endpoint.** The frontend calls the existing `POST /instances/:id/plugins/install` with the `pluginId` and `source` from the registry entry's `pluginInstall` descriptor. This preserves:

- Trust policy evaluation (`evaluateTrustPolicy()`)
- Version pinning and integrity hash
- The full `PluginSource` model (bundled vs npm vs local)
- Error handling and retry logic

The PluginGate component constructs the request payload from `channel.pluginInstall`:
```typescript
await api.post(`/instances/${instanceId}/plugins/install`, {
  pluginId: channel.pluginInstall.pluginId,
  source: channel.pluginInstall.source,
});
```

### 4.3 Extended: Policies Endpoint

The existing `PATCH /:id/channels/:channel/policies` is extended to handle allowlists:

```typescript
router.patch('/:id/channels/:channel/policies', async (req, res) => {
  const { dmPolicy, groupPolicy, allowFrom, groupAllowFrom } = req.body as ChannelPolicyUpdate;

  const channelPatch: Record<string, unknown> = {};
  if (dmPolicy) {
    if (NESTED_DM_POLICY_CHANNELS.has(channel)) {
      channelPatch.dm = { policy: dmPolicy, ...(allowFrom ? { allowFrom } : {}) };
    } else {
      channelPatch.dmPolicy = dmPolicy;
      if (allowFrom) channelPatch.allowFrom = allowFrom;
    }
  }
  if (groupPolicy) channelPatch.groupPolicy = groupPolicy;
  if (groupAllowFrom) channelPatch.groupAllowFrom = groupAllowFrom;

  await patchGatewayConfig(instance.id, req.auth!.userId, {
    channels: { [channel]: channelPatch },
  }, `Update ${channel} policies`);
  // waitForReconnect is now called inside pushChannelConfigToGateway
});
```

---

## 5. Shared Type Additions

**File**: `packages/shared/src/types.ts`

```typescript
// === Channel Registry ===

export interface ChannelFieldDef {
  key: string;
  label: string;
  labelKey: string;
  type: 'text' | 'password' | 'textarea' | 'select' | 'number';
  placeholder?: string;
  placeholderKey?: string;
  required: boolean;
  helpText?: string;
  helpTextKey?: string;
  helpUrl?: string;
  options?: Array<{ value: string; label: string; labelKey?: string }>;
  pattern?: string;
  patternError?: string;
}

export interface ChannelCapabilities {
  dm: boolean;
  groups: boolean;
  media: boolean;
  reactions: boolean;
  threads: boolean;
  streaming: boolean;
}

export interface ChannelRegistryEntry {
  id: string;
  label: string;
  labelKey: string;
  description: string;
  descriptionKey: string;
  setupType: 'token' | 'qr' | 'token+qr';
  pluginRequired: boolean;
  pluginInstall?: {
    pluginId: string;
    source: PluginSource;
    minVersion?: string;
  };
  category: 'popular' | 'enterprise' | 'community' | 'experimental';
  order: number;
  fields: ChannelFieldDef[];
  helpUrl?: string;
  helpTextKey?: string;
  capabilities: ChannelCapabilities;
  supportedDmPolicies: Array<ChannelPolicyUpdate['dmPolicy']>;
  supportedGroupPolicies: Array<ChannelPolicyUpdate['groupPolicy']>;
  nestedDmPolicy: boolean;
  icon: string;
  serverValidation?: Record<string, { pattern: string; message: string }>;
}

export interface ChannelRegistryItem extends ChannelRegistryEntry {
  status: ChannelStatusDetail | null;
  pluginInstalled: boolean;
  hasCredentials: boolean;
  compatible: boolean;
  incompatibleReason?: string;
}
```

**Extended existing type**:

```typescript
// ChannelPolicyUpdate — add allowFrom fields
export interface ChannelPolicyUpdate {
  dmPolicy?: 'open' | 'pairing' | 'allowlist' | 'disabled';
  groupPolicy?: 'open' | 'disabled' | 'allowlist';
  allowFrom?: string[];        // NEW — DM allowlist entries
  groupAllowFrom?: string[];   // NEW — Group allowlist entries
}
```

---

## 6. Frontend Component Hierarchy

```
ChannelsTab (apps/web/src/components/channels/ChannelsTab.tsx)
├── ChannelGrid
│   └── ChannelCard ×N
│       ├── ChannelIcon
│       ├── ChannelStatusBadge
│       └── ChannelQuickActions (enable/disable toggle, configure button)
│
├── ChannelConfigDrawer
│   ├── DrawerHeader (channel name + icon + close)
│   ├── PluginGate (shown if pluginRequired && !pluginInstalled)
│   ├── TokenSetupForm (shown for setupType='token')
│   │   ├── DynamicField ×N (renders based on ChannelFieldDef)
│   │   └── SaveButton + DisconnectButton
│   ├── QrSetupFlow (shown for setupType='qr')
│   │   ├── QrCodeDisplay
│   │   ├── QrStatusMessage
│   │   └── DisconnectButton
│   ├── PolicySection (shown when channel is configured)
│   │   ├── DmPolicySelector
│   │   ├── GroupPolicySelector
│   │   └── AllowlistEditor
│   └── ChannelStatusPanel
│       ├── ConnectionIndicator
│       ├── LastActivityTimestamps
│       ├── ProbeResults
│       └── ErrorDisplay
│
└── (polling timer — no separate component)
```

**File structure**:
```
apps/web/src/components/channels/
├── ChannelsTab.tsx
├─��� ChannelsTab.css
├── ChannelGrid.tsx
├── ChannelCard.tsx
├── ChannelIcon.tsx
├── ChannelStatusBadge.tsx
├── ChannelConfigDrawer.tsx
├── TokenSetupForm.tsx
├── QrSetupFlow.tsx
├── PluginGate.tsx
├── PolicySection.tsx
└── DynamicField.tsx
```

---

## 7. Component Specifications

### 7.1 ChannelsTab

**Props**: `{ instanceId: string; instanceStatus: string }`

**State**:
```typescript
const [registry, setRegistry] = useState<ChannelRegistryItem[]>([]);
const [loading, setLoading] = useState(true);
const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
const [applying, setApplying] = useState(false); // gateway restart in progress
```

**Behavior**:
- On mount: `GET /instances/:id/channels/registry` → populate registry
- If `instanceStatus === 'running'`: start 30s interval polling `GET /channels/status?probe=false`
- After any mutation (configure/disconnect/policy): set `applying=true`, wait 3s, re-fetch status, set `applying=false`
- When instance is not running: show info banner "Start your instance to manage channels"
- Skeleton: 6 placeholder cards with pulse animation while loading

### 7.2 ChannelCard

**Props**: `{ channel: ChannelRegistryItem; onSelect; onToggleEnabled; disabled }`

**Visual layout**:
```
┌────────────────────────────────────────┐
│  [Icon]  Telegram              [Toggle]│
│          @my_assistant_bot             │
│                                        │
│  ● Connected  ·  Last msg: 2m ago      │
│                                        │
│  DM  Groups  Media  Streaming          │
│                                        │
│              [Configure →]             │
└────────────────────────────────────────┘
```

**States**:
- **Not configured** (no credentials): Muted card, "Set up →" button
- **Configured + connected**: Green dot, show displayName, last activity
- **Configured + disconnected**: Red dot, show error if any
- **Applying**: Yellow dot, "Applying changes..." text
- **Plugin required + not installed**: Lock icon overlay, "Install plugin" CTA
- **Incompatible**: Warning banner on card, configure disabled
- **Instance not running**: All cards muted, no toggle/configure

### 7.3 ChannelConfigDrawer

480px slide-out from right. On mobile (<640px), 100vw — functions as full-page detail.

**Props**: `{ channel: ChannelRegistryItem; instanceId: string; onClose; onUpdate }`

**Sections rendered conditionally**:

| Condition | Section shown |
|-----------|---------------|
| `!compatible` | Incompatibility warning only |
| `pluginRequired && !pluginInstalled` | PluginGate only |
| `setupType === 'token'` | TokenSetupForm |
| `setupType === 'qr'` | QrSetupFlow |
| `setupType === 'token+qr'` | TokenSetupForm + QR button |
| `hasCredentials` | PolicySection + StatusPanel |

### 7.4 TokenSetupForm

**Props**: `{ channel: ChannelRegistryItem; instanceId: string; onConfigured }`

**Behavior**:
1. Renders one `DynamicField` per entry in `channel.fields[]`
2. Client-side validation using `pattern` regex before submit (server also validates)
3. On submit: `POST /instances/:id/channels/:channel/configure` with field values
4. Server waits for gateway reconnect before responding
5. On success: toast "Telegram configured", call `onConfigured()` → triggers re-fetch
6. If `hasCredentials=true`: show placeholder "••••••••" and "Disconnect" button

**Disconnect flow**: Confirmation dialog → `POST disconnect` → toast → re-fetch

### 7.5 QrSetupFlow

**Props**: `{ channel: ChannelRegistryItem; instanceId: string; onConnected }`

**State machine**: `[idle] → [requesting] → [scanning] → [connected]` with `[expired]` fallback and auto-retry (up to 3 times).

**Implementation** (WhatsApp):
1. `POST /whatsapp/start` → get `qrDataUrl`
2. Render QR as `<img src={qrDataUrl} />` (280×280px, white bg, 16px padding)
3. `POST /whatsapp/wait` (long-poll, up to 120s)
4. On `connected: true` → success state
5. On timeout/515 → "QR expired, generating new one..." → auto-retry

### 7.6 PluginGate

**Props**: `{ channel: ChannelRegistryItem; instanceId: string; onInstalled }`

**Behavior**: Click "Install" → `POST /instances/:id/plugins/install` with `channel.pluginInstall.pluginId` and `channel.pluginInstall.source` → spinner → on success: hide gate, show setup form. Trust policy is enforced by the existing plugin route.

### 7.7 PolicySection

**Props**: `{ channel: ChannelRegistryItem; instanceId: string; onPolicyUpdate }`

**Layout**:
```
─── Access Policies ────────────────────

DM Policy        [Pairing ▼]
                  New contacts must be approved.

Group Policy     [Allowlist ▼]
                  Bot only responds in listed groups.

Allow List       +15551234567          [✕]
                 @telegram_user_123    [✕]
                 [+ Add]
```

**Behavior**:
- DM/Group dropdowns populated from `channel.supportedDmPolicies` / `supportedGroupPolicies`
- On change: `PATCH /policies` with `{ dmPolicy, groupPolicy, allowFrom, groupAllowFrom }`
- Allowlist editor: shown when policy is 'allowlist'; add/remove entries sent as full array replacement
- Optimistic: update dropdown immediately, revert on error

### 7.8 DynamicField

Renders one form control per `ChannelFieldDef`. Maps `type` to `<Input>`, `<Input type="password">`, `<textarea>`, `<Select>`, or `<Input type="number">`. Validates `pattern` on blur with inline error. Help text with optional external link.

### 7.9 ChannelStatusBadge

| connected | configured | running | applying | Display |
|-----------|-----------|---------|----------|---------|
| true | true | true | false | 🟢 Connected |
| — | — | — | true | 🟡 Applying... |
| false | true | true | false | 🔴 Disconnected |
| false | true | false | false | 🟡 Stopped |
| false | false | false | false | ⚪ Not configured |

---

## 8. State Management & Data Flow

### 8.1 Data loading sequence

```
ChannelsTab mounts
  │
  ├─ GET /instances/:id/channels/registry
  │  → Sets registry[] state (includes status snapshot)
  │
  ├─ If instanceStatus === 'running':
  │  └─ Start 30s interval: GET /instances/:id/channels/status?probe=false
  │     → mergeStatusIntoRegistry(statusDetails)
  │
  └─ If instanceStatus changes to 'running' (was starting):
     → Re-fetch full registry (credentials may have been applied during start)
```

### 8.2 Configuration flow (with gateway restart awareness)

```
User fills form → Submit
  │
  ├─ UI: setApplying(true), show "Applying..." badge on card
  │
  ├─ POST /instances/:id/channels/:channel/configure
  │   │ Server stores credentials (encrypted, with audit context)
  │   │ Server pushes config patch to gateway
  │   │ Server calls waitForReconnect() — waits for SIGUSR1 restart to complete
  │   └─ Returns success (gateway is back online)
  │
  ├─ UI: toast "Telegram configured"
  │
  ├─ Wait 1s (allow gateway channel to start)
  │
  ├─ GET /instances/:id/channels/status?probe=false → merge into registry
  │
  └─ UI: setApplying(false), card shows actual status
```

### 8.3 Optimistic UI

- **Enable/disable toggle**: Flip immediately → `PATCH /enable`. On error, flip back + toast.
- **Policy change**: Update dropdown immediately → `PATCH /policies`. On error, revert + toast.
- **Disconnect**: Show "Disconnecting..." → POST → on response, re-fetch → card updates.

---

## 9. Status Refresh Strategy

### Why polling only

The OpenClaw gateway does **not** emit dedicated WebSocket events for channel state changes. The gateway event relay forwards raw events, but:

- There is no `channels.status.changed` event in the gateway's event list
- Channel status is only available via `channels.status` RPC (request/response)
- The status route suppresses RPC failures by returning empty `{ channels: {}, details: [] }`

Relying on assumed WS events would cause stale or oscillating state. Polling is reliable and sufficient.

### Polling implementation

```typescript
// In ChannelsTab
useEffect(() => {
  if (instanceStatus !== 'running') return;

  const poll = async () => {
    try {
      const result = await api.get<{ details: ChannelStatusDetail[] }>(
        `/instances/${instanceId}/channels/status?probe=false`
      );
      setRegistry(prev => mergeStatusIntoRegistry(prev, result.details));
    } catch {
      // Swallow — next poll will retry
    }
  };

  const timer = setInterval(poll, 30_000);
  return () => clearInterval(timer);
}, [instanceId, instanceStatus]);
```

### Post-mutation refresh

After configure/disconnect/policy changes, the server waits for gateway reconnect before responding. The UI then waits 1s and fetches status once:

```typescript
const refreshAfterMutation = async () => {
  setApplying(true);
  await new Promise(r => setTimeout(r, 1000)); // Let channel start
  await fetchStatus();
  setApplying(false);
};
```

---

## 10. CSS & Visual Design

### 10.1 Design tokens

All from existing `index.css` — no new CSS variables needed.

### 10.2 Key styles

```css
/* Card grid — responsive */
.channel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--spacing-lg);
  padding: var(--spacing-md) 0;
}

/* Channel card */
.channel-card {
  background: var(--color-card-bg);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: var(--spacing-lg);
  cursor: pointer;
  transition: box-shadow var(--transition-base), border-color var(--transition-base);
}
.channel-card:hover { box-shadow: var(--shadow-md); border-color: var(--color-primary); }
.channel-card--disabled { opacity: 0.5; cursor: not-allowed; }
.channel-card--connected { border-left: 3px solid var(--color-success); }
.channel-card--error { border-left: 3px solid var(--color-danger); }
.channel-card--applying { border-left: 3px solid var(--color-warning); }

/* Config drawer */
.channel-drawer-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 50; }
.channel-drawer {
  position: fixed; top: 0; right: 0; bottom: 0;
  width: 480px; max-width: 90vw;
  background: var(--color-bg); box-shadow: var(--shadow-xl); z-index: 51;
  overflow-y: auto;
  animation: slide-in-right var(--transition-slow) ease-out;
}
@keyframes slide-in-right { from { transform: translateX(100%); } to { transform: translateX(0); } }
.channel-drawer__header { position: sticky; top: 0; background: var(--color-bg); padding: var(--spacing-lg); border-bottom: 1px solid var(--color-border); display: flex; align-items: center; gap: var(--spacing-md); z-index: 1; }
.channel-drawer__body { padding: var(--spacing-lg); display: flex; flex-direction: column; gap: var(--spacing-xl); }

/* QR code */
.qr-container { display: flex; flex-direction: column; align-items: center; gap: var(--spacing-md); padding: var(--spacing-xl) 0; }
.qr-code { width: 280px; height: 280px; background: white; padding: 16px; border-radius: 12px; box-shadow: var(--shadow-sm); }
.qr-timer { width: 280px; height: 4px; background: var(--color-border); border-radius: 2px; overflow: hidden; }
.qr-timer__bar { height: 100%; background: var(--color-primary); transition: width 1s linear; }

/* Channel icons — brand colors */
.channel-icon { width: 24px; height: 24px; flex-shrink: 0; }
.channel-icon--lg { width: 32px; height: 32px; }
.channel-icon--whatsapp { color: #25D366; }
.channel-icon--telegram { color: #0088cc; }
.channel-icon--discord  { color: #5865F2; }
.channel-icon--feishu   { color: #3370FF; }
.channel-icon--slack    { color: #4A154B; }
.channel-icon--qqbot    { color: #12B7F5; }
.channel-icon--wechat   { color: #07C160; }
.channel-icon--signal   { color: #3A76F0; }

/* Responsive */
@media (max-width: 640px) {
  .channel-grid { grid-template-columns: 1fr; }
  .channel-drawer { width: 100vw; }
}
@media (min-width: 641px) and (max-width: 1024px) {
  .channel-grid { grid-template-columns: repeat(2, 1fr); }
}
```

Dark mode: All colors use CSS variables from Oxide — adapts automatically. Brand icon colors remain constant.

---

## 11. i18n Strategy

All channel strings live under the `channels` namespace. Full key structure in `en.json`:

```json
{
  "channels": {
    "title": "Channels",
    "subtitle": "Connect your AI agent to messaging platforms.",
    "instanceNotRunning": "Start your instance to manage channels.",
    "applying": "Applying changes...",
    "status": {
      "connected": "Connected",
      "disconnected": "Disconnected",
      "stopped": "Stopped",
      "notConfigured": "Not configured",
      "applying": "Applying..."
    },
    "actions": {
      "configure": "Configure",
      "setup": "Set up",
      "disconnect": "Disconnect",
      "enable": "Enable",
      "disable": "Disable",
      "installPlugin": "Install Plugin",
      "installing": "Installing...",
      "save": "Save & Apply",
      "saving": "Saving...",
      "retry": "Retry"
    },
    "drawer": {
      "configuration": "Configuration",
      "policies": "Access Policies",
      "pluginRequired": "Plugin Required",
      "pluginRequiredDesc": "{{channel}} requires the {{pluginId}} plugin. Install it to continue.",
      "disconnectConfirm": "This will remove your {{channel}} credentials and disconnect the bot. Continue?",
      "incompatible": "This channel is not compatible with your current instance image."
    },
    "policies": {
      "dmPolicy": "DM Policy",
      "groupPolicy": "Group Policy",
      "allowList": "Allow List",
      "addEntry": "Add",
      "pairing": "Pairing",
      "pairingDesc": "New contacts must be approved before messaging.",
      "allowlist": "Allow List",
      "allowlistDesc": "Only listed contacts can message.",
      "open": "Open",
      "openDesc": "Anyone can message the bot.",
      "disabled": "Disabled",
      "disabledDesc": "All messages blocked."
    },
    "whatsapp": { "label": "WhatsApp", "description": "Connect via QR code — uses your existing WhatsApp account.", "scanInstructions": "Open WhatsApp → Settings → Linked Devices → Link a Device", "qrExpired": "QR code expired. Generating a new one...", "connected": "WhatsApp connected!" },
    "telegram": { "label": "Telegram", "description": "Create a bot via @BotFather and paste the token.", "fields": { "botToken": "Bot Token", "botTokenPlaceholder": "123456789:ABCdefGHI...", "botTokenHelp": "Get this from @BotFather on Telegram." } },
    "discord": { "label": "Discord", "description": "Create a bot in the Discord Developer Portal.", "fields": { "token": "Bot Token", "tokenHelp": "Discord Developer Portal → Bot → Token." } },
    "feishu": { "label": "飞书 / Lark", "description": "Connect via Feishu Open Platform enterprise app.", "fields": { "appId": "App ID", "appIdHelp": "From Feishu Open Platform console.", "appSecret": "App Secret", "domain": "Domain", "domainFeishu": "飞书 (China)", "domainLark": "Lark (Global)" } },
    "slack": { "label": "Slack", "description": "Connect via Slack Socket Mode.", "fields": { "appToken": "App Token", "appTokenHelp": "App-Level Token (starts with xapp-).", "botToken": "Bot Token", "botTokenHelp": "Bot User OAuth Token (starts with xoxb-)." } },
    "qqbot": { "label": "QQ Bot", "description": "Connect via official QQ Bot API.", "fields": { "appId": "App ID", "appIdHelp": "From QQ Open Platform.", "clientSecret": "Client Secret" } },
    "wechat": { "label": "WeChat", "description": "Connect via QR code login." },
    "msteams": { "label": "Microsoft Teams", "description": "Connect via Azure Bot Framework.", "fields": { "appId": "App ID", "appPassword": "App Password", "tenantId": "Tenant ID" } },
    "signal": { "label": "Signal", "description": "Connect via signal-cli.", "fields": { "account": "Phone Number", "accountHelp": "E.164 format." } },
    "googlechat": { "label": "Google Chat", "description": "Connect via service account.", "fields": { "serviceAccountJson": "Service Account JSON" } },
    "line": { "label": "LINE", "description": "Connect via LINE Messaging API.", "fields": { "channelAccessToken": "Channel Access Token", "channelSecret": "Channel Secret" } },
    "matrix": { "label": "Matrix", "description": "Connect to any Matrix homeserver.", "fields": { "homeserver": "Homeserver URL", "accessToken": "Access Token" } }
  }
}
```

Locales: `en.json` and `zh.json` get full translations. `fr/de/es/it` start with English fallbacks.

---

## 12. Security Considerations

### 12.1 Credential handling

- **Never return secrets to browser**: Registry endpoint returns `hasCredentials: boolean`, never actual values.
- **AES-256-GCM encryption** at rest via existing `credential-store.ts`.
- **Audit context**: All `addCredential()` / `deleteCredential()` calls include `{ userId, source: 'channel-config', ipAddress }`. Both functions already accept optional `CredentialAuditContext` and log when provided — channel routes now always pass it.

### 12.2 Input validation

- **Client-side**: `pattern` regex on `ChannelFieldDef` for immediate feedback.
- **Server-side**: `serverValidation` patterns enforced in the generic configure endpoint before credential storage. Critical patterns (Telegram bot token format, Slack token prefix) are checked server-side.

### 12.3 Plugin trust

- Plugin installation via existing route enforces `evaluateTrustPolicy()` for non-bundled sources.
- Registry only offers plugins with known `pluginId` and `PluginSource` — no arbitrary npm input.

### 12.4 Authorization

- All routes behind `requireAuth`.
- Instance ownership verified via `getInstance(id, userId)`.

---

## 13. Implementation Phases

### Phase 0: Backend Alignment

**Goal**: Make existing backend routes reliable and complete for Channel Hub.

- [ ] Add `waitForReconnect()` to `pushChannelConfigToGateway()` in `channels.ts`
- [ ] Add `feishu` and `qqbot` to `CHANNEL_REQUIRED_FIELDS`
- [ ] Extend `ChannelPolicyUpdate` with `allowFrom` and `groupAllowFrom` in shared types
- [ ] Extend `PATCH /policies` route to handle allowFrom/groupAllowFrom
- [ ] Pass audit context in all channel credential mutations
- [ ] Add server-side validation using `serverValidation` patterns in generic configure
- [ ] Add config-field-meta entries for new channels

**Deliverable**: Existing channel routes are reliable, new channels are configurable, policies support allowlists.

### Phase 1: Registry + Skeleton UI

**Backend**:
- [ ] Create `apps/server/src/services/channel-registry.ts` with `buildChannelRegistry()`
- [ ] Add `GET /instances/:id/channels/registry` endpoint
- [ ] Add new shared types to `packages/shared/src/types.ts`

**Frontend**:
- [ ] Create `apps/web/src/components/channels/` directory
- [ ] Implement `ChannelsTab.tsx` with loading, polling, and banner states
- [ ] Implement `ChannelGrid.tsx` and `ChannelCard.tsx` (status display only)
- [ ] Implement `ChannelStatusBadge.tsx` and `ChannelIcon.tsx`
- [ ] Add `'channels'` to `TabId` in `InstancePage.tsx`
- [ ] Create `ChannelsTab.css`
- [ ] Add i18n keys to `en.json` and `zh.json`

**Deliverable**: Channels tab shows card grid with live status. No configuration yet.

### Phase 2: Token Config + Policy Management

- [ ] Implement `ChannelConfigDrawer.tsx` (drawer shell)
- [ ] Implement `DynamicField.tsx`
- [ ] Implement `TokenSetupForm.tsx` (form + save + disconnect + applying state)
- [ ] Implement `PolicySection.tsx` (DM/group policy dropdowns + allowlist editor)
- [ ] Wire card click → drawer → form → API → re-fetch

**Deliverable**: Users can configure Telegram, Discord, Slack, Feishu, Signal, LINE, Matrix, MS Teams, Google Chat + set policies + manage allowlists.

### Phase 3: QR Config + Plugin Gate

- [ ] Implement `QrSetupFlow.tsx` (QR display + countdown + long-poll)
- [ ] Implement `PluginGate.tsx` (calls existing plugin install API)
- [ ] Handle WhatsApp start/wait/disconnect flow
- [ ] Handle QR expiry + auto-retry logic

**Deliverable**: Full channel management including WhatsApp QR, plugin installation for Feishu/QQ/WeChat.

### Phase 4: Polish

- [ ] Add remaining locale translations (fr, de, es, it)
- [ ] Add channel icon SVGs for all channels
- [ ] Add skeleton loading states for all components
- [ ] Keyboard accessibility (Escape closes drawer, Tab navigation)
- [ ] E2E tests with Playwright

---

## 14. Migration & Backward Compatibility

### No database migration needed

All channel data uses existing tables (`credentials`, gateway config files). No new tables or columns.

### Existing configurations preserved

Users who configured Telegram/WhatsApp via old UI will see them as "Configured + Connected" in the new tab — same credential store.

### Backward-compatible routes

All existing channel routes unchanged. New registry endpoint and policy extensions are additive.

---

## 15. Future Work (v2)

### Multi-account support

**Problem**: The credential store uses `onConflict(['instance_id', 'provider', 'credential_type']).merge()` which overwrites previous credentials. `ChannelStatusDetail` has no `accountId` field (explicitly stripped in `channels.ts` line 218).

**What needs to change**:
1. **Credential storage**: Change unique key to include an `account_id` column. Requires DB migration.
2. **Shared types**: Add `accountId` to `ChannelStatusDetail`.
3. **Status route**: Preserve `accountId` from gateway response instead of stripping it.
4. **Registry model**: `ChannelRegistryItem` gets `accounts: ChannelAccountItem[]` instead of single `status`/`hasCredentials`.
5. **UI**: Account sub-cards within each channel card; account selector in drawer.

OpenClaw gateway already supports multi-account via `channelAccounts[channelId]` returning an array of `ChannelAccountSnapshot` with per-account `accountId`. The limitation is purely in Aquarium's storage and API layer.

### Plugin version constraints

Add `minVersion` and `maxImageTag` to `pluginInstall` descriptors. The registry endpoint would check installed plugin version and instance image tag, surfacing incompatibility warnings before users attempt configuration.
