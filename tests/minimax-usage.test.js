// tests/minimax-usage.test.js
import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

// Import from built dist files (npm test runs after npm run build)
import { getMiniMaxUsage, isMiniMaxConfigured, parseUtilization } from '../dist/minimax-usage.js';

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

    strictEqual(response.start_time, 1773921600000);
    strictEqual(response.end_time, 1773936000000);
    strictEqual(response.remains_time, 7173984);
    strictEqual(response.current_interval_total_count, 600);
    strictEqual(response.current_interval_usage_count, 557);
    strictEqual(response.model_name, 'MiniMax-M2.7');
    strictEqual(response.current_weekly_total_count, 21000);
    strictEqual(response.current_weekly_usage_count, 19640);
    strictEqual(response.weekly_start_time, 1773590400000);
    strictEqual(response.weekly_end_time, 1774195200000);
    strictEqual(response.weekly_remains_time, 266373984);
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

    strictEqual(typeof response.start_time, 'number');
    strictEqual(typeof response.end_time, 'number');
    strictEqual(typeof response.remains_time, 'number');
    strictEqual(typeof response.current_interval_total_count, 'number');
    strictEqual(typeof response.current_interval_usage_count, 'number');
    strictEqual(typeof response.model_name, 'string');
    strictEqual(typeof response.current_weekly_total_count, 'number');
    strictEqual(typeof response.current_weekly_usage_count, 'number');
    strictEqual(typeof response.weekly_start_time, 'number');
    strictEqual(typeof response.weekly_end_time, 'number');
    strictEqual(typeof response.weekly_remains_time, 'number');
  });
});

describe('MiniMaxUsageData', () => {
  it('has correct shape with required fields', () => {
    const data = {
      planName: 'MiniMax',
      utilization: 85,
      resetAt: new Date(1773936000000),
    };

    strictEqual(data.planName, 'MiniMax');
    strictEqual(typeof data.utilization, 'number');
    strictEqual(data.resetAt instanceof Date, true);
  });

  it('has resetAt as null when no reset time', () => {
    const data = {
      planName: 'MiniMax',
      utilization: 100,
      resetAt: null,
    };

    strictEqual(data.planName, 'MiniMax');
    strictEqual(data.resetAt, null);
  });

  it('has optional apiUnavailable field', () => {
    const data = {
      planName: 'MiniMax',
      utilization: 0,
      resetAt: null,
      apiUnavailable: true,
    };

    strictEqual(data.apiUnavailable, true);
  });

  it('has optional apiError field', () => {
    const data = {
      planName: 'MiniMax',
      utilization: 0,
      resetAt: null,
      apiError: 'Rate limit exceeded',
    };

    strictEqual(data.apiError, 'Rate limit exceeded');
  });

  it('has all optional fields together', () => {
    const data = {
      planName: 'MiniMax',
      utilization: 50,
      resetAt: new Date(),
      apiUnavailable: false,
      apiError: 'Some error',
    };

    strictEqual(data.planName, 'MiniMax');
    strictEqual(typeof data.utilization, 'number');
    strictEqual(data.resetAt instanceof Date, true);
    strictEqual(data.apiUnavailable, false);
    strictEqual(data.apiError, 'Some error');
  });
});

describe('getMiniMaxUsage', () => {
  it('returns null when no API key is set', async () => {
    // Override getAnthropicModelFromSettings to avoid reading real settings.json
    // which has MiniMax-M2.7 configured, causing cached data to be returned
    const result = await getMiniMaxUsage({
      apiKey: () => null,
      getAnthropicModelFromSettings: () => 'claude-sonnet-4',
    });
    strictEqual(result, null);
  });

  it('parses utilization correctly', () => {
    // (600 - 557) / 600 * 100 = 7.17%
    const utilization = parseUtilization(600, 557);
    strictEqual(utilization, 7);
  });

  it('clamps utilization to 0-100', () => {
    strictEqual(parseUtilization(100, 150), 0);  // over 100%
    strictEqual(parseUtilization(100, -10), 100); // negative
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
    strictEqual(result?.apiUnavailable, true);
    strictEqual(result?.apiError, 'network');
  });

  it('returns apiUnavailable on MiniMax API error status', async () => {
    // MiniMax API returns base_resp.status_code !== 0 for errors
    const deps = {
      apiKey: () => 'fake-key',
      fetchApi: async () => ({
        data: {
          base_resp: { status_code: 1004, status_msg: 'cookie is missing, log in again' },
          start_time: 0,
          end_time: 0,
          remains_time: 0,
          current_interval_total_count: 600,
          current_interval_usage_count: 557,
          model_name: 'MiniMax-M2.7',
          current_weekly_total_count: 21000,
          current_weekly_usage_count: 19640,
          weekly_start_time: 0,
          weekly_end_time: 0,
          weekly_remains_time: 0,
        },
      }),
      homeDir: () => '/tmp',
      now: () => Date.now(),
      ttls: { cacheTtlMs: 60000, failureCacheTtlMs: 15000 },
      getAnthropicModelFromSettings: () => 'MiniMax-M2.7',
    };
    const result = await getMiniMaxUsage(deps);
    strictEqual(result?.apiUnavailable, true);
    strictEqual(result?.apiError, 'cookie is missing, log in again');
  });
});

describe('isMiniMaxConfigured', () => {
  it('returns true when ANTHROPIC_MODEL contains minimax', () => {
    const result = isMiniMaxConfigured('MiniMax-M2.7');
    strictEqual(result, true);
  });

  it('returns true for lowercase minimax', () => {
    const result = isMiniMaxConfigured('minimax-m2.7');
    strictEqual(result, true);
  });

  it('returns false for anthropic', () => {
    const result = isMiniMaxConfigured('claude-sonnet-4-20250514');
    strictEqual(result, false);
  });

  it('returns false for null or undefined', () => {
    strictEqual(isMiniMaxConfigured(null), false);
    strictEqual(isMiniMaxConfigured(undefined), false);
  });
});
