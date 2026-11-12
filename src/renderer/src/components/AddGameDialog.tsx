import { useState } from 'react'
import type { Game } from '../../../shared/types'

export function AddGameDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState('')
  const [exePath, setExePath] = useState('')
  const [appId, setAppId] = useState('')
  const [busy, setBusy] = useState(false)

  const pick = async (): Promise<void> => {
    const picked = await window.api.pickExe()
    if (picked) {
      setExePath(picked.exePath)
      if (!name) setName(picked.suggestedName)
    }
  }

  const save = async (): Promise<void> => {
    if (!exePath) return
    setBusy(true)
    const game: Partial<Game> & { exePath: string } = {
      name: name.trim() || undefined,
      exePath
    }
    const appIdNum = Number(appId)
    if (appId && Number.isInteger(appIdNum) && appIdNum > 0) game.appId = appIdNum
    const result = await window.api.addGame(game)
    if (result.duplicated) {
      alert(`«${result.game.name}» уже есть в библиотеке.`)
    }
    onClose()
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Добавить игру</h3>
        <button className="btn" onClick={() => void pick()}>
          {exePath ? 'Выбрать другой exe…' : 'Выбрать exe-файл…'}
        </button>
        {exePath && <div className="path">{exePath}</div>}
        <label className="field">
          Название
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название игры" />
        </label>
        <label className="field">
          Steam AppID (необязательно, для будущих достижений)
          <input
            value={appId}
            onChange={(e) => setAppId(e.target.value.replace(/\D/g, ''))}
            placeholder="например 1091500"
            inputMode="numeric"
          />
        </label>
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn btn-primary"
            disabled={!exePath || busy}
            onClick={() => void save()}
          >
            Добавить
          </button>
        </div>
      </div>
    </div>
  )
}
