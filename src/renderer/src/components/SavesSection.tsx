import { useEffect, useState } from 'react'
import type { SavesSettings, SavesStatusPayload } from '../../../shared/types'
import { SaveStatusToast } from './SaveStatusToast'

export function SavesSection(): React.JSX.Element {
  const [settings, setSettings] = useState<SavesSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<SavesStatusPayload | null>(null)

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
      <button
        className="chip"
        disabled={busy || !settings.enabled || !settings.backupPath}
        onClick={async () => {
          setBusy(true)
          try {
            const result = await window.api.syncSavesNow()
            const msg = result.unknown.length
              ? ` (не распознаны: ${result.unknown.join(', ')})`
              : ''
            alert(
              `Синхронизация сохранений\n\nуспешно: ${result.processed}\nс ошибками: ${result.failed}${msg}`
            )
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
