#!/usr/bin/env node
/**
 * Smoke test for the Copilot extension's pure logic under plain Node (no
 * VS Code): the key auto-resolution and the message conversion are the two
 * pieces that must not regress. `vscode` is resolved to a shim through a
 * module register hook, so the compiled out/*.js load unmodified.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const extRoot = path.resolve(import.meta.dirname, '..')
const vscodeDir = path.join(extRoot, 'node_modules', 'vscode')
fs.mkdirSync(vscodeDir, { recursive: true })
const vscodeShimPath = path.join(vscodeDir, 'index.js')
fs.writeFileSync(vscodeShimPath, `
  'use strict'
  class LanguageModelTextPart { constructor(value) { this.value = value } }
  class LanguageModelToolCallPart { constructor(callId, name, input) { this.callId = callId; this.name = name; this.input = input } }
  class LanguageModelToolResultPart { constructor(callId, content) { this.callId = callId; this.content = content } }
  class LanguageModelDataPart { constructor(data, mimeType) { this.data = data; this.mimeType = mimeType } }
  const LanguageModelChatMessageRole = { User: 1, Assistant: 2 }
  const workspace = { getConfiguration: () => ({ get: () => undefined }) }
  module.exports = { LanguageModelTextPart, LanguageModelToolCallPart, LanguageModelToolResultPart, LanguageModelDataPart, LanguageModelChatMessageRole, workspace }
`)
fs.writeFileSync(path.join(vscodeDir, 'package.json'), JSON.stringify({ name: 'vscode', version: '0.0.0-test-shim', main: './index.js' }))

const require = createRequire(import.meta.url)
const { readHubKeyFromDataDir } = await import('../out/settings.js')

test('readHubKeyFromDataDir resolves the server key from the hub data dir', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fmh-key-'))
  fs.mkdirSync(path.join(home, 'hub'), { recursive: true })
  fs.writeFileSync(path.join(home, 'hub', 'settings.json'), JSON.stringify({ server: { key: 'K-test-123' } }))
  assert.equal(readHubKeyFromDataDir(home), 'K-test-123')
  fs.rmSync(home, { recursive: true, force: true })
})

test('readHubKeyFromDataDir degrades to empty on missing/corrupt files', () => {
  assert.equal(readHubKeyFromDataDir(path.join(os.tmpdir(), 'fmh-nonexistent-home')), '')
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fmh-key-'))
  fs.mkdirSync(path.join(home, 'hub'), { recursive: true })
  fs.writeFileSync(path.join(home, 'hub', 'settings.json'), '{corrupt')
  assert.equal(readHubKeyFromDataDir(home), '')
  fs.rmSync(home, { recursive: true, force: true })
})

test('platformOf groups models the way dsh-our-free-model does', async () => {
  const { platformOf, displayNameOf, sortByPlatform, isPickerVisible, canonicalAtomcodeId, dedupeVisible } = await import('../out/platforms.js')
  assert.equal(platformOf({ id: 'mimo-v2.6-flash-free', name: 'MiMo V2.6 Flash' }).label, 'OpenCode')
  assert.equal(platformOf({ id: 'mimo-v2.6-flash-free' }).vendor, 'freehub-free')
  assert.equal(platformOf({ id: 'muse-spark-1.3-contributor-free', regionSensitive: true }).label, 'OpenCode')
  assert.equal(platformOf({ id: 'muse-spark-1.3-contributor-free', state: 'region-blocked' }).label, 'OpenCode · region-limited')
  assert.equal(isPickerVisible({ id: 'mimo-v2.6-flash-free' }), true)
  assert.equal(isPickerVisible({ id: 'gone', state: 'unavailable' }), false)
  assert.equal(isPickerVisible({ id: 'gone', state: '不可用' }), false)
  assert.equal(isPickerVisible({ id: 'muse', state: 'region-blocked' }), false)
  assert.equal(isPickerVisible({ id: 'dead', routable: false }), false)
  assert.equal(platformOf({ id: 'nvidia/nemotron-3-ultra:free', channel: 'kilo' }).label, 'Kilo')
  assert.equal(platformOf({ id: 'nvidia/nemotron-3-ultra:free', channel: 'kilo' }).vendor, 'freehub-kilo')
  assert.equal(platformOf({ id: 'zcode/GLM-5.3', channel: 'chan', provider: 'zcode' }).label, 'ZCode (智谱)')
  assert.equal(platformOf({ id: 'trae/kimi-k3', ownedBy: 'chan:trae' }).label, 'TRAE (字节)')
  assert.equal(platformOf({ id: 'atomcode/glm-4.6', channel: 'atomcode' }).label, 'AtomCode')
  assert.equal(canonicalAtomcodeId('atomcode/AtomGit-qwen3.8-27b'), 'qwen3.8-27b')
  const atom = dedupeVisible([
    { id: 'atomcode/qwen3.8-27b', channel: 'atomcode', name: 'qwen3.8-27b' },
    { id: 'atomcode/AtomGit-qwen3.8-27b', channel: 'atomcode', name: 'AtomGit-qwen3.8-27b' },
  ])
  assert.equal(atom.length, 1)
  assert.equal(displayNameOf({ id: 'mimo-v2.6-flash-free', name: 'MiMo V2.6 Flash' }), 'mimo-v2.6-flash-free')
  assert.equal(displayNameOf({ id: 'mimo-v2.6-flash-free' }), 'mimo-v2.6-flash-free')
  assert.equal(displayNameOf({ id: 'codearts/deepseek-v4-flash', channel: 'chan', provider: 'codearts', name: 'deepseek-v4-flash' }), 'deepseek-v4-flash')
  assert.equal(displayNameOf({ id: 'zcode/GLM-5.3', channel: 'chan', provider: 'zcode', name: 'GLM 5.3' }), 'GLM-5.3')
  assert.equal(displayNameOf({ id: 'nvidia/nemotron-3-ultra:free', channel: 'kilo', name: 'NVIDIA: Nemotron 3 Ultra (free)' }), 'nemotron-3-ultra:free')
  // Two free-pool routers are named after their org; dropping it would leave
  // two identical `free` rows. They keep the prefix, every other id does not.
  assert.equal(displayNameOf({ id: 'kilo-auto/free', channel: 'kilo' }), 'kilo-auto free')
  assert.equal(displayNameOf({ id: 'openrouter/free', channel: 'kilo' }), 'openrouter free')
  const sorted = sortByPlatform([
    { id: 'zcode/GLM-5.3', channel: 'chan', provider: 'zcode', name: 'GLM 5.3' },
    { id: 'mimo-v2.6-flash-free', name: 'MiMo V2.6 Flash' },
    { id: 'nvidia/nemotron:free', channel: 'kilo', name: 'Kilo Nemotron' },
  ])
  assert.equal(sorted[0].id, 'mimo-v2.6-flash-free')
  assert.equal(sorted[1].id, 'nvidia/nemotron:free')
  assert.equal(sorted[2].id, 'zcode/GLM-5.3')
})

test('convertToChatRequest maps roles, tools and tool results (with vscode shimmed)', async () => {
  const { convertToChatRequest } = await import('../out/convert.js')
  const { LanguageModelTextPart, LanguageModelToolCallPart, LanguageModelToolResultPart, LanguageModelChatMessageRole } = require(vscodeShimPath)

  const body = convertToChatRequest(
    { id: 'deepseek-v4-flash-free', vision: true },
    [
      { role: LanguageModelChatMessageRole.User, content: [new LanguageModelTextPart('hello')] },
      { role: LanguageModelChatMessageRole.Assistant, content: [new LanguageModelToolCallPart('call_1', 'read', { path: 'x' })] },
      { role: LanguageModelChatMessageRole.User, content: [new LanguageModelToolResultPart('call_1', [new LanguageModelTextPart('file body')])] },
    ],
    { toolChoice: undefined, tools: [{ name: 'read', description: 'read a file', inputSchema: { type: 'object' } }] },
  )
  assert.equal(body.model, 'deepseek-v4-flash-free')
  assert.equal(body.stream, true)
  assert.equal(body.messages[0].role, 'user')
  assert.equal(body.messages[0].content, 'hello')
  assert.equal(body.messages[1].role, 'assistant')
  assert.equal(body.messages[1].tool_calls[0].id, 'call_1')
  assert.equal(body.messages[1].tool_calls[0].function.name, 'read')
  assert.equal(body.messages[2].role, 'tool')
  assert.equal(body.messages[2].tool_call_id, 'call_1')
  assert.equal(body.messages[2].content, 'file body')
  assert.equal(body.tools[0].function.name, 'read')
})

console.log('copilot-extension smoke tests: all passed')
