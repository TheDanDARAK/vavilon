import { useEffect } from 'react'
import type { AchievementUnlockEvent } from '../../../shared/types'
import { mediaUrl } from '../lib/media'

export function UnlockToast({
  event,
  onDone
}: {
  event: AchievementUnlockEvent
  onDone: () => void
}): React.JSX.Element {
  useEffect(() => {
    const timer = setTimeout(onDone, 6000)
    return () => clearTimeout(timer)
  }, [event, onDone])

  return (
    <div className="toast">
      {event.icon && <img className="toast-icon" src={mediaUrl(event.icon)} alt="" />}
      <div className="toast-text">
        <div className="toast-title">🏆 Достижение разблокировано</div>
        <div className="toast-name">{event.name}</div>
        <div className="toast-game">{event.gameName}</div>
      </div>
    </div>
  )
}
