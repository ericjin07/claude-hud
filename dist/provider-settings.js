import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getClaudeConfigDir } from './claude-config-dir.js';
function getStringSetting(source, key) {
    const value = source?.[key];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
function getFallbackModelSetting(source) {
    if (!source) {
        return null;
    }
    for (const [key, value] of Object.entries(source)) {
        if (!key.endsWith('_MODEL')) {
            continue;
        }
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }
    return null;
}
function extractConfiguredModel(settings) {
    const env = settings.env;
    const preferredKeys = ['ANTHROPIC_MODEL', 'CLAUDE_CODE_MODEL', 'MODEL'];
    for (const key of preferredKeys) {
        const envValue = getStringSetting(env, key);
        if (envValue) {
            return envValue;
        }
        const topLevelValue = getStringSetting(settings, key);
        if (topLevelValue) {
            return topLevelValue;
        }
    }
    return getFallbackModelSetting(env) ?? getFallbackModelSetting(settings);
}
export function getConfiguredModelFromSettings(homeDir = os.homedir()) {
    try {
        const settingsPath = path.join(getClaudeConfigDir(homeDir), 'settings.json');
        if (!fs.existsSync(settingsPath)) {
            return null;
        }
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        return extractConfiguredModel(settings);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=provider-settings.js.map