import * as k8s from '@kubernetes/client-node';
import type { Readable } from 'stream';
import { PassThrough } from 'stream';
import type { Writable as NodeWritable, Readable as NodeReadable } from 'stream';
import { config } from '../config.js';
import type { RuntimeEngine, InstanceSpec, StartResult, RuntimeStatus, ExecResult, ExecOptions } from './types.js';

const MANAGED_LABEL = 'managed-by';
const MANAGED_VALUE = 'aquarium';

export class KubernetesEngine implements RuntimeEngine {
  readonly name = 'kubernetes' as const;
  private coreApi: k8s.CoreV1Api;
  private appsApi: k8s.AppsV1Api;
  private kc: k8s.KubeConfig;

  constructor() {
    this.kc = new k8s.KubeConfig();
    try {
      this.kc.loadFromCluster();
    } catch {
      this.kc.loadFromDefault();
    }
    this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
  }

  private get namespace(): string {
    return config.kubernetes.namespace;
  }

  private resolveImage(image: string): string {
    const registry = config.kubernetes.imageRegistry;
    if (registry && !image.includes('/')) {
      return `${registry}/${image}`;
    }
    return image;
  }

  private parseRuntimeId(runtimeId: string): { namespace: string; name: string } {
    const [ns, name] = runtimeId.split('/');
    return { namespace: ns, name };
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.coreApi.listNamespace({ limit: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async start(spec: InstanceSpec): Promise<StartResult> {
    const ns = this.namespace;
    const name = spec.name;

    // ── TCP Proxy Strategy ──
    // The OpenClaw Gateway binds ONLY to 127.0.0.1 (hardcoded). kubelet health probes
    // run at the node level and cannot reach 127.0.0.1 inside the pod. Inject a Node.js
    // TCP proxy (same pattern as DockerEngine) that listens on 0.0.0.0:proxyPort and
    // forwards to 127.0.0.1:gatewayPort. Health probes and external clients target proxyPort.
    const PROXY_PORT_OFFSET = 1; // proxy listens on containerPort + 1

    const proxyPairs: Array<{ gatewayPort: number; proxyPort: number }> = [];
    for (const p of spec.ports) {
      proxyPairs.push({ gatewayPort: p.containerPort, proxyPort: p.containerPort + PROXY_PORT_OFFSET });
    }

    const proxyScript = proxyPairs.map(({ gatewayPort, proxyPort }) =>
      `require("net").createServer(c=>{const s=require("net").connect(${gatewayPort},"127.0.0.1");c.pipe(s);s.pipe(c);c.on("error",()=>s.destroy());s.on("error",()=>c.destroy())}).listen(${proxyPort},"0.0.0.0")`
    ).join(';');

    const envVars: k8s.V1EnvVar[] = [
      ...Object.entries(spec.env).map(([k, v]) => ({ name: k, value: v })),
      ...Object.entries(spec.secrets).map(([k, v]) => ({ name: k, value: v })),
    ];

    const labels: Record<string, string> = {
      ...spec.labels,
      [MANAGED_LABEL]: MANAGED_VALUE,
      component: 'instance',
      app: name,
    };

    const volumeClaimTemplates: k8s.V1PersistentVolumeClaim[] = spec.volumes.map(v => ({
      metadata: { name: v.name },
      spec: {
        accessModes: ['ReadWriteOnce'],
        resources: { requests: { storage: v.size } },
      },
    }));

    const volumeMounts: k8s.V1VolumeMount[] = spec.volumes.map(v => ({
      name: v.name,
      mountPath: v.mountPath,
    }));

    const containerPorts: k8s.V1ContainerPort[] = spec.ports.map(p => ({
      name: p.name,
      containerPort: p.containerPort + PROXY_PORT_OFFSET,
      protocol: p.protocol.toUpperCase() as 'TCP' | 'UDP',
    }));

    let startupProbe: k8s.V1Probe | undefined;
    let livenessProbe: k8s.V1Probe | undefined;
    let readinessProbe: k8s.V1Probe | undefined;
    if (spec.healthCheck) {
      const baseProbe: k8s.V1Probe = {
        periodSeconds: spec.healthCheck.periodSeconds,
        timeoutSeconds: 5,
      };
      if (spec.healthCheck.type === 'http') {
        const probePort = spec.healthCheck.port + PROXY_PORT_OFFSET;
        baseProbe.httpGet = { port: probePort as (number | string), path: spec.healthCheck.path || '/' };
      } else {
        // 'tcp' — use exec probe because tcpSocket probes run at kubelet (node) level
        // and cannot reach 127.0.0.1 inside the pod. Exec probes run inside the container.
        const probePort = spec.healthCheck.port + PROXY_PORT_OFFSET;
        baseProbe.exec = {
          command: [
            'node', '-e',
            `require('net').connect(${probePort},'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))`,
          ],
        };
      }
      // startupProbe: tolerates slow first-boot (up to 300s = 30 * 10s)
      // While startupProbe is running, liveness/readiness are disabled
      startupProbe = { ...baseProbe, initialDelaySeconds: 10, periodSeconds: 10, failureThreshold: 30 };
      livenessProbe = { ...baseProbe, initialDelaySeconds: 0, failureThreshold: 6 };
      readinessProbe = { ...baseProbe, initialDelaySeconds: 0, failureThreshold: 3 };
    }

    const podSecurityContext: k8s.V1PodSecurityContext = {
      seccompProfile: { type: 'RuntimeDefault' },
    };
    if (spec.securityContext?.fsGroup) podSecurityContext.fsGroup = spec.securityContext.fsGroup;
    if (spec.securityContext?.runAsUser) podSecurityContext.runAsUser = spec.securityContext.runAsUser;
    if (spec.securityContext?.runAsGroup) podSecurityContext.runAsGroup = spec.securityContext.runAsGroup;

    const statefulSet: k8s.V1StatefulSet = {
      metadata: { name, namespace: ns, labels },
      spec: {
        serviceName: name,
        replicas: 1,
        selector: { matchLabels: { app: name } },
        updateStrategy: { type: 'OnDelete' },
        volumeClaimTemplates,
        template: {
          metadata: { labels },
          spec: {
            serviceAccountName: config.kubernetes.serviceAccountName,
            securityContext: podSecurityContext,
            containers: [{
              name: 'gateway',
              image: this.resolveImage(spec.image),
              imagePullPolicy: 'Always',
              command: ['sh', '-c', `node -e '${proxyScript}' & exec node openclaw.mjs gateway --allow-unconfigured`],
              args: [],
              ports: containerPorts,
              env: envVars,
              volumeMounts,
              resources: {
                requests: { cpu: spec.resources.requests.cpu, memory: spec.resources.requests.memory },
                limits: { cpu: spec.resources.limits.cpu, memory: spec.resources.limits.memory },
              },
              securityContext: {
                runAsNonRoot: true,
                allowPrivilegeEscalation: false,
                capabilities: { drop: ['ALL'] },
              },
              startupProbe,
              livenessProbe,
              readinessProbe,
            }],
            terminationGracePeriodSeconds: 30,
          },
        },
      },
    };

    try {
      await this.appsApi.deleteNamespacedStatefulSet({ name, namespace: ns });
      await new Promise(r => setTimeout(r, 2000));
    } catch {
    }

    await this.appsApi.createNamespacedStatefulSet({ namespace: ns, body: statefulSet });

    const service: k8s.V1Service = {
      metadata: { name, namespace: ns, labels },
      spec: {
        type: 'ClusterIP',
        clusterIP: 'None',
        selector: { app: name },
        ports: spec.ports.map(p => ({
          name: p.name,
          port: p.containerPort + PROXY_PORT_OFFSET,
          targetPort: (p.containerPort + PROXY_PORT_OFFSET) as (number | string),
          protocol: p.protocol.toUpperCase() as 'TCP' | 'UDP',
        })),
      },
    };

    try {
      await this.coreApi.deleteNamespacedService({ name, namespace: ns });
    } catch {
    }
    await this.coreApi.createNamespacedService({ namespace: ns, body: service });

    const endpoints: Record<string, string> = {};
    for (const p of spec.ports) {
      const proxyPort = p.containerPort + PROXY_PORT_OFFSET;
      endpoints[p.name] = `ws://${name}-0.${name}.${ns}.svc.cluster.local:${proxyPort}`;
    }

    return {
      runtimeId: `${ns}/${name}`,
      endpoints,
    };
  }

  async stop(runtimeId: string): Promise<void> {
    const { namespace, name } = this.parseRuntimeId(runtimeId);
    try {
      await this.appsApi.patchNamespacedStatefulSet(
        { name, namespace, body: [{ op: 'replace', path: '/spec/replicas', value: 0 }] },
      );
    } catch (err: unknown) {
      if (!this.isNotFound(err)) throw err;
    }
  }

  async restart(_spec: InstanceSpec, runtimeId: string): Promise<StartResult> {
    const { namespace, name } = this.parseRuntimeId(runtimeId);

    const podName = `${name}-0`;
    try {
      await this.coreApi.deleteNamespacedPod({ name: podName, namespace });
    } catch (err: unknown) {
      if (!this.isNotFound(err)) throw err;
    }

    try {
      await this.appsApi.patchNamespacedStatefulSet(
        { name, namespace, body: [{ op: 'replace', path: '/spec/replicas', value: 1 }] },
      );
    } catch (err: unknown) {
      if (!this.isNotFound(err)) throw err;
    }

    try {
      const { items: services } = await this.coreApi.listNamespacedService({ namespace, labelSelector: `app=${name}` });
      const svc = services?.[0];
      const endpoints: Record<string, string> = {};
      if (svc?.spec?.ports) {
        for (const p of svc.spec.ports) {
          endpoints[p.name || 'default'] = `ws://${name}-0.${name}.${namespace}.svc.cluster.local:${p.port}`;
        }
      }
      return { runtimeId, endpoints };
    } catch {
      return { runtimeId, endpoints: {} };
    }
  }

  async delete(runtimeId: string): Promise<void> {
    const { namespace, name } = this.parseRuntimeId(runtimeId);
    try {
      await this.appsApi.deleteNamespacedStatefulSet({ name, namespace });
    } catch (err: unknown) {
      if (!this.isNotFound(err)) throw err;
    }
    try {
      await this.coreApi.deleteNamespacedService({ name, namespace });
    } catch (err: unknown) {
      if (!this.isNotFound(err)) throw err;
    }
  }

  async purge(runtimeId: string): Promise<void> {
    const { namespace, name } = this.parseRuntimeId(runtimeId);

    try {
      await this.appsApi.deleteNamespacedStatefulSet({ name, namespace });
    } catch (err: unknown) {
      if (!this.isNotFound(err)) throw err;
    }

    try {
      await this.coreApi.deleteNamespacedService({ name, namespace });
    } catch (err: unknown) {
      if (!this.isNotFound(err)) throw err;
    }

    try {
      const { items: pvcs } = await this.coreApi.listNamespacedPersistentVolumeClaim({
        namespace,
        labelSelector: `app=${name}`,
      });
      for (const pvc of pvcs || []) {
        if (pvc.metadata?.name) {
          try {
            await this.coreApi.deleteNamespacedPersistentVolumeClaim({ name: pvc.metadata.name, namespace });
          } catch {
          }
        }
      }
    } catch {
    }
  }

  async getStatus(runtimeId: string): Promise<RuntimeStatus> {
    const { namespace, name } = this.parseRuntimeId(runtimeId);

    try {
      const sts = await this.appsApi.readNamespacedStatefulSet({ name, namespace });
      const replicas = sts.spec?.replicas ?? 0;

      if (replicas === 0) {
        return { running: false, phase: 'stopped', message: 'Scaled to 0' };
      }

      const podName = `${name}-0`;
      try {
        const pod = await this.coreApi.readNamespacedPod({ name: podName, namespace });
        const phase = pod.status?.phase;
        const startedAt = pod.status?.startTime?.toISOString();

        if (phase === 'Running') {
          const ready = pod.status?.containerStatuses?.every(c => c.ready) ?? false;
          if (ready) {
            return { running: true, phase: 'running', startedAt };
          }

          // Detect CrashLoopBackOff or other error states — don't report as 'starting'
          const waitingState = pod.status?.containerStatuses?.[0]?.state?.waiting;
          if (waitingState?.reason === 'CrashLoopBackOff' || waitingState?.reason === 'Error' || waitingState?.reason === 'CreateContainerConfigError') {
            return { running: false, phase: 'error', startedAt, message: waitingState.reason + (waitingState.message ? `: ${waitingState.message}` : '') };
          }

          // Check restartCount — high restarts indicate a crash loop even before K8s labels it
          const restartCount = pod.status?.containerStatuses?.[0]?.restartCount ?? 0;
          if (restartCount >= 3) {
            const lastTerminated = pod.status?.containerStatuses?.[0]?.lastState?.terminated;
            const reason = lastTerminated?.reason || 'Container keeps crashing';
            return { running: false, phase: 'error', startedAt, message: `${reason} (${restartCount} restarts)` };
          }

          return { running: false, phase: 'starting', startedAt, message: 'Containers not ready' };
        }
        if (phase === 'Pending') {
          const waitingState = pod.status?.containerStatuses?.[0]?.state?.waiting;
          if (waitingState?.reason === 'CreateContainerConfigError' || waitingState?.reason === 'ImagePullBackOff' || waitingState?.reason === 'ErrImagePull') {
            return { running: false, phase: 'error', message: waitingState.reason + (waitingState.message ? `: ${waitingState.message}` : '') };
          }
          return { running: false, phase: 'starting', message: 'Pod pending' };
        }
        if (phase === 'Failed') {
          const reason = pod.status?.containerStatuses?.[0]?.state?.terminated?.reason || 'Pod failed';
          return { running: false, phase: 'error', message: reason };
        }
        return { running: false, phase: 'stopped', message: `Pod phase: ${phase}` };
      } catch (err: unknown) {
        if (this.isNotFound(err)) {
          return { running: false, phase: 'starting', message: 'Pod not yet created' };
        }
        throw err;
      }
    } catch (err: unknown) {
      if (this.isNotFound(err)) {
        return { running: false, phase: 'not_found' };
      }
      throw err;
    }
  }

  async streamLogs(runtimeId: string, options?: { follow?: boolean; tailLines?: number; timestamps?: boolean }): Promise<Readable> {
    const { namespace, name } = this.parseRuntimeId(runtimeId);
    const podName = `${name}-0`;

    const logStream = await this.coreApi.readNamespacedPodLog({
      name: podName,
      namespace,
      follow: options?.follow ?? false,
      tailLines: options?.tailLines ?? 100,
      timestamps: options?.timestamps ?? false,
      container: 'gateway',
    });

    if (typeof logStream === 'string') {
      const pt = new PassThrough();
      pt.write(logStream);
      pt.end();
      return pt;
    }

    return logStream as unknown as Readable;
  }

  private async waitForPodReady(namespace: string, podName: string, timeoutMs = 300_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const pod = await this.coreApi.readNamespacedPod({ name: podName, namespace });
        // Check for container running (not ready) — we only need exec access to write
        // config files. The container won't become "ready" until the gateway binds,
        // which requires the config files we're about to write (chicken-and-egg).
        const running = pod.status?.containerStatuses?.some(c => c.state?.running) ?? false;
        if (running) return;
      } catch { /* pod not yet created */ }
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  private execCommand(namespace: string, podName: string, cmd: string[]): Promise<string> {
    const exec = new k8s.Exec(this.kc);
    return new Promise<string>((resolve, reject) => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const chunks: Buffer[] = [];
      stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      exec.exec(
        namespace, podName, 'gateway',
        cmd,
        stdout as unknown as NodeWritable,
        stderr as unknown as NodeWritable,
        null as unknown as NodeReadable,
        false,
        (status: k8s.V1Status) => {
          if (status.status === 'Success') resolve(Buffer.concat(chunks).toString('utf8'));
          else reject(new Error(status.message || 'exec failed'));
        },
      );
    });
  }

  async ensureLiteLLMConnected(_instanceId: string): Promise<void> {
    // No-op: Kubernetes pod networking handles LiteLLM connectivity via ClusterIP Services
  }

  async listFiles(runtimeId: string, dirPath: string): Promise<string[]> {
    try {
      const { namespace, name } = this.parseRuntimeId(runtimeId);
      const podName = `${name}-0`;
      await this.waitForPodReady(namespace, podName);
      const output = await this.execCommand(namespace, podName, ['ls', '-1', dirPath]);
      return output.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    } catch {
      return [];
    }
  }

  async readFile(runtimeId: string, filePath: string): Promise<string | null> {
    try {
      const { namespace, name } = this.parseRuntimeId(runtimeId);
      const podName = `${name}-0`;
      await this.waitForPodReady(namespace, podName);
      const output = await this.execCommand(namespace, podName, ['cat', filePath]);
      return output || null;
    } catch {
      return null;
    }
  }

  async writeFiles(runtimeId: string, basePath: string, files: Map<string, string>): Promise<void> {
    const { namespace, name } = this.parseRuntimeId(runtimeId);
    const podName = `${name}-0`;

    // Retry the entire write sequence if exec fails due to container restart
    // (e.g. during instance restart, old container may be killed mid-exec).
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.waitForPodReady(namespace, podName);
      try {
        await this.writeFilesInner(namespace, podName, basePath, files);
        return;
      } catch (err) {
        if (attempt === maxAttempts) throw err;
        console.warn(`[k8s] writeFiles attempt ${attempt} failed, retrying in 5s:`, err instanceof Error ? err.message : err);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  private async writeFilesInner(namespace: string, podName: string, basePath: string, files: Map<string, string>): Promise<void> {
    const exec = new k8s.Exec(this.kc);

    for (const [relativePath, content] of files) {
      const fullPath = `${basePath}/${relativePath}`;
      const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));

      await new Promise<void>((resolve, reject) => {
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        exec.exec(
          namespace, podName, 'gateway',
          ['mkdir', '-p', dir],
          stdout as unknown as NodeWritable,
          stderr as unknown as NodeWritable,
          null as unknown as NodeReadable,
          false,
          (status: k8s.V1Status) => {
            if (status.status === 'Success') resolve();
            else reject(new Error(`mkdir failed: ${status.message}`));
          },
        );
      });

      await new Promise<void>((resolve, reject) => {
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const b64 = Buffer.from(content).toString('base64');
        exec.exec(
          namespace, podName, 'gateway',
          ['sh', '-c', `echo '${b64}' | base64 -d > '${fullPath}'`],
          stdout as unknown as NodeWritable,
          stderr as unknown as NodeWritable,
          null as unknown as NodeReadable,
          false,
          (status: k8s.V1Status) => {
            if (status.status === 'Success') resolve();
            else reject(new Error(`write failed: ${status.message}`));
          },
        );
      });
    }
  }

  private isNotFound(err: unknown): boolean {
    if (err && typeof err === 'object') {
      const e = err as { response?: { statusCode?: number }; statusCode?: number; code?: number; body?: { code?: number } };
      return e.response?.statusCode === 404 || e.statusCode === 404 || e.code === 404 || e.body?.code === 404;
    }
    return false;
  }

  async exec(runtimeId: string, command: string[], options?: ExecOptions): Promise<ExecResult> {
    const { namespace, name } = this.parseRuntimeId(runtimeId);
    const podName = `${name}-0`;

    await this.waitForPodReady(namespace, podName);

    const cmd = options?.workDir
      ? ['sh', '-c', `cd '${options.workDir}' && ${command.map(c => `'${c}'`).join(' ')}`]
      : command;

    const exec = new k8s.Exec(this.kc);
    const timeoutMs = options?.timeout ?? 120_000;

    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`exec timed out after ${timeoutMs}ms`)), timeoutMs);

      const stdoutStream = new PassThrough();
      const stderrStream = new PassThrough();
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      stdoutStream.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      stderrStream.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      exec.exec(
        namespace, podName, 'gateway',
        cmd,
        stdoutStream as unknown as NodeWritable,
        stderrStream as unknown as NodeWritable,
        null as unknown as NodeReadable,
        false,
        (status: k8s.V1Status) => {
          clearTimeout(timer);
          resolve({
            stdout: Buffer.concat(stdoutChunks).toString('utf8'),
            stderr: Buffer.concat(stderrChunks).toString('utf8'),
          });
        },
      );
    });

    const exitCode = stdout || !stderr ? 0 : 1;

    return { exitCode, stdout, stderr };
  }
}
