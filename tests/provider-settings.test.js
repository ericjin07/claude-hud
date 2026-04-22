import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { getConfiguredModelFromSettings } from '../dist/provider-settings.js';

test('getConfiguredModelFromSettings reads ANTHROPIC_MODEL from env settings', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-provider-settings-'));

  try {
    const claudeDir = path.join(homeDir, '.claude');
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({ env: { ANTHROPIC_MODEL: 'MiniMax-M2.7' } }),
      'utf8',
    );

    assert.equal(getConfiguredModelFromSettings(homeDir), 'MiniMax-M2.7');
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('getConfiguredModelFromSettings falls back to provider-specific *_MODEL keys', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-provider-settings-'));

  try {
    const claudeDir = path.join(homeDir, '.claude');
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({ env: { OPENAI_MODEL: 'gpt-4.1-mini' } }),
      'utf8',
    );

    assert.equal(getConfiguredModelFromSettings(homeDir), 'gpt-4.1-mini');
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});