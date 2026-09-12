import { describe, expect, it } from 'vitest';
import {
  DEMO_ROUTING_CONFIG,
  parseRoutingConfig,
  selectManualRoute,
  selectRoute,
} from './routing.js';

const customConfig = {
  models: [
    { id: 'quick', label: 'Quick', provider: 'anthropic', model: 'anthropic/claude-haiku-4.5' },
    { id: 'usual', label: 'Usual', provider: 'google', model: 'google/gemini-2.5-pro' },
    { id: 'deep', label: 'Deep', provider: 'mistral', model: 'mistralai/mistral-large' },
  ],
  tiers: { simple: 'quick', standard: 'usual', complex: 'deep' },
  classifierModelId: 'quick',
};

describe('parseRoutingConfig', () => {
  it('accepts configured vendor metadata without restricting it to OpenAI', () => {
    expect(parseRoutingConfig(customConfig)).toEqual(customConfig);
  });

  it.each([
    {
      name: 'an empty ID',
      input: { ...customConfig, models: [{ ...customConfig.models[0], id: '   ' }] },
    },
    {
      name: 'a duplicate ID',
      input: { ...customConfig, models: [...customConfig.models, { ...customConfig.models[0] }] },
    },
  ])('rejects $name', ({ input }) => {
    expect(() => parseRoutingConfig(input)).toThrow();
  });

  it('rejects an empty model list', () => {
    expect(() => parseRoutingConfig({ ...customConfig, models: [] })).toThrow();
  });

  it.each(['simple', 'standard', 'complex'] as const)(
    'rejects an unknown %s tier target',
    (tier) => {
      expect(() =>
        parseRoutingConfig({
          ...customConfig,
          tiers: { ...customConfig.tiers, [tier]: 'missing' },
        }),
      ).toThrow();
    },
  );

  it('rejects a missing classifier model', () => {
    expect(() => parseRoutingConfig({ ...customConfig, classifierModelId: 'missing' })).toThrow();
  });

  it('rejects missing and whitespace-only model metadata', () => {
    expect(() =>
      parseRoutingConfig({
        ...customConfig,
        models: [{ id: 'quick', label: '', provider: 'anthropic', model: '   ' }],
      }),
    ).toThrow();
  });
});

describe('route selection', () => {
  it.each([
    ['simple', 'fast', 'openai/gpt-5.6-luna'],
    ['standard', 'balanced', 'openai/gpt-5.6-sol'],
    ['complex', 'capable', 'openai/gpt-6-astra'],
  ] as const)('selects the configured default for %s work', (complexity, modelId, model) => {
    expect(selectRoute(DEMO_ROUTING_CONFIG, complexity, 'Ticket scope')).toEqual({
      modelId,
      model,
      provider: 'openai',
      complexity,
      reason: 'Ticket scope',
    });
  });

  it('selects custom non-OpenAI entries by tier', () => {
    const config = parseRoutingConfig(customConfig);
    expect(selectRoute(config, 'complex', 'Cross-cutting change')).toMatchObject({
      modelId: 'deep',
      model: 'mistralai/mistral-large',
      provider: 'mistral',
    });
  });

  it('selects only a configured model for a manual override', () => {
    expect(() => selectManualRoute(DEMO_ROUTING_CONFIG, 'injected/model')).toThrow();
    expect(selectManualRoute(DEMO_ROUTING_CONFIG, 'balanced')).toMatchObject({
      model: 'openai/gpt-5.6-sol',
      complexity: 'manual',
      provider: 'openai',
    });
  });
});

describe('DEMO_ROUTING_CONFIG', () => {
  it('cannot be mutated at runtime', () => {
    expect(Object.isFrozen(DEMO_ROUTING_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEMO_ROUTING_CONFIG.models)).toBe(true);
    expect(Object.isFrozen(DEMO_ROUTING_CONFIG.models[0])).toBe(true);
    expect(Object.isFrozen(DEMO_ROUTING_CONFIG.tiers)).toBe(true);
  });
});
