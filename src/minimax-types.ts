export interface MiniMaxUsageResponse {
  start_time: number;       // Unix ms timestamp
  end_time: number;          // Unix ms timestamp (reset time)
  remains_time: number;      // ms until reset
  current_interval_total_count: number;
  current_interval_usage_count: number;
  model_name: string;
  current_weekly_total_count: number;
  current_weekly_usage_count: number;
  weekly_start_time: number;
  weekly_end_time: number;
  weekly_remains_time: number;
}

export interface MiniMaxUsageData {
  planName: 'MiniMax';
  utilization: number;      // 0-100 percentage remaining
  resetAt: Date | null;     // from end_time (Unix ms)
  apiUnavailable?: boolean;
  apiError?: string;
}

/** Type guard to check if usage data is MiniMax data */
export function isMiniMaxUsageData(data: unknown): data is MiniMaxUsageData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'planName' in data &&
    (data as { planName: unknown }).planName === 'MiniMax'
  );
}
