import type { AgentTypeInfo, BillingMode, UserCredential } from '@aquarium/shared';

// Re-export for convenience in step components
export type { AgentTypeInfo, BillingMode, UserCredential };

export type WizardStep = 'agentType' | 'naming' | 'principles' | 'identity' | 'confirm';

export const STEP_IDS: WizardStep[] = ['agentType', 'naming', 'principles', 'identity', 'confirm'];

export type PrinciplesMode = 'default' | 'custom';

export interface TemperaturePreset {
  key: string;
  label: string;
  value: number;
}

export interface ProviderModel {
  id: string;
  displayName: string;
  isDefault?: boolean;
}

export interface ProviderAuthMethod {
  value: string;
  label: string;
  hint: string;
  type: string;
}

export interface AvailableModel {
  id: string;
  name: string;
  provider: string;
  recommended: boolean;
}

export interface WizardState {
  name: string;
  avatar: string;
  principlesMode: PrinciplesMode;
  customPrinciples: string;
  identityDescription: string;
  credentialMode: 'platform' | 'byok';
  byokProvider: string;
  byokApiKey: string;
  model: string;
  contextLength: string;
  temperaturePreset: string;
  memoryModule: 'native' | 'memos' | 'memos-cloud';
}

export const DEFAULT_STATE: WizardState = {
  name: '',
  avatar: 'preset:robot',
  principlesMode: 'default',
  customPrinciples: '',
  identityDescription: '',
  credentialMode: 'platform',
  byokProvider: '',
  byokApiKey: '',
  model: '',
  contextLength: '128K Tokens',
  temperaturePreset: 'life',
  memoryModule: 'native',
};

export const CONTEXT_OPTIONS_FALLBACK = [
  { value: 4096, label: '4K Tokens' },
  { value: 8192, label: '8K Tokens' },
  { value: 16384, label: '16K Tokens' },
  { value: 32768, label: '32K Tokens' },
  { value: 131072, label: '128K Tokens' },
];

export interface StepProps {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}

export interface StepPrinciplesProps extends StepProps {
  defaultPrinciples: string[];
}

export interface StepIdentityProps extends StepProps {
  identityTemplates: string[];
}

export interface ContextOption {
  value: number;
  label: string;
  description?: string;
}

export interface StepConfirmProps extends StepProps {
  providers: Array<{ name: string; displayName: string; authMethods?: ProviderAuthMethod[]; models: ProviderModel[] }>;
  temperaturePresets: TemperaturePreset[];
  contextOptions: ContextOption[];
  userCredentials: UserCredential[];
  credentialsLoading: boolean;
  platformModels: AvailableModel[];
  platformModelsLoading: boolean;
}

export interface StepAgentTypeProps {
  allTypes: AgentTypeInfo[];
  selectedId: string;
  onSelect: (id: string) => void;
}
