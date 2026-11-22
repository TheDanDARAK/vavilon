import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  AchievementSettings,
  GeneralSettings,
  UpdateInfo,
  UpdaterState
} from '../../../shared/types'

/**
 * Full settings dialog: window behaviour (tray, autostart), achievements
 * (notifications, watchdog interval), storefront (RAWG + SteamGridDB keys),
 * in-app updates and misc toggles. Cloud-saves settings live in their own
 * sidebar section.
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
  const [sgdbKey, setSgdbKey] = useState('')
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [updater, setUpdater] = useState<UpdaterState | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    void window.api.getGeneralSettings().then(setGeneral)
    void window.api.getAchSettings().then(setAch)
    void window.api.storeGetKey().then(setStoreKey)
    void window.api.storeGetSteamGridDbKey().then(setSgdbKey)
    void window.api.getAppVersion().then(setVersion)
    void window.api.getUpdaterState().then(setUpdater)
    return window.api.onUpdaterState(setUpdater)
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
              <span>Спрашивать подтверждение при удалении игры</span>
            </label>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={general.autoUpdateCheck}
                onChange={(e) => void patchGeneral({ autoUpdateCheck: e.target.checked })}
              />
              <span>
                Проверять обновления при запуске
                <small>новая версия скачается сама, установка — по вашей кнопке</small>
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
              placeholder="Вставьте ключ..."
            />
            <small className="store-key-hint">
              Бесплатный персональный ключ выдаётся на rawg.io/apidocs за минуту.
            </small>
          </div>
          <div className="dialog-actions">
            <button className="btn" onClick={() => window.open('https://rawg.io/apidocs')}>
              Получить ключ ↗
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void window.api.storeSetKey(storeKey.trim())}
            >
              Сохранить ключ
            </button>
          </div>
          <div className="field">
            <span>Ключ SteamGridDB — для обложек старых игр без картинки в Steam</span>
            <input
              value={sgdbKey}
              onChange={(e) => setSgdbKey(e.target.value)}
              placeholder="необязательно — уже есть встроенный"
            />
            <small className="store-key-hint">
              Если поле пустое, используется встроенный публичный ключ. Свой ключ выдаётся на
              steamgriddb.com/profile/preferences.
            </small>
          </div>
          <div className="dialog-actions">
            <button
              className="btn"
              onClick={() => window.open('https://www.steamgriddb.com/profile/preferences')}
            >
              Получить ключ ↗
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void window.api.storeSetSteamGridDbKey(sgdbKey.trim())}
            >
              Сохранить ключ
            </button>
          </div>
        </div>

        <div className="settings-group">
          <div className="settings-group-title">Обновления</div>
          <div className="settings-version">
            Версия лаунчера: <b>{version || '...'}</b>
          </div>

          {updater && (
            <div className="updater-state">
              {updater.phase === 'checking' && <small>Проверяю обновления…</small>}
              {updater.phase === 'available' && (
                <div className="dialog-actions">
                  <small>Доступна версия {updater.latest}</small>
                  <button
                    className="btn btn-primary"
                    onClick={() => void window.api.downloadUpdate()}
                  >
                    Скачать обновление
                  </button>
                </div>
              )}
              {updater.phase === 'downloading' && (
                <>
                  <small>
                    Загрузка {updater.latest}: {updater.percent ?? 0}%
                  </small>
                  <div className="update-bar">
                    <div
                      className="update-bar-fill"
                      style={{ width: `${updater.percent ?? 0}%` }}
                    />
                  </div>
                </>
              )}
              {updater.phase === 'downloaded' && (
                <div className="dialog-actions">
                  <small>Версия {updater.latest} готова к установке</small>
                  <button
                    className="btn btn-primary"
                    onClick={() => void window.api.installUpdate()}
                  >
                    Установить и перезапустить
                  </button>
                </div>
              )}
              {updater.phase === 'not-available' && (
                <small>Обновлений нет — установлена последняя версия.</small>
              )}
              {updater.phase === 'error' && (
                <small className="store-key-hint">Ошибка обновления: {updater.error}</small>
              )}
              {updater.portable && (
                <small className="store-key-hint">
                  Portable-сборка: после загрузки откроется установщик.
                </small>
              )}
            </div>
          )}

          <div className="dialog-actions">
            <button className="btn" disabled={checking} onClick={() => void checkForUpdates()}>
              {checking ? 'Проверяю...' : 'Проверить на GitHub'}
            </button>
            {update?.updateAvailable && update.url && (
              <button
                className="btn"
                onClick={() => void window.api.openReleasePage(update.url as string)}
              >
                Страница релиза {update.latest} ↗
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
