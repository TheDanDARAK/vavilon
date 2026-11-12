import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { getGames } from '../library'
import { loadSettings } from './saveSettings'

/**
 * Thin wrapper around the ludusavi CLI (MIT licensed, bundled as a separate binary).
 *
 * Ludusavi knows where every game stores its saves (19 000+ titles) and can:
 *  - `find --steam-id <appid>` — resolve the canonical game name ludusavi uses
 *  - `backup <name> --path <dir>` — save current saves into the backup folder
 *  - `restore <name> --path <dir>` — put cloud saves back into place
 *  - `wrap --name <name> -- exe args` — restore before launch + backup after exit
 *
 * All output is JSON via --api. The launcher keeps its own ludusavi config
 * folder so it never touches a user's separate ludusavi installation.
 */

export interface LudusaviBackupResult {
  ok: boolean
  processed: number
  failed: boolean
  raw?: unknown
}

const canonicalNameCache = new Map<number, string | null>()

function runCli(
  args: string[],
  timeoutMs = 10 * 60_000
): Promise<{ code: number; stdout: string; stderr: string }> {
  const settings = loadSettings()
  const exe = settings.saves.ludusaviPath
  if (!exe || !existsSync(exe)) {
    return Promise.reject(new Error('ludusavi.exe не найден — укажи путь в настройках сохранений'))
  }
  const fullArgs = ['--config', configDir(), ...args]
  return new Promise((resolve, reject) => {
    const child = spawn(exe, fullArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

function configDir(): string {
  // isolated config so the launcher never touches a shared ludusavi install
  return process.env.APPDATA
    ? `${process.env.APPDATA}\\my-launcher\\ludusavi-config`
    : 'ludusavi-config'
}

/** Resolves the canonical ludusavi game name by Steam AppID (cached). */
export async function findNameByAppId(appId: number): Promise<string | null> {
  if (canonicalNameCache.has(appId)) return canonicalNameCache.get(appId) ?? null
  try {
    const { code, stdout } = await runCli(['find', '--steam-id', String(appId), '--api'])
    if (code !== 0 || !stdout.trim()) {
      canonicalNameCache.set(appId, null)
      return null
    }
    const data = JSON.parse(stdout) as { games?: Record<string, unknown> }
    const names = Object.keys(data.games ?? {})
    const name = names.length > 0 ? names[0] : null
    canonicalNameCache.set(appId, name)
    return name
  } catch {
    canonicalNameCache.set(appId, null)
    return null
  }
}

export function clearNameCache(): void {
  canonicalNameCache.clear()
}

interface BackupApiOutput {
  overall?: { processedGames?: number }
  errors?: { someGamesFailed?: boolean }
}

/** Backs up one game (by ludusavi name) into the configured backup folder. */
export async function backupGame(gameName: string): Promise<LudusaviBackupResult> {
  const settings = loadSettings()
  const args = ['backup', gameName, '--force', '--no-cloud-sync', '--api']
  if (settings.saves.backupPath) args.push('--path', settings.saves.backupPath)
  const { code, stdout } = await runCli(args)
  let data: BackupApiOutput = {}
  try {
    data = JSON.parse(stdout) as BackupApiOutput
  } catch {
    // non-JSON output means a CLI-level error
  }
  return {
    ok: code === 0 && !data.errors?.someGamesFailed,
    processed: data.overall?.processedGames ?? 0,
    failed: code !== 0 || data.errors?.someGamesFailed === true,
    raw: data
  }
}

/** Restores one game from the backup folder. */
export async function restoreGame(gameName: string): Promise<LudusaviBackupResult> {
  const settings = loadSettings()
  const args = ['restore', gameName, '--force', '--no-cloud-sync', '--api']
  if (settings.saves.backupPath) args.push('--path', settings.saves.backupPath)
  const { code, stdout } = await runCli(args)
  let data: BackupApiOutput = {}
  try {
    data = JSON.parse(stdout) as BackupApiOutput
  } catch {
    // ignore
  }
  return {
    ok: code === 0 && !data.errors?.someGamesFailed,
    processed: data.overall?.processedGames ?? 0,
    failed: code !== 0 || data.errors?.someGamesFailed === true,
    raw: data
  }
}

/**
 * Launch command list for a game run through ludusavi wrap:
 * restore happens before the game starts, backup right after it exits.
 * Returns null when saves are disabled or the game is unknown to ludusavi.
 */
export async function buildWrapCommand(
  gameId: string
): Promise<{ exe: string; args: string[] } | null> {
  const settings = loadSettings()
  if (!settings.saves.enabled || !settings.saves.backupPath) return null

  const game = getGames().find((g) => g.id === gameId)
  if (!game) return null

  const exeName = settings.saves.ludusaviPath
  if (!exeName || !existsSync(exeName)) return null

  let gameName: string | null = null
  if (game.appId) gameName = await findNameByAppId(game.appId)
  if (!gameName) {
    try {
      const { code, stdout } = await runCli(['find', game.name, '--api'])
      if (code === 0 && stdout.trim()) {
        const data = JSON.parse(stdout) as { games?: Record<string, unknown> }
        const names = Object.keys(data.games ?? {})
        if (names.length > 0) gameName = names[0]
      }
    } catch {
      // not found
    }
  }
  if (!gameName) return null

  const args = [
    'wrap',
    '--name',
    gameName,
    '--path',
    settings.saves.backupPath,
    '--force',
    '--no-cloud-sync',
    '--',
    game.exePath,
    ...(game.args ?? [])
  ]
  return { exe: exeName, args }
}
