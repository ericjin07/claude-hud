import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
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
    getConfiguredModel: () => "MiniMax-M2.7",
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
    providerId: "external-fallback",
    providerLabel: "External Fallback",
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
    getConfiguredModel: () => "MiniMax-M2.7",
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

test("resolveUsageContext honors configured provider order and prefers Claude first", async () => {
  const usageData = await resolveUsageContext({
    stdin: {
      rate_limits: {
        five_hour: { used_percentage: 49.6, resets_at: 1710000000 },
        seven_day: { used_percentage: 25.2, resets_at: 1710600000 },
      },
    },
    config: makeConfig({
      usage: {
        providerDefinitions: [
          { id: "claude", label: "Claude", usageSource: { kind: "stdin" } },
          { id: "minimax", label: "MiniMax", modelMatchers: ["minimax"], usageSource: { kind: "minimax" } },
        ],
      },
    }),
    now: () => Date.UTC(2026, 3, 22, 10, 0, 0),
    getConfiguredModel: () => "MiniMax-M2.7",
    getMiniMaxUsage: async () => {
      throw new Error("MiniMax should not be called when Claude is configured first and available");
    },
    getUsageFromStdin: () => ({
      planName: null,
      fiveHour: 50,
      sevenDay: 25,
      fiveHourResetAt: new Date(1710000000 * 1000),
      sevenDayResetAt: new Date(1710600000 * 1000),
    }),
    getUsageFromExternalSnapshot: () => null,
  });

  assert.equal(usageData?.providerId, "claude");
});

test("resolveUsageContext falls through configured providers from Claude to MiniMax", async () => {
  const resetAt = new Date("2026-04-22T12:00:00.000Z");
  const usageData = await resolveUsageContext({
    stdin: { rate_limits: null },
    config: makeConfig({
      usage: {
        providerDefinitions: [
          { id: "claude", label: "Claude", usageSource: { kind: "stdin" } },
          { id: "minimax", label: "MiniMax", modelMatchers: ["minimax"], usageSource: { kind: "minimax" } },
        ],
      },
    }),
    now: () => Date.UTC(2026, 3, 22, 10, 0, 0),
    getConfiguredModel: () => "MiniMax-M2.7",
    getMiniMaxUsage: async () => ({
      planName: "MiniMax",
      utilization: 45,
      resetAt,
    }),
    getUsageFromStdin: () => null,
    getUsageFromExternalSnapshot: () => null,
  });

  assert.equal(usageData?.providerId, "minimax");
  assert.equal(usageData?.windows[0]?.usedPercent, 55);
});

test("resolveUsageContext does not select MiniMax when the active stdin model is Claude", async () => {
  const usageData = await resolveUsageContext({
    stdin: {
      model: {
        id: "claude-sonnet-4-20250514",
        display_name: "Claude Sonnet 4",
      },
      rate_limits: {
        five_hour: { used_percentage: 49.6, resets_at: 1710000000 },
        seven_day: { used_percentage: 25.2, resets_at: 1710600000 },
      },
    },
    config: makeConfig(),
    now: () => Date.UTC(2026, 3, 22, 10, 0, 0),
    getConfiguredModel: () => "MiniMax-M2.7",
    getMiniMaxUsage: async () => {
      throw new Error("MiniMax should not be called when the active stdin model is Claude");
    },
    getUsageFromStdin: () => ({
      planName: null,
      fiveHour: 50,
      sevenDay: 25,
      fiveHourResetAt: new Date(1710000000 * 1000),
      sevenDayResetAt: new Date(1710600000 * 1000),
    }),
    getUsageFromExternalSnapshot: () => null,
  });

  assert.equal(usageData?.providerId, "claude");
});

test("resolveUsageContext resolves a configured http-json provider from settings model and response mapping", async () => {
  process.env.CUSTOM_USAGE_TOKEN = "secret-token";
  try {
    const usageData = await resolveUsageContext({
      stdin: { rate_limits: null },
      config: makeConfig({
        usage: {
          providerDefinitions: [
            {
              id: "custom-http",
              label: "Custom HTTP",
              modelMatchers: ["custom-model"],
              usageSource: {
                kind: "http-json",
                endpoint: "https://example.test/usage",
                auth: {
                  type: "bearer-env",
                  envName: "CUSTOM_USAGE_TOKEN",
                },
                responseMapping: {
                  planNamePath: "plan.name",
                  windows: [
                    {
                      key: "5h",
                      label: "5h",
                      remainingPercentPath: "usage.five_hour.remaining",
                      resetAtPath: "usage.five_hour.reset_at",
                    },
                    {
                      key: "7d",
                      label: "7d",
                      usedPercentPath: "usage.seven_day.used",
                      resetAtPath: "usage.seven_day.reset_at",
                    },
                  ],
                },
              },
            },
          ],
        },
      }),
      now: () => Date.UTC(2026, 3, 22, 10, 0, 0),
      getConfiguredModel: () => "custom-model-v1",
      getMiniMaxUsage: async () => null,
      getUsageFromStdin: () => null,
      getUsageFromExternalSnapshot: () => null,
      fetchJson: async (request) => {
        assert.equal(request.endpoint, "https://example.test/usage");
        assert.equal(request.headers.Authorization, "Bearer secret-token");
        return {
          plan: { name: "Custom Plan" },
          usage: {
            five_hour: {
              remaining: 61,
              reset_at: "2026-04-22T14:00:00.000Z",
            },
            seven_day: {
              used: 83,
              reset_at: "2026-04-28T10:00:00.000Z",
            },
          },
        };
      },
    });

    assert.deepEqual(usageData, {
      providerId: "custom-http",
      providerLabel: "Custom HTTP",
      planName: "Custom Plan",
      windows: [
        {
          key: "5h",
          label: "5h",
          usedPercent: 39,
          resetAt: new Date("2026-04-22T14:00:00.000Z"),
        },
        {
          key: "7d",
          label: "7d",
          usedPercent: 83,
          resetAt: new Date("2026-04-28T10:00:00.000Z"),
        },
      ],
    });
  } finally {
    delete process.env.CUSTOM_USAGE_TOKEN;
  }
});

test("resolveUsageContext falls through when a configured http-json provider errors", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-hud-http-provider-error-"));

  try {
    const usageData = await resolveUsageContext({
      stdin: {
        rate_limits: {
          five_hour: { used_percentage: 49.6, resets_at: 1710000000 },
          seven_day: { used_percentage: 25.2, resets_at: 1710600000 },
        },
      },
      config: makeConfig({
        usage: {
          providerDefinitions: [
            {
              id: "custom-http",
              label: "Custom HTTP",
              modelMatchers: ["custom-model"],
              usageSource: {
                kind: "http-json",
                endpoint: "https://example.test/usage",
                responseMapping: {
                  windows: [
                    { key: "5h", label: "5h", usedPercentPath: "usage.five_hour.used" },
                  ],
                },
              },
            },
            { id: "claude", label: "Claude", usageSource: { kind: "stdin" } },
          ],
        },
      }),
      now: () => Date.UTC(2026, 3, 22, 10, 0, 0),
      homeDir: () => homeDir,
      getConfiguredModel: () => "custom-model-v1",
      getMiniMaxUsage: async () => null,
      getUsageFromStdin: () => ({
        planName: null,
        fiveHour: 50,
        sevenDay: 25,
        fiveHourResetAt: new Date(1710000000 * 1000),
        sevenDayResetAt: new Date(1710600000 * 1000),
      }),
      getUsageFromExternalSnapshot: () => null,
      fetchJson: async () => {
        throw new Error("network down");
      },
    });

    assert.equal(usageData?.providerId, "claude");
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("resolveUsageContext falls through when a configured http-json provider yields no usable windows", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-hud-http-provider-empty-"));

  try {
    const usageData = await resolveUsageContext({
      stdin: {
        rate_limits: {
          five_hour: { used_percentage: 49.6, resets_at: 1710000000 },
          seven_day: { used_percentage: 25.2, resets_at: 1710600000 },
        },
      },
      config: makeConfig({
        usage: {
          providerDefinitions: [
            {
              id: "custom-http",
              label: "Custom HTTP",
              modelMatchers: ["custom-model"],
              usageSource: {
                kind: "http-json",
                endpoint: "https://example.test/usage",
                responseMapping: {
                  windows: [
                    { key: "5h", label: "5h", usedPercentPath: "usage.five_hour.missing" },
                  ],
                },
              },
            },
            { id: "claude", label: "Claude", usageSource: { kind: "stdin" } },
          ],
        },
      }),
      now: () => Date.UTC(2026, 3, 22, 10, 0, 0),
      homeDir: () => homeDir,
      getConfiguredModel: () => "custom-model-v1",
      getMiniMaxUsage: async () => null,
      getUsageFromStdin: () => ({
        planName: null,
        fiveHour: 50,
        sevenDay: 25,
        fiveHourResetAt: new Date(1710000000 * 1000),
        sevenDayResetAt: new Date(1710600000 * 1000),
      }),
      getUsageFromExternalSnapshot: () => null,
      fetchJson: async () => ({ usage: { five_hour: {} } }),
    });

    assert.equal(usageData?.providerId, "claude");
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("resolveUsageContext reuses cached http-json provider results within TTL", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-hud-http-provider-"));
  let fetchCalls = 0;

  try {
    const config = makeConfig({
      usage: {
        cacheTtlSeconds: 60,
        failureCacheTtlSeconds: 15,
        providerDefinitions: [
          {
            id: "custom-http",
            label: "Custom HTTP",
            modelMatchers: ["custom-model"],
            usageSource: {
              kind: "http-json",
              endpoint: "https://example.test/usage",
              responseMapping: {
                windows: [
                  {
                    key: "5h",
                    label: "5h",
                    usedPercentPath: "usage.five_hour.used",
                    resetAtPath: "usage.five_hour.reset_at",
                  },
                ],
              },
            },
          },
        ],
      },
    });

    const first = await resolveUsageContext({
      stdin: { rate_limits: null },
      config,
      now: () => Date.UTC(2026, 3, 22, 10, 0, 0),
      homeDir: () => homeDir,
      getConfiguredModel: () => "custom-model-v1",
      getMiniMaxUsage: async () => null,
      getUsageFromStdin: () => null,
      getUsageFromExternalSnapshot: () => null,
      fetchJson: async () => {
        fetchCalls += 1;
        return {
          usage: {
            five_hour: {
              used: 44,
              reset_at: "2026-04-22T14:00:00.000Z",
            },
          },
        };
      },
    });

    const second = await resolveUsageContext({
      stdin: { rate_limits: null },
      config,
      now: () => Date.UTC(2026, 3, 22, 10, 0, 30),
      homeDir: () => homeDir,
      getConfiguredModel: () => "custom-model-v1",
      getMiniMaxUsage: async () => null,
      getUsageFromStdin: () => null,
      getUsageFromExternalSnapshot: () => null,
      fetchJson: async () => {
        fetchCalls += 1;
        throw new Error("should not be called while cache is fresh");
      },
    });

    assert.equal(fetchCalls, 1);
    assert.deepEqual(second, first);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("resolveUsageContext forwards configured TTLs to anthropic-oauth providers", async () => {
  const usageData = await resolveUsageContext({
    stdin: { rate_limits: null },
    config: makeConfig({
      usage: {
        cacheTtlSeconds: 120,
        failureCacheTtlSeconds: 45,
        providerDefinitions: [
          {
            id: "anthropic-oauth",
            label: "Claude OAuth",
            usageSource: { kind: "anthropic-oauth" },
          },
        ],
      },
    }),
    now: () => Date.UTC(2026, 3, 22, 10, 0, 0),
    getMiniMaxUsage: async () => null,
    getUsageFromStdin: () => null,
    getUsageFromExternalSnapshot: () => null,
    getAnthropicUsage: async (overrides = {}) => {
      assert.deepEqual(overrides.ttls, {
        cacheTtlMs: 120000,
        failureCacheTtlMs: 45000,
      });
      return {
        planName: null,
        fiveHour: 33,
        sevenDay: 12,
        fiveHourResetAt: new Date("2026-04-22T14:00:00.000Z"),
        sevenDayResetAt: new Date("2026-04-28T10:00:00.000Z"),
      };
    },
  });

  assert.equal(usageData?.providerId, "anthropic-oauth");
});

test("resolveUsageContext passes provider-specific snapshot paths to external-file providers", async () => {
  const usageData = await resolveUsageContext({
    stdin: { rate_limits: null },
    config: makeConfig({
      usage: {
        providerDefinitions: [
          {
            id: "external-file",
            label: "External File",
            usageSource: {
              kind: "external-file",
              path: "/tmp/provider-usage.json",
            },
          },
        ],
      },
      display: {
        externalUsagePath: "/tmp/global-usage.json",
      },
    }),
    now: () => Date.UTC(2026, 3, 22, 10, 0, 0),
    getMiniMaxUsage: async () => null,
    getUsageFromStdin: () => null,
    getUsageFromExternalSnapshot: (config, now, snapshotPath) => {
      assert.equal(config.display.externalUsagePath, "/tmp/global-usage.json");
      assert.equal(now, Date.UTC(2026, 3, 22, 10, 0, 0));
      assert.equal(snapshotPath, "/tmp/provider-usage.json");
      return {
        planName: null,
        fiveHour: 17,
        sevenDay: null,
        fiveHourResetAt: new Date("2026-04-22T14:00:00.000Z"),
        sevenDayResetAt: null,
      };
    },
  });

  assert.equal(usageData?.providerId, "external-file");
});