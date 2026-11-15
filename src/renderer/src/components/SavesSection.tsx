import { useEffect, useState } from 'react'
import type { SavesSettings, SavesStatusPayload } from '../../../shared/types'
import { useFeedback } from '../lib/feedback'
import { errorText } from '../lib/errors'
import { SaveStatusToast } from './SaveStatusToast'

export function SavesSection(): React.JSX.Element {
  const [settings, setSettings] = useState<SavesSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<SavesStatusPayload | null>(null)
  const { show } = useFeedback()

  useEffect(() => {
    void window.api.getSavesSettings().then(setSettings)
    return window.api.onSaveStatus((payload) => setStatus(payload))
  }, [])

  const patch = async (part: Partial<SavesSettings>): Promise<void> => {
    const next = await window.api.setSavesSettings(part)
    setSettings(next)
  }

  if (!settings) return <div className="section" />

  return (
    <div className="section">
      <div className="section-title">Сохранения (облако)</div>
      <label className="switch-row">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => void patch({ enabled: e.target.checked })}
        />
        <span>Бэкапы ludusavi</span>
      </label>
      <button
        className="chip"
        title={settings.ludusaviPath || 'не найден'}
        onClick={async () => {
          const path = await window.api.pickLudusaviExe()
          if (path) await patch({ ludusaviPath: path })
        }}
      >
        ludusavi.exe: {settings.ludusaviPath ? 'найден ✓' : 'указать…'}
      </button>
      <button
        className="chip"
        title={settings.backupPath || 'не выбрана'}
        onClick={async () => {
          const path = await window.api.pickBackupDir()
          if (path) await patch({ backupPath: path })
        }}
      >
        Папка бэкапов: {settings.backupPath ? 'выбрана ✓' : 'выбрать…'}
      </button>
      <div className="path-line" title={settings.ludusaviPath || undefined}>
        {settings.ludusaviPath || 'ludusavi.exe не найден'}
      </div>
      <div className="path-line" title={settings.backupPath || undefined}>
        {settings.backupPath || 'папка бэкапов не выбрана'}
      </div>
      <button
        className="chip"
        disabled={busy || !settings.enabled || !settings.backupPath || !settings.ludusaviPath}
        onClick={async () => {
          setBusy(true)
          try {
            const result = await window.api.syncSavesNow()
            const msg = result.unknown.length
              ? `\nНе распознаны: ${result.unknown.join(', ')}`
              : ''
            await show({
              title: 'Синхронизация сохранений',
              message: `Успешно: ${result.processed}\nС ошибками: ${result.failed}${msg}`,
              tone: result.failed > 0 ? 'warning' : 'success'
            })
          } catch (e) {
            await show({
              title: 'Ошибка синхронизации',
              message: errorText(e),
              tone: 'error'
            })
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? 'Синхронизирую…' : 'Синхронизировать сейчас'}
      </button>
      {status && <SaveStatusToast event={status} onDone={() => setStatus(null)} />}
    </div>
  )
}
