import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Game } from '../../../shared/types'
import { mediaUrl } from '../lib/media'
import { useFeedback } from '../lib/feedback'
import { errorText } from '../lib/errors'

/*
 * Emulator dialog, modelled after Achievement Watcher Next:
 *  - tracking itself is passive (reads emulator saves, never writes game files)
 *  - "Схема и обложка" is safe: config files only, no DLL is touched
 *  - "Установить эмулятор" is the explicit repair action (backup first) that
 *    antivirus products may false-positive on — hence the confirmation
 *  - a user-imported DLL ("Свой DLL…") means nothing is downloaded at all
 */

interface SchemaResult {
  total: number
  withIcons: number
  localized: boolean
  rarity: boolean
}

interface SetupReport {
  dll: string
  dllPath?: string
  schema: SchemaResult | null
  appidWritten: boolean
  cover: boolean
  interfaces?: { generated: boolean; source?: string }
  warnings: string[]
}

interface SchemaReport {
  schema: SchemaResult | null
  cover: boolean
  coverSource?: string
  appidWritten: boolean
  schemaError?: string
  warnings?: string[]
}

interface DiagReport {
  gameId: string
  appId?: number
  dll: { path: string; isEmulator: boolean; backup: boolean } | null
  appidTxt: boolean
  schema: { total: number; icons: number } | null
  interfaces: boolean
  originalCandidates: string[]
  runtimeSaves: number
  cover: boolean
  customDll: string | null
}

interface RestoreReport {
  restored: string[]
  removed: string[]
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
  const [diag, setDiag] = useState<DiagReport | null>(null)
  const achievements = game.achievements ?? []
  const unlocked = achievements.filter((a) => a.unlockedAt).length
  const { toast, show, confirm } = useFeedback()

  const refreshDiag = (): void => {
    void window.api
      .diagnoseEmu(game.id)
      .then((r) => setDiag(r as DiagReport))
      .catch(() => setDiag(null))
  }

  useEffect(() => {
    refreshDiag()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id])

  const finishWith = async (
    promise: Promise<unknown>,
    describe: (report: unknown) => string
  ): Promise<void> => {
    setSetupBusy(true)
    try {
      const report = await promise
      await show({ title: 'Готово', message: describe(report), tone: 'success' })
      refreshDiag()
      onClose()
    } catch (e) {
      await show({ title: 'Ошибка', message: errorText(e), tone: 'error' })
    } finally {
      setSetupBusy(false)
    }
  }

  /** Safe: schema + cover, config files only. */
  const runSchema = (): Promise<void> =>
    finishWith(window.api.setupSchema(game.id), (raw) => {
      const r = raw as SchemaReport
      const schema = r.schema
      return (
        `Готово!\n\n` +
        (schema
          ? `схема: ${schema.total} достижений, иконок ${schema.withIcons}` +
            `${schema.localized ? ', русские названия' : ''}` +
            `${schema.rarity ? ', редкость' : ''}\n`
          : r.schemaError
            ? `схема: недоступна (${r.schemaError})\n`
            : '') +
        `${r.cover ? `Обложка загружена (${r.coverSource ?? 'Steam CDN'})\n` : 'Обложка не найдена\n'}` +
        (r.warnings?.length ? `\n${r.warnings.join('\n')}\n` : '') +
        `\nФайлы игры (DLL) не изменялись.`
      )
    })

  /** Repair: DLL replacement + schema. Explicitly confirmed. */
  const runInstall = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Установить Steam-эмулятор?',
      message:
        'В папку игры будет установлен эмулятор GBE.\n\n' +
        '— оригинальная steam_api.dll сохранится как .valve.bak\n' +
        '— схема достижений и steam_appid.txt будут записаны\n\n' +
        'Антивирус может отреагировать на эмуляторную DLL — это ложное срабатывание. ' +
        'Добавьте папку игры в исключения кнопкой «🛡 Исключение в Защитник». ' +
        'Вместо скачивания можно использовать свой DLL (кнопка «📁 Свой DLL…»).',
      confirmLabel: 'Установить'
    })
    if (!ok) return
    await finishWith(window.api.installEmu(game.id), (raw) => {
      const report = raw as SetupReport
      const schema = report.schema
      return (
        `Готово!\n\n` +
        `DLL: ${report.dll}\n` +
        (schema
          ? `схема: ${schema.total} достижений, иконок ${schema.withIcons}` +
            `${schema.localized ? ', русские названия' : ''}` +
            `${schema.rarity ? ', редкость' : ''}\n`
          : '') +
        (report.interfaces?.generated
          ? `interfaces: сгенерирован из ${report.interfaces.source?.split('\\').pop()}\n`
          : '') +
        `${report.cover ? 'Обложка загружена с Steam CDN\n' : ''}` +
        (report.warnings.length ? `\n${report.warnings.join('\n')}\n` : '') +
        `\nЗапусти игру и разблокируй достижение — оно появится здесь.`
      )
    })
  }

  /** Import a user-provided emulator DLL instead of the downloaded build. */
  const runCustomDll = async (): Promise<void> => {
    try {
      const r = await window.api.pickCustomDll()
      if (!r) return
      await show({
        title: 'DLL импортирован',
        message:
          `${r.name} (${r.arch === 64 ? 'x64' : 'x86'}).\n\n` +
          'Теперь нажмите «🛠 Установить эмулятор» — будет использован ваш файл вместо скачиваемого.',
        tone: 'success'
      })
      refreshDiag()
    } catch (e) {
      await show({ title: 'Ошибка импорта DLL', message: errorText(e), tone: 'error' })
    }
  }

  const runRestore = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Откатить Steam-эмуляцию?',
      message:
        '— оригинальная steam_api.dll будет восстановлена из .valve.bak (или удалён установленный эмулятор)\n' +
        '— схема достижений и steam_appid.txt будут удалены\n\n' +
        'История достижений в библиотеке сохранится.',
      confirmLabel: 'Откатить',
      danger: true
    })
    if (!ok) return
    setSetupBusy(true)
    try {
      const report = (await window.api.restoreEmu(game.id)) as RestoreReport
      const lines: string[] = []
      if (report.restored.length) lines.push(`Восстановлено:\n${report.restored.join('\n')}`)
      if (report.removed.length) lines.push(`Удалено:\n${report.removed.join('\n')}`)
      if (report.warnings.length) lines.push(report.warnings.join('\n'))
      if (lines.length === 0) lines.push('Файлы эмуляции не найдены — откатывать нечего.')
      await show({ title: 'Откат выполнен', message: lines.join('\n\n'), tone: 'success' })
      refreshDiag()
    } catch (e) {
      await show({ title: 'Ошибка отката', message: errorText(e), tone: 'error' })
    } finally {
      setSetupBusy(false)
    }
  }

  const runSync = async (): Promise<void> => {
    try {
      const changed = await window.api.syncAchievements()
      toast(changed ? 'Найдены новые достижения' : 'Достижения уже актуальны', changed ? 'success' : 'info')
      refreshDiag()
    } catch (e) {
      toast(`Ошибка синхронизации: ${errorText(e)}`, 'error')
    }
  }

  const runExportUnlocks = async (): Promise<void> => {
    try {
      const r = await window.api.exportUnlocks(game.id)
      await show({
        title: 'Прогресс загружен в эмулятор',
        message: `Экспортировано: ${r.exported}\n\n${r.files.join('\n')}`,
        tone: 'success'
      })
    } catch (e) {
      await show({ title: 'Ошибка экспорта', message: errorText(e), tone: 'error' })
    }
  }

  const runReset = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Сбросить достижения?',
      message:
        `— счётчик станет 0/${achievements.length}\n` +
        '— runtime-файлы эмулятора (GSE Saves / Goldberg) будут удалены\n' +
        '— игра начнёт считать достижения заново\n\n' +
        'Отменить это нельзя.',
      confirmLabel: 'Сбросить',
      danger: true
    })
    if (!ok) return
    try {
      const r = await window.api.resetAchievements(game.id)
      await show({
        title: 'Достижения сброшены',
        message:
          `Сброшено: ${r.cleared}\n` +
          (r.files.length ? `\nУдалены файлы:\n${r.files.join('\n')}` : ''),
        tone: 'success'
      })
      onClose()
    } catch (e) {
      await show({ title: 'Ошибка сброса', message: errorText(e), tone: 'error' })
    }
  }

  /** Adds the game folder + cache to Defender exclusions (the AV false-positive fix). */
  const runAddExclusion = async (): Promise<void> => {
    try {
      const result = await window.api.addEmuExclusion(game.id)
      await show({
        title: result.ok ? 'Исключение добавлено' : 'Не удалось добавить исключение',
        message:
          result.message +
          (result.paths.length ? `\n\n${result.paths.join('\n')}` : ''),
        tone: result.ok ? 'success' : 'error'
      })
    } catch (e) {
      await show({ title: 'Ошибка', message: errorText(e), tone: 'error' })
    }
  }

  const diagText = diag
    ? [
        diag.customDll
          ? 'свой DLL'
          : diag.dll
            ? diag.dll.isEmulator
              ? 'эмулятор установлен'
              : 'оригинальная Steam DLL'
            : 'эмулятора нет',
        diag.dll?.backup ? 'бэкап: есть' : null,
        diag.schema ? `схема: ${diag.schema.total} ачивок` : 'схемы нет',
        diag.appidTxt ? 'appid: ок' : 'appid: нет',
        diag.interfaces ? 'interfaces: ок' : 'interfaces: нет',
        `runtime-файлы: ${diag.runtimeSaves > 0 ? 'есть' : 'нет'}`,
        diag.originalCandidates.length && !diag.dll?.isEmulator
          ? `оригинал: ${diag.originalCandidates.join(', ')}`
          : null
      ]
        .filter(Boolean)
        .join(' · ')
    : ''

  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="dialog dialog-wide" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h3>{game.name}</h3>
          <span className="ach-total">
            🏆 {unlocked} / {achievements.length}
          </span>
        </div>

        {diagText && <div className="emu-diag">{diagText}</div>}

        {achievements.length === 0 ? (
          <div className="ach-empty">
            Достижения ещё не найдены.
            <small>
              Для трекинга нужен Steam-эмулятор (GBE/Goldberg) в игре и схема достижений. «Схема и
              обложка» безопасна — она не меняет файлы игры. Установку эмулятора подтверждаете вы.
            </small>
            <button
              className="btn btn-primary setup-btn"
              disabled={setupBusy}
              onClick={() => void runInstall()}
            >
              {setupBusy ? 'Настраиваю…' : '🛠 Установить эмулятор (GBE)'}
            </button>
            <button
              className="btn setup-btn"
              disabled={setupBusy}
              onClick={() => void runSchema()}
              title="Названия, иконки, редкость и обложка с Steam CDN — без изменения DLL"
            >
              ⬇ Схема и обложка (без DLL)
            </button>
            <button
              className="btn setup-btn"
              disabled={setupBusy}
              onClick={() => void runCustomDll()}
              title="Использовать свой steam_api(64).dll вместо скачиваемого — тогда лаунчер ничего не скачивает"
            >
              📁 Свой DLL…
            </button>
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
                  {typeof a.progress === 'number' &&
                    typeof a.maxProgress === 'number' &&
                    a.maxProgress > 0 &&
                    !a.unlockedAt && (
                      <div className="ach-progress-line">
                        <div className="ach-bar mini">
                          <div
                            className="ach-bar-fill"
                            style={{
                              width: `${Math.min(100, (a.progress / a.maxProgress) * 100)}%`
                            }}
                          />
                        </div>
                        <span className="ach-progress-text">
                          {a.progress}/{a.maxProgress}
                        </span>
                      </div>
                    )}
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
          <button className="btn" onClick={() => void runSync()}>
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
            onClick={() => void runExportUnlocks()}
          >
            ⬆ Загрузить прогресс в эмулятор
          </button>
          <button
            className="btn"
            title="Сбросить счётчик: убрать разблокировки из библиотеки и удалить runtime-файлы эмулятора (аналог Reset в AW Next)"
            onClick={() => void runReset()}
          >
            🧹 Сбросить достижения
          </button>
          <button
            className="btn"
            disabled={setupBusy}
            title="Установить Steam-эмулятор (GBE): замена DLL с бэкапом + схема. Антивирус может отреагировать — это ложное срабатывание"
            onClick={() => void runInstall()}
          >
            {setupBusy ? '…' : '🛠 Установить эмулятор'}
          </button>
          <button
            className="btn"
            disabled={setupBusy}
            onClick={() => void runCustomDll()}
            title="Использовать свой steam_api(64).dll вместо скачиваемого — тогда лаунчер ничего не скачивает"
          >
            📁 Свой DLL…
          </button>
          <button
            className="btn"
            disabled={setupBusy}
            onClick={() => void runAddExclusion()}
            title="Добавить папку игры и кэш лаунчера в исключения Защитника Windows — убирает ложное срабатывание на эмулятор"
          >
            🛡 Исключение в Защитник
          </button>
          <button
            className="btn"
            disabled={setupBusy}
            onClick={() => void runSchema()}
            title="Схема, иконки, редкость и обложка (Steam / SteamGridDB / RAWG) — файлы игры не меняются"
          >
            {setupBusy ? '…' : '⚙ Схема и обложка'}
          </button>
          <button
            className="btn"
            disabled={setupBusy}
            title="Восстановить оригинальную steam_api.dll и удалить файлы эмулятора"
            onClick={() => void runRestore()}
          >
            ↩ Откатить эмуляцию
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
