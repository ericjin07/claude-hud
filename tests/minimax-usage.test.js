// tests/minimax-usage.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');

// Import from built dist files (npm test runs after npm run build)
const { getMiniMaxUsage, isMiniMaxConfigured, parseUtilization } = require('../dist/minimax-usage.js');
const { MiniMaxUsageResponse, MiniMaxUsageData } = require('../dist/minimax-types.js');

describe('MiniMaxUsageResponse', () => {
  it('has correct shape with all 11 fields', () => {
    const response = {
      start_time: 1773921600000,
      end_time: 1773936000000,
      remains_time: 7173984,
      current_interval_total_count: 600,
      current_interval_usage_count: 557,
      model_name: 'MiniMax-M2.7',
      current_weekly_total_count: 21000,
      current_weekly_usage_count: 19640,
      weekly_start_time: 1773590400000,
      weekly_end_time: 1774195200000,
      weekly_remains_time: 266373984,
    };

    assert.strictEqual(response.start_time, 1773921600000);
    assert.strictEqual(response.end_time, 1773936000000);
    assert.strictEqual(response.remains_time, 7173984);
    assert.strictEqual(response.current_interval_total_count, 600);
    assert.strictEqual(response.current_interval_usage_count, 557);
    assert.strictEqual(response.model_name, 'MiniMax-M2.7');
    assert.strictEqual(response.current_weekly_total_count, 21000);
    assert.strictEqual(response.current_weekly_usage_count, 19640);
    assert.strictEqual(response.weekly_start_time, 1773590400000);
    assert.strictEqual(response.weekly_end_time, 1774195200000);
    assert.strictEqual(response.weekly_remains_time, 266373984);
  });

  it('has correct field types', () => {
    const response = {
      start_time: 0,
      end_time: 0,
      remains_time: 0,
      current_interval_total_count: 0,
      current_interval_usage_count: 0,
      model_name: '',
      current_weekly_total_count: 0,
      current_weekly_usage_count: 0,
      weekly_start_time: 0,
      weekly_end_time: 0,
      weekly_remains_time: 0,
    };

    assert.strictEqual(typeof response.start_time, 'number');
    assert.strictEqual(typeof response.end_time, 'number');
    assert.strictEqual(typeof response.remains_time, 'number');
    assert.strictEqual(typeof response.current_interval_total_count, 'number');
    assert.strictEqual(typeof response.current_interval_usage_count, 'number');
    assert.strictEqual(typeof response.model_name, 'string');
    assert.strictEqual(typeof response.current_weekly_total_count, 'number');
    assert.strictEqual(typeof response.current_weekly_usage_count, 'number');
    assert.strictEqual(typeof response.weekly_start_time, 'number');
    assert.strictEqual(typeof response.weekly_end_time, 'number');
    assert.strictEqual(typeof response.weekly_remains_time, 'number');
  });
});

describe('MiniMaxUsageData', () => {
  it('has correct shape with required fields', () => {
    const data = {
      planName: 'MiniMax',
      utilization: 85,
      resetAt: new Date(1773936000000),
    };

    assert.strictEqual(data.planName, 'MiniMax');
    assert.strictEqual(typeof data.utilization, 'number');
    assert.strictEqual(data.resetAt instanceof Date, true);
  });

  it('has resetAt as null when no reset time', () => {
    const data = {
      planName: 'MiniMax',
      utilization: 100,
      resetAt: null,
    };

    assert.strictEqual(data.planName, 'MiniMax');
    assert.strictEqual(data.resetAt, null);
  });

  it('has optional apiUnavailable field', () => {
    const data = {
      planName: 'MiniMax',
      utilization: 0,
      resetAt: null,
      apiUnavailable: true,
    };

    assert.strictEqual(data.apiUnavailable, true);
  });

  it('has optional apiError field', () => {
    const data = {
      planName: 'MiniMax',
      utilization: 0,
      resetAt: null,
      apiError: 'Rate limit exceeded',
    };

    assert.strictEqual(data.apiError, 'Rate limit exceeded');
  });

  it('has all optional fields together', () => {
    const data = {
      planName: 'MiniMax',
      utilization: 50,
      resetAt: new Date(),
      apiUnavailable: false,
      apiError: 'Some error',
    };

    assert.strictEqual(data.planName, 'MiniMax');
    assert.strictEqual(typeof data.utilization, 'number');
    assert.strictEqual(data.resetAt instanceof Date, true);
    assert.strictEqual(data.apiUnavailable, false);
    assert.strictEqual(data.apiError, 'Some error');
  });
});

describe('getMiniMaxUsage', () => {
  it('returns null when no API key is set', async () => {
    const result = await getMiniMaxUsage({ apiKey: () => null });
    assert.strictEqual(result, null);
  });

  it('parses utilization correctly', () => {
    // (600 - 557) / 600 * 100 = 7.17%
    const utilization = parseUtilization(600, 557);
    assert.strictEqual(utilization, 7);
  });

  it('clamps utilization to 0-100', () => {
    assert.strictEqual(parseUtilization(100, 150), 0);  // over 100%
    assert.strictEqual(parseUtilization(100, -10), 100); // negative
  });

  it('returns apiUnavailable on network error', async () => {
    const deps = {
      apiKey: () => 'fake-key',
      fetchApi: async () => ({ data: null, error: 'network' }),
      homeDir: () => '/tmp',
      now: () => Date.now(),
      ttls: { cacheTtlMs: 60000, failureCacheTtlMs: 15000 },
      getAnthropicModelFromSettings: () => 'MiniMax-M2.7',
    };
    const result = await getMiniMaxUsage(deps);
    assert.strictEqual(result?.apiUnavailable, true);
    assert.strictEqual(result?.apiError, 'network');
  });
});

describe('isMiniMaxConfigured', () => {
  it('returns true when ANTHROPIC_MODEL contains minimax', () => {
    const result = isMiniMaxConfigured('MiniMax-M2.7');
    assert.strictEqual(result, true);
  });

  it('returns true for lowercase minimax', () => {
    const result = isMiniMaxConfigured('minimax-m2.7');
    assert.strictEqual(result, true);
  });

  it('returns false for anthropic', () => {
    const result = isMiniMaxConfigured('claude-sonnet-4-20250514');
    assert.strictEqual(result, false);
  });

  it('returns false for null or undefined', () => {
    assert.strictEqual(isMiniMaxConfigured(null), false);
    assert.strictEqual(isMiniMaxConfigured(undefined), false);
  });
});
