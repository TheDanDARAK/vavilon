import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { Game } from '../../../shared/types'
import { mediaUrl } from '../lib/media'

interface SetupReport {
  dll: string
  schema: { total: number; withIcons: number; localized: boolean; rarity: boolean } | null
  appidWritten: boolean
  cover: boolean
  warnings: string[]
}

function formatDate(ts?: number): string {
  return ts ? new Date(ts).toLocaleDateString('ru-RU', { dateStyle: 'medium' }) : ''
}

export function AchievementsDialog({
  game,
  onClose
}: {
  game: Game
  onClose: () => void
}): React.JSX.Element {
  const [setupBusy, setSetupBusy] = useState(false)
  const [setupError, setSetupError] = useState('')
  const achievements = game.achievements ?? []
  const unlocked = achievements.filter((a) => a.unlockedAt).length

  const runSetup = async (): Promise<void> => {
    setSetupBusy(true)
    setSetupError('')
    try {
      const report = (await window.api.setupAchievements(game.id)) as SetupReport
      const schema = report.schema
      alert(
        `Готово!\n\n` +
          `DLL: ${report.dll}\n` +
          (schema
            ? `схема: ${schema.total} достижений, иконок ${schema.withIcons}` +
              `${schema.localized ? ', русские названия' : ''}` +
              `${schema.rarity ? ', редкость' : ''}\n`
            : '') +
          `${report.cover ? 'Обложка загружена с Steam CDN\n' : ''}` +
          (report.warnings.length ? `\n${report.warnings.join('\n')}\n` : '') +
          `\nЗапусти игру и разблокируй достижение — оно появится здесь.`
      )
      onClose()
    } catch (e) {
      setSetupError(`Ошибка настройки: ${String(e).replace('Error: ', '')}`)
    } finally {
      setSetupBusy(false)
    }
  }

  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="dialog dialog-wide" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h3>{game.name}</h3>
          <span className="ach-total">
            🏆 {unlocked} / {achievements.length}
          </span>
        </div>

        {achievements.length === 0 ? (
          <div className="ach-empty">
            Достижения ещё не найдены.
            <small>
              Нужен Steam-эмулятор (GBE/Goldberg) и схема достижений. Кнопка ниже скачает схему
              (названия, иконки, редкость) и при необходимости сам эмулятор.
            </small>
            <button
              className="btn btn-primary setup-btn"
              disabled={setupBusy}
              onClick={() => void runSetup()}
            >
              {setupBusy ? 'Настраиваю… (скачивание схемы и иконок)' : '⚙ Настроить Steam-эмуляцию (GBE)'}
            </button>
            {setupError && <div className="setup-error">{setupError}</div>}
          </div>
        ) : (
          <div className="ach-list">
            {achievements.map((a) => (
              <div
                key={a.api}
                className={a.unlockedAt ? 'ach-row unlocked' : 'ach-row locked'}
              >
                <div className="ach-icon">
                  {a.icon ? (
                    <img src={mediaUrl(a.icon)} alt="" />
                  ) : (
                    <div className="ach-icon-fallback">{a.unlockedAt ? '🏆' : '🔒'}</div>
                  )}
                </div>
                <div className="ach-text">
                  <div className="ach-name">{a.displayName || a.api}</div>
                  {a.description && <div className="ach-desc">{a.description}</div>}
                </div>
                <div className="ach-side">
                  {a.rarity !== undefined && (
                    <span className="ach-rarity">{a.rarity.toFixed(1)}%</span>
                  )}
                  <span className="ach-date">{a.unlockedAt ? formatDate(a.unlockedAt) : '—'}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="dialog-actions">
          <button className="btn" onClick={() => void window.api.syncAchievements()}>
            Обновить из файлов
          </button>
          <button
            className="btn"
            onClick={() => void window.api.restoreSaves(game.id)}
            title="Восстановить сохранения из папки бэкапов (например, после переустановки игры)"
          >
            💾 Восстановить сохранения
          </button>
          <button
            className="btn"
            title="Записать достижения из библиотеки лаунчера в файлы эмулятора — игра снова увидит весь прогресс (полезно после переустановки игры)"
            onClick={() => {
              void window.api
                .exportUnlocks(game.id)
                .then((r) => alert(`Прогресс загружен в эмулятор: ${r.exported} достижение(й).\n\n${r.file}`))
                .catch((e) => alert(`Ошибка: ${String(e).replace('Error: ', '')}`))
            }}
          >
            ⬆ Загрузить прогресс в эмулятор
          </button>
          <button
            className="btn"
            disabled={setupBusy}
            onClick={() => void runSetup()}
            title="Схема достижений, иконки, редкость и обложка с Steam CDN"
          >
            {setupBusy ? '…' : '⚙ Схема и обложка'}
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
