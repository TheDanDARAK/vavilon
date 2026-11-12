import { useCallback, useEffect, useState } from 'react'
import type { Game, AchievementUnlockEvent } from '../../shared/types'
import { GameCard } from './components/GameCard'
import { AddGameDialog } from './components/AddGameDialog'
import { UnlockToast } from './components/UnlockToast'
import { SavesSection } from './components/SavesSection'
import { GeneralSettingsSection } from './components/GeneralSettingsSection'

type SortKey = 'name' | 'lastPlayed' | 'playtime'

export default function App(): React.JSX.Element {
  const [games, setGames] = useState<Game[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('lastPlayed')
  const [unlockToast, setUnlockToast] = useState<AchievementUnlockEvent | null>(null)

  const refresh = useCallback(async () => {
    setGames(await window.api.getGames())
  }, [])

  useEffect(() => {
    void refresh()
    const offChanged = window.api.onGamesChanged(refresh)
    const offUnlock = window.api.onAchievementUnlocked((event) => setUnlockToast(event))
    return () => {
      offChanged()
      offUnlock()
    }
  }, [refresh])

  const sorted = [...games].sort((a, b) => {
    switch (sortKey) {
      case 'name':
        return a.name.localeCompare(b.name)
      case 'playtime':
        return (b.playtimeSeconds ?? 0) - (a.playtimeSeconds ?? 0)
      default:
        return (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0)
    }
  })

  return (
    <div className="app">
      <header className="sidebar">
        <div className="logo-wrap">
          <div className="logo">VAVILON</div>
          <div className="logo-sub">игровой комбайн</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
          + Добавить игру
        </button>
        <div className="section">
          <div className="section-title">Сортировка</div>
          <button
            className={sortKey === 'lastPlayed' ? 'chip active' : 'chip'}
            onClick={() => setSortKey('lastPlayed')}
          >
            Недавние
          </button>
          <button
            className={sortKey === 'name' ? 'chip active' : 'chip'}
            onClick={() => setSortKey('name')}
          >
            По имени
          </button>
          <button
            className={sortKey === 'playtime' ? 'chip active' : 'chip'}
            onClick={() => setSortKey('playtime')}
          >
            По времени
          </button>
        </div>
        <div className="section">
          <div className="section-title">Профиль</div>          <button
            className="chip"
            onClick={async () => {
              const path = await window.api.exportProfile()
              if (path) alert(`Профиль сохранён:\n${path}`)
            }}
          >
            Экспорт
          </button>
          <button
            className="chip"
            onClick={async () => {
              try {
                const result = (await window.api.importProfile('merge')) as {
                  added: number
                  updated: number
                } | null
                if (result) alert(`Импортировано: +${result.added} новых, ${result.updated} обновлено`)
              } catch (e) {
                alert(`Ошибка импорта: ${String(e)}`)
              }
            }}
          >
            Импорт (слить)
          </button>
        </div>
        <GeneralSettingsSection />
        <SavesSection />
        <div className="stats">
          <div>{games.length} игр в библиотеке</div>
          <div>
            всего:{' '}
            {Math.round(games.reduce((s, g) => s + (g.playtimeSeconds ?? 0), 0) / 3600)} ч
          </div>
        </div>
      </header>

      <main className="content">
        {sorted.length === 0 ? (
          <div className="empty">
            <h2>Библиотека пуста</h2>
            <p>Нажмите «Добавить игру» и выберите exe-файл.</p>
          </div>
        ) : (
          <div className="grid">
            {sorted.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        )}
      </main>

      {showAdd && <AddGameDialog onClose={() => setShowAdd(false)} />}
      {unlockToast && (
        <UnlockToast
          event={unlockToast}
          onDone={() => setUnlockToast(null)}
        />
      )}
    </div>
  )
}
