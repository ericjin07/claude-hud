export interface MiniMaxModelUsage {
    start_time: number;
    end_time: number;
    remains_time: number;
    current_interval_total_count: number;
    current_interval_usage_count: number;
    model_name: string;
    current_weekly_total_count: number;
    current_weekly_usage_count: number;
    weekly_start_time: number;
    weekly_end_time: number;
    weekly_remains_time: number;
}
export interface MiniMaxUsageResponse {
    model_remains: MiniMaxModelUsage[];
    base_resp: {
        status_code: number;
        status_msg: string;
    };
}
export interface MiniMaxUsageData {
    planName: 'MiniMax';
    utilization: number;
    resetAt: Date | null;
    apiUnavailable?: boolean;
    apiError?: string;
}
/** Type guard to check if usage data is MiniMax data */
export declare function isMiniMaxUsageData(data: unknown): data is MiniMaxUsageData;
//# sourceMappingURL=minimax-types.d.ts.map