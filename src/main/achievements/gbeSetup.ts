import { spawn } from 'child_process'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs'
import { readdir, stat, mkdir, copyFile, rename, writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import { app, ipcMain } from 'electron'
import { getGames, updateGame } from '../library'
import { installSchema } from './steamSchema'
import { syncNowSilently } from './watcher'
import { saveRoots, type RuntimeAchEntry } from './emuSaves'

/**
 * One-click Steam emulation setup for a game:
 *  1. Detect the Steamworks DLL (steam_api.dll / steam_api64.dll) and its architecture.
 *  2. If it is a real Valve DLL, back it up and replace it with gbe_fork.
 *     If there is no DLL at all, install both architectures.
 *  3. Write steam_appid.txt.
 *  4. Download the achievement schema (names/icons/rarity) into steam_settings —
 *     without it gbe_fork refuses to unlock achievements.
 */

export interface SetupReport {
  gameId: string
  dll: 'kept-emulator' | 'replaced' | 'installed' | 'not-found'
  dllPath?: string
  schema: { total: number; withIcons: number; localized: boolean; rarity: boolean } | null
  appidWritten: boolean
  cover: boolean
  warnings: string[]
}

const USER_AGENT = 'my-launcher/0.1 (+personal use)'

/** Reads the PE header machine type: 0x014C = x86, 0x8664 = x64. */
function peMachine(file: string): 32 | 64 | null {
  try {
    const buf = readFileSync(file)
    if (buf.length < 0x100 || buf[0] !== 0x4d || buf[1] !== 0x5a) return null // "MZ"
    const peOff = buf.readUInt32LE(0x3c)
    if (peOff + 6 > buf.length) return null
    const machine = buf.readUInt16LE(peOff + 4)
    if (machine === 0x014c) return 32
    if (machine === 0x8664) return 64
    return null
  } catch {
    return null
  }
}

/** Is this DLL a Goldberg-family emulator? */
function looksLikeEmulator(file: string): boolean {
  try {
    const text = readFileSync(file).toString('latin1')
    return (
      text.includes('steam_settings') ||
      text.includes('GSE Saves') ||
      text.includes('Goldberg') ||
      text.includes('achievements.json')
    )
  } catch {
    return false
  }
}

/** Finds steam_api(64).dll near the game exe (game root + one level of subfolders). */
async function findSteamApiDll(gameDir: string): Promise<string | null> {
  const names = ['steam_api64.dll', 'steam_api.dll']
  // check the root first
  for (const name of names) {
    const p = join(gameDir, name)
    if (existsSync(p)) return p
  }
  // then one level deep
  try {
    for (const entry of await readdir(gameDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      for (const name of names) {
        const p = join(gameDir, entry.name, name)
        if (existsSync(p)) return p
      }
    }
  } catch {
    // ignore
  }
  return null
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`GitHub вернул ${res.status}`)
  return res.json()
}

interface ReleaseAsset {
  name: string
  browser_download_url: string
}

/** Downloads the latest gbe_fork Windows release archive into the cache. */
async function downloadGbeRelease(): Promise<{ archive: string; tag: string }> {
  const cacheDir = join(app.getPath('userData'), 'cache', 'gbe')
  await mkdir(cacheDir, { recursive: true })

  const releases = (await fetchJson(
    'https://api.github.com/repos/Detanup01/gbe_fork/releases?per_page=10'
  )) as Array<{ tag_name: string; assets: ReleaseAsset[] }>

  const withAssets = releases.filter((r) => r.assets?.length)
  if (withAssets.length === 0) throw new Error('Не найдены релизы gbe_fork')

  // prefer the release build with the widest runtime compatibility (vs2022)
  for (const release of withAssets) {
    const asset = release.assets.find(
      (a) => a.name.startsWith('emu-win-release') && a.name.endsWith('.7z')
    )
    if (!asset) continue
    const archive = join(cacheDir, `${release.tag_name}_${asset.name}`)
    if (!existsSync(archive)) {
      await downloadToFile(asset.browser_download_url, archive)
    }
    return { archive, tag: release.tag_name }
  }
  throw new Error('В релизах gbe_fork нет Windows-сборки')
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`Скачивание вернуло ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, buf)
}

/** Extracts a .7z with the standalone 7zr.exe (downloaded from 7-zip.org). */
async function extract7z(archive: string, outDir: string): Promise<void> {
  const cacheDir = join(app.getPath('userData'), 'cache', 'gbe')
  const sevenZip = join(cacheDir, '7zr.exe')
  if (!existsSync(sevenZip)) {
    await downloadToFile('https://www.7-zip.org/a/7zr.exe', sevenZip)
  }
  await mkdir(outDir, { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const child = spawn(sevenZip, ['x', archive, `-o${outDir}`, '-y'], { stdio: 'ignore' })
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`7z exit ${code}`))))
    child.on('error', reject)
  })
}

/** Recursively finds a file in the extracted tree. */
async function findFileRecursive(dir: string, name: string, depth = 0): Promise<string | null> {
  if (depth > 6) return null
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return full
      if (entry.isDirectory()) {
        const hit = await findFileRecursive(full, name, depth + 1)
        if (hit) return hit
      }
    }
  } catch {
    // ignore
  }
  return null
}

/** Installs the gbe_fork DLL of the requested architecture. */
async function installDll(arch: 32 | 64, gameDir: string): Promise<string> {
  const { archive } = await downloadGbeRelease()
  const extractDir = join(app.getPath('userData'), 'cache', 'gbe', 'extracted')
  await extract7z(archive, extractDir)

  const dllName = arch === 64 ? 'steam_api64.dll' : 'steam_api.dll'
  const source = await findFileRecursive(extractDir, dllName)
  if (!source) throw new Error(`В архиве gbe_fork не найден ${dllName}`)

  const target = join(gameDir, dllName)
  await mkdir(dirname(target), { recursive: true })
  await copyFile(source, target)
  return target
}

/** Downloads the vertical library capsule from the Steam CDN. */
async function downloadCover(appId: number, dest: string): Promise<boolean> {
  const urls = [
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`
  ]
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      const type = res.headers.get('content-type') ?? ''
      if (res.ok && type.startsWith('image')) {
        await mkdir(dirname(dest), { recursive: true })
        await writeFile(dest, Buffer.from(await res.arrayBuffer()))
        return true
      }
    } catch {
      // try the next mirror
    }
  }
  return false
}

/**
 * Full setup for one game.
 */
export async function setupAchievements(gameId: string): Promise<SetupReport> {
  const game = getGames().find((g) => g.id === gameId)
  if (!game) throw new Error('Игра не найдена')
  if (!game.appId) throw new Error('У игры не указан Steam AppID')
  const gameDir = game.workDir ?? dirname(game.exePath)

  const warnings: string[] = []
  const report: SetupReport = {
    gameId,
    dll: 'not-found',
    schema: null,
    appidWritten: false,
    cover: false,
    warnings
  }

  // 1. DLL
  const existing = await findSteamApiDll(gameDir)
  if (existing) {
    const machine = peMachine(existing)
    if (looksLikeEmulator(existing)) {
      report.dll = 'kept-emulator'
      report.dllPath = existing
    } else {
      // real Valve Steamworks DLL — back it up and replace it
      const backup = existing + '.valve.bak'
      if (!existsSync(backup)) await rename(existing, backup)
      const machineOr64 = machine ?? 64
      try {
        const installed = await installDll(machineOr64, gameDir)
        report.dll = 'replaced'
        report.dllPath = installed
      } catch (e) {
        // restore the original so the game stays playable
        await copyFile(backup, existing)
        throw new Error(`Не удалось заменить DLL: ${String(e)}`)
      }
    }
  } else {
    warnings.push('steam_api DLL не найдена — установлены обе архитектуры (x86 и x64)')
    await installDll(32, gameDir)
    await installDll(64, gameDir)
    report.dll = 'installed'
  }

  // 2. steam_appid.txt (steam_settings has priority for gbe)
  const settingsDir = join(gameDir, 'steam_settings')
  await mkdir(settingsDir, { recursive: true })
  const appidInSettings = join(settingsDir, 'steam_appid.txt')
  if (!existsSync(appidInSettings)) {
    await writeFile(appidInSettings, String(game.appId), 'utf-8')
    report.appidWritten = true
  }
  const appidInRoot = join(gameDir, 'steam_appid.txt')
  if (!existsSync(appidInRoot)) {
    await writeFile(appidInRoot, String(game.appId), 'utf-8')
    report.appidWritten = true
  }

  // 3. Schema
  report.schema = await installSchema(gameDir, game.appId)

  // 4. Cover from the Steam CDN (portrait library capsule)
  const coverPath = join(app.getPath('userData'), 'covers', `${gameId}.jpg`)
  if (!existsSync(coverPath) || (await stat(coverPath).then((s) => s.size === 0).catch(() => true))) {
    const ok = await downloadCover(game.appId, coverPath)
    if (ok) {
      updateGame(gameId, { coverPath })
      report.cover = true
    }
  } else {
    updateGame(gameId, { coverPath })
    report.cover = true
  }

  return report
}

/** Sizes a directory recursively (debug helper). */
export async function dirSize(dir: string): Promise<number> {
  let size = 0
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isFile()) size += (await stat(full)).size
      else size += await dirSize(full)
    }
  } catch {
    // ignore
  }
  return size
}

/**
 * Exports unlock history from the launcher library back into the emulator's
 * runtime file (%APPDATA%\GSE Saves\<appid>\achievements.json).
 *
 * Use case: the game was reinstalled (or moved to another PC) — the runtime file
 * is empty, but the launcher keeps the permanent history. This writes the unlocks
 * back so the emulator (and the game) sees all past progress again.
 *
 * Merge policy: "max wins" — an unlock stays if either side has it, with the
 * later timestamp of the two.
 */
export async function exportUnlocks(gameId: string): Promise<{ exported: number; file: string }> {
  const game = getGames().find((g) => g.id === gameId)
  if (!game) throw new Error('Игра не найдена')
  if (!game.appId) throw new Error('У игры не указан Steam AppID')

  const file = join(saveRoots()[0], String(game.appId), 'achievements.json')

  // existing runtime state (common variant), so we don't lose emulator-side data
  const merged: Record<string, RuntimeAchEntry> = {}
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
      const rec = value as Record<string, unknown>
      merged[key.toLowerCase()] = {
        earned: rec.earned === true,
        earnedTime: typeof rec.earned_time === 'number' ? rec.earned_time : 0
      }
    }
  } catch {
    // no existing file or invalid JSON — start fresh
  }

  let exported = 0
  for (const record of game.achievements ?? []) {
    const key = record.api.toLowerCase()
    const launcherTime = record.unlockedAt ? Math.floor(record.unlockedAt / 1000) : 0
    if (!record.unlockedAt) {
      // locked in the launcher: keep only an existing emulator entry, never force-lock
      if (!merged[key]) merged[key] = { earned: false, earnedTime: 0 }
      continue
    }
    const prev = merged[key]
    if (prev && prev.earned && prev.earnedTime >= launcherTime) continue
    merged[key] = {
      earned: true,
      earnedTime: Math.max(launcherTime, prev?.earnedTime ?? 0)
    }
    exported++
  }

  await mkdir(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(merged, null, 2), 'utf-8')
  return { exported, file }
}

export function registerGbeSetupIpc(): void {
  ipcMain.handle('gbe:setup', async (_event, gameId: string) => {
    const report = await setupAchievements(gameId)
    // import any unlocks the emulator has already written
    syncNowSilently()
    return report
  })

  ipcMain.handle('gbe:exportUnlocks', async (_event, gameId: string) => {
    const result = await exportUnlocks(gameId)
    return result
  })
}
