import { isMiniMaxUsageData } from './minimax-types.js';
/** Check if usage limit is reached (either window at 100%) */
export function isLimitReached(data) {
    if (isMiniMaxUsageData(data)) {
        return data.utilization === 0;
    }
    return data.fiveHour === 100 || data.sevenDay === 100;
}
//# sourceMappingURL=types.js.map