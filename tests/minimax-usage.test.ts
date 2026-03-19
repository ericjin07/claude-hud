// tests/minimax-usage.test.ts
import { describe, it, expect } from 'vitest';
import type { MiniMaxUsageResponse, MiniMaxUsageData } from '../src/minimax-types.js';

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
