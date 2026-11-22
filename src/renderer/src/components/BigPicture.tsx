import { useCallback, useEffect, useRef, useState } from 'react'
import type { Game } from '../../../shared/types'
import { mediaUrl } from '../lib/media'
import { useGamepad } from '../lib/gamepad'
import { useFeedback } from '../lib/feedback'

/**
 * Big Picture mode: a fullscreen, gamepad-driven shell meant to be launched by
 * streaming hosts such as Sunshine (`Vavilon.exe --bigpicture`). Navigation is
 * a grid of large covers; A launches, B stops/back, Start leaves the mode.
 */

function coverFor(game: Game): string | undefined {
  return (game.coverPath ? mediaUrl(game.coverPath) : undefined) ?? game.metadata?.coverUrl
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

export function BigPicture(): React.JSX.Element {
  const [games, setGames] = useState<Game[]>([])
  const [index, setIndex] = useState(0)
  const [running, setRunning] = useState<Record<string, boolean>>({})
  const [columns, setColumns] = useState(4)
  const gridRef = useRef<HTMLDivElement>(null)
  const { confirm, toast } = useFeedback()

  const refresh = useCallback(async (): Promise<void> => {
    const list = await window.api.getGames()
    setGames([...list].sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0)))
  }, [])

  useEffect(() => {
    void refresh()
    const offChanged = window.api.onGamesChanged(() => void refresh())
    const offRunning = window.api.onGameRunningChanged((id, value) =>
      setRunning((prev) => ({ ...prev, [id]: value }))
    )
    return () => {
      offChanged()
      offRunning()
    }
  }, [refresh])

  // columns drive left/right vs up/down navigation
  useEffect(() => {
    const compute = (): void => {
      const width = gridRef.current?.clientWidth ?? window.innerWidth
      setColumns(Math.max(3, Math.min(6, Math.floor(width / 240))))
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [])

  const clamp = useCallback(
    (next: number): number => Math.min(Math.max(0, games.length - 1), Math.max(0, next)),
    [games.length]
  )

  const move = useCallback((delta: number): void => setIndex((i) => clamp(i + delta)), [clamp])

  const launch = useCallback(async (): Promise<void> => {
    const game = games[index]
    if (!game || running[game.id]) return
    await window.api.launchGame(game.id)
  }, [games, index, running])

  const leaveOrStop = useCallback(async (): Promise<void> => {
    const game = games[index]
    if (game && running[game.id]) {
      await window.api.stopGame(game.id)
      return
    }
    const ok = await confirm({
      title: 'Выйти из Big Picture?',
      message: 'Вернуться в обычное окно лаунчера.',
      confirmLabel: 'Выйти'
    })
    if (ok) await window.api.exitBigPicture()
  }, [games, index, running, confirm])

  useGamepad({
    onUp: () => move(-columns),
    onDown: () => move(columns),
    onLeft: () => move(-1),
    onRight: () => move(1),
    onConfirm: () => void launch(),
    onBack: () => void leaveOrStop(),
    onMenu: () => void leaveOrStop()
  })

  // keyboard controls keep the mode usable without a gamepad (and for testing)
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowUp') move(-columns)
      else if (event.key === 'ArrowDown') move(columns)
      else if (event.key === 'ArrowLeft') move(-1)
      else if (event.key === 'ArrowRight') move(1)
      else if (event.key === 'Enter') void launch()
      else if (event.key === 'Escape') void leaveOrStop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // keep the selected tile visible while navigating
  useEffect(() => {
    const node = gridRef.current?.children[index] as HTMLElement | undefined
    node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [index])

  useEffect(() => {
    if (games.length > 0 && index >= games.length) setIndex(games.length - 1)
  }, [games.length, index])

  return (
    <div className="bigpicture">
      <header className="bp-header">
        <div className="bp-logo">
          VAVILON <span>BIG PICTURE</span>
        </div>
        <div className="bp-hint">
          🎮 A — играть · B — назад/стоп · Start — выход
          <button className="btn bp-exit" onClick={() => void leaveOrStop()}>
            Выйти
          </button>
        </div>
      </header>

      {games.length === 0 ? (
        <div className="bp-empty">
          <h2>Библиотека пуста</h2>
          <p>Добавьте игры в обычном режиме лаунчера.</p>
        </div>
      ) : (
        <div className="bp-grid" ref={gridRef}>
          {games.map((game, i) => {
            const cover = coverFor(game)
            const achievements = game.achievements ?? []
            const unlocked = achievements.filter((a) => a.unlockedAt).length
            return (
              <button
                key={game.id}
                className={i === index ? 'bp-tile selected' : 'bp-tile'}
                onMouseEnter={() => setIndex(i)}
                onClick={() => {
                  setIndex(i)
                  if (running[game.id]) return
                  void window.api.launchGame(game.id).then(() =>
                    toast(`Запуск: ${game.name}`, 'success')
                  )
                }}
              >
                <div className="bp-cover">
                  {cover ? (
                    <img src={cover} alt={game.name} />
                  ) : (
                    <div className="bp-cover-fallback">{initials(game.name)}</div>
                  )}
                  {running[game.id] && <div className="bp-running">▶ запущена</div>}
                </div>
                <div className="bp-name" title={game.name}>
                  {game.name}
                </div>
                {achievements.length > 0 && (
                  <div className="bp-ach">
                    🏆 {unlocked}/{achievements.length}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
