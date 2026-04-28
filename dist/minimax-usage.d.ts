import type { MiniMaxUsageResponse, MiniMaxUsageData } from './minimax-types.js';
export type { MiniMaxUsageData } from './minimax-types.js';
export declare function getAnthropicModelFromSettings(homeDir: string): string | null;
export declare function isMiniMaxConfigured(model?: string | null): boolean;
export declare function parseUtilization(total: number, remaining: number): number;
export type MiniMaxUsageDeps = {
    apiKey: () => string | null;
    fetchApi: (key: string) => Promise<{
        data: MiniMaxUsageResponse | null;
        error?: string;
    }>;
    homeDir: () => string;
    now: () => number;
    ttls: {
        cacheTtlMs: number;
        failureCacheTtlMs: number;
    };
    getAnthropicModelFromSettings: (homeDir: string) => string | null;
};
export declare function getMiniMaxUsage(overrides?: Partial<MiniMaxUsageDeps>): Promise<MiniMaxUsageData | null>;
//# sourceMappingURL=minimax-usage.d.ts.map