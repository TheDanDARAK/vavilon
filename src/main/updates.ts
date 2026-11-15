import { app, ipcMain, net, shell } from 'electron'
import type { UpdateInfo } from '../shared/types'
import { isNewerVersion } from '../shared/version'

/**
 * Lightweight update check through GitHub Releases. No auto-download: the
 * launcher only reports whether a newer tag exists and opens the release page.
 */

const REPO = 'TheDanDARAK/vavilon'
const RELEASE_RE = new RegExp(`^https://github\\.com/${REPO}/`, 'i')

export async function checkForUpdates(): Promise<UpdateInfo> {
  const current = app.getVersion()
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `vavilon/${current}`,
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) {
      return { current, updateAvailable: false, error: `GitHub вернул ${res.status}` }
    }
    const data = (await res.json()) as { tag_name?: string; html_url?: string }
    const latest = data.tag_name?.replace(/^v/i, '')
    if (!latest) {
      return { current, updateAvailable: false, error: 'GitHub не вернул номер версии' }
    }
    return {
      current,
      latest,
      url: data.html_url,
      updateAvailable: isNewerVersion(latest, current)
    }
  } catch (e) {
    return {
      current,
      updateAvailable: false,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

export function registerUpdatesIpc(): void {
  ipcMain.handle('updates:version', () => app.getVersion())
  ipcMain.handle('updates:check', () => checkForUpdates())
  ipcMain.handle('updates:open', async (_event, url: string) => {
    if (typeof url !== 'string' || !RELEASE_RE.test(url)) return false
    await shell.openExternal(url)
    return true
  })
}
