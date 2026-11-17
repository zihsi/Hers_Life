import { readFile } from 'node:fs/promises'
import test from 'node:test'
import assert from 'node:assert/strict'

const source = await readFile(new URL('./index.js', import.meta.url), 'utf8')

test('browser control is accepted only from an authenticated Owner Discord DM', () => {
  assert.match(source, /source\.kind !== 'plugin:hers-life-discord'/)
  assert.match(source, /meta\.conversationType !== 'dm'/)
  assert.match(source, /ctx\.hersLifeDiscord\?\.isOwner\?\./)
  assert.doesNotMatch(source, /targetMode|qqSessionPrefix|ownerQQ|findQQSession|shareToQQ|plugin:dsh-onebot/)
})

test('free-time work always runs in its own DSH session and reports to the Owner via Discord', () => {
  assert.match(source, /const target = await ensureAgent\(\)/)
  assert.match(source, /const shareToOwner = async/)
  assert.match(source, /ctx\.hersLifeDiscord\.sendToOwner/)
  assert.match(source, /sharePendingFor = id/)
  assert.doesNotMatch(source, /pickTarget\s*=|shareToQQ|qqSessionPrefix/)
})

test('the plugin declares its Discord adapter dependency and inherits the central workspace', () => {
  assert.match(source, /export const inject = \[[^\]]*hersLifeDiscord/)
  assert.match(source, /ctx\.hersLifeDiscord\?\.workspace/)
})
