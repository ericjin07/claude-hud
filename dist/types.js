import { isMiniMaxUsageData } from './minimax-types.js';
function isNormalizedUsageData(data) {
    return 'windows' in data && Array.isArray(data.windows);
}
/** Check if usage limit is reached (either window at 100% or MiniMax at 0% remaining) */
export function toNormalizedUsageData(data) {
    if (isNormalizedUsageData(data)) {
        return data;
    }
    if (isMiniMaxUsageData(data)) {
        const normalized = {
            providerId: 'minimax',
            providerLabel: 'MiniMax',
            planName: data.planName,
            windows: [
                {
                    key: '5h',
                    label: '5h',
                    usedPercent: Math.max(0, 100 - data.utilization),
                    resetAt: data.resetAt,
                },
            ],
        };
        if (data.apiUnavailable !== undefined) {
            normalized.apiUnavailable = data.apiUnavailable;
        }
        if (data.apiError !== undefined) {
            normalized.apiError = data.apiError;
        }
        return normalized;
    }
    const normalized = {
        providerId: 'claude',
        providerLabel: 'Claude',
        planName: data.planName,
        windows: [
            {
                key: '5h',
                label: '5h',
                usedPercent: data.fiveHour,
                resetAt: data.fiveHourResetAt,
            },
            {
                key: '7d',
                label: '7d',
                usedPercent: data.sevenDay,
                resetAt: data.sevenDayResetAt,
            },
        ],
    };
    if (data.apiUnavailable !== undefined) {
        normalized.apiUnavailable = data.apiUnavailable;
    }
    if (data.apiError !== undefined) {
        normalized.apiError = data.apiError;
    }
    return normalized;
}
/** Check if any usage window has reached its limit. */
export function isLimitReached(data) {
    const normalized = toNormalizedUsageData(data);
    for (const window of normalized.windows) {
        if (window.usedPercent === 100) {
            return true;
        }
    }
    return false;
}
//# sourceMappingURL=types.js.map