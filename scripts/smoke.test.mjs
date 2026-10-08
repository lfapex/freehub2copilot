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
