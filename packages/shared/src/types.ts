// === Status Types ===

export type InstanceStatus = 'created' | 'starting' | 'running' | 'restarting' | 'stopping' | 'stopped' | 'error';
export type DeploymentTarget = 'docker' | 'kubernetes';
export type CredentialType = 'api_key' | 'oauth_token';
export type BillingMode = 'platform' | 'byok';
export type SecurityProfile = 'strict' | 'standard' | 'developer' | 'unrestricted';
export type UserRole = 'admin' | 'user' | 'viewer';
export type ModelMode = 'auto' | 'specific';
export type ChatErrorCategory = 'timeout' | 'auth' | 'quota' | 'model' | 'gateway' | 'unknown';

/** A model returned by the gateway, enriched with credential status. */
export interface GatewayModel {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
  /** Whether the instance has a credential configured for this model's provider. */
  usable: boolean;
}

/** Response shape for GET /instances/:id/models. */
export interface InstanceModelsResponse {
  models: GatewayModel[];
  configuredProviders: string[];
}

/** A provider returned by GET /instances/:id/providers — models grouped under their provider. */
export interface InstanceProvider {
  name: string;
  displayName: string;
  authMethods?: Array<{ value: string; label: string; hint?: string; type: string }>;
  models: Array<{ id: string; displayName: string; isDefault?: boolean; contextWindow?: number }>;
}

/** Response shape for GET /instances/:id/providers. Source indicates where the data came from. */
export interface InstanceProvidersResponse {
  providers: InstanceProvider[];
  configuredProviders: string[];
  /** 'gateway' if live data from the running instance, 'metadata' if the static fallback was used. */
  source: 'gateway' | 'metadata';
}

/** Attachment sent with a chat message (image only, base64-encoded). */
export interface ChatAttachment {
  type: 'image' | 'file';
  mimeType: string;
  fileName: string;
  content: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;

export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

export const ALLOWED_ATTACHMENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/** Check whether a MIME type is an image (inline-embeddable). */
export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

/**
 * HTML `accept` attribute value for file inputs.
 * Includes BOTH file extensions AND MIME types for cross-browser/macOS compatibility.
 * macOS file dialogs require explicit MIME types — extensions alone are not enough.
 */
export const FILE_INPUT_ACCEPT = 'image/*,.pdf,application/pdf,.xls,application/vnd.ms-excel,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.doc,application/msword,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Max file size for agents.files.write uploads (10 MB). */
export const MAX_FILE_UPLOAD_SIZE = 10 * 1024 * 1024;

/**
 * Trust levels for input sources.
 * Higher trust = more privileged actions allowed.
 *
 * - system: Platform-injected instructions (SOUL.md security paragraphs)
 * - authorized_user: Authenticated platform user
 * - external_message: Third-party channel messages (WhatsApp, Telegram, email)
 * - tool_return: Results from tool execution (web scraping, API responses)
 */
export type TrustLevel = 'system' | 'authorized_user' | 'external_message' | 'tool_return';

// === User ===

export interface User {
  id: string;
  email: string;
  displayName: string;
  role?: UserRole;
  billingMode?: BillingMode;
  usageBalanceUsd?: number | null;
  usageLimitUsd?: number | null;
  createdAt: string;
}

/** Minimal user info returned by the search endpoint (no sensitive data). */
export interface UserSearchResult {
  id: string;
  email: string;
  displayName: string;
}

// === Instance ===

export interface Instance {
  id: string;
  userId: string;
  name: string;
  agentType: string;
  imageTag: string;
  status: InstanceStatus;
  statusMessage: string | null;
  deploymentTarget: DeploymentTarget;
  runtimeId: string | null;
  controlEndpoint: string | null;
  authToken: string;
  config: Record<string, unknown>;
  templateId: string | null;
  templateVersion: string | null;
  createdAt: string;
  updatedAt: string;
  billingMode?: BillingMode;
  securityProfile: SecurityProfile;
  proxyKeyId?: string | null;
  litellmKeyHash?: string | null;
  avatar?: string | null;
}

export interface InstancePublic {
  id: string;
  userId: string;
  name: string;
  agentType: string;
  imageTag: string;
  status: InstanceStatus;
  statusMessage: string | null;
  deploymentTarget: DeploymentTarget;
  securityProfile: SecurityProfile;
  billingMode?: BillingMode;
  avatar?: string | null;
  createdAt: string;
  updatedAt: string;
}

// === Credential ===

export interface Credential {
  id: string;
  instanceId: string;
  provider: string;
  credentialType: CredentialType;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// === Instance Event ===

export interface InstanceEvent {
  id: string;
  instanceId: string;
  eventType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// === Agent Type Info ===

export interface AgentTypeInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  defaultImageTag: string;
  availableTags: string[];
  implemented?: boolean;
  capabilities: {
    hasWebUI: boolean;
    hasRPC: boolean;
    supportsConfigRead: boolean;
    supportsConfigWrite: boolean;
    supportsModelSelection: boolean;
    supportsOAuth: boolean;
    supportsChannels: boolean;
    channelTypes?: string[];
  };
  configSchema?: Record<string, unknown>;
  wizard?: {
    providers: Array<{
      name: string;
      displayName: string;
      authMethods?: Array<{ value: string; label: string; hint: string; type: string }>;
      models: Array<{ id: string; displayName: string; isDefault?: boolean; contextWindow?: number }>;
    }>;
    defaultProvider?: string;
    defaultModel?: string;
    platformModels?: Array<{ id: string; displayName: string; isDefault?: boolean }>;
    channelSupport: { enabled: boolean; channels?: string[] };
    defaultPrinciples?: string[];
    identityTemplates?: string[];
    temperaturePresets?: Array<{ key: string; label: string; value: number; description?: string }>;
    contextOptions?: Array<{ value: number; label: string; description?: string }>;
    chatSuggestions?: string[];
  };
  webUI?: { port: number; basePath: string; authMethod: string; iframeAllowed: boolean };
  usageTracking?: { method: string; rpcMethod?: string; pollIntervalMs?: number };
}

// === Auth Response ===

export interface AuthResponse {
  user: User;
}

export interface AuthRedirectResponse {
  redirect: string;
}

// === API ===

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

// === Tool Permissions ===

export type ToolProfile = 'full' | 'coding' | 'messaging' | 'minimal';

export interface ToolPermissions {
  /** Tool profile — controls which tool groups are available. Default: 'full'. */
  profile: ToolProfile;
  /** Enable web_search tool (default: true). */
  webSearchEnabled: boolean;
  /** Enable web_fetch tool (default: true). */
  webFetchEnabled: boolean;
  /** Enable browser tool (default: true). */
  browserEnabled: boolean;
  /** Enable elevated exec (default: true). */
  elevatedEnabled: boolean;
  /** Custom deny list — tool names or groups to deny. */
  denyList: string[];
}

export const DEFAULT_TOOL_PERMISSIONS: ToolPermissions = {
  profile: 'full',
  webSearchEnabled: true,
  webFetchEnabled: true,
  browserEnabled: true,
  elevatedEnabled: true,
  denyList: [],
};

// === Request Types ===

export interface CreateInstanceRequest {
  name: string;
  agentType: string;
  imageTag?: string;
  deploymentTarget?: DeploymentTarget;
  billingMode?: BillingMode;
  securityProfile?: SecurityProfile;
  config?: Record<string, unknown>;
  avatar?: string;
}

export interface AddCredentialRequest {
  provider: string;
  credentialType: CredentialType;
  value: string;
  metadata?: Record<string, unknown>;
}

export interface RpcRequest {
  method: string;
  params?: Record<string, unknown>;
}

// === WebSocket ===

export type WsEventType =
  | 'instance:status'
  | 'instance:logs'
  | 'instance:event'
  | 'instance:ready'
  | 'instance:gateway_event'
  | 'instance:exec_approval_request'
  | 'instance:exec_approval_resolved'
  | 'group_chat:message'
  | 'group_chat:delivery_status'
  | 'group_chat:typing'
  | 'group_chat:error'
  | 'instance:snapshot_restored'
  | 'notification'
  | 'security_event';

export interface WsMessage {
  type: WsEventType;
  instanceId?: string;
  groupChatId?: string;
  payload: Record<string, unknown>;
}

// === Profile ===

export interface UpdateProfileRequest {
  displayName?: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}


// === Template Types ===

export type TemplateCategory =
  | 'customer-service'
  | 'sales'
  | 'marketing'
  | 'devops'
  | 'education'
  | 'personal'
  | 'custom'
  | 'general'
  | 'coding'
  | 'data-analysis'
  | 'content-creation';

export type TemplateLicense = 'private' | 'public' | 'mit' | 'apache-2.0';
export type TemplateTrustLevel = 'official' | 'verified' | 'community';

export interface CredentialRequirement {
  provider: string;
  credentialType: CredentialType;
  description: string;
  required: boolean;
}

export interface McpServerDeclaration {
  name: string;
  description: string;
  env: Record<string, string>;
  runtime?: 'node' | 'python' | 'binary';
  installSpec?: string;
  installCommand?: string[];
  url?: string;
  headers?: Record<string, string>;
  transport?: 'stdio' | 'sse';
}

export type SkillSource =
  | { type: 'bundled' }
  | { type: 'inline' }
  | { type: 'clawhub'; slug: string; version?: string }
  | { type: 'npm'; spec: string };

export interface SkillDeclaration {
  id: string;
  name: string;
  description: string;
  /** @deprecated Use `source` instead. Kept for backward compatibility with existing templates. */
  inline?: boolean;
  source?: SkillSource;
}

export interface PluginDependency {
  id: string;
  npmSpec: string;
  config?: Record<string, unknown>;
  required: boolean;
  credentialKeys?: string[];
}

export interface TemplateManifest {
  id: string;
  slug: string;
  version: string;
  isLatest: boolean;
  name: string;
  description: string | null;
  category: TemplateCategory;
  tags: string[];
  locale: string;
  authorId: string;
  authorName: string | null;
  license: TemplateLicense;
  trustLevel: TemplateTrustLevel;
  minImageTag: string | null;
  agentType: string;
  billingMode: BillingMode | null;
  requiredCredentials: CredentialRequirement[];
  mcpServers: Record<string, McpServerDeclaration>;
  skills: SkillDeclaration[];
  pluginDependencies?: PluginDependency[];
  suggestedChannels: string[];
  forkedFrom: string | null;
  installCount: number;
  forkCount: number;
  rating: number;
  featured: boolean;
  usageCount: number;
  securityScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface SetupCommand {
  command: string[];
  description: string;
  workDir?: string;
  timeout?: number;
}

export interface TemplateSecurityConfig {
  minSecurityProfile?: SecurityProfile;
  includeTrustLevels?: boolean;
  customNeverDoRules?: string[];
  customSuspiciousPatterns?: string[];
}

export interface TemplateContent {
  id: string;
  templateId: string;
  workspaceFiles: Record<string, string>;
  mcpServerConfigs: Record<string, unknown>;
  inlineSkills: Record<string, unknown>;
  openclawConfig: Record<string, unknown>;
  pluginDependencies?: PluginDependency[];
  setupCommands: SetupCommand[];
  customImage: string | null;
  security?: TemplateSecurityConfig;
  createdAt: string;
}

export interface UserCredential {
  id: string;
  userId: string;
  provider: string;
  credentialType: CredentialType;
  displayName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// === Credential Extensions (CIT-141) ===

export type CredentialRole = 'default' | 'backup' | 'dedicated';
export type CredentialStatus = 'active' | 'disabled';

export interface UserCredentialExtended extends UserCredential {
  role: CredentialRole;
  status: CredentialStatus;
  usageCount: number;
  maskedValue: string | null;
}

// === Billing & Subscription Types (CIT-141) ===

export type PlanTier = 'free' | 'basic' | 'pro' | 'enterprise';
export type BillingCycle = 'monthly' | 'annual';

export interface Plan {
  id: string;
  name: string;
  tier: PlanTier;
  billingCycle: BillingCycle;
  priceCny: number;
  features: Record<string, unknown>;
  isActive: boolean;
}

export type SubscriptionStatus = 'active' | 'expired' | 'cancelled';

export interface Subscription {
  id: string;
  userId: string;
  plan: Plan;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  autoRenew: boolean;
  createdAt: string;
}

export type OrderType = 'subscription' | 'recharge' | 'upgrade';
export type OrderStatus = 'pending' | 'completed' | 'failed' | 'refunded';

export interface Order {
  id: string;
  orderNumber: string;
  orderType: OrderType;
  planName?: string;
  amountCny: number;
  status: OrderStatus;
  paymentMethod?: string;
  createdAt: string;
  completedAt?: string;
}

export interface BillingDetail {
  id: string;
  instanceId: string;
  instanceName: string;
  date: string;
  model: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  costCny: number;
}

export interface UserBudget {
  monthlyBudgetCny: number | null;
  annualBudgetCny: number | null;
  alertThresholdPercent: number;
  alertEnabled: boolean;
}

// === Extended Usage Types (CIT-141) ===

export interface UsageSummaryExtended extends UsageSummary {
  todaySpend: number;
  yesterdaySpend: number;
  dayOverDayPercent: number;
  monthlyProjection: number;
  totalRequests: number;
  lastMonthSpend: number;
  monthOverMonthPercent: number;
  yearToDateSpend: number;
  yearBudgetUsedPercent: number | null;
}

export interface InstanceSpendDistribution {
  instanceId: string;
  instanceName: string;
  spend: number;
  percentage: number;
}

// === Account Security Types (CIT-141) ===

export interface UserExtended extends User {
  avatarUrl: string | null;
  passwordChangedAt: string | null;
  totpEnabled: boolean;
  role: 'admin' | 'user';
  clerkId?: string | null;
  authProvider?: AuthProvider;
}

export interface LoginHistoryEntry {
  id: string;
  eventType: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  failureReason?: string;
}

export interface TotpSetupResponse {
  secret: string;
  qrCodeDataUrl: string;
  backupCodes: string[];
}

export interface LoginWith2FAResponse {
  requires2FA: true;
  tempToken: string;
}

// === Template Request/Response Types ===

export interface CreateTemplateRequest {
  slug: string;
  name: string;
  description?: string;
  category?: TemplateCategory;
  tags?: string[];
  locale?: string;
  license?: TemplateLicense;
  minImageTag?: string;
  agentType?: string;
  billingMode?: BillingMode;
  requiredCredentials?: CredentialRequirement[];
  mcpServers?: Record<string, McpServerDeclaration>;
  skills?: SkillDeclaration[];
  pluginDependencies?: PluginDependency[];
  suggestedChannels?: string[];
  content: {
    workspaceFiles?: Record<string, string>;
    mcpServerConfigs?: Record<string, unknown>;
    inlineSkills?: Record<string, unknown>;
    openclawConfig?: Record<string, unknown>;
    pluginDependencies?: PluginDependency[];
    setupCommands?: SetupCommand[];
    customImage?: string;
    security?: TemplateSecurityConfig;
  };
}

export interface UpdateTemplateRequest {
  name?: string;
  description?: string;
  category?: TemplateCategory;
  tags?: string[];
  locale?: string;
  license?: TemplateLicense;
  minImageTag?: string;
  billingMode?: BillingMode;
  requiredCredentials?: CredentialRequirement[];
  mcpServers?: Record<string, McpServerDeclaration>;
  skills?: SkillDeclaration[];
  pluginDependencies?: PluginDependency[];
  suggestedChannels?: string[];
  content?: {
    workspaceFiles?: Record<string, string>;
    mcpServerConfigs?: Record<string, unknown>;
    inlineSkills?: Record<string, unknown>;
    openclawConfig?: Record<string, unknown>;
    pluginDependencies?: PluginDependency[];
    setupCommands?: SetupCommand[];
    customImage?: string;
    security?: TemplateSecurityConfig;
  };
}

export interface InstantiateTemplateRequest {
  instanceName: string;
  imageTag?: string;
  deploymentTarget?: DeploymentTarget;
  billingMode?: BillingMode;
  credentials?: Record<string, string | null>;
  saveToVault?: string[];
  securityProfile?: SecurityProfile;
}

export interface InstantiateTemplateResponse {
  instance: Instance;
  credentialStatus: Record<string, 'provided' | 'from_vault' | 'missing'>;
  /** Extensions that were blocked by trust policy and omitted from the instance */
  blockedExtensions?: Array<{
    id: string;
    kind: ExtensionKind;
    reason: string;
  }>;
  /** Extensions that require fresh admin trust override before they can be installed */
  requiresTrustOverride?: Array<{
    id: string;
    kind: ExtensionKind;
    source: PluginSource | ExtensionSkillSource;
    reason: string;
  }>;
  /** Count of extensions successfully inserted as lifecycle rows */
  extensionsImported?: number;
}

export interface TemplateExtensionDeclaration {
  id: string;
  kind: ExtensionKind;
  source: PluginSource | ExtensionSkillSource;
  lockedVersion: string | null;
  integrityHash: string | null;
  enabled: boolean;
  needsCredentials: boolean;
  requiresReAuth?: boolean;   // extension uses OAuth credentials that cannot be exported
  config?: Record<string, unknown>;
}

export interface ExportTemplateResponse {
  draft: Omit<CreateTemplateRequest, 'content'>;
  content: {
    workspaceFiles: Record<string, string>;
    mcpServerConfigs: Record<string, unknown>;
    inlineSkills: Record<string, unknown>;
    openclawConfig: Record<string, unknown>;
    setupCommands: SetupCommand[];
    customImage: string | null;
    extensions?: TemplateExtensionDeclaration[];
  };
  securityWarnings: SecurityWarning[];
}

export interface SecurityWarning {
  type: 'possible_hardcoded_key' | 'redacted_secret';
  location: string;
  pattern: string;
  suggestion: string;
}

export interface ListTemplatesQuery {
  category?: TemplateCategory;
  tags?: string[];
  search?: string;
  license?: TemplateLicense;
  trustLevel?: TemplateTrustLevel;
  authorId?: string;
  featured?: boolean;
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AddUserCredentialRequest {
  provider: string;
  credentialType: CredentialType;
  value: string;
  displayName?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateUserCredentialRequest {
  value?: string;
  displayName?: string;
  metadata?: Record<string, unknown>;
  role?: CredentialRole;
  status?: CredentialStatus;
}

// === Channel Status ===

export interface ChannelStatusDetail {
  /** Channel identifier (e.g., 'telegram', 'discord', 'whatsapp') */
  channelId: string;
  /** Normalized connection status */
  connected: boolean;
  /** Whether the channel plugin is running */
  running: boolean;
  /** Whether the channel has configuration */
  configured: boolean;
  /** Last inbound message timestamp (epoch ms) or null */
  lastInboundAt: number | null;
  /** Last outbound message timestamp (epoch ms) or null */
  lastOutboundAt: number | null;
  /** Most recent error message or null */
  lastError: string | null;
  /** When the last error occurred (epoch ms) or null */
  lastErrorAt: number | null;
  /** Auth status string (e.g., 'authenticated', 'expired', 'pending') or null */
  authStatus: string | null;
  /** Account display name (e.g., bot username) or null */
  displayName: string | null;
  /** Probe results (only present when probe was requested) */
  probe: { ok: boolean; latencyMs?: number; error?: string } | null;
  /** Raw extra fields from the gateway (channel-type-specific data) */
  extra: Record<string, unknown>;
}

// === Channel Management ===

export interface ChannelEnableRequest {
  enabled: boolean;
}

export interface ChannelPolicyUpdate {
  dmPolicy?: 'open' | 'pairing' | 'allowlist' | 'disabled';
  groupPolicy?: 'open' | 'disabled' | 'allowlist';
  allowFrom?: string[];
  groupAllowFrom?: string[];
}

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

export interface ChannelCapabilitiesInfo {
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
  capabilities: ChannelCapabilitiesInfo;
  supportedDmPolicies: Array<NonNullable<ChannelPolicyUpdate['dmPolicy']>>;
  supportedGroupPolicies: Array<NonNullable<ChannelPolicyUpdate['groupPolicy']>>;
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

// === Cron Jobs ===

export type CronJobSchedule =
  | { kind: 'cron'; expr: string; tz?: string }
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number };

export type CronJobPayload =
  | { kind: 'systemEvent'; text: string }
  | { kind: 'agentTurn'; message: string; model?: string; timeoutSeconds?: number };

export interface CronJobDelivery {
  mode: 'announce' | 'none';
  channel?: string;
  to?: string;
}

export interface CronJobState {
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: 'ok' | 'error' | 'skipped';
  lastError?: string;
  lastDurationMs?: number;
  consecutiveErrors?: number;
  lastDeliveryStatus?: 'delivered' | 'not-delivered' | 'unknown' | 'not-requested';
}

export interface CronJob {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  schedule: CronJobSchedule;
  payload: CronJobPayload;
  delivery?: CronJobDelivery;
  sessionTarget?: 'main' | 'isolated';
  wakeMode?: 'now' | 'next-heartbeat';
  deleteAfterRun?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  state: CronJobState;
  nextRunAt?: string;
  lastRunAt?: string;
}

export interface CreateCronJobRequest {
  name: string;
  description?: string;
  enabled?: boolean;
  deleteAfterRun?: boolean;
  agentId?: string;
  sessionKey?: string;
  schedule: CronJobSchedule;
  sessionTarget?: 'main' | 'isolated';
  wakeMode?: 'now' | 'next-heartbeat';
  payload: CronJobPayload;
  delivery?: CronJobDelivery;
}

export interface UpdateCronJobRequest {
  name?: string;
  description?: string;
  enabled?: boolean;
  deleteAfterRun?: boolean;
  agentId?: string;
  sessionKey?: string;
  schedule?: CronJobSchedule;
  sessionTarget?: 'main' | 'isolated';
  wakeMode?: 'now' | 'next-heartbeat';
  payload?: CronJobPayload;
  delivery?: CronJobDelivery;
}

export interface CronJobRun {
  id: string;
  jobId: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'completed' | 'failed';
  durationMs?: number;
  error?: string;
  deliveryStatus?: string;
}

export interface CronListResponse {
  total: number;
  jobs: CronJob[];
}

export interface CronRunsResponse {
  total: number;
  entries: CronJobRun[];
}

// === Admin ===

export interface AdminStats {
  totalUsers: number;
  totalInstances: number;
  instancesByStatus: Record<string, number>;
  instancesByTarget: Record<string, number>;
  recentSignups: number;
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  instanceCount: number;
  runningCount: number;
}

export interface AdminUserInstance {
  id: string;
  name: string;
  agentType: string;
  status: InstanceStatus;
  statusMessage: string | null;
  deploymentTarget: DeploymentTarget;
  imageTag: string;
  createdAt: string;
  updatedAt: string;
}

// === Admin Key Management ===

export interface AdminKeyInfo {
  token: string;          // key hash (not the raw key)
  keyAlias: string | null;
  keyName: string;
  spend: number;
  maxBudget: number | null;
  teamId: string;
  userId: string | null;  // resolved from team metadata or DB
  userEmail: string | null;
  models: string[];
  status: 'active' | 'expired' | 'revoked';
  expires: string | null;
  createdAt: string | null;
}

export interface AdminKeyCreateRequest {
  userId: string;
  models?: string[];
  maxBudget?: number | null;
  budgetDuration?: string;
  keyAlias?: string;
}

export interface AdminKeyCreateResponse {
  key: string;            // the raw virtual key (shown once)
  keyName: string;
  keyAlias: string | null;
  teamId: string;
}

export interface AdminKeyUpdateRequest {
  maxBudget?: number | null;
}

// === Group Chat ===

export type MentionMode = 'broadcast' | 'silent';
export type MessageSenderType = 'user' | 'bot' | 'system';
export type DeliveryStatusValue = 'pending' | 'delivered' | 'processing' | 'completed' | 'error';
export type AggregatedDeliveryStatus = 'pending' | 'delivered' | 'processing' | 'completed' | 'partial_error' | 'error';

export interface GroupChat {
  id: string;
  userId: string;
  name: string;
  defaultMentionMode: MentionMode;
  maxBotChainDepth: number;
  members: GroupChatMember[];
  createdAt: string;
  updatedAt: string;
}

export interface GroupChatMember {
  id: string;
  groupChatId: string;
  instanceId: string | null;  // null for human members
  displayName: string;
  role: string | null;        // role description for context injection
  isHuman: boolean;           // true for human participants
  userId: string | null;      // user_id for human members
  joinedAt: string;
}

export interface GroupChatMessage {
  id: string;
  groupChatId: string;
  senderType: MessageSenderType;
  senderInstanceId: string | null;
  senderUserId: string | null;   // for human senders
  senderDisplayName?: string;     // resolved display name (convenience)
  content: string;
  mentionedInstanceIds: string[];
  replyToMessageId: string | null;
  chainDepth: number;
  createdAt: string;
  deliveryStatus?: DeliveryStatusEntry[];
}

export interface DeliveryStatusEntry {
  id: string;
  messageId: string;
  targetInstanceId: string;
  targetDisplayName?: string;
  status: DeliveryStatusValue;
  errorMessage: string | null;
  responseMessageId: string | null;
  retryCount: number;
  maxRetries: number;
  nextRetryAt: string | null;
  deliveredAt: string | null;
  processingAt: string | null;
  completedAt: string | null;
  errorAt: string | null;
  createdAt: string;
}

// === Group Chat Request/Response Types ===

export interface CreateGroupChatRequest {
  name: string;
  instanceIds: string[];
  displayNames: Record<string, string>;
  roles?: Record<string, string>;           // instanceId -> role description
  defaultMentionMode?: MentionMode;
  maxBotChainDepth?: number;
}

export interface UpdateGroupChatRequest {
  name?: string;
  defaultMentionMode?: MentionMode;
  maxBotChainDepth?: number;
}

export interface AddGroupChatMemberRequest {
  instanceId?: string;     // optional now (null for human members)
  userId?: string;         // for human members
  displayName: string;
  role?: string;
  isHuman?: boolean;
}

export interface SendGroupChatMessageRequest {
  content: string;
  attachments?: ChatAttachment[];
}

export interface RetryGroupChatMessageRequest {
  targetInstanceId?: string;
}

export interface GroupChatMessagesResponse {
  messages: GroupChatMessage[];
  hasMore: boolean;
}

export interface GroupChatMessageSentResponse {
  messageId: string;
}

export interface RetryGroupChatMessageResponse {
  retriedCount: number;
}

export interface UpdateGroupChatMemberRequest {
  displayName?: string;
  role?: string;
}

// === Group Chat WebSocket Events ===

export interface GroupChatWsMessage {
  type: 'group_chat:message';
  groupChatId: string;
  payload: {
    messageId: string;
    senderType: MessageSenderType;
    senderInstanceId: string | null;
    senderUserId: string | null;        // NEW
    senderName: string;
    content: string;
    chainDepth: number;
    createdAt: string;
    deliveryStatus?: Array<{
      targetInstanceId: string;
      targetDisplayName: string;
      status: DeliveryStatusValue;
      errorMessage?: string;
    }>;
  };
}

export interface GroupChatDeliveryWsMessage {
  type: 'group_chat:delivery_status';
  groupChatId: string;
  payload: {
    messageId: string;
    targetInstanceId: string;
    targetDisplayName: string;
    status: DeliveryStatusValue;
    errorMessage?: string;
    responseMessageId?: string;
    timestamp: string;
  };
}

export interface GroupChatTypingWsMessage {
  type: 'group_chat:typing';
  groupChatId: string;
  payload: {
    instanceId: string;
    displayName: string;
  };
}

export interface GroupChatErrorWsMessage {
  type: 'group_chat:error';
  groupChatId: string;
  payload: {
    messageId?: string;
    instanceId?: string;
    error: string;
  };
}

// === Usage Types ===

export interface UsageSummary {
  totalSpendUsd: number;
  balanceUsd: number | null;
  budgetLimitUsd: number | null;
  budgetUsedPercent: number | null;
  spendByModel: Record<string, number>;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface UsageTimeseries {
  date: string;
  spendUsd: number;
  model: string;
  provider: string;
  totalTokens: number;
  requestCount: number;
}

// --- Snapshot & Version Restore ---

export type SnapshotTriggerType = 'manual' | 'pre_operation' | 'daily';

export interface Snapshot {
  id: string;
  instanceId: string;
  userId: string;
  configSnapshot: Record<string, unknown>;
  workspaceFiles: Record<string, string>;
  credentialRefs: Array<{ provider: string; type: string }>;
  description: string | null;
  triggerType: SnapshotTriggerType;
  triggerDetail: string | null;
  instanceStatus: string | null;
  totalSizeBytes: number | null;
  createdAt: string;
}

/**
 * 配置变更摘要 — 描述单个字段从旧值到新值的变化
 */
export interface ConfigChangeSummary {
  /** 字段标识符 (如 "defaultModel", "agentsmd") */
  field: string;
  /** 字段显示名称 (如 "AI 模型", "工作区指令") */
  fieldLabel: string;
  /** 字段分类 */
  category: 'core' | 'workspace' | 'channel' | 'tool' | 'mcp';
  /** 变更类型 */
  changeType: 'added' | 'modified' | 'removed';
  /** 旧值摘要 (截断到 50 字符) */
  oldValue?: string;
  /** 新值摘要 (截断到 50 字符) */
  newValue?: string;
  /** 对于长文本，显示字符数变化 */
  sizeDelta?: number;
}

export interface SnapshotSummary {
  id: string;
  description: string | null;
  triggerType: SnapshotTriggerType;
  triggerDetail: string | null;
  instanceStatus: string | null;
  totalSizeBytes: number | null;
  createdAt: string;
  // === 新增字段 (版本历史完善) ===
  /** 版本号 (如 "v2.3") — 按时间顺序递增 */
  version?: string;
  /** 与前一版本的变更摘要 */
  changeSummary?: ConfigChangeSummary[];
  /** 变更字段数量 */
  changeCount?: number;
  /** 创建者 ID (null = 系统自动) */
  createdById?: string | null;
  /** 创建者名称 */
  createdByName?: string;
}

export type DiffChangeType = 'modified' | 'added' | 'removed' | 'unchanged';

export interface SnapshotDiffEntry {
  file: string;
  type: DiffChangeType;
  snapshotContent?: string;
  currentContent?: string;
}

export interface SnapshotDiff {
  snapshotId: string;
  snapshotCreatedAt: string;
  changes: SnapshotDiffEntry[];
}

export interface SnapshotRestoredWsMessage {
  type: 'instance:snapshot_restored';
  instanceId: string;
  groupChatId?: string;
  payload: { snapshotId: string; restoredAt: string };
}

// === Notifications ===

export type NotificationType =
  | 'budget_warning'
  | 'budget_critical'
  | 'budget_exhausted'
  | 'burn_rate_spike'
  | 'instance_stopped'
  | 'daily_digest'
  | 'security_audit'
  | 'config_integrity'
  | 'skill_plugin_change'
  | 'dlp_alert';

export type NotificationSeverity = 'info' | 'warn' | 'critical';

export interface Notification {
  id: string;
  userId: string;
  instanceId: string | null;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  metadata: BudgetNotificationMetadata | Record<string, unknown>;
  isRead: boolean;
  isDismissed: boolean;
  createdAt: string;
}

export interface NotificationSummary {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  isRead: boolean;
  createdAt: string;
}

export interface BudgetNotificationMetadata {
  instanceId?: string;
  instanceName?: string;
  currentSpend?: number;
  budgetLimit?: number;
  percentUsed?: number;
  dailyRate7d?: number;
  daysUntilExhaustion?: number | null;
  trend?: BurnRateTrend;
}

// === Burn Rate ===

export type BurnRateTrend = 'fast_burn' | 'rising' | 'steady' | 'cooling' | 'idle';

export interface BurnRateResult {
  dailyRate7d: number;
  dailyRate30d: number;
  dailyRateToday: number;
  trend: BurnRateTrend;
  daysUntilExhaustion: number | null;
  projectedMonthlySpend: number;
}

export type BurnRateReason = 'not_platform' | 'not_provisioned' | 'no_team' | 'no_usage';

export interface BurnRateApiData {
  burnRate: BurnRateResult | null;
  reason?: BurnRateReason;
}

// === WebSocket Notification Message ===

export interface WsNotificationMessage {
  type: 'notification';
  instanceId?: string;
  groupChatId?: string;
  payload: {
    notification: NotificationSummary;
  };
}

// === Output Filter / DLP (CIT-120) ===

export type DlpMode = 'redact' | 'block' | 'warn';

export interface DlpConfig {
  credentialLeakProtection: boolean;
  apiKeyPatternDetection: boolean;
  systemPromptLeakProtection: boolean;
  envLeakProtection: boolean;
  internalPathProtection: boolean;
  mode: DlpMode;
}

export type OutputFilterCategory =
  | 'credential_leak'
  | 'api_key_pattern'
  | 'system_prompt_leak'
  | 'env_leak'
  | 'internal_path_leak';

export interface OutputFilterMatch {
  category: OutputFilterCategory;
  redactedSnippet: string;
}

export interface OutputFilterResult {
  filtered: boolean;
  mode: DlpMode;
  filteredContent: string;
  matches: OutputFilterMatch[];
  durationMs: number;
}

// === Prompt Guard (CIT-117) ===

export type PromptGuardSeverity = 'info' | 'warning' | 'critical';

export type PromptGuardCategory =
  | 'fake_system_message'    // 伪装系统消息：[System Message]、[ADMIN]
  | 'instruction_override'   // 指令覆盖：Ignore previous instructions
  | 'sensitive_probe'        // 敏感探测：输出系统提示词、列出环境变量
  | 'destructive_action'     // 破坏性操作：删除数据、执行 shell
  | 'fake_urgency'           // 伪装紧急：URGENT SYSTEM UPDATE
  | 'repetition_attack';     // 重复攻击：大量重复内容

export interface PromptGuardPattern {
  id: string;
  category: PromptGuardCategory;
  severity: PromptGuardSeverity;
  /** 正则表达式字符串（运行时编译） */
  pattern: string;
  /** 正则标志位 (默认 'i') */
  flags?: string;
  /** 人类可读描述 */
  description: string;
}

export interface PromptGuardResult {
  /** 是否检测到注入模式 */
  detected: boolean;
  /** 最高严重级别 */
  maxSeverity: PromptGuardSeverity | null;
  /** 匹配的模式列表 */
  matches: Array<{
    patternId: string;
    category: PromptGuardCategory;
    severity: PromptGuardSeverity;
    /** 匹配的文本片段（脱敏，截断至 100 字符） */
    matchedSnippet: string;
  }>;
  /** 检测耗时（毫秒） */
  durationMs: number;
}

export interface PromptGuardConfig {
  /** 是否启用检测 */
  enabled: boolean;
  /** 触发告警的最低严重级别 */
  minAlertSeverity: PromptGuardSeverity;
  /** 自定义可疑模式（追加到默认列表） */
  customPatterns: PromptGuardPattern[];
  /** 是否记录安全事件到 instance_events */
  logEvents: boolean;
  /** 是否通过 WebSocket 推送安全事件 */
  pushEvents: boolean;
}

// === Exec Approval ===

export interface ExecApprovalRequest {
  approvalId: string;
  command: string;
  args?: string[];
  workDir?: string;
  requestedAt: string;
  timeoutMs: number;
}

export interface ExecApprovalResponse {
  approvalId: string;
  approved: boolean;
}

// === Security Audit (CIT-123) ===

export type SecurityEventType =
  | 'security:prompt_injection_detected'
  | 'security:output_filtered'
  | 'security:credential_accessed'
  | 'security:config_changed'
  | 'security:suspicious_activity';

/** Severity level for security events displayed in the dashboard timeline. */
export type SecurityEventSeverity = 'critical' | 'warning' | 'info';

export type AuthEventType = 'login_success' | 'login_failure' | 'signup' | 'logout';

export type AuthProvider = 'clerk';

export interface AuthEvent {
  id: string;
  eventType: AuthEventType;
  userId: string | null;
  email: string;
  ipAddress: string | null;
  userAgent: string | null;
  failureReason: string | null;
  createdAt: string;
}

/** Global security summary across all user instances (GET /api/security/summary). */
export interface SecuritySummary {
  totalEvents: number;
  bySeverity: Record<string, number>;
  byType: Record<string, number>;
  recentCritical: number;
}

/** Protection status indicators for a single instance. */
export interface ProtectionStatus {
  securityProfile: SecurityProfile;
  trustLayers: boolean;
  injectionDetection: boolean;
  outputFiltering: boolean;
  dlpScanning: boolean;
  configIntegrity: boolean;
}

/** Per-instance security dashboard summary (GET /api/instances/:id/security-summary). */
export interface InstanceSecuritySummary {
  instanceId: string;
  totalEvents24h: number;
  bySeverity: Record<string, number>;
  byType: Record<string, number>;
  recentCritical: number;
  protection: ProtectionStatus;
  topEvents: InstanceEvent[];
}

// === System Config (CIT-142) ===

export interface SystemConfigEntry {
  key: string;
  value: unknown;
  updatedAt: string;
}

export interface RateLimitConfig {
  windowMs: number;
  max: number;
}

export interface PlatformApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string | null;
}

export interface SystemConfig {
  platformName?: string;
  platformDescription?: string;
  timezone?: string;
  language?: string;
  enableUserRegistration?: boolean;
  rateLimitGeneral?: RateLimitConfig;
  rateLimitLogin?: RateLimitConfig;
  rateLimitCredentials?: RateLimitConfig;
  corsOrigins?: string[];
  webhookUrl?: string;
  apiKeys?: PlatformApiKey[];
  dataRetentionEventsDays?: number;
  dataRetentionAuthEventsDays?: number;
  dataRetentionAuditLogDays?: number;
  dataAutoCleanupEnabled?: boolean;
  defaultUserRole?: UserRole;
  instanceQuotaPerUser?: number;
}

export interface StorageTableStats {
  table: string;
  sizeBytes: number;
  sizeFormatted: string;
  rowCount: number;
}

export interface StorageStats {
  tables: StorageTableStats[];
  totalSizeBytes: number;
  totalSizeFormatted: string;
}

export interface AdminUserWithRole {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  instanceCount: number;
}

// === Extension Lifecycle Types ===

export type ExtensionStatus = 'pending' | 'installed' | 'active' | 'disabled' | 'degraded' | 'failed';

export type ExtensionKind = 'plugin' | 'skill';

export type PluginSource =
  | { type: 'bundled' }
  | { type: 'clawhub'; spec: string }
  | { type: 'npm'; spec: string };

export type ExtensionSkillSource =
  | { type: 'bundled' }
  | { type: 'clawhub'; spec: string }
  | { type: 'url'; url: string };

export interface ExtensionCredentialRequirement {
  field: string;
  label: string;
  type: 'api_key' | 'env_var' | 'oauth_token';
  required: boolean;
  description?: string;
}

export interface GatewayExtensionInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  source: 'bundled';
  enabled: boolean;
}

export interface InstancePlugin {
  id: string;
  instanceId: string;
  pluginId: string;
  source: PluginSource;
  version: string | null;
  lockedVersion: string | null;
  integrityHash: string | null;
  enabled: boolean;
  config: Record<string, unknown>;
  status: ExtensionStatus;
  errorMessage: string | null;
  failedAt: string | null;
  pendingOwner: string | null;
  retryCount: number;
  installedAt: string;
  updatedAt: string;
  trustOverride?: TrustOverride | null;
}

export interface InstanceSkill {
  id: string;
  instanceId: string;
  skillId: string;
  source: ExtensionSkillSource;
  version: string | null;
  lockedVersion: string | null;
  integrityHash: string | null;
  enabled: boolean;
  config: Record<string, unknown>;
  status: ExtensionStatus;
  errorMessage: string | null;
  failedAt: string | null;
  pendingOwner: string | null;
  retryCount: number;
  installedAt: string;
  updatedAt: string;
  trustOverride?: TrustOverride | null;
}

export interface SkillCatalogEntry {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  source: 'bundled' | 'clawhub';
  version: string;
  requiredCredentials: ExtensionCredentialRequirement[];
  requiredBinaries: string[];
  requiredEnvVars: string[];
  trustSignals?: TrustSignals;
  trustTier?: TrustTier;
  trustDecision?: TrustDecision;
  blockReason?: string;
}

export interface PluginCatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  source: 'bundled' | 'clawhub';
  version: string;
  requiredCredentials: ExtensionCredentialRequirement[];
  capabilities: string[];
  trustSignals?: TrustSignals;
  trustTier?: TrustTier;
  trustDecision?: TrustDecision;
  blockReason?: string;
}

export interface ExtensionOperation {
  id: string;
  instanceId: string;
  fencingToken: string;
  operationType: string;
  targetExtension: string;
  extensionKind: ExtensionKind;
  pendingOwner: string;
  cancelRequested: boolean;
  startedAt: string;
  completedAt: string | null;
  result: string | null;
  errorMessage: string | null;
}

// === Trust Policy Types ===

export type TrustTier = 'bundled' | 'verified' | 'community' | 'unscanned';

export interface TrustSignals {
  verifiedPublisher: boolean;
  downloadCount: number;
  ageInDays: number;
  virusTotalPassed: boolean | null;  // null = not scanned
}

export interface TrustOverride {
  id: string;
  instanceId: string;
  extensionId: string;
  extensionKind: ExtensionKind;
  action: 'allow';
  reason: string;
  userId: string;
  credentialAccessAcknowledged: boolean;
  createdAt: string;
}

export type TrustDecision = 'allow' | 'block';

export interface TrustEvaluation {
  tier: TrustTier;
  decision: TrustDecision;
  signals: TrustSignals | null;   // null for bundled (no ClawHub metadata)
  override: TrustOverride | null; // non-null if admin overrode
  blockReason: string | null;     // human-readable reason when blocked
}

// ClawHub catalog entry — extends base catalog entries with trust signals
export interface ClawHubCatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  kind: ExtensionKind;
  publisher: string;
  trustSignals: TrustSignals;
  requiredCredentials: ExtensionCredentialRequirement[];
  capabilities?: string[];        // plugins only
  requiredBinaries?: string[];    // skills only
  hasScripts?: boolean;           // skills only — true if contains scripts/ dir
}
