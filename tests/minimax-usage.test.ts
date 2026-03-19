// tests/minimax-usage.test.ts
import { describe, it, expect } from 'vitest';
import type { MiniMaxUsageResponse, MiniMaxUsageData } from '../src/minimax-types.js';
import { getMiniMaxUsage, isMiniMaxConfigured, parseUtilization } from '../src/minimax-usage.js';

describe('MiniMaxUsageResponse', () => {
  it('has correct shape with all 11 fields', () => {
    const response: MiniMaxUsageResponse = {
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

    // Verify all 11 fields exist and have correct types
    expect(response.start_time).toBe(1773921600000);
    expect(response.end_time).toBe(1773936000000);
    expect(response.remains_time).toBe(7173984);
    expect(response.current_interval_total_count).toBe(600);
    expect(response.current_interval_usage_count).toBe(557);
    expect(response.model_name).toBe('MiniMax-M2.7');
    expect(response.current_weekly_total_count).toBe(21000);
    expect(response.current_weekly_usage_count).toBe(19640);
    expect(response.weekly_start_time).toBe(1773590400000);
    expect(response.weekly_end_time).toBe(1774195200000);
    expect(response.weekly_remains_time).toBe(266373984);
  });

  it('has correct field types', () => {
    const response: MiniMaxUsageResponse = {
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

    expect(typeof response.start_time).toBe('number');
    expect(typeof response.end_time).toBe('number');
    expect(typeof response.remains_time).toBe('number');
    expect(typeof response.current_interval_total_count).toBe('number');
    expect(typeof response.current_interval_usage_count).toBe('number');
    expect(typeof response.model_name).toBe('string');
    expect(typeof response.current_weekly_total_count).toBe('number');
    expect(typeof response.current_weekly_usage_count).toBe('number');
    expect(typeof response.weekly_start_time).toBe('number');
    expect(typeof response.weekly_end_time).toBe('number');
    expect(typeof response.weekly_remains_time).toBe('number');
  });
});

describe('MiniMaxUsageData', () => {
  it('has correct shape with required fields', () => {
    const data: MiniMaxUsageData = {
      planName: 'MiniMax',
      utilization: 85,
      resetAt: new Date(1773936000000),
    };

    expect(data.planName).toBe('MiniMax');
    expect(typeof data.utilization).toBe('number');
    expect(data.resetAt).toBeInstanceOf(Date);
  });

  it('has resetAt as null when no reset time', () => {
    const data: MiniMaxUsageData = {
      planName: 'MiniMax',
      utilization: 100,
      resetAt: null,
    };

    expect(data.planName).toBe('MiniMax');
    expect(data.resetAt).toBeNull();
  });

  it('has optional apiUnavailable field', () => {
    const data: MiniMaxUsageData = {
      planName: 'MiniMax',
      utilization: 0,
      resetAt: null,
      apiUnavailable: true,
    };

    expect(data.apiUnavailable).toBe(true);
  });

  it('has optional apiError field', () => {
    const data: MiniMaxUsageData = {
      planName: 'MiniMax',
      utilization: 0,
      resetAt: null,
      apiError: 'Rate limit exceeded',
    };

    expect(data.apiError).toBe('Rate limit exceeded');
  });

  it('has all optional fields together', () => {
    const data: MiniMaxUsageData = {
      planName: 'MiniMax',
      utilization: 50,
      resetAt: new Date(),
      apiUnavailable: false,
      apiError: 'Some error',
    };

    expect(data.planName).toBe('MiniMax');
    expect(typeof data.utilization).toBe('number');
    expect(data.resetAt).toBeInstanceOf(Date);
    expect(data.apiUnavailable).toBe(false);
    expect(data.apiError).toBe('Some error');
  });
});

describe('getMiniMaxUsage', () => {
  it('returns null when no API key is set', async () => {
    const result = await getMiniMaxUsage({ apiKey: () => null });
    expect(result).toBeNull();
  });

  it('parses utilization correctly', () => {
    // (600 - 557) / 600 * 100 = 7.17%
    const utilization = parseUtilization(600, 557);
    expect(utilization).toBe(7);
  });

  it('clamps utilization to 0-100', () => {
    expect(parseUtilization(100, 150)).toBe(0);  // over 100%
    expect(parseUtilization(100, -10)).toBe(100); // negative
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
    expect(result?.apiUnavailable).toBe(true);
    expect(result?.apiError).toBe('network');
  });
});

describe('isMiniMaxConfigured', () => {
  it('returns true when ANTHROPIC_MODEL contains minimax', () => {
    const result = isMiniMaxConfigured('MiniMax-M2.7');
    expect(result).toBe(true);
  });

  it('returns true for lowercase minimax', () => {
    const result = isMiniMaxConfigured('minimax-m2.7');
    expect(result).toBe(true);
  });

  it('returns false for anthropic', () => {
    const result = isMiniMaxConfigured('claude-sonnet-4-20250514');
    expect(result).toBe(false);
  });
});
