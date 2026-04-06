import Docker from 'dockerode';
import type { Readable } from 'stream';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import type { RuntimeEngine, InstanceSpec, StartResult, RuntimeStatus, ExecResult, ExecOptions } from './types.js';
import { Buffer } from 'buffer';

/**
 * Convert a host filesystem path to a Docker-compatible mount path.
 * On Windows, Docker Desktop expects POSIX-style paths (e.g. /c/Users/...)
 * instead of native Windows paths (C:\Users\...).
 */
function toDockerHostPath(hostPath: string): string {
  if (process.platform !== 'win32') return hostPath;
  return hostPath
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):/, (_m, drive: string) => `/${drive.toLowerCase()}`);
}

export class DockerEngine implements RuntimeEngine {
  readonly name = 'docker' as const;
  private docker: Docker;
  private usedPorts = new Set<number>();

  constructor() {
    this.docker = new Docker({ socketPath: config.docker.socketPath });
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  private async allocatePort(): Promise<number> {
    // Scan existing containers for used ports
    const containers = await this.docker.listContainers({ all: true });
    for (const c of containers) {
      for (const p of c.Ports || []) {
        if (p.PublicPort) this.usedPorts.add(p.PublicPort);
      }
    }

    for (let port = config.docker.portRangeStart; port <= config.docker.portRangeEnd; port++) {
      if (!this.usedPorts.has(port)) {
        this.usedPorts.add(port);
        return port;
      }
    }
    throw new Error('No available ports in configured range');
  }

  private parseMemory(memStr: string): number {
    const match = memStr.match(/^(\d+(?:\.\d+)?)\s*(Mi|Gi|Ki|M|G|K)?$/i);
    if (!match) return 512 * 1024 * 1024;
    const val = parseFloat(match[1]);
    switch (match[2]?.toLowerCase()) {
      case 'gi': return val * 1024 * 1024 * 1024;
      case 'mi': return val * 1024 * 1024;
      case 'ki': return val * 1024;
      case 'g': return val * 1000 * 1000 * 1000;
      case 'm': return val * 1000 * 1000;
      case 'k': return val * 1000;
      default: return val;
    }
  }

  private parseCpu(cpuStr: string): number {
    if (cpuStr.endsWith('m')) {
      return parseFloat(cpuStr) * 1_000_000;
    }
    return parseFloat(cpuStr) * 1_000_000_000;
  }

  private async initVolumePermissions(containerId: string, binds: string[]): Promise<void> {
    if (binds.length === 0) return;
    const mountPaths = binds.map(b => b.split(':')[1]);
    const initName = `${containerId.slice(0, 12)}-vol-init`;
    const initContainer = await this.docker.createContainer({
      name: initName,
      Image: 'alpine:3.19',
      Cmd: ['chown', '-R', '1000:1000', ...mountPaths],
      User: 'root',
      HostConfig: { Binds: binds },
    });
    try {
      await initContainer.start();
      await initContainer.wait();
    } finally {
      try { await initContainer.remove({ force: true }); } catch { /* cleanup */ }
    }
  }

  private instanceNetworkName(instanceId: string): string {
    return `openclaw-instance-${instanceId}`;
  }

  private async createInstanceNetwork(instanceId: string): Promise<string> {
    const networkName = this.instanceNetworkName(instanceId);
    try {
      await this.docker.getNetwork(networkName).inspect();
      return networkName;
    } catch {
    }

    try {
      await this.docker.createNetwork({
        Name: networkName,
        Driver: 'bridge',
        Internal: false,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('all predefined address pools have been fully subnetted')) {
        console.warn('[docker] subnet pool exhausted — cleaning orphan networks and retrying');
        await this.cleanupOrphanNetworks();
        await this.docker.createNetwork({
          Name: networkName,
          Driver: 'bridge',
          Internal: false,
        });
      } else {
        throw err;
      }
    }
    return networkName;
  }

  private async connectPlatformContainer(networkName: string): Promise<void> {
    const platformId = config.docker.platformContainerId;
    if (!platformId) return;
    const network = this.docker.getNetwork(networkName);
    try {
      await network.connect({ Container: platformId });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('already exists')) throw err;
    }
  }

  private async connectLiteLLMContainer(networkName: string): Promise<void> {
    const litellmName = config.docker.litellmContainerName;
    if (!litellmName) return;
    const network = this.docker.getNetwork(networkName);
    try {
      await network.connect({ Container: litellmName });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('already exists')) throw err;
    }
  }

  async ensureLiteLLMConnected(instanceId: string): Promise<void> {
    const networkName = this.instanceNetworkName(instanceId);
    await this.connectLiteLLMContainer(networkName);
  }

  async cleanupOrphanNetworks(): Promise<void> {
    const infraContainers = new Set<string>();
    const litellmName = config.docker.litellmContainerName;
    const platformId = config.docker.platformContainerId;
    if (litellmName) infraContainers.add(litellmName);
    if (platformId) infraContainers.add(platformId);

    try {
      const networks = await this.docker.listNetworks();
      const instanceNetworks = networks.filter(n => n.Name?.startsWith('openclaw-instance-'));
      let removed = 0;

      for (const net of instanceNetworks) {
        try {
          const network = this.docker.getNetwork(net.Id!);
          const info = await network.inspect();
          const containers = info.Containers || {};
          const hasInstanceContainer = Object.values(containers).some(
            (c: { Name?: string }) => c.Name != null && !infraContainers.has(c.Name),
          );

          if (!hasInstanceContainer) {
            for (const [id, c] of Object.entries(containers) as Array<[string, { Name?: string }]>) {
              if (c.Name && infraContainers.has(c.Name)) {
                try { await network.disconnect({ Container: id, Force: true }); } catch { /* already disconnected */ }
              }
            }
            await network.remove();
            removed++;
          }
        } catch {
          /* network already gone or inspect failed — skip */
        }
      }

      if (removed > 0) {
        console.log(`[docker] cleaned up ${removed} orphan instance network(s)`);
      }
    } catch (err) {
      console.warn('[docker] failed to clean up orphan networks:', err instanceof Error ? err.message : err);
    }
  }

  private async cleanupInstanceNetworks(runtimeId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(runtimeId);
      const info = await container.inspect();
      const networks = info.NetworkSettings?.Networks ?? {};
      for (const name of Object.keys(networks)) {
        if (!name.startsWith('openclaw-instance-')) continue;
        try {
          const network = this.docker.getNetwork(name);
          await network.disconnect({ Container: runtimeId, Force: true });
          const platformId = config.docker.platformContainerId;
          if (platformId) {
            try {
              await network.disconnect({ Container: platformId, Force: true });
            } catch { /* platform already disconnected */ }
          }
          const litellmName = config.docker.litellmContainerName;
          if (litellmName) {
            try {
              await network.disconnect({ Container: litellmName, Force: true });
            } catch { /* litellm already disconnected */ }
          }
          await network.remove();
        } catch { /* network already gone */ }
      }
    } catch { /* container not found — nothing to clean */ }
  }

  async start(spec: InstanceSpec): Promise<StartResult> {
    // Remove existing container with same name if exists
    try {
      const existing = this.docker.getContainer(spec.name);
      const info = await existing.inspect();
      if (info.State.Running) {
        await existing.stop({ t: 5 });
      }
      await existing.remove({ v: false });
    } catch {
      // container doesn't exist — fine
    }

    const instanceId = spec.labels['platform.io/instance-id'];
    const networkName = await this.createInstanceNetwork(instanceId);

    // Port mapping — gateway uses native bind:lan (0.0.0.0), so Docker can
    // map host ports directly to the container's gateway port.
    const exposedPorts: Record<string, object> = {};
    const portBindings: Record<string, Array<{ HostPort: string }>> = {};
    const endpoints: Record<string, string> = {};

    for (const p of spec.ports) {
      const hostPort = await this.allocatePort();
      const portKey = `${p.containerPort}/${p.protocol || 'tcp'}`;
      exposedPorts[portKey] = {};
      portBindings[portKey] = [{ HostPort: String(hostPort) }];
      endpoints[p.name] = `ws://localhost:${hostPort}`;
    }

    // Volumes
    const binds: string[] = [];
    for (const v of spec.volumes) {
      const volumeName = `${spec.name}-${v.name}`;
      // Create volume if doesn't exist
      try {
        await this.docker.getVolume(volumeName).inspect();
      } catch {
        await this.docker.createVolume({ Name: volumeName });
      }
      binds.push(`${volumeName}:${v.mountPath}`);
    }

    // Mount the local platform-bridge plugin into the container so the gateway
    // picks up the latest code without rebuilding the Docker image.
    // Path: <repo>/openclaw/plugin relative to <repo>/apps/server/src/runtime/docker.ts
    const pluginHostPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../../openclaw/plugin',
    );
    if (fs.existsSync(pluginHostPath)) {
      binds.push(`${toDockerHostPath(pluginHostPath)}:/opt/openclaw-plugins/platform-bridge:ro`);
    }

    // Env vars — inject HOME so root-user containers still use the expected data dir
    const mergedEnv = { HOME: '/home/node', ...spec.env };
    const env = [
      ...Object.entries(mergedEnv).map(([k, v]) => `${k}=${v}`),
      ...Object.entries(spec.secrets).map(([k, v]) => `${k}=${v}`),
    ];

    let healthcheck: Docker.ContainerCreateOptions['Healthcheck'] | undefined;
    if (spec.healthCheck) {
      const checkPort = spec.healthCheck.port;
      // Use Node.js for health check — nc/curl may not be available in minimal images
      healthcheck = {
        Test: ['CMD-SHELL', `node -e "require('net').connect(${checkPort},'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"`],
        Interval: spec.healthCheck.periodSeconds * 1_000_000_000,
        StartPeriod: (spec.healthCheck.initialDelaySeconds || 5) * 1_000_000_000,
        Retries: 3,
        Timeout: 5_000_000_000,
      };
    }

    // Labels
    const labels: Record<string, string> = {
      ...spec.labels,
      'managed-by': 'aquarium',
      component: 'instance',
    };

    // ── Resource limits from manifest (K8s-style strings → Docker numeric) ──
    const memoryBytes = this.parseMemory(spec.resources.limits.memory);
    const nanoCpus = this.parseCpu(spec.resources.limits.cpu);

    const container = await this.docker.createContainer({
      name: spec.name,
      Image: spec.image,
      Env: env,
      Labels: labels,
      Healthcheck: healthcheck,
      ExposedPorts: exposedPorts,
      // Run as non-root (uid 1000 = node user in alpine/openclaw image).
      // Volumes are pre-chowned to 1000:1000 before container start.
      User: '1000:1000',
      // Override entrypoint to exec gateway directly (native bind:lan eliminates proxy need)
      Entrypoint: ['sh', '-c', 'exec node openclaw.mjs gateway --allow-unconfigured'],
      Cmd: [],
      HostConfig: {
        Binds: binds,
        PortBindings: portBindings,
        NetworkMode: networkName,
        RestartPolicy: { Name: 'unless-stopped' },
        // §5.2 — Container security hardening
        Memory: memoryBytes,
        NanoCpus: nanoCpus,
        PidsLimit: 256,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
      },
    });

    // ── Volume permission initialization ──
    // Docker named volumes are created as root. chown them to 1000:1000 before
    // starting the non-root container so the node user can write to them.
    await this.initVolumePermissions(container.id, binds);

    console.log(`[docker] start container=${spec.name} user=1000:1000 memory=${memoryBytes} nanoCpus=${nanoCpus} pidsLimit=256 capDrop=ALL`);

    await container.start();
    await this.connectPlatformContainer(networkName);
    await this.connectLiteLLMContainer(networkName);

    return {
      runtimeId: container.id,
      endpoints,
    };
  }

  async stop(runtimeId: string): Promise<void> {
    console.log(`[docker] stop container=${runtimeId.slice(0, 12)}`);
    await this.cleanupInstanceNetworks(runtimeId);
    try {
      const container = this.docker.getContainer(runtimeId);
      const info = await container.inspect();
      if (info.State.Running) {
        await container.stop({ t: 10 });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('no such container') && !msg.includes('is not running')) {
        throw err;
      }
    }
  }

  async restart(spec: InstanceSpec, runtimeId: string): Promise<StartResult> {
    await this.stop(runtimeId);
    await this.delete(runtimeId);
    return this.start(spec);
  }

  async delete(runtimeId: string): Promise<void> {
    console.log(`[docker] delete container=${runtimeId.slice(0, 12)}`);
    await this.cleanupInstanceNetworks(runtimeId);
    try {
      const container = this.docker.getContainer(runtimeId);
      const info = await container.inspect();
      if (info.State.Running) {
        await container.stop({ t: 5 });
      }
      await container.remove({ v: false });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('no such container')) {
        throw err;
      }
    }
  }

  async purge(runtimeId: string): Promise<void> {
    console.log(`[docker] purge container=${runtimeId.slice(0, 12)}`);
    await this.cleanupInstanceNetworks(runtimeId);
    try {
      const container = this.docker.getContainer(runtimeId);
      const info = await container.inspect();

      if (info.State.Running) {
        await container.stop({ t: 5 });
      }
      await container.remove({ v: true });

      const mounts = info.Mounts || [];
      for (const mount of mounts) {
        if (mount.Type === 'volume' && mount.Name) {
          try {
            await this.docker.getVolume(mount.Name).remove();
          } catch {
            // volume already gone
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('no such container')) {
        throw err;
      }
    }
  }

  async getStatus(runtimeId: string): Promise<RuntimeStatus> {
    try {
      const container = this.docker.getContainer(runtimeId);
      const info = await container.inspect();

      if (info.State.Running) {
        return { running: true, phase: 'running', startedAt: info.State.StartedAt };
      }
      if (info.State.Restarting) {
        return { running: false, phase: 'starting', message: 'Container restarting' };
      }
      if (info.State.ExitCode !== 0) {
        return { running: false, phase: 'error', message: `Exited with code ${info.State.ExitCode}` };
      }
      return { running: false, phase: 'stopped' };
    } catch {
      return { running: false, phase: 'not_found' };
    }
  }

  async streamLogs(runtimeId: string, options?: { follow?: boolean; tailLines?: number; timestamps?: boolean }): Promise<Readable> {
    const container = this.docker.getContainer(runtimeId);
    const follow = options?.follow ?? false;

    if (follow) {
      const stream = await container.logs({
        follow: true as const,
        stdout: true,
        stderr: true,
        tail: options?.tailLines ?? 100,
        timestamps: options?.timestamps ?? false,
      });
      return stream as unknown as Readable;
    }

    const buffer = await container.logs({
      follow: false as const,
      stdout: true,
      stderr: true,
      tail: options?.tailLines ?? 100,
      timestamps: options?.timestamps ?? false,
    });

    // Buffer result — wrap in a readable stream
    const { Readable: ReadableStream } = await import('stream');
    const readable = new ReadableStream();
    readable.push(buffer);
    readable.push(null);
    return readable;
  }

  async listFiles(runtimeId: string, dirPath: string): Promise<string[]> {
    try {
      const container = this.docker.getContainer(runtimeId);
      const exec = await container.exec({
        Cmd: ['ls', '-1', dirPath],
        AttachStdout: true,
        AttachStderr: true,
      });
      const raw = await new Promise<Buffer>((resolve, reject) => {
        exec.start({}, (err: Error | null, stream: NodeJS.ReadableStream | undefined) => {
          if (err) return reject(err);
          if (!stream) return resolve(Buffer.alloc(0));
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => resolve(Buffer.concat(chunks)));
          stream.on('error', reject);
        });
      });
      const output = this.demuxStdout(raw);
      return output
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);
    } catch {
      return [];
    }
  }

  async readFile(runtimeId: string, filePath: string): Promise<string | null> {
    try {
      const container = this.docker.getContainer(runtimeId);
      const exec = await container.exec({
        Cmd: ['cat', filePath],
        AttachStdout: true,
        AttachStderr: true,
      });
      const raw = await new Promise<Buffer>((resolve, reject) => {
        exec.start({}, (err: Error | null, stream: NodeJS.ReadableStream | undefined) => {
          if (err) return reject(err);
          if (!stream) return resolve(Buffer.alloc(0));
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => resolve(Buffer.concat(chunks)));
          stream.on('error', reject);
        });
      });
      const stdout = this.demuxStdout(raw);
      return stdout || null;
    } catch {
      return null;
    }
  }

  private demuxStdout(raw: Buffer): string {
    const stdoutChunks: Buffer[] = [];
    let offset = 0;
    while (offset + 8 <= raw.length) {
      const streamType = raw[offset];
      const frameSize = raw.readUInt32BE(offset + 4);
      offset += 8;
      if (offset + frameSize > raw.length) break;
      if (streamType === 1) {
        stdoutChunks.push(raw.subarray(offset, offset + frameSize));
      }
      offset += frameSize;
    }
    if (stdoutChunks.length === 0) {
      return raw.toString('utf8').replace(/[\x00-\x08]/g, '');
    }
    return Buffer.concat(stdoutChunks).toString('utf8');
  }

  async writeFiles(runtimeId: string, basePath: string, files: Map<string, string>): Promise<void> {
    const container = this.docker.getContainer(runtimeId);
    console.log(`[docker] writeFiles container=${runtimeId.slice(0, 12)} basePath=${basePath} fileCount=${files.size}`);

    for (const [relativePath, content] of files) {
      const fullPath = `${basePath}/${relativePath}`;
      const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));

      const mkdirExec = await container.exec({
        Cmd: ['mkdir', '-p', dir],
        AttachStdout: true,
        AttachStderr: true,
      });
      await new Promise<void>((resolve, reject) => {
        mkdirExec.start({}, (err: Error | null, stream: NodeJS.ReadableStream | undefined) => {
          if (err) return reject(err);
          stream?.on('end', resolve);
          stream?.resume();
        });
      });

      const writeExec = await container.exec({
        Cmd: ['sh', '-c', `cat > '${fullPath}'`],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
      });
      await new Promise<void>((resolve, reject) => {
        writeExec.start({ hijack: true, stdin: true }, (err: Error | null, stream: NodeJS.WritableStream | undefined) => {
          if (err) return reject(err);
          if (!stream) return reject(new Error('No stream'));
          stream.write(content);
          (stream as NodeJS.WritableStream & { end(): void }).end();
          setTimeout(resolve, 100);
        });
      });
    }
  }

  async exec(runtimeId: string, command: string[], options?: ExecOptions): Promise<ExecResult> {
    console.log(`[docker] exec container=${runtimeId.slice(0, 12)} cmd=${command[0]}`);
    const container = this.docker.getContainer(runtimeId);
    const cmd = options?.workDir
      ? ['sh', '-c', `cd '${options.workDir}' && ${command.map(c => `'${c}'`).join(' ')}`]
      : command;

    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
    });

    const timeoutMs = options?.timeout ?? 120_000;

    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`exec timed out after ${timeoutMs}ms`)), timeoutMs);

      exec.start({}, (err: Error | null, stream: NodeJS.ReadableStream | undefined) => {
        if (err) { clearTimeout(timer); return reject(err); }
        if (!stream) { clearTimeout(timer); return resolve({ stdout: '', stderr: '' }); }

        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => {
          clearTimeout(timer);
          const raw = Buffer.concat(chunks);
          const stdout = this.demuxStdout(raw);
          resolve({ stdout, stderr: '' });
        });
        stream.on('error', (e: Error) => { clearTimeout(timer); reject(e); });
      });
    });

    const inspection = await exec.inspect();
    const exitCode = typeof inspection.ExitCode === 'number' ? inspection.ExitCode : 0;

    return { exitCode, stdout, stderr };
  }
}
