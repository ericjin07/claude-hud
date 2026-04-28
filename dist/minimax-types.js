/** Type guard to check if usage data is MiniMax data */
export function isMiniMaxUsageData(data) {
    return (typeof data === 'object' &&
        data !== null &&
        'planName' in data &&
        data.planName === 'MiniMax');
}
//# sourceMappingURL=minimax-types.js.map