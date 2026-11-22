import { spawn } from 'child_process'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { app } from 'electron'

/**
 * Windows Defender exclusions for the emulator.
 *
 * Steam emulators (Goldberg / GBE Fork) are heuristic false positives —
 * Defender names the archive `Trojan:Win32/Suschil!rfn` purely because it
 * impersonates the Steam client. Achievement Watcher Next's answer is not a
 * "safer" build (there is none — it downloads the very same Detanup01/gbe_fork
 * release); it is an explicit, user-confirmed Defender exclusion. This module
 * does the same: it whitelists the launcher's emulator cache and the game
 * folder through an elevated `Add-MpPreference -ExclusionPath`.
 *
 * Nothing runs without the user's consent — the elevation prompt is the consent.
 */

export interface ExclusionResult {
  ok: boolean
  message: string
  /** Paths that were added (as requested by the caller) */
  paths: string[]
}

/** The directories a Steam-emulation setup writes into. */
export function emulatorExclusionPaths(gameDir?: string): string[] {
  const paths = [join(app.getPath('userData'), 'cache', 'gbe')]
  if (gameDir) paths.push(gameDir)
  return [...new Set(paths)]
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Adds each path to the Defender exclusion list via an elevated PowerShell run.
 * Resolves with `ok:false` and a message when the user declines the UAC prompt
 * or Defender is unavailable.
 */
export function addDefenderExclusion(paths: string[]): Promise<ExclusionResult> {
  const unique = [...new Set(paths.filter((p) => typeof p === 'string' && p.trim()))]
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false, message: 'Исключения Защитника доступны только в Windows', paths: unique })
  }
  if (unique.length === 0) {
    return Promise.resolve({ ok: false, message: 'Нет папок для добавления', paths: unique })
  }

  const dir = join(tmpdir(), 'vavilon-defender')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // the temp dir already exists or is unwritable — the write below reports it
  }
  const inner = join(dir, 'add.ps1')
  const outer = join(dir, 'run.ps1')

  const adds = unique.map((p) => `Add-MpPreference -ExclusionPath ${psQuote(p)}`).join('\r\n')
  writeFileSync(inner, `$ErrorActionPreference = 'Stop'\r\n${adds}\r\n`, 'utf-8')
  writeFileSync(
    outer,
    [
      `$p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru ` +
        `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File', ${psQuote(inner)})`,
      'exit $p.ExitCode'
    ].join('\r\n'),
    'utf-8'
  )

  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', outer],
      { windowsHide: true }
    )
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) =>
      resolve({ ok: false, message: `Не удалось запустить PowerShell: ${err.message}`, paths: unique })
    )
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({
          ok: true,
          message: `Добавлено в исключения Защитника Windows: ${unique.length}`,
          paths: unique
        })
      } else {
        resolve({
          ok: false,
          message: stderr.trim() || 'Отклонено или Защитник недоступен (нужны права администратора)',
          paths: unique
        })
      }
    })
  })
}
