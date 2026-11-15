import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { Game, GameMetadata } from '../../../shared/types'
import { formatArgs, parseArgs } from '../../../shared/args'
import { mediaUrl } from '../lib/media'
import { useFeedback } from '../lib/feedback'
import { errorText } from '../lib/errors'
import { SteamSearchField } from './SteamSearchField'

/**
 * Edit dialog for a library game: name, exe, working directory, launch
 * arguments, Steam AppID and cover image.
 * Fields cleared to empty are sent as undefined — the main process spread
 * removes them from the record (JSON then drops the key entirely).
 */
export function EditGameDialog({
  game,
  onClose
}: {
  game: Game
  onClose: () => void
}): React.JSX.Element {
  const [name, setName] = useState(game.name)
  const [exePath, setExePath] = useState(game.exePath)
  const [workDir, setWorkDir] = useState(game.workDir ?? '')
  const [args, setArgs] = useState(formatArgs(game.args ?? []))
  const [appId, setAppId] = useState(game.appId ? String(game.appId) : '')
  const [coverPath, setCoverPath] = useState(game.coverPath)
  const [busy, setBusy] = useState(false)
  /** Metadata fetched through the search, applied on save */
  const [fetchedMeta, setFetchedMeta] = useState<GameMetadata | null>(null)
  const { toast } = useFeedback()

  const pickExe = async (): Promise<void> => {
    const picked = await window.api.pickExe()
    if (picked) {
      setExePath(picked.exePath)
      // refresh the working dir together with the exe unless the user typed one
      if (!workDir.trim()) setWorkDir(picked.suggestedWorkDir)
    }
  }

  const pickCover = async (): Promise<void> => {
    const path = await window.api.pickCover(game.id)
    if (path) setCoverPath(path)
  }

  /** A Steam search hit fills the AppID, the canonical name and pulls metadata */
  const pickSteamHit = async (hit: { appId: number; name: string }): Promise<void> => {
    setAppId(String(hit.appId))
    setName(hit.name)
    setBusy(true)
    try {
      const meta = await window.api.fetchMetadata(hit.appId)
      if (meta) {
        setFetchedMeta(meta)
        setCoverPath(undefined) // show the internet cover instead of the old one
      }
    } finally {
      setBusy(false)
    }
  }

  /** Re-downloads metadata from the store for the currently entered AppID */
  const syncMeta = async (): Promise<void> => {
    const id = Number(appId)
    if (!appId || !Number.isInteger(id) || id <= 0) {
      toast('Сначала укажите корректный Steam AppID', 'warning')
      return
    }
    setBusy(true)
    try {
      const meta = await window.api.fetchMetadata(id)
      if (meta) {
        setFetchedMeta(meta)
        if (!game.coverPath) setCoverPath(undefined)
      } else {
        toast('Steam не вернул данные для этого AppID', 'warning')
      }
    } catch (e) {
      toast(`Ошибка сети: ${errorText(e)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    const appIdNum = Number(appId)
    const appIdFinal =
      appId && Number.isInteger(appIdNum) && appIdNum > 0 ? appIdNum : undefined
    await window.api.updateGame(game.id, {
      name: name.trim() || game.name,
      exePath,
      // empty working dir → falls back to the exe folder everywhere in the main process
      workDir: workDir.trim() || undefined,
      args: parseArgs(args),
      appId: appIdFinal,
      ...(fetchedMeta && fetchedMeta.appId === appIdFinal ? { metadata: fetchedMeta } : {})
    })
    onClose()
  }

  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Изменить игру</h3>
        <SteamSearchField
          placeholder="Найти игру в Steam (заполнит AppID, имя и метаданные)…"
          onPick={(h) => void pickSteamHit(h)}
        />
        <div className="edit-cover-row">
          {coverPath ? (
            <img className="cover-preview" src={mediaUrl(coverPath)} alt="Обложка" />
          ) : fetchedMeta?.coverUrl ? (
            <img className="cover-preview" src={fetchedMeta.coverUrl} alt="Обложка" />
          ) : (
            <div className="cover-preview cover-preview-empty">?</div>
          )}
          <div className="edit-cover-actions">
            <button className="btn" onClick={() => void pickCover()}>
              Выбрать обложку…
            </button>
            {coverPath && (
              <button className="btn" onClick={() => void window.api.removeCover(game.id).then(() => setCoverPath(undefined))}>
                Убрать
              </button>
            )}
            <button className="btn" disabled={busy} onClick={() => void syncMeta()}>
              ⟳ Метаданные из Steam
            </button>
            {fetchedMeta && <small>✓ Найдено: {fetchedMeta.shortDescription?.slice(0, 90) ?? 'метаданные загружены'}…</small>}
            <small>Обложку можно взять с Steam CDN кнопкой «⚙ Схема и обложка» в окне достижений.</small>
          </div>
        </div>
        <button className="btn" onClick={() => void pickExe()}>
          Выбрать exe…
        </button>
        <div className="path">{exePath}</div>
        <label className="field">
          Название
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название игры" />
        </label>
        <label className="field">
          Рабочая папка (пусто = папка exe)
          <input
            value={workDir}
            onChange={(e) => setWorkDir(e.target.value)}
            placeholder="например D:\\Games\\CoolGame"
          />
        </label>
        <label className="field">
          Аргументы запуска
          <input
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            placeholder="например --windowed -novid"
          />
        </label>
        <label className="field">
          Steam AppID (для достижений и обложки)
          <input
            value={appId}
            onChange={(e) => setAppId(e.target.value.replace(/\D/g, ''))}
            placeholder="например 1091500"
            inputMode="numeric"
          />
        </label>
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" disabled={!exePath || busy} onClick={() => void save()}>
            Сохранить
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
