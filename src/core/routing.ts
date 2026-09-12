export type TaskComplexity = 'simple' | 'standard' | 'complex';

export interface RoutingModel {
  id: string;
  label: string;
  provider: string;
  model: string;
}

export interface RoutingConfig {
  models: RoutingModel[];
  tiers: Record<TaskComplexity, string>;
  classifierModelId: string;
}

export interface RouteDecision {
  modelId: string;
  model: string;
  provider: string;
  complexity: TaskComplexity | 'manual';
  reason: string;
}

const COMPLEXITIES: TaskComplexity[] = ['simple', 'standard', 'complex'];

function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonemptyString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a nonempty string`);
  }
  return value;
}

export function parseRoutingConfig(input: unknown): RoutingConfig {
  const raw = objectValue(input, 'Routing config');
  if (!Array.isArray(raw.models) || raw.models.length === 0) {
    throw new Error('Routing config models must be a nonempty array');
  }

  const seenIds = new Set<string>();
  const models = raw.models.map((value, index): RoutingModel => {
    const model = objectValue(value, `models[${index}]`);
    const parsed = {
      id: nonemptyString(model.id, `models[${index}].id`),
      label: nonemptyString(model.label, `models[${index}].label`),
      provider: nonemptyString(model.provider, `models[${index}].provider`),
      model: nonemptyString(model.model, `models[${index}].model`),
    };
    if (seenIds.has(parsed.id)) {
      throw new Error(`Duplicate routing model ID: ${parsed.id}`);
    }
    seenIds.add(parsed.id);
    return parsed;
  });

  const rawTiers = objectValue(raw.tiers, 'Routing config tiers');
  const tiers = Object.fromEntries(
    COMPLEXITIES.map((complexity) => [
      complexity,
      nonemptyString(rawTiers[complexity], `tiers.${complexity}`),
    ]),
  ) as Record<TaskComplexity, string>;

  for (const complexity of COMPLEXITIES) {
    if (!seenIds.has(tiers[complexity])) {
      throw new Error(`Unknown model ID for ${complexity} tier: ${tiers[complexity]}`);
    }
  }

  const classifierModelId = nonemptyString(raw.classifierModelId, 'classifierModelId');
  if (!seenIds.has(classifierModelId)) {
    throw new Error(`Unknown classifier model ID: ${classifierModelId}`);
  }

  return { models, tiers, classifierModelId };
}

function configuredModel(config: RoutingConfig, modelId: string): RoutingModel {
  const model = config.models.find((candidate) => candidate.id === modelId);
  if (!model) throw new Error(`Unknown routing model ID: ${modelId}`);
  return model;
}

export function selectRoute(
  config: RoutingConfig,
  complexity: TaskComplexity,
  reason: string,
): RouteDecision {
  const modelId = config.tiers[complexity];
  const selected = configuredModel(config, modelId);
  return {
    modelId,
    model: selected.model,
    provider: selected.provider,
    complexity,
    reason,
  };
}

export function selectManualRoute(config: RoutingConfig, modelId: string): RouteDecision {
  const selected = configuredModel(config, modelId);
  return {
    modelId,
    model: selected.model,
    provider: selected.provider,
    complexity: 'manual',
    reason: `Manual selection: ${selected.label}`,
  };
}

const demoConfig = parseRoutingConfig({
  models: [
    { id: 'fast', label: 'Fast', provider: 'openai', model: 'openai/gpt-5.6-luna' },
    { id: 'balanced', label: 'Balanced', provider: 'openai', model: 'openai/gpt-5.6-sol' },
    { id: 'capable', label: 'Capable', provider: 'openai', model: 'openai/gpt-6-astra' },
  ],
  tiers: { simple: 'fast', standard: 'balanced', complex: 'capable' },
  classifierModelId: 'fast',
});

demoConfig.models.forEach(Object.freeze);
Object.freeze(demoConfig.models);
Object.freeze(demoConfig.tiers);

export const DEMO_ROUTING_CONFIG: RoutingConfig = Object.freeze(demoConfig);
