import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Game } from '../../../shared/types'
import { AchievementsDialog } from './AchievementsDialog'
import { EditGameDialog } from './EditGameDialog'
import { GameDetailsDialog } from './GameDetailsDialog'
import { mediaUrl } from '../lib/media'
import { useFeedback } from '../lib/feedback'

function formatPlaytime(seconds: number): string {
  if (!seconds) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`
}

export function GameCard({
  game,
  missing = false
}: {
  game: Game
  missing?: boolean
}): React.JSX.Element {
  const [running, setRunning] = useState(false)
  const [showAch, setShowAch] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(true)
  const [failedCovers, setFailedCovers] = useState<Set<string>>(new Set())
  const { confirm } = useFeedback()

  useEffect(() => {
    let alive = true
    const apply = (value: boolean): void => {
      if (alive) setRunning(value)
    }
    void window.api.isRunning(game.id).then(apply)
    // live updates: the badge appears right after launch and clears on exit
    const off = window.api.onGameRunningChanged((id, value) => {
      if (id === game.id) apply(value)
    })
    void window.api.getGeneralSettings().then((s) => {
      if (alive) setConfirmDelete(s.confirmDelete)
    })
    return () => {
      alive = false
      off()
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

  /** Local cover first (user's choice), then the internet cover, then initials */
  const localCover = game.coverPath ? mediaUrl(game.coverPath) : undefined
  const remoteCover = game.metadata?.coverUrl
  const coverSrc = [localCover, remoteCover].find((src) => src && !failedCovers.has(src))

  // a failed load must not block the next fallback or a refreshed cover later
  useEffect(() => {
    setFailedCovers(new Set())
  }, [localCover, remoteCover])

  const onCoverError = (): void => {
    if (!coverSrc) return
    setFailedCovers((current) => new Set(current).add(coverSrc))
  }

  return (
    <div className={running ? 'card running' : 'card'}>
      <div className="cover" onClick={() => setShowAch(true)}>
        {coverSrc ? (
          <img src={coverSrc} alt={game.name} onError={onCoverError} />
        ) : (
          <div className="cover-fallback">{initials}</div>
        )}
        {running && <div className="badge-running">▶ запущена</div>}
        {missing && <div className="badge-missing">⚠ exe не найден</div>}
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
        {running ? (
          <button
            className="btn btn-play btn-stop"
            title="Остановить игру"
            onClick={() => void window.api.stopGame(game.id)}
          >
            ■ Остановить
          </button>
        ) : (
          <button
            className="btn btn-play"
            disabled={missing}
            title={
              missing
                ? 'exe-файл не найден — укажите новый путь в редакторе игры'
                : undefined
            }
            onClick={() => void window.api.launchGame(game.id)}
          >
            {missing ? 'Файл не найден' : 'Играть'}
          </button>
        )}
        <button className="icon-btn" title="Информация о игре" onClick={() => setShowDetails(true)}>
          ⓘ
        </button>
        <button className="icon-btn" title="Изменить игру" onClick={() => setShowEdit(true)}>
          ✎
        </button>
        <button
          className="icon-btn"
          title="Удалить из библиотеки"
          onClick={() => {
            const doRemove = (): void => void window.api.removeGame(game.id)
            if (!confirmDelete) {
              doRemove()
              return
            }
            void confirm({
              title: 'Удалить игру?',
              message: `«${game.name}» будет удалена из библиотеки. Файлы игры на диске останутся на месте.`,
              confirmLabel: 'Удалить',
              danger: true
            }).then((ok) => {
              if (ok) doRemove()
            })
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
      {showDetails &&
        createPortal(
          <GameDetailsDialog game={game} onClose={() => setShowDetails(false)} />,
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
