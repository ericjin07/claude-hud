import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../dist/config.js";
import { resolveUsageContext } from "../dist/index.js";

function makeConfig(overrides = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    display: {
      ...DEFAULT_CONFIG.display,
      ...(overrides.display ?? {}),
    },
    usage: {
      ...DEFAULT_CONFIG.usage,
      ...(overrides.usage ?? {}),
    },
  };
}

test("resolveUsageContext prefers MiniMax and normalizes to usage windows", async () => {
  const resetAt = new Date("2026-04-22T12:00:00.000Z");
  const usageData = await resolveUsageContext({
    stdin: { rate_limits: null },
    config: makeConfig(),
    now: () => Date.UTC(2026, 3, 22, 10, 0, 0),
    getMiniMaxUsage: async () => ({
      planName: "MiniMax",
      utilization: 45,
      resetAt,
    }),
    getUsageFromStdin: () => {
      throw new Error("stdin usage should not be called when MiniMax exists");
    },
    getUsageFromExternalSnapshot: () => {
      throw new Error("external usage should not be called when MiniMax exists");
    },
  });

  assert.deepEqual(usageData, {
    providerId: "minimax",
    providerLabel: "MiniMax",
    planName: "MiniMax",
    windows: [
      {
        key: "5h",
        label: "5h",
        usedPercent: 55,
        resetAt,
      },
    ],
  });
});

test("resolveUsageContext falls back to stdin usage and normalizes both windows", async () => {
  const usageData = await resolveUsageContext({
    stdin: {
      rate_limits: {
        five_hour: { used_percentage: 49.6, resets_at: 1710000000 },
        seven_day: { used_percentage: 25.2, resets_at: 1710600000 },
      },
    },
    config: makeConfig(),
    now: () => Date.UTC(2026, 3, 22, 10, 0, 0),
    getMiniMaxUsage: async () => null,
    getUsageFromStdin: () => ({
      planName: null,
      fiveHour: 50,
      sevenDay: 25,
      fiveHourResetAt: new Date(1710000000 * 1000),
      sevenDayResetAt: new Date(1710600000 * 1000),
    }),
    getUsageFromExternalSnapshot: () => {
      throw new Error("external usage should not be called when stdin usage exists");
    },
  });

  assert.deepEqual(usageData, {
    providerId: "claude",
    providerLabel: "Claude",
    planName: null,
    windows: [
      {
        key: "5h",
        label: "5h",
        usedPercent: 50,
        resetAt: new Date(1710000000 * 1000),
      },
      {
        key: "7d",
        label: "7d",
        usedPercent: 25,
        resetAt: new Date(1710600000 * 1000),
      },
    ],
  });
});

test("resolveUsageContext falls back to external usage when MiniMax and stdin are unavailable", async () => {
  const config = makeConfig();
  const now = Date.UTC(2026, 3, 22, 10, 0, 0);
  const usageData = await resolveUsageContext({
    stdin: { rate_limits: null },
    config,
    now: () => now,
    getMiniMaxUsage: async () => null,
    getUsageFromStdin: () => null,
    getUsageFromExternalSnapshot: (receivedConfig, receivedNow) => {
      assert.equal(receivedConfig, config);
      assert.equal(receivedNow, now);
      return {
        planName: null,
        fiveHour: 42,
        sevenDay: 85,
        fiveHourResetAt: new Date("2026-04-20T15:00:00.000Z"),
        sevenDayResetAt: new Date("2026-04-27T12:00:00.000Z"),
      };
    },
  });

  assert.deepEqual(usageData, {
    providerId: "claude",
    providerLabel: "Claude",
    planName: null,
    windows: [
      {
        key: "5h",
        label: "5h",
        usedPercent: 42,
        resetAt: new Date("2026-04-20T15:00:00.000Z"),
      },
      {
        key: "7d",
        label: "7d",
        usedPercent: 85,
        resetAt: new Date("2026-04-27T12:00:00.000Z"),
      },
    ],
  });
});

test("resolveUsageContext preserves API status fields for MiniMax results", async () => {
  const usageData = await resolveUsageContext({
    stdin: { rate_limits: null },
    config: makeConfig(),
    now: () => Date.UTC(2026, 3, 22, 10, 0, 0),
    getMiniMaxUsage: async () => ({
      planName: "MiniMax",
      utilization: 100,
      resetAt: null,
      apiUnavailable: true,
      apiError: "rate-limited",
    }),
    getUsageFromStdin: () => null,
    getUsageFromExternalSnapshot: () => null,
  });

  assert.deepEqual(usageData, {
    providerId: "minimax",
    providerLabel: "MiniMax",
    planName: "MiniMax",
    windows: [
      {
        key: "5h",
        label: "5h",
        usedPercent: 0,
        resetAt: null,
      },
    ],
    apiUnavailable: true,
    apiError: "rate-limited",
  });
});

test("resolveUsageContext returns null when no usage source is available", async () => {
  const usageData = await resolveUsageContext({
    stdin: { rate_limits: null },
    config: makeConfig(),
    now: () => Date.UTC(2026, 3, 22, 10, 0, 0),
    getMiniMaxUsage: async () => null,
    getUsageFromStdin: () => null,
    getUsageFromExternalSnapshot: () => null,
  });

  assert.equal(usageData, null);
});