// tests/minimax-usage.test.ts
import { describe, it, expect } from 'vitest';
import type { MiniMaxUsageResponse, MiniMaxUsageData } from '../src/minimax-types.js';

describe('MiniMaxUsageResponse', () => {
  it('has correct shape', () => {
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
    expect(response.model_name).toBe('MiniMax-M2.7');
    expect(response.current_interval_total_count).toBe(600);
  });
});
