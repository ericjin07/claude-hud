/** Check if any usage window has reached its limit. */
export function isLimitReached(data) {
    for (const window of data.windows) {
        if (window.usedPercent === 100) {
            return true;
        }
    }
    return false;
}
//# sourceMappingURL=types.js.map