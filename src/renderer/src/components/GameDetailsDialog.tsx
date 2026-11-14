import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { Game } from '../../../shared/types'
import { mediaUrl } from '../lib/media'
import { TorrentSearchDialog } from './TorrentSearchDialog'

/**
 * Full-page game details: hero image, description, screenshots and trailer —
 * all streamed from the Steam CDN by URL, nothing is stored on disk.
 */
export function GameDetailsDialog({
  game,
  onClose
}: {
  game: Game
  onClose: () => void
}): React.JSX.Element {
  const meta = game.metadata
  const [busy, setBusy] = useState(false)
  const [showFull, setShowFull] = useState(false)
  const [showTrailer, setShowTrailer] = useState(false)
  const [bigShot, setBigShot] = useState<string | null>(null)
  const [torrentOpen, setTorrentOpen] = useState(false)

  const refresh = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.api.syncGameMetadata(game.id)
      if (!result.ok) alert(result.message ?? 'Не удалось загрузить метаданные')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="overlay details-overlay" onClick={onClose}>
      <div className="details-panel" onClick={(e) => e.stopPropagation()}>
        <button className="details-close" title="Закрыть" onClick={onClose}>
          ✕
        </button>

        {/* hero backdrop */}
        {meta?.heroUrl || meta?.headerUrl ? (
          <div
            className="details-hero"
            style={{ backgroundImage: `url(${meta.heroUrl ?? meta.headerUrl})` }}
          />
        ) : (
          <div className="details-hero details-hero-empty" />
        )}
        <div className="details-hero-fade" />

        <div className="details-body">
          <div className="details-head">
            <div className="details-cover">
              {game.coverPath ? (
                <img src={mediaUrl(game.coverPath)} alt={game.name} />
              ) : meta?.coverUrl ? (
                <img src={meta.coverUrl} alt={game.name} />
              ) : (
                <div className="cover-fallback">{game.name.slice(0, 2).toUpperCase()}</div>
              )}
            </div>
            <div className="details-head-info">
              <h2>{game.name}</h2>
              <div className="details-sub">
                {meta?.developer?.join(', ')}
                {meta?.developer && meta?.publisher ? ' · ' : ''}
                {meta?.publisher?.length && meta.publisher[0] !== meta.developer?.[0]
                  ? meta.publisher.join(', ')
                  : ''}
              </div>
              <div className="details-facts">
                {meta?.ratingPct !== undefined && (
                  <span
                    className={`rating-badge ${meta.ratingPct >= 70 ? 'rating-good' : 'rating-mid'}`}
                    title={meta.ratingLabel}
                  >
                    ★ {meta.ratingPct}%
                  </span>
                )}
                {meta?.ratingLabel && <span className="fact">{meta.ratingLabel}</span>}
                {meta?.releaseDate && <span className="fact">{meta.releaseDate}</span>}
              </div>
              {meta?.genres && meta.genres.length > 0 && (
                <div className="genre-row">
                  {meta.genres.slice(0, 6).map((g) => (
                    <span key={g} className="genre-chip">
                      {g}
                    </span>
                  ))}
                </div>
              )}
              <div className="details-actions">
                <button className="btn btn-play" onClick={() => void window.api.launchGame(game.id)}>
                  Играть
                </button>
                <button className="btn" disabled={busy} onClick={() => void refresh()}>
                  {busy ? 'Загрузка…' : '⟳ Обновить метаданные'}
                </button>
                <button className="btn" onClick={() => setTorrentOpen(true)}>
                  ⬇ Найти раздачу
                </button>
                {meta?.storeUrl && (
                  <a className="btn" href={meta.storeUrl} target="_blank" rel="noreferrer">
                    Страница в Steam ↗
                  </a>
                )}
              </div>
              {!meta && !busy && (
                <div className="details-hint">
                  Метаданных ещё нет — нажмите «Обновить метаданные»
                  {game.appId ? '' : ' (или укажите Steam AppID в редакторе игры)'}
                </div>
              )}
            </div>
          </div>

          {meta?.shortDescription && (
            <p className="details-short">{meta.shortDescription}</p>
          )}

          {meta?.trailerUrl && (
            <div className="trailer-block">
              {showTrailer ? (
                <video src={meta.trailerUrl} controls autoPlay className="trailer-player" />
              ) : (
                <button
                  className="trailer-thumb"
                  style={meta.trailerThumbUrl ? { backgroundImage: `url(${meta.trailerThumbUrl})` } : undefined}
                  onClick={() => setShowTrailer(true)}
                >
                  <span className="trailer-play">▶ Смотреть трейлер</span>
                </button>
              )}
            </div>
          )}

          {meta?.screenshots && meta.screenshots.length > 0 && (
            <>
              <h4 className="details-section-title">Скриншоты</h4>
              <div className="shots-row">
                {meta.screenshots.map((s) => (
                  <button
                    key={s.url}
                    className="shot-thumb"
                    style={{ backgroundImage: `url(${s.thumbUrl ?? s.url})` }}
                    onClick={() => setBigShot(s.url)}
                  />
                ))}
              </div>
            </>
          )}

          {meta?.fullDescription && (
            <>
              <h4 className="details-section-title">Об игре</h4>
              <div
                className={`details-desc ${showFull ? '' : 'collapsed'}`}
                dangerouslySetInnerHTML={{ __html: meta.fullDescription }}
              />
              {!showFull && (
                <button className="btn btn-ghost" onClick={() => setShowFull(true)}>
                  Показать полностью…
                </button>
              )}
            </>
          )}
        </div>

        {bigShot && (
          <div className="shot-viewer" onClick={() => setBigShot(null)}>
            <img src={bigShot} alt="Скриншот" />
          </div>
        )}

        {torrentOpen && (
          <TorrentSearchDialog initialQuery={game.name} onClose={() => setTorrentOpen(false)} />
        )}
      </div>
    </div>,
    document.body
  )
}
