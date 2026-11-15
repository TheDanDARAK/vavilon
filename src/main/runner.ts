import { ipcMain, BrowserWindow } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import { Game, getGames, updateGame } from './library'
import { buildWrapCommand } from './saves/ludusavi'

const running = new Map<string, { startedAt: number; child: ChildProcess; wrapped: boolean }>()

function isStillRunning(child: ChildProcess): boolean {
  return child.exitCode === null && !child.killed
}

/** Tells every window that a game started or stopped, so cards update live. */
function broadcastRunning(id: string, value: boolean): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('games:running', id, value)
  }
}

/**
 * Kills a game together with everything it spawned. `child.kill()` alone only
 * terminates the wrapper/launcher exe, while the actual game keeps running.
 */
function killProcessTree(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    })
    killer.on('error', () => child.kill())
    return
  }
  child.kill()
}

/**
 * Launches a game and tracks the session.
 * When cloud saves are enabled and ludusavi knows the game, the game is started
 * through `ludusavi wrap`: restore happens before launch, backup right after exit.
 * On process exit: playtime += session duration, lastPlayedAt updated,
 * and the renderer is notified so it can refresh.
 */
async function launchGame(id: string, getWindow: () => BrowserWindow | null): Promise<void> {
  if (running.has(id)) return
  const game = getGames().find((g) => g.id === id)
  if (!game) return

  // Try the ludusavi wrap launch (restore -> game -> backup)
  let target: { exe: string; args: string[] } = { exe: game.exePath, args: game.args ?? [] }
  let wrapped = false
  try {
    const wrap = await buildWrapCommand(id)
    if (wrap) {
      target = wrap
      wrapped = true
      getWindow()?.webContents.send('saves:status', {
        stage: 'launch',
        gameName: game.name,
        ok: true,
        message: 'восстановление сохранений перед запуском…'
      })
    }
  } catch {
    // fall back to a plain launch
  }

  const startedAt = Date.now()
  const child = spawn(target.exe, target.args, {
    cwd: game.workDir ?? undefined,
    detached: true,
    stdio: 'ignore'
  })
  child.unref()
  running.set(id, { startedAt, child, wrapped })
  broadcastRunning(id, true)

  // Some games spawn the real game and the launcher exe exits immediately.
  // We detect a quick exit and still record a minimal session.
  child.on('exit', () => {
    const entry = running.get(id)
    if (!entry || entry.child !== child) return
    running.delete(id)
    broadcastRunning(id, false)
    const playedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000))
    const current = getGames().find((g) => g.id === id)
    if (current) {
      updateGame(id, {
        playtimeSeconds: (current.playtimeSeconds ?? 0) + playedSeconds,
        lastPlayedAt: startedAt
      })
    }
    const win = getWindow()
    if (entry.wrapped) {
      // ludusavi wrap performs the post-exit backup before it terminates
      win?.webContents.send('saves:status', {
        stage: 'launch',
        gameName: game.name,
        ok: true,
        message: 'сохранения скопированы после выхода'
      })
    }
    win?.webContents.send('games:changed')
  })

  child.on('error', (err) => {
    // spawn itself failed (missing exe, access denied) — the process never ran,
    // so drop the tracking entry or the game would look "running" forever
    const entry = running.get(id)
    if (!entry || entry.child !== child) return
    running.delete(id)
    broadcastRunning(id, false)
    getWindow()?.webContents.send('saves:status', {
      stage: 'launch',
      gameName: game.name,
      ok: false,
      message: `не удалось запустить игру: ${err.message}`
    })
  })
}

export function registerRunnerIpc(ipc: typeof ipcMain, getWindow: () => BrowserWindow | null): void {
  ipc.handle('games:launch', async (event, id: string) => {
    await launchGame(id, getWindow)
    const win = BrowserWindow.fromWebContents(event.sender)
    // Minimize so the game takes over the screen
    win?.minimize()
    return true
  })

  ipc.handle('games:isRunning', (_event, id: string) => {
    const entry = running.get(id)
    return entry ? isStillRunning(entry.child) : false
  })

  ipc.handle('games:stop', (_event, id: string) => {
    const entry = running.get(id)
    if (entry && isStillRunning(entry.child)) {
      killProcessTree(entry.child)
    }
    return true
  })
}
