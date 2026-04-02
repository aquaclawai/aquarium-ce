import type { Readable } from 'stream';

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  timeout?: number;
  workDir?: string;
}

export interface InstanceSpec {
  name: string;
  image: string;
  ports: Array<{ name: string; containerPort: number; protocol: 'tcp' | 'udp' }>;
  env: Record<string, string>;
  secrets: Record<string, string>;
  volumes: Array<{ name: string; mountPath: string; size: string }>;
  resources: { requests: { cpu: string; memory: string }; limits: { cpu: string; memory: string } };
  securityContext?: { runAsUser?: number; runAsGroup?: number; fsGroup?: number };
  healthCheck?: { type: 'http' | 'tcp'; port: number; path?: string; initialDelaySeconds: number; periodSeconds: number };
  labels: Record<string, string>;
}

export interface StartResult {
  runtimeId: string;
  endpoints: Record<string, string>;
}

export interface RuntimeStatus {
  running: boolean;
  phase: 'running' | 'stopped' | 'starting' | 'error' | 'not_found';
  startedAt?: string;
  message?: string;
}

export interface RuntimeEngine {
  readonly name: 'docker' | 'kubernetes';
  isAvailable(): Promise<boolean>;
  start(spec: InstanceSpec): Promise<StartResult>;
  stop(runtimeId: string): Promise<void>;
  restart(spec: InstanceSpec, runtimeId: string): Promise<StartResult>;
  delete(runtimeId: string): Promise<void>;
  purge(runtimeId: string): Promise<void>;
  getStatus(runtimeId: string): Promise<RuntimeStatus>;
  streamLogs(runtimeId: string, options?: { follow?: boolean; tailLines?: number; timestamps?: boolean }): Promise<Readable>;
  ensureLiteLLMConnected?(instanceId: string): Promise<void>;
  cleanupOrphanNetworks?(): Promise<void>;
  writeFiles?(containerName: string, basePath: string, files: Map<string, string>): Promise<void>;
  listFiles?(runtimeId: string, dirPath: string): Promise<string[]>;
  readFile?(runtimeId: string, filePath: string): Promise<string | null>;
  exec?(runtimeId: string, command: string[], options?: ExecOptions): Promise<ExecResult>;
}
