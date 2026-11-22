import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { readdir, stat, mkdir, copyFile, rename, writeFile, rm } from 'fs/promises'
import { join, dirname, basename } from 'path'
import { app, dialog, ipcMain, net } from 'electron'
import SevenZip from '7z-wasm'
import { getGames, updateGame } from '../library'
import { installSchema, type SchemaInstallResult } from './steamSchema'
import { syncNowSilently, invalidateSchemaCache } from './watcher'
import { saveRoots, saveFilesForAppId, type RuntimeAchEntry } from './emuSaves'
import { resolveAndCacheCover } from '../covers'
import { addDefenderExclusion, emulatorExclusionPaths } from './defender'

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
  interfaces?: { generated: boolean; source?: string }
  warnings: string[]
}

const USER_AGENT = 'vavilon/0.2 (+personal use)'

/** Finds every steam_api(64).dll near the game exe (root + one level of subfolders). */
async function findSteamApiDlls(gameDir: string): Promise<string[]> {
  const names = ['steam_api64.dll', 'steam_api.dll']
  const out: string[] = []
  const dirs = [gameDir]
  try {
    for (const entry of await readdir(gameDir, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(join(gameDir, entry.name))
    }
  } catch {
    // ignore
  }
  for (const dir of dirs) {
    for (const name of names) {
      const p = join(dir, name)
      if (existsSync(p)) out.push(p)
    }
  }
  return out
}

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

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Valve DLLs a repack (or a previous setup) left renamed in the game folder,
 * e.g. steam_api.dll.license — real Steamworks binaries under a non-dll name.
 * They are restore sources and the source for steam_interfaces.txt generation.
 */
async function findRenamedOriginals(gameDir: string): Promise<string[]> {
  const out: string[] = []
  const dirs = [gameDir]
  try {
    for (const entry of await readdir(gameDir, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(join(gameDir, entry.name))
    }
  } catch {
    // ignore
  }
  for (const dir of dirs) {
    try {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue
        // steam_api(64).dll.<anything> — .license, .valve.bak, .bak, ...
        if (!/^steam_api(64)?\.dll\./i.test(entry.name)) continue
        const full = join(dir, entry.name)
        // a real PE and not an emulator: a packed-aside original
        if (peMachine(full) && !looksLikeEmulator(full)) out.push(full)
      }
    } catch {
      // ignore
    }
  }
  return out
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
  const res = await net.fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15000)
  })
  if (!res.ok) throw new Error(`GitHub вернул ${res.status}`)
  return res.json()
}

interface ReleaseAsset {
  name: string
  browser_download_url: string
  /** "sha256:<hex>" — published by GitHub for release assets */
  digest?: string
}

interface GbeRelease {
  url: string
  tag: string
  sha256?: string
}

/** Finds the gbe_fork Windows release to use (nothing is downloaded here). */
async function findGbeRelease(): Promise<GbeRelease> {
  const cacheDir = join(app.getPath('userData'), 'cache', 'gbe')

  // legacy cleanup: the old flow cached the archive (and even a 7zr.exe)
  // on disk — real-time antivirus kills such files mid-setup, and the new
  // in-memory flow never puts the archive on disk at all
  try {
    if (existsSync(cacheDir)) {
      for (const entry of await readdir(cacheDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue
        if (entry.name === '7zr.exe' || entry.name.endsWith('.7z')) {
          await rm(join(cacheDir, entry.name)).catch(() => {})
        }
      }
    }
  } catch {
    // ignore
  }

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
    return {
      url: asset.browser_download_url,
      tag: release.tag_name,
      sha256: asset.digest?.replace(/^sha256:/, '')
    }
  }
  throw new Error('В релизах gbe_fork нет Windows-сборки')
}

/**
 * Downloads the release archive into memory and unpacks it into outDir.
 * The archive never touches the disk: real-time antivirus was observed
 * deleting the Goldberg archive between write and read, so the wasm
 * extractor receives the bytes straight from RAM.
 */
async function downloadAndExtractGbe(rel: GbeRelease, outDir: string): Promise<void> {
  const res = await net.fetch(rel.url, {
    headers: { 'User-Agent': USER_AGENT },
    // release archives are tens of MB — allow more time than the JSON calls
    signal: AbortSignal.timeout(120000)
  })
  if (!res.ok) throw new Error(`Скачивание вернуло ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  // GitHub publishes sha256 digests for release assets — verify before unpacking
  if (rel.sha256) {
    const actual = createHash('sha256').update(buf).digest('hex')
    if (actual !== rel.sha256) {
      throw new Error('Контрольная сумма скачанного архива не совпала — файл повреждён')
    }
  }

  await mkdir(outDir, { recursive: true })
  const sevenZip = await SevenZip({ print: () => {}, printErr: () => {} })
  const stream = sevenZip.FS.open('/gbe.7z', 'w+')
  sevenZip.FS.write(stream, buf, 0, buf.length)
  sevenZip.FS.close(stream)

  const mntOut = '/out'
  sevenZip.FS.mkdir(mntOut)
  sevenZip.FS.mount(sevenZip.NODEFS, { root: outDir }, mntOut)

  try {
    // cherry-pick: extract ONLY the steam_api DLLs. The archive also carries
    // helper exes (lobby_connect, steamclient_loader) that Windows Defender
    // quarantines on sight — the launcher never uses them, so they are never
    // written to disk at all
    sevenZip.callMain([
      'x',
      '/gbe.7z',
      `-o${mntOut}`,
      '-ir!steam_api.dll',
      '-ir!steam_api64.dll',
      '-y'
    ])
  } catch (err) {
    // some emscripten builds signal completion by throwing ExitStatus
    if (err && typeof err === 'object' && 'status' in err) {
      const status = (err as { status?: number }).status
      if (typeof status === 'number' && status !== 0) {
        throw new Error(`7z вернул код ${status}`)
      }
    } else {
      throw err
    }
  }
  try {
    sevenZip.FS.unmount(mntOut)
  } catch {
    // ignore
  }
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

/** Directory where user-imported emulator DLLs are kept. */
function customDllDir(): string {
  return join(app.getPath('userData'), 'cache', 'gbe', 'custom')
}

/** Copies an emulator DLL into the game folder and verifies it survived the antivirus. */
async function copyDllIntoGame(source: string, dllName: string, gameDir: string): Promise<string> {
  const target = join(gameDir, dllName)
  await mkdir(dirname(target), { recursive: true })
  await copyFile(source, target)
  // real-time antivirus (Windows Defender included) quarantines Goldberg DLLs
  // seconds after they are written — give it a moment, then verify
  await delay(2500)
  if (!existsSync(target)) {
    throw new Error(
      `${dllName} пропал из папки игры сразу после установки — антивирус его удалил (ложное срабатывание на эмулятор). Добавьте папку игры в исключения антивируса (или восстановите файл из карантина) и повторите настройку`
    )
  }
  return target
}

/**
 * Locates the wanted steam_api DLL in an extracted release tree.
 * Direct release/regular/<arch> paths win; a scored recursive search covers
 * future archive reshuffles — debug and experimental builds are penalised
 * (they are multi-tens-of-MB debug builds, not what a game should load).
 */
async function findDllInTree(extractDir: string, dllName: string): Promise<string | null> {
  const archDirs = dllName.toLowerCase() === 'steam_api64.dll' ? ['x64', 'x86', 'x32'] : ['x86', 'x32', 'x64']
  for (const archDir of archDirs) {
    const direct = join(extractDir, 'release', 'regular', archDir, dllName)
    if (existsSync(direct)) return direct
  }

  const target = dllName.toLowerCase()
  let best: string | null = null
  let bestScore = -Infinity
  try {
    for (const entry of await readdir(extractDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const sub = await findFileRecursive(join(extractDir, entry.name), dllName)
      if (!sub) continue
      const lower = sub.toLowerCase()
      let score = 0
      if (lower.includes('regular')) score += 2
      if (archDirs.some((d) => lower.includes(`\\${d}\\`) || lower.includes(`/${d}/`))) score += 1
      if (lower.includes('debug')) score -= 3
      if (lower.includes('experimental')) score -= 1
      if (score > bestScore) {
        bestScore = score
        best = sub
      }
    }
  } catch {
    // ignore
  }
  return best
}

/** Byte-for-byte file comparison (size first, then contents). */
function sameFileBytes(a: string, b: string): boolean {
  try {
    if (statSync(a).size !== statSync(b).size) return false
    return readFileSync(a).equals(readFileSync(b))
  } catch {
    return false
  }
}

/**
 * The emulator DLL build currently cached on disk (no downloads): the custom
 * import when present, otherwise the newest extracted release. Used to decide
 * whether an already-installed emulator DLL is the build we would install.
 */
async function cachedDllPath(arch: 32 | 64): Promise<string | null> {
  const dllName = arch === 64 ? 'steam_api64.dll' : 'steam_api.dll'
  const custom = join(customDllDir(), dllName)
  if (existsSync(custom)) return custom
  const cacheDir = join(app.getPath('userData'), 'cache', 'gbe', 'extracted')
  try {
    for (const entry of await readdir(cacheDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const hit = await findDllInTree(join(cacheDir, entry.name), dllName)
      if (hit) return hit
    }
  } catch {
    // ignore
  }
  return null
}

/**
 * Installs an emulator DLL of the requested architecture.
 * A user-imported DLL (cache/gbe/custom) always wins over the downloaded
 * gbe_fork build — importing own files means nothing is downloaded at all.
 */
async function installDll(arch: 32 | 64, gameDir: string): Promise<string> {
  const dllName = arch === 64 ? 'steam_api64.dll' : 'steam_api.dll'

  const custom = join(customDllDir(), dllName)
  if (existsSync(custom)) {
    return copyDllIntoGame(custom, dllName, gameDir)
  }

  const rel = await findGbeRelease()
  // per-release extraction cache: the archive is unpacked only once
  const extractDir = join(app.getPath('userData'), 'cache', 'gbe', 'extracted', rel.tag)

  let source = await findDllInTree(extractDir, dllName)
  if (!source) {
    // stale extraction (possibly with quarantined helper exes) — start clean
    await rm(join(app.getPath('userData'), 'cache', 'gbe', 'extracted'), {
      recursive: true,
      force: true
    }).catch(() => {})
    await downloadAndExtractGbe(rel, extractDir)
    source = await findDllInTree(extractDir, dllName)
  }
  if (!source) throw new Error(`В архиве gbe_fork не найден ${dllName}`)

  return copyDllIntoGame(source, dllName, gameDir)
}

/**
 * Imports the user's own steam_api(64).dll (e.g. from their own emulator
 * distribution) instead of the downloaded gbe_fork build. The file is
 * validated before it is ever installed: real PE, matching architecture,
 * Goldberg-family signature.
 */
export async function importCustomDll(): Promise<{ name: string; arch: 32 | 64 } | null> {
  const result = await dialog.showOpenDialog({
    title: 'Выберите свой steam_api(64).dll',
    filters: [{ name: 'Steam API DLL', extensions: ['dll'] }],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const file = result.filePaths[0]
  const name = basename(file).toLowerCase()
  if (name !== 'steam_api.dll' && name !== 'steam_api64.dll') {
    throw new Error('Файл должен называться steam_api.dll (x86) или steam_api64.dll (x64)')
  }
  const wantArch: 32 | 64 = name === 'steam_api64.dll' ? 64 : 32
  const machine = peMachine(file)
  if (machine !== wantArch) {
    throw new Error(
      `Архитектура файла (${machine === 64 ? 'x64' : 'x86'}) не совпадает с именем (${wantArch === 64 ? 'x64' : 'x86'})`
    )
  }
  if (!looksLikeEmulator(file)) {
    throw new Error('Это не Steam-эмулятор (Goldberg/GBE) — такой файл устанавливать нельзя')
  }

  await mkdir(customDllDir(), { recursive: true })
  await copyFile(file, join(customDllDir(), name))
  return { name, arch: wantArch }
}

/** Removes the imported custom DLL — setups fall back to the downloaded build. */
export async function clearCustomDll(): Promise<boolean> {
  try {
    await rm(customDllDir(), { recursive: true })
    return true
  } catch {
    return false
  }
}

/**
 * Writes steam_settings/steam_interfaces.txt the way Achievement Watcher Next
 * does: the Steamworks interface versions the game's ORIGINAL DLL was built
 * against, scanned straight out of its bytes. gbe_fork falls back to default
 * interface versions without it, which breaks tracking in a number of games.
 * No helper exe is spawned — the names are found in the PE data directly.
 */
async function writeInterfacesFile(
  gameDir: string
): Promise<{ generated: boolean; source?: string }> {
  const settingsDir = join(gameDir, 'steam_settings')
  const dest = join(settingsDir, 'steam_interfaces.txt')
  if (existsSync(dest)) return { generated: false }

  for (const p of await findRenamedOriginals(gameDir)) {
    let text: string
    try {
      text = readFileSync(p).toString('latin1')
    } catch {
      continue
    }
    const found = new Set<string>()
    for (const m of text.matchAll(/\bSteam[A-Za-z]+?\d{3}\b/g)) found.add(m[0])
    if (found.size === 0) continue
    await mkdir(settingsDir, { recursive: true })
    await writeFile(dest, [...found].sort().join('\n') + '\n', 'utf-8')
    return { generated: true, source: p }
  }
  return { generated: false }
}

/**
 * Safe part of the setup: steam_appid.txt, achievement schema and cover.
 * Writes only configuration files — never touches any DLL in the game folder,
 * so nothing here can trip an antivirus.
 *
 * A missing achievement schema (old games without achievements) is NOT an
 * error: the schema step is skipped, but the cover is still resolved through
 * the full provider chain (Steam → SteamGridDB → RAWG), so old titles like
 * LEGO Batman 2 get their artwork too.
 */
export async function setupSchema(gameId: string): Promise<{
  schema: SchemaInstallResult | null
  cover: boolean
  coverSource?: string
  appidWritten: boolean
  schemaError?: string
  warnings: string[]
}> {
  const game = getGames().find((g) => g.id === gameId)
  if (!game) throw new Error('Игра не найдена')
  const gameDir = game.workDir ?? dirname(game.exePath)
  const warnings: string[] = []

  // 1. steam_appid.txt — plain text files the emulator reads; only when we know the AppID
  let appidWritten = false
  if (game.appId) {
    const settingsDir = join(gameDir, 'steam_settings')
    await mkdir(settingsDir, { recursive: true })
    const appidInSettings = join(settingsDir, 'steam_appid.txt')
    if (!existsSync(appidInSettings)) {
      await writeFile(appidInSettings, String(game.appId), 'utf-8')
      appidWritten = true
    }
    const appidInRoot = join(gameDir, 'steam_appid.txt')
    if (!existsSync(appidInRoot)) {
      await writeFile(appidInRoot, String(game.appId), 'utf-8')
      appidWritten = true
    }
  }

  // 2. Schema — requires an AppID; a failure (no achievements on Steam) is not fatal
  let schema: SchemaInstallResult | null = null
  let schemaError: string | undefined
  if (game.appId) {
    try {
      schema = await installSchema(gameDir, game.appId)
    } catch (e) {
      schemaError = e instanceof Error ? e.message : String(e)
      warnings.push(
        'Схема достижений недоступна (у игры может не быть достижений в Steam) — обложка всё равно загружена'
      )
    }
  } else {
    schemaError = 'У игры не указан Steam AppID — схема достижений недоступна'
  }

  // 3. Cover through the full provider chain (works with or without an AppID)
  const coverResult = await resolveAndCacheCover(game, false)

  return {
    schema,
    cover: coverResult.ok,
    coverSource: coverResult.source,
    appidWritten,
    schemaError,
    warnings
  }
}

/**
 * Full emulator repair, mirroring Achievement Watcher Next's "Apply emulator fix":
 * the ONLY operation that replaces a game DLL. Backs up the original first and
 * restores it when the replacement fails. Explicitly confirmed in the UI because
 * antivirus products routinely false-positive on Goldberg-family DLLs.
 */
export async function installEmulator(gameId: string): Promise<SetupReport> {
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
      // already an emulator: keep it only when it IS the build we would install
      // (an older, foreign or experimental copy gets upgraded to the cached one)
      const wanted = await cachedDllPath(machine ?? 64)
      if (wanted && sameFileBytes(existing, wanted)) {
        report.dll = 'kept-emulator'
        report.dllPath = existing
      } else {
        report.dllPath = await installDll(machine ?? 64, gameDir)
        report.dll = 'replaced'
        warnings.push('обновлён эмуляторный DLL — стояла другая или устаревшая сборка')
      }
    } else {
      // real Valve Steamworks DLL — back it up and replace it
      const backup = existing + '.valve.bak'
      if (!existsSync(backup)) await rename(existing, backup)
      try {
        report.dllPath = await installDll(machine ?? 64, gameDir)
        report.dll = 'replaced'
      } catch (e) {
        // restore the original so the game stays playable
        await copyFile(backup, existing)
        throw new Error(
          `Не удалось заменить DLL: ${String(e)}. Если антивирус ругался — это ложное срабатывание на эмулятор (Goldberg): добавьте папку игры в исключения и повторите настройку`
        )
      }
    }
  } else {
    // no DLL at all: install only the architecture the game exe actually loads —
    // writing both is just double antivirus bait (AW Next seeds one arch too)
    const exeArch = peMachine(game.exePath)
    if (exeArch) {
      await installDll(exeArch, gameDir)
      warnings.push(
        `DLL отсутствовала — установлен ${exeArch === 64 ? 'steam_api64.dll (x64)' : 'steam_api.dll (x86)'} под архитектуру игры`
      )
    } else {
      warnings.push(
        'steam_api DLL не найдена и архитектура exe неизвестна — установлены обе архитектуры (x86 и x64)'
      )
      await installDll(32, gameDir)
      await installDll(64, gameDir)
    }
    report.dll = 'installed'
  }

  // 2. steam_appid.txt + schema + cover (configuration only)
  const schemaReport = await setupSchema(gameId)
  report.schema = schemaReport.schema
  report.cover = schemaReport.cover
  report.appidWritten = schemaReport.appidWritten

  // 3. steam_interfaces.txt from the original Valve DLL (byte scan, no exe spawned)
  report.interfaces = await writeInterfacesFile(gameDir)

  // final check: real-time antivirus may have quarantined the DLLs we just wrote
  await delay(1500)
  for (const p of await findSteamApiDlls(gameDir)) {
    if (!existsSync(p)) {
      throw new Error(
        `${basename(p)} исчез из папки игры после установки — антивирус его удалил (ложное срабатывание на эмулятор). Добавьте папку игры в исключения антивируса или восстановите файл из карантина, затем повторите установку`
      )
    }
  }

  return report
}

export interface DiagReport {
  gameId: string
  appId?: number
  dll: { path: string; isEmulator: boolean; backup: boolean } | null
  appidTxt: boolean
  schema: { total: number; icons: number } | null
  interfaces: boolean
  /** renamed Valve originals found in the game folder (steam_api.dll.license etc.) */
  originalCandidates: string[]
  /** runtime save files found for this game's appId */
  runtimeSaves: number
  cover: boolean
  customDll: string | null
}

/** Read-only state report for the emulator dialog (never modifies anything). */
export async function diagnoseEmulator(gameId: string): Promise<DiagReport> {
  const game = getGames().find((g) => g.id === gameId)
  if (!game) throw new Error('Игра не найдена')
  const gameDir = game.workDir ?? dirname(game.exePath)
  const settingsDir = join(gameDir, 'steam_settings')

  const report: DiagReport = {
    gameId,
    appId: game.appId,
    dll: null,
    appidTxt:
      existsSync(join(gameDir, 'steam_appid.txt')) || existsSync(join(settingsDir, 'steam_appid.txt')),
    schema: null,
    interfaces: existsSync(join(settingsDir, 'steam_interfaces.txt')),
    originalCandidates: [],
    runtimeSaves: 0,
    cover: !!(game.coverPath && existsSync(game.coverPath)),
    customDll: null
  }
  report.originalCandidates = (await findRenamedOriginals(gameDir)).map((p) => basename(p))

  const dll = await findSteamApiDll(gameDir)
  if (dll) {
    report.dll = {
      path: dll,
      isEmulator: looksLikeEmulator(dll),
      backup: existsSync(dll + '.valve.bak')
    }
  }

  try {
    const raw = JSON.parse(readFileSync(join(settingsDir, 'achievements.json'), 'utf-8')) as unknown[]
    if (Array.isArray(raw)) {
      let icons = 0
      try {
        icons = (await readdir(join(settingsDir, 'achievement_images'))).length
      } catch {
        // no images dir
      }
      report.schema = { total: raw.length, icons }
    }
  } catch {
    // no schema file
  }

  if (game.appId) report.runtimeSaves = saveFilesForAppId(game.appId).length

  for (const dllName of ['steam_api64.dll', 'steam_api.dll']) {
    const p = join(customDllDir(), dllName)
    if (existsSync(p)) {
      report.customDll = p
      break
    }
  }
  return report
}

/**
 * Rolls back everything the one-click setup did for a game:
 *  - restores the original Valve DLL from the .valve.bak backup
 *  - deletes emulator DLLs that were installed from scratch (no backup exists)
 *  - removes steam_appid.txt (only the ones we wrote), the generated schema
 *    and its downloaded icon images
 * The permanent unlock history in the library is kept on purpose.
 */
export async function restoreSteamEmulation(
  gameId: string
): Promise<{ restored: string[]; removed: string[]; warnings: string[] }> {
  const game = getGames().find((g) => g.id === gameId)
  if (!game) throw new Error('Игра не найдена')
  const gameDir = game.workDir ?? dirname(game.exePath)

  const restored: string[] = []
  const removed: string[] = []
  const warnings: string[] = []

  // 1. DLLs (root + one level deep, same places the setup looks in)
  for (const dll of await findSteamApiDlls(gameDir)) {
    const backup = dll + '.valve.bak'
    if (!looksLikeEmulator(dll)) {
      if (!existsSync(backup)) warnings.push(`${dll} — это не эмулятор, оставил как есть`)
      continue
    }
    if (existsSync(backup)) {
      await rename(backup, dll)
      restored.push(dll)
    } else {
      // installed from scratch — no original to restore. Park the file next to
      // the game instead of destroying it: recoverable, and a second rollback
      // or an antivirus quarantine never loses the user's emulator build
      const parked = dll + '.emu-removed.bak'
      if (existsSync(parked)) await rm(parked).catch(() => {})
      try {
        await rename(dll, parked)
        removed.push(`${dll} (перемещён в ${basename(parked)})`)
      } catch {
        await rm(dll)
        removed.push(dll)
      }
    }
  }

  // 2. steam_appid.txt — only the files whose content is this game's appid
  const appidText = String(game.appId)
  for (const p of [join(gameDir, 'steam_appid.txt'), join(gameDir, 'steam_settings', 'steam_appid.txt')]) {
    if (!existsSync(p)) continue
    try {
      if (readFileSync(p, 'utf-8').trim() === appidText) {
        await rm(p)
        removed.push(p)
      }
    } catch {
      // unreadable — leave it alone
    }
  }

  // 3. generated schema + icons + interfaces file; drop steam_settings if it becomes empty
  const settingsDir = join(gameDir, 'steam_settings')
  const achJson = join(settingsDir, 'achievements.json')
  if (existsSync(achJson)) {
    await rm(achJson)
    removed.push(achJson)
  }
  const interfacesTxt = join(settingsDir, 'steam_interfaces.txt')
  if (existsSync(interfacesTxt)) {
    // only remove the one we generate — a hand-made file is left alone
    try {
      const text = readFileSync(interfacesTxt, 'utf-8')
      const lines = text.split(/\r?\n/).filter(Boolean)
      if (lines.length > 0 && lines.every((l) => /^Steam[A-Za-z]+\d{3}$/.test(l))) {
        await rm(interfacesTxt)
        removed.push(interfacesTxt)
      }
    } catch {
      // unreadable — leave it alone
    }
  }
  const imagesDir = join(settingsDir, 'achievement_images')
  if (existsSync(imagesDir)) {
    await rm(imagesDir, { recursive: true })
    removed.push(imagesDir)
  }
  if (existsSync(settingsDir)) {
    try {
      if ((await readdir(settingsDir)).length === 0) {
        await rm(settingsDir)
        removed.push(settingsDir)
      }
    } catch {
      // ignore
    }
  }

  return { restored, removed, warnings }
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
export async function exportUnlocks(
  gameId: string
): Promise<{ exported: number; file: string; files: string[] }> {
  const game = getGames().find((g) => g.id === gameId)
  if (!game) throw new Error('Игра не найдена')
  if (!game.appId) throw new Error('У игры не указан Steam AppID')

  const roots = saveRoots()
  const appDir = String(game.appId)
  // the primary root (GSE Saves) always gets the file; other known roots
  // (classic Goldberg) get it too when they already exist on disk, so the
  // game sees the progress no matter which fork it runs on
  const targets = [join(roots[0], appDir, 'achievements.json')]
  for (const root of roots.slice(1)) {
    if (existsSync(root)) targets.push(join(root, appDir, 'achievements.json'))
  }

  // existing runtime state across all targets, so we don't lose emulator-side data
  const merged: Record<string, RuntimeAchEntry> = {}
  for (const file of targets) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>
      for (const [key, value] of Object.entries(raw)) {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
        const rec = value as Record<string, unknown>
        const entry: RuntimeAchEntry = {
          earned: rec.earned === true,
          earnedTime: typeof rec.earned_time === 'number' ? rec.earned_time : 0
        }
        const prev = merged[key.toLowerCase()]
        if (!prev || entry.earnedTime > prev.earnedTime) merged[key.toLowerCase()] = entry
      }
    } catch {
      // no existing file or invalid JSON — start fresh
    }
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

  for (const file of targets) {
    await mkdir(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(merged, null, 2), 'utf-8')
  }
  return { exported, file: targets[0], files: targets }
}

/**
 * AW Next's "Reset achievements": the counter lives in the launcher library
 * (permanent history), so deleting runtime folders by hand can never reset it.
 * This clears unlockedAt for every record AND removes the emulator runtime
 * files, otherwise the next poll would re-import the old unlocks right back.
 */
export async function resetAchievements(
  gameId: string
): Promise<{ cleared: number; files: string[] }> {
  const game = getGames().find((g) => g.id === gameId)
  if (!game) throw new Error('Игра не найдена')
  const records = game.achievements ?? []
  const cleared = records.filter((r) => r.unlockedAt).length

  updateGame(game.id, {
    achievements: records.map((r) => ({
      ...r,
      unlockedAt: undefined,
      progress: undefined,
      maxProgress: undefined
    }))
  })

  const files: string[] = []
  if (game.appId) {
    for (const root of saveRoots()) {
      for (const name of ['achievements.json', 'achievements.ini']) {
        const p = join(root, String(game.appId), name)
        if (existsSync(p)) {
          try {
            await rm(p)
            files.push(p)
          } catch {
            // locked by a running game — leave it, the library is cleared anyway
          }
        }
      }
    }
  }
  return { cleared, files }
}

export function registerGbeSetupIpc(): void {
  ipcMain.handle('gbe:diagnose', async (_event, gameId: string) => {
    return diagnoseEmulator(gameId)
  })

  // safe: configuration files only, no DLL is ever touched
  ipcMain.handle('gbe:schema', async (_event, gameId: string) => {
    const result = await setupSchema(gameId)
    invalidateSchemaCache(gameId)
    return result
  })

  // full repair: replaces the game DLL (backup first) — explicit user action
  ipcMain.handle('gbe:install', async (_event, gameId: string) => {
    const report = await installEmulator(gameId)
    // the schema on disk just changed — make the watcher re-read it
    invalidateSchemaCache(gameId)
    // import any unlocks the emulator has already written
    syncNowSilently()
    return report
  })

  ipcMain.handle('gbe:pickCustomDll', async () => {
    return importCustomDll()
  })

  ipcMain.handle('gbe:clearCustomDll', async () => {
    return clearCustomDll()
  })

  ipcMain.handle('gbe:exportUnlocks', async (_event, gameId: string) => {
    const result = await exportUnlocks(gameId)
    return result
  })

  ipcMain.handle('gbe:restore', async (_event, gameId: string) => {
    const result = await restoreSteamEmulation(gameId)
    invalidateSchemaCache(gameId)
    return result
  })

  ipcMain.handle('gbe:resetAch', async (_event, gameId: string) => {
    return resetAchievements(gameId)
  })

  /**
   * Adds the emulator cache and the game folder to Windows Defender exclusions.
   * This is the honest fix for the Goldberg/GBE false positive (same approach
   * as Achievement Watcher Next) — the elevation prompt is the user's consent.
   */
  ipcMain.handle('gbe:addExclusion', async (_event, gameId: string) => {
    const game = getGames().find((g) => g.id === gameId)
    const gameDir = game ? game.workDir ?? dirname(game.exePath) : undefined
    return addDefenderExclusion(emulatorExclusionPaths(gameDir))
  })
}
