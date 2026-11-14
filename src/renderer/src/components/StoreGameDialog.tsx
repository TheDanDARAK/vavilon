import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { StoreGame, StoreGameDetails } from '../../../shared/types'
import { TorrentSearchDialog } from './TorrentSearchDialog'

/**
 * Storefront game details: hero, description, screenshots, wishlist toggle
 * and a "find in Steam" jump. Browsing only — the storefront never sells
 * anything.
 */

export function StoreGameDialog({
  gameId,
  inWishlist,
  onToggleWishlist,
  onClose
}: {
  gameId: number
  inWishlist: boolean
  onToggleWishlist: (game: StoreGame, isWished: boolean) => void
  onClose: () => void
}): React.JSX.Element {
  const [details, setDetails] = useState<StoreGameDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showFull, setShowFull] = useState(false)
  const [bigShot, setBigShot] = useState<string | null>(null)
  const [torrentOpen, setTorrentOpen] = useState(false)

  useEffect(() => {
    let alive = true
    void window.api.storeDetails(gameId).then((res) => {
      if (!alive) return
      if (res.ok && res.data) setDetails(res.data)
      else setError(res.error ?? 'Не удалось загрузить описание игры')
    })
    return () => {
      alive = false
    }
  }, [gameId])

  const steamSearchUrl = details
    ? `https://store.steampowered.com/search/?term=${encodeURIComponent(details.name)}`
    : null

  const openUrl = (url: string): void => {
    window.open(url)
  }

  return createPortal(
    <div className="overlay details-overlay" onClick={onClose}>
      <div className="details-panel" onClick={(e) => e.stopPropagation()}>
        <button className="details-close" title="Закрыть" onClick={onClose}>
          ✕
        </button>

        {details ? (
          <>
            {details.coverUrl && (
              <div
                className="details-hero"
                style={{ backgroundImage: `url(${details.coverUrl})` }}
              />
            )}
            <div className="details-hero-fade" />

            <div className="details-body">
              <div className="details-head">
                <div className="details-cover">
                  {details.coverUrl ? (
                    <img src={details.coverUrl} alt={details.name} />
                  ) : (
                    <div className="cover-fallback">{details.name.slice(0, 2).toUpperCase()}</div>
                  )}
                </div>
                <div className="details-head-info">
                  <h2>{details.name}</h2>
                  <div className="details-facts">
                    {details.released && (
                      <span className="fact">📅 {new Date(details.released).toLocaleDateString()}</span>
                    )}
                    {details.rating ? (
                      <span className="fact">★ {details.rating.toFixed(1)} / 5 (RAWG)</span>
                    ) : null}
                    {details.metacritic && (
                      <span className="rating-badge rating-good">Metacritic {details.metacritic}</span>
                    )}
                  </div>
                  {details.genres && details.genres.length > 0 && (
                    <div className="genre-row">
                      {details.genres.map((g) => (
                        <span key={g} className="genre-chip">
                          {g}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="details-actions">
                    <a
                      className="btn btn-primary"
                      href={steamSearchUrl ?? undefined}
                      onClick={(e) => {
                        e.preventDefault()
                        if (steamSearchUrl) openUrl(steamSearchUrl)
                      }}
                    >
                      Найти в Steam ↗
                    </a>
                    <button
                      className={inWishlist ? 'btn btn-wished' : 'btn'}
                      onClick={() => onToggleWishlist(details, inWishlist)}
                    >
                      {inWishlist ? '★ В желаемом' : '☆ В желаемое'}
                    </button>
                    <button className="btn" onClick={() => setTorrentOpen(true)}>
                      ⬇ Найти раздачу
                    </button>
                    {details.website && (
                      <button className="btn" onClick={() => openUrl(details.website as string)}>
                        Официальный сайт ↗
                      </button>
                    )}
                  </div>
                  <div className="details-hint">
                    Витрина — только каталог: ссылка откроет страницу игры в Steam в браузере.
                  </div>
                </div>
              </div>

              {details.description && (
                <div
                  className={
                    showFull ? 'details-desc store-desc' : 'details-desc collapsed store-desc'
                  }
                >
                  {details.description}
                </div>
              )}
              {details.description && (
                <button className="btn btn-ghost" onClick={() => setShowFull((v) => !v)}>
                  {showFull ? 'Свернуть' : 'Показать полностью'}
                </button>
              )}

              {details.screenshots && details.screenshots.length > 0 && (
                <>
                  <div className="details-section-title">Скриншоты</div>
                  <div className="shots-row">
                    {details.screenshots.map((shot) => (
                      <div
                        key={shot.url}
                        className="shot-thumb"
                        style={{ backgroundImage: `url(${shot.thumbUrl ?? shot.url})` }}
                        onClick={() => setBigShot(shot.url)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            {bigShot && (
              <div className="shot-viewer" onClick={() => setBigShot(null)}>
                <img src={bigShot} alt="Скриншот" />
              </div>
            )}

            {torrentOpen && (
              <TorrentSearchDialog
                initialQuery={details.name}
                onClose={() => setTorrentOpen(false)}
              />
            )}
          </>
        ) : (
          <div className="store-dialog-loading">
            {error ? `⚠ ${error}` : 'Загрузка…'}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
