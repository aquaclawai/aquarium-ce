import type { DeploymentTarget } from '@aquarium/shared';
import type { RuntimeEngine } from './types.js';
import { DockerEngine } from './docker.js';
import { KubernetesEngine } from './kubernetes.js';

const engines = new Map<string, RuntimeEngine>();

export function getRuntimeEngine(target: DeploymentTarget): RuntimeEngine {
  let engine = engines.get(target);
  if (engine) return engine;

  switch (target) {
    case 'docker':
      engine = new DockerEngine();
      engines.set(target, engine);
      return engine;
    case 'kubernetes':
      engine = new KubernetesEngine();
      engines.set(target, engine);
      return engine;
    default:
      throw new Error(`Unknown deployment target: ${target}`);
  }
}
