import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AchievementSettings, GeneralSettings, UpdateInfo } from '../../../shared/types'

/**
 * Full settings dialog: window behaviour (tray, autostart), achievements
 * (notifications, watchdog interval), storefront (RAWG key) and misc toggles.
 * Cloud-saves settings live in their own sidebar section.
 */

const POLL_CHOICES = [
  { value: 2000, label: '2 секунды' },
  { value: 4000, label: '4 секунды' },
  { value: 10000, label: '10 секунд' },
  { value: 30000, label: '30 секунд' }
]

export function SettingsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [general, setGeneral] = useState<GeneralSettings | null>(null)
  const [ach, setAch] = useState<AchievementSettings | null>(null)
  const [storeKey, setStoreKey] = useState('')
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    void window.api.getGeneralSettings().then(setGeneral)
    void window.api.getAchSettings().then(setAch)
    void window.api.storeGetKey().then(setStoreKey)
    void window.api.getAppVersion().then(setVersion)
  }, [])

  const checkForUpdates = async (): Promise<void> => {
    setChecking(true)
    try {
      setUpdate(await window.api.checkUpdates())
    } catch (e) {
      setUpdate({
        current: version,
        updateAvailable: false,
        error: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setChecking(false)
    }
  }

  const patchGeneral = async (part: Partial<GeneralSettings>): Promise<void> => {
    setGeneral(await window.api.setGeneralSettings(part))
  }

  const patchAch = async (part: Partial<AchievementSettings>): Promise<void> => {
    setAch(await window.api.setAchSettings(part))
  }

  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="dialog dialog-wide settings" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h3>⚙ Настройки</h3>
        </div>

        {general && (
          <div className="settings-group">
            <div className="settings-group-title">Окно и запуск</div>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={general.closeToTray}
                onChange={(e) => void patchGeneral({ closeToTray: e.target.checked })}
              />
              <span>
                Скрывать в трей при закрытии
                <small>окно закрывается, лаунчер и уведомления работают дальше</small>
              </span>
            </label>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={general.startWithWindows}
                onChange={(e) => void patchGeneral({ startWithWindows: e.target.checked })}
              />
              <span>
                Автозапуск с Windows
                <small>лаунчер стартует вместе с системой и ждёт в трее</small>
              </span>
            </label>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={general.confirmDelete}
                onChange={(e) => void patchGeneral({ confirmDelete: e.target.checked })}
              />
              <span>
                Спрашивать подтверждение при удалении игры
              </span>
            </label>
          </div>
        )}

        {ach && (
          <div className="settings-group">
            <div className="settings-group-title">Достижения</div>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={ach.toasts}
                onChange={(e) => void patchAch({ toasts: e.target.checked })}
              />
              <span>Всплывашки в лаунчере при разблокировке</span>
            </label>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={ach.notifications}
                onChange={(e) => void patchAch({ notifications: e.target.checked })}
              />
              <span>
                Системные уведомления Windows
                <small>когда окно лаунчера закрыто или свёрнуто</small>
              </span>
            </label>
            <div className="field">
              <span>Частота опроса файлов эмулятора</span>
              <select
                value={ach.pollIntervalMs}
                onChange={(e) => void patchAch({ pollIntervalMs: Number(e.target.value) })}
              >
                {POLL_CHOICES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="settings-group">
          <div className="settings-group-title">Витрина (каталог игр)</div>
          <div className="field">
            <span>Ключ RAWG API — нужен для новинок и рекомендаций</span>
            <input
              value={storeKey}
              onChange={(e) => setStoreKey(e.target.value)}
              placeholder="Вставьте ключ…"
            />
            <small className="store-key-hint">
              Бесплатный персональный ключ выдаётся на rawg.io/apidocs за минуту.
            </small>
          </div>
          <div className="dialog-actions">
            <button
              className="btn"
              onClick={() => window.open('https://rawg.io/apidocs')}
            >
              Получить ключ ↗
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void window.api.storeSetKey(storeKey.trim())}
            >
              Сохранить ключ
            </button>
          </div>
        </div>

        <div className="settings-group">
          <div className="settings-group-title">Обновления</div>
          <div className="settings-version">
            Версия лаунчера: <b>{version || '…'}</b>
          </div>
          <div className="dialog-actions">
            <button className="btn" disabled={checking} onClick={() => void checkForUpdates()}>
              {checking ? 'Проверяю…' : 'Проверить обновления'}
            </button>
            {update?.updateAvailable && update.url && (
              <button
                className="btn btn-primary"
                onClick={() => void window.api.openReleasePage(update.url as string)}
              >
                Открыть {update.latest}
              </button>
            )}
          </div>
          {update && !update.error && (
            <small className="store-key-hint">
              {update.updateAvailable
                ? `Доступна новая версия ${update.latest}.`
                : 'Установлена последняя версия.'}
            </small>
          )}
          {update?.error && (
            <small className="store-key-hint">Не удалось проверить: {update.error}</small>
          )}
        </div>

        <div className="settings-group">
          <div className="settings-group-title">Данные</div>
          <div className="settings-version">
            Библиотека, настройки, кэш и ежедневные копии библиотеки.
          </div>
          <div className="dialog-actions">
            <button className="btn" onClick={() => void window.api.openDataDir()}>
              Открыть папку данных
            </button>
          </div>
        </div>

        <div className="dialog-actions">
          <button className="btn btn-primary" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
