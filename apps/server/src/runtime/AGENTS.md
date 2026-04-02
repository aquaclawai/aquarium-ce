# Runtime — AGENTS.md

> Parent: `../AGENTS.md` (route→service boundary)

## Architecture

```
types.ts      ← RuntimeEngine interface (the contract)
factory.ts    ← Returns Docker or K8s engine based on DEPLOYMENT_TARGET config
docker.ts     ← DockerRuntimeEngine — uses dockerode
kubernetes.ts ← KubernetesRuntimeEngine — uses @kubernetes/client-node
```

Services call `RuntimeEngineFactory.getEngine()` — never instantiate engines directly.

## RuntimeEngine Interface

Key methods (both engines implement all):
- `startContainer(id, image, env, volumes, ports)` → create + start
- `stopContainer(id)` → stop + remove
- `getContainerStatus(id)` → running/stopped/not-found
- `getContainerLogs(id, tail?)` → stdout/stderr
- `execInContainer(id, cmd[])` → run command inside
- `writeFile(id, path, content)` → seed config files into volume

## Docker vs Kubernetes Differences

| Aspect | Docker | Kubernetes |
|--------|--------|------------|
| Identity | Container name = `openclaw-{instanceId}` | Deployment + Service in `K8S_NAMESPACE` |
| Network | Joins `OPENCLAW_NETWORK` bridge | ClusterIP Service, internal DNS |
| Ports | Host port from `PORT_RANGE_START..END` | No host ports; Service exposes internally |
| Storage | Named volume `openclaw-data-{id}` | PVC backed by Compute Engine disk |
| File seeding | `docker cp` via tar stream | `kubectl exec` with base64 pipe |
| Health check | HTTP to `localhost:{hostPort}` | HTTP to `service.namespace.svc.cluster.local` |

## Gotchas

### Port Range (Docker only)
Port allocation is sequential from `OPENCLAW_PORT_RANGE_START` (default 19000). If range exhausted, start fails. No automatic recycling — stopped instances release ports.

### Docker Network
Instances join `OPENCLAW_NETWORK` (default: `openclaw-net`). This network must exist externally — `docker-compose.dev.yml` declares it as external. Create manually if missing: `docker network create openclaw-net`.

### K8s Startup Timing
Gateway needs ~150s first boot. startupProbe: initialDelay=10s, period=10s, failureThreshold=30 (310s total). Liveness/readiness disabled until startup succeeds. Do NOT reduce these — causes crash-loops.

### Volume Persistence
Both engines preserve data volumes on stop. `stopContainer` removes the container/deployment but NOT the volume/PVC. Data survives restart. `deleteInstance` removes everything including volume.

### Adding Runtime Operations
1. Add method to `RuntimeEngine` interface in `types.ts`
2. Implement in BOTH `docker.ts` and `kubernetes.ts`
3. Call via factory in service layer — never import engine directly
