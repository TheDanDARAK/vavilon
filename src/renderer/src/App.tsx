import { useCallback, useEffect, useState } from 'react'
import type { Game, AchievementUnlockEvent } from '../../shared/types'
import { GameCard } from './components/GameCard'
import { AddGameDialog } from './components/AddGameDialog'
import { UnlockToast } from './components/UnlockToast'
import { SavesSection } from './components/SavesSection'
import { GeneralSettingsSection } from './components/GeneralSettingsSection'
import { StorePage } from './components/StorePage'
import { useFeedback } from './lib/feedback'
import { errorText } from './lib/errors'

type SortKey = 'name' | 'lastPlayed' | 'playtime'
type View = 'library' | 'store'

const SORT_KEYS: SortKey[] = ['lastPlayed', 'name', 'playtime']

function loadSortKey(): SortKey {
  const saved = localStorage.getItem('vavilon.sort')
  return SORT_KEYS.includes(saved as SortKey) ? (saved as SortKey) : 'lastPlayed'
}

export default function App(): React.JSX.Element {
  const [games, setGames] = useState<Game[]>([])
  const [missingGames, setMissingGames] = useState<Set<string>>(() => new Set())
  const [showAdd, setShowAdd] = useState(false)
  const [view, setView] = useState<View>('library')
  const [sortKey, setSortKey] = useState<SortKey>(loadSortKey)
  const [query, setQuery] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [unlockToast, setUnlockToast] = useState<AchievementUnlockEvent | null>(null)
  const { toast, show, confirm } = useFeedback()

  const refresh = useCallback(async () => {
    const [nextGames, missingIds] = await Promise.all([
      window.api.getGames(),
      window.api.getMissingGames()
    ])
    setGames(nextGames)
    setMissingGames(new Set(missingIds))
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

  const changeSort = (key: SortKey): void => {
    setSortKey(key)
    localStorage.setItem('vavilon.sort', key)
  }

  /** Adds every dropped exe to the library (duplicates are reported, not re-added). */
  const handleDrop = async (event: React.DragEvent): Promise<void> => {
    event.preventDefault()
    if (view !== 'library') return
    setDragOver(false)
    for (const file of Array.from(event.dataTransfer.files)) {
      const path = window.api.pathForFile(file)
      if (!path || !path.toLowerCase().endsWith('.exe')) continue
      const result = await window.api.addGame({ exePath: path })
      if (result.duplicated) toast(`«${result.game.name}» уже есть в библиотеке`, 'warning')
    }
  }

  const visible =
    query.trim() === ''
      ? sorted
      : sorted.filter((g) => g.name.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <div className="app">
      <header className="sidebar">
        <div className="logo-wrap">
          <div className="logo">VAVILON</div>
          <div className="logo-sub">игровой комбайн</div>
        </div>
        <div className="section">
          <div className="section-title">Навигация</div>
          <button
            className={view === 'library' ? 'chip active' : 'chip'}
            onClick={() => setView('library')}
          >
            📚 Библиотека
          </button>
          <button
            className={view === 'store' ? 'chip active' : 'chip'}
            onClick={() => setView('store')}
          >
            🛍 Витрина
          </button>
        </div>
        {view === 'library' && (
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            + Добавить игру
          </button>
        )}
        {view === 'library' && (
          <div className="section">
            <div className="section-title">Поиск</div>
            <input
              className="search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Название игры…"
            />
          </div>
        )}
        {view === 'library' && (
          <div className="section">
            <div className="section-title">Сортировка</div>
          <button
            className={sortKey === 'lastPlayed' ? 'chip active' : 'chip'}
            onClick={() => changeSort('lastPlayed')}
          >
            Недавние
          </button>
          <button
            className={sortKey === 'name' ? 'chip active' : 'chip'}
            onClick={() => changeSort('name')}
          >
            По имени
          </button>
          <button
            className={sortKey === 'playtime' ? 'chip active' : 'chip'}
            onClick={() => changeSort('playtime')}
          >
            По времени
          </button>
          </div>
        )}
        <div className="section">
          <div className="section-title">Профиль</div>          <button
            className="chip"
            onClick={async () => {
              const path = await window.api.exportProfile()
              if (path) toast(`Профиль сохранён: ${path}`, 'success')
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
                if (result) {
                  toast(`Импортировано: +${result.added} новых, ${result.updated} обновлено`, 'success')
                }
              } catch (e) {
                void show({ title: 'Ошибка импорта', message: errorText(e), tone: 'error' })
              }
            }}
          >
            Импорт (слить)
          </button>
          <button
            className="chip"
            title="Заменить текущую библиотеку содержимым профиля (сначала создаётся бэкап)"
            onClick={async () => {
              const ok = await confirm({
                title: 'Заменить библиотеку?',
                message:
                  'Текущая библиотека будет заменена играми из профиля.\n\n' +
                  'Перед заменой автоматически создаётся library.json.bak, но список игр в лаунчере изменится сразу.',
                confirmLabel: 'Заменить',
                danger: true
              })
              if (!ok) return
              try {
                const result = (await window.api.importProfile('replace')) as {
                  added: number
                  updated: number
                } | null
                if (result) {
                  toast(`Библиотека заменена: ${result.added} игр`, 'success')
                }
              } catch (e) {
                void show({ title: 'Ошибка импорта', message: errorText(e), tone: 'error' })
              }
            }}
          >
            Импорт (заменить)
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

      {view === 'store' ? (
        <main className="content">
          <StorePage games={games} />
        </main>
      ) : (
        <main
          className="content"
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
          }}
          onDrop={(e) => void handleDrop(e)}
        >
          {sorted.length === 0 ? (
            <div className="empty">
              <h2>Библиотека пуста</h2>
              <p>Нажмите «Добавить игру» или перетащите exe-файл прямо сюда.</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="empty">
              <h2>Ничего не найдено</h2>
              <p>По запросу «{query.trim()}» нет ни одной игры.</p>
            </div>
          ) : (
            <div className="grid">
              {visible.map((game) => (
                <GameCard key={game.id} game={game} missing={missingGames.has(game.id)} />
              ))}
            </div>
          )}
          {dragOver && <div className="drop-overlay">Отпустите, чтобы добавить игру</div>}
        </main>
      )}

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
