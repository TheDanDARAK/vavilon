import { useState } from 'react'
import { SettingsDialog } from './SettingsDialog'

/** Sidebar entry that opens the full settings dialog. */
export function GeneralSettingsSection(): React.JSX.Element {
  const [showSettings, setShowSettings] = useState(false)

  return (
    <div className="section">
      <div className="section-title">Настройки</div>
      <button className="chip" onClick={() => setShowSettings(true)}>
        ⚙ Все настройки
      </button>
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </div>
  )
}
