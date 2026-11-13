import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Game } from '../../../shared/types'
import { AchievementsDialog } from './AchievementsDialog'
import { EditGameDialog } from './EditGameDialog'
import { mediaUrl } from '../lib/media'

function formatPlaytime(seconds: number): string {
  if (!seconds) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`
}

export function GameCard({ game }: { game: Game }): React.JSX.Element {
  const [running, setRunning] = useState(false)
  const [showAch, setShowAch] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(true)

  useEffect(() => {
    let alive = true
    void window.api.isRunning(game.id).then((r) => {
      if (alive) setRunning(r)
    })
    void window.api.getGeneralSettings().then((s) => {
      if (alive) setConfirmDelete(s.confirmDelete)
    })
    return () => {
      alive = false
    }
  }, [game.id])

  const achievements = game.achievements ?? []
  const unlocked = achievements.filter((a) => a.unlockedAt).length
  const total = achievements.length
  const percent = total > 0 ? Math.round((unlocked / total) * 100) : 0

  const initials = game.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w: string) => w[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <div className={running ? 'card running' : 'card'}>
      <div className="cover" onClick={() => setShowAch(true)}>
        {game.coverPath ? (
          <img src={mediaUrl(game.coverPath)} alt={game.name} />
        ) : (
          <div className="cover-fallback">{initials}</div>
        )}
        {running && <div className="badge-running">▶ запущена</div>}
      </div>
      <div className="card-body">
        <div className="card-title" title={game.name}>
          {game.name}
        </div>
        <div className="card-meta">
          {formatPlaytime(game.playtimeSeconds ?? 0)}
          {game.lastPlayedAt ? ` · ${new Date(game.lastPlayedAt).toLocaleDateString()}` : ''}
        </div>
        {total > 0 && (
          <div className="ach-progress" onClick={() => setShowAch(true)} title="Открыть достижения">
            <div className="ach-bar">
              <div className="ach-bar-fill" style={{ width: `${percent}%` }} />
            </div>
            <span className="ach-count">
              🏆 {unlocked}/{total}
            </span>
          </div>
        )}
      </div>
      <div className="card-actions">
        <button className="btn btn-play" onClick={() => void window.api.launchGame(game.id)}>
          Играть
        </button>
        <button className="icon-btn" title="Изменить игру" onClick={() => setShowEdit(true)}>
          ✎
        </button>
        <button
          className="icon-btn"
          title="Удалить из библиотеки"
          onClick={() => {
            const doRemove = (): void => void window.api.removeGame(game.id)
            if (confirmDelete) {
              if (confirm(`Удалить «${game.name}» из библиотеки?`)) doRemove()
            } else {
              doRemove()
            }
          }}
        >
          ✕
        </button>
      </div>
      {showAch &&
        createPortal(
          <AchievementsDialog game={game} onClose={() => setShowAch(false)} />,
          document.body
        )}
      {showEdit &&
        createPortal(
          <EditGameDialog game={game} onClose={() => setShowEdit(false)} />,
          document.body
        )}
    </div>
  )
}
