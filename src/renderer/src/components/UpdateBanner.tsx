import { useEffect, useState } from 'react'
import type { UpdaterState } from '../../../shared/types'

/**
 * Floating notification for over-the-air updates. Appears as soon as a newer
 * release is found, shows download progress, and offers a one-click install —
 * the user never has to leave the launcher.
 */
export function UpdateBanner(): React.JSX.Element | null {
  const [state, setState] = useState<UpdaterState | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    void window.api.getUpdaterState().then(setState)
    return window.api.onUpdaterState((next) => {
      setState(next)
      // a fresh update state should always resurface the banner
      if (next.phase !== 'idle' && next.phase !== 'not-available') setHidden(false)
    })
  }, [])

  if (!state || hidden) return null
  const { phase } = state
  if (phase === 'idle' || phase === 'checking' || phase === 'not-available' || phase === 'error') {
    return null
  }

  return (
    <div className={`update-banner phase-${phase}`}>
      {phase === 'available' && (
        <>
          <span className="update-text">⬇ Доступно обновление {state.latest}</span>
          <button className="btn btn-primary" onClick={() => void window.api.downloadUpdate()}>
            Скачать
          </button>
        </>
      )}
      {phase === 'downloading' && (
        <>
          <span className="update-text">
            Загрузка обновления {state.latest} — {state.percent ?? 0}%
          </span>
          <div className="update-bar">
            <div className="update-bar-fill" style={{ width: `${state.percent ?? 0}%` }} />
          </div>
        </>
      )}
      {phase === 'downloaded' && (
        <>
          <span className="update-text">
            Обновление {state.latest} готово{state.portable ? ' (portable: откроется установщик)' : ''}
          </span>
          <button className="btn btn-primary" onClick={() => void window.api.installUpdate()}>
            Установить и перезапустить
          </button>
        </>
      )}
      <button className="icon-btn update-close" title="Скрыть" onClick={() => setHidden(true)}>
        ✕
      </button>
    </div>
  )
}
