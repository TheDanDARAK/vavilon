import { useEffect } from 'react'
import type { SavesStatusPayload } from '../../../shared/types'

export function SaveStatusToast({
  event,
  onDone
}: {
  event: SavesStatusPayload
  onDone: () => void
}): React.JSX.Element {
  useEffect(() => {
    const timer = setTimeout(onDone, 4000)
    return () => clearTimeout(timer)
  }, [event, onDone])

  return (
    <div className={event.ok ? 'save-toast' : 'save-toast save-toast-error'}>
      <span className="save-toast-icon">{event.ok ? '💾' : '⚠️'}</span>
      <span className="save-toast-text">
        <b>{event.gameName}</b>
        {event.message ? ` — ${event.message}` : ''}
      </span>
    </div>
  )
}
