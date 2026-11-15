import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Game, StoreGame, WishlistEntry } from '../../../shared/types'
import { STORE_GENRES } from '../../../shared/types'
import { useFeedback } from '../lib/feedback'
import { StoreGameDialog } from './StoreGameDialog'

/**
 * Storefront view: hero banner with the latest releases, "recommended for
 * you" (activity-weighted library genres), "similar to your games", a new
 * releases row with genre filters, the wishlist and a catalogue search.
 * Browsing only — opening a store game leads to a Steam search link, nothing
 * can be bought here.
 */

const LABEL_BY_SLUG = new Map(STORE_GENRES.map((g) => [g.slug, g.label]))

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '')
}

function formatDate(value?: string): string {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}

/** One clickable catalogue card (16:9 cover like RAWG provides) */
function StoreCard({
  game,
  owned,
  wished,
  onOpen
}: {
  game: StoreGame
  owned: boolean
  wished: boolean
  onOpen: (id: number) => void
}): React.JSX.Element {
  const [imgError, setImgError] = useState(false)
  const initials = game.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <div className="store-card" onClick={() => onOpen(game.id)}>
      <div className="store-card-cover">
        {game.coverUrl && !imgError ? (
          <img src={game.coverUrl} alt={game.name} loading="lazy" onError={() => setImgError(true)} />
        ) : (
          <div className="cover-fallback">{initials}</div>
        )}
        {owned && <div className="badge-owned">✓ в библиотеке</div>}
        {!owned && wished && <div className="badge-wished">⭐ в желаемом</div>}
      </div>
      <div className="store-card-body">
        <div className="store-card-title" title={game.name}>
          {game.name}
        </div>
        <div className="store-card-meta">
          <span>{formatDate(game.released)}</span>
          {game.rating ? <span>★ {game.rating.toFixed(1)}</span> : null}
        </div>
      </div>
    </div>
  )
}

/** Inline RAWG key setup, shown until the user provides a key */
function KeyPanel({ onSaved }: { onSaved: () => void }): React.JSX.Element {
  const [value, setValue] = useState('')

  const save = async (): Promise<void> => {
    const key = value.trim()
    if (!key) return
    await window.api.storeSetKey(key)
    onSaved()
  }

  return (
    <div className="store-key-panel">
      <h2>🛍 Витрина каталога</h2>
      <p>
        Новинки и рекомендации берутся из открытого каталога RAWG. Он бесплатный — нужен только
        персональный API-ключ (30 секунд на получение).
      </p>
      <div className="store-search-row">
        <input
          className="search-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
          placeholder="Вставьте RAWG API-ключ…"
        />
        <button className="btn btn-primary" onClick={() => void save()}>
          Подключить
        </button>
      </div>
      <button className="btn-ghost btn" onClick={() => window.open('https://rawg.io/apidocs')}>
        Получить бесплатный ключ на rawg.io/apidocs ↗
      </button>
    </div>
  )
}

function RowError({ message, onRetry }: { message: string; onRetry: () => void }): React.JSX.Element {
  return (
    <div className="store-row-error">
      <span>⚠ {message}</span>
      <button className="btn" onClick={onRetry}>
        Повторить
      </button>
    </div>
  )
}

export function StorePage({ games }: { games: Game[] }): React.JSX.Element {
  const [keyReady, setKeyReady] = useState(false)
  const [releases, setReleases] = useState<StoreGame[] | null>(null)
  const [releasesError, setReleasesError] = useState<string | null>(null)
  const [releasesPage, setReleasesPage] = useState(1)
  const [releasesHasMore, setReleasesHasMore] = useState(false)
  const [loadingMoreReleases, setLoadingMoreReleases] = useState(false)
  const [genre, setGenre] = useState<string | null>(null)
  const [releasesTick, setReleasesTick] = useState(0)
  const [recs, setRecs] = useState<StoreGame[] | null>(null)
  const [recBasis, setRecBasis] = useState<string[]>([])
  const [recError, setRecError] = useState<string | null>(null)
  const [recTick, setRecTick] = useState(0)
  const [heroIdx, setHeroIdx] = useState(0)
  const [detailsId, setDetailsId] = useState<number | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<StoreGame[] | null>(null)
  const [searchPage, setSearchPage] = useState(1)
  const [searchHasMore, setSearchHasMore] = useState(false)
  const [loadingMoreSearch, setLoadingMoreSearch] = useState(false)
  const [wishlist, setWishlist] = useState<WishlistEntry[]>([])
  const [similarSource, setSimilarSource] = useState<string | null>(null)
  const [similar, setSimilar] = useState<StoreGame[] | null>(null)
  const [similarName, setSimilarName] = useState('')
  const [similarError, setSimilarError] = useState<string | null>(null)
  const [similarTick, setSimilarTick] = useState(0)
  const { toast } = useFeedback()

  const ownedNames = useMemo(
    () => new Set(games.map((g) => normalizeName(g.name))),
    [games]
  )
  const wishlistIds = useMemo(() => new Set(wishlist.map((w) => w.id)), [wishlist])
  /** The user's most played games — sources for "similar to your games" */
  const topPlayed = useMemo(
    () => [...games].sort((a, b) => (b.playtimeSeconds ?? 0) - (a.playtimeSeconds ?? 0)).slice(0, 6),
    [games]
  )

  /* initial key + wishlist check */
  useEffect(() => {
    let alive = true
    void window.api.storeGetKey().then((key) => {
      if (alive && key.trim()) setKeyReady(true)
    })
    void window.api.storeWishlistGet().then((list) => {
      if (alive) setWishlist(list)
    })
    return () => {
      alive = false
    }
  }, [])

  /* new releases (also re-fetched when the genre filter changes) */
  useEffect(() => {
    if (!keyReady) return
    let alive = true
    setReleases(null)
    setReleasesError(null)
    setReleasesPage(1)
    setReleasesHasMore(false)
    void window.api.storeNewReleases(genre ?? undefined, 1).then((res) => {
      if (!alive) return
      if (res.ok && res.data) {
        setReleases(res.data.items)
        setReleasesHasMore(res.data.hasMore)
        setHeroIdx(0)
      } else {
        setReleasesError(res.error ?? 'Не удалось загрузить новинки')
      }
    })
    return () => {
      alive = false
    }
  }, [keyReady, genre, releasesTick])

  const loadMoreReleases = async (): Promise<void> => {
    if (loadingMoreReleases || !releasesHasMore) return
    const nextPage = releasesPage + 1
    setLoadingMoreReleases(true)
    try {
      const res = await window.api.storeNewReleases(genre ?? undefined, nextPage)
      if (res.ok && res.data) {
        setReleases((current) => [...(current ?? []), ...res.data!.items])
        setReleasesHasMore(res.data.hasMore)
        setReleasesPage(nextPage)
      } else {
        toast(res.error ?? 'Не удалось загрузить новинки', 'error')
      }
    } finally {
      setLoadingMoreReleases(false)
    }
  }

  /* recommendations: computed from the library, refetchable via ↻ */
  useEffect(() => {
    if (!keyReady) return
    let alive = true
    setRecs(null)
    setRecError(null)
    void window.api.storeRecommend().then((res) => {
      if (!alive) return
      if (res.ok && res.data) {
        setRecs(res.data.games)
        setRecBasis(res.data.basisSlugs)
      } else {
        setRecError(res.error ?? 'Не удалось загрузить рекомендации')
      }
    })
    return () => {
      alive = false
    }
  }, [keyReady, recTick])

  /* similar-to-your-games: pick the default source, then load its suggestions */
  useEffect(() => {
    if (!keyReady || similarSource || topPlayed.length === 0) return
    setSimilarSource(topPlayed[0].id)
  }, [keyReady, similarSource, topPlayed])

  useEffect(() => {
    if (!keyReady || !similarSource) return
    let alive = true
    setSimilar(null)
    setSimilarError(null)
    setSimilarName('')
    void window.api.storeSimilarForGame(similarSource).then((res) => {
      if (!alive) return
      if (res.ok && res.data) {
        setSimilar(res.data.games)
        setSimilarName(res.data.source ?? '')
      } else {
        setSimilarError(res.error ?? 'Не удалось загрузить похожие игры')
      }
    })
    return () => {
      alive = false
    }
  }, [keyReady, similarSource, similarTick])

  /* hero carousel auto-advance */
  const featured = useMemo(() => (releases ?? []).slice(0, 5), [releases])
  useEffect(() => {
    if (featured.length <= 1) return
    const timer = setInterval(() => setHeroIdx((i) => (i + 1) % featured.length), 6000)
    return () => clearInterval(timer)
  }, [featured])

  const search = async (): Promise<void> => {
    const q = searchTerm.trim()
    if (q.length < 2) return
    setSearching(true)
    try {
      const res = await window.api.storeSearch(q, 1)
      if (res.ok && res.data) {
        setSearchResults(res.data.items)
        setSearchHasMore(res.data.hasMore)
      } else {
        setSearchResults([])
        setSearchHasMore(false)
        toast(res.error ?? 'Не удалось выполнить поиск', 'error')
      }
      setSearchPage(1)
    } finally {
      setSearching(false)
    }
  }

  const loadMoreSearch = async (): Promise<void> => {
    if (loadingMoreSearch || !searchHasMore) return
    const nextPage = searchPage + 1
    setLoadingMoreSearch(true)
    try {
      const res = await window.api.storeSearch(searchTerm.trim(), nextPage)
      if (res.ok && res.data) {
        setSearchResults((current) => [...(current ?? []), ...res.data!.items])
        setSearchHasMore(res.data.hasMore)
        setSearchPage(nextPage)
      } else {
        toast(res.error ?? 'Не удалось загрузить результаты', 'error')
      }
    } finally {
      setLoadingMoreSearch(false)
    }
  }

  const hero = featured[Math.min(heroIdx, Math.max(featured.length - 1, 0))]
  const basisLabels = recBasis.map((slug) => LABEL_BY_SLUG.get(slug) ?? slug)

  /** Toggles a store game in the wishlist and keeps the UI in sync */
  const toggleWishlist = async (game: StoreGame, isWished: boolean): Promise<void> => {
    const list = isWished
      ? await window.api.storeWishlistRemove(game.id)
      : await window.api.storeWishlistAdd({ ...game, addedAt: Date.now() })
    setWishlist(list)
  }

  /** Badge state for a catalogue card */
  const badges = (g: StoreGame): { owned: boolean; wished: boolean } => ({
    owned: ownedNames.has(normalizeName(g.name)),
    wished: wishlistIds.has(g.id)
  })

  return (
    <div className="store-page">
      {!keyReady ? (
        <KeyPanel
          onSaved={() => {
            setKeyReady(true)
          }}
        />
      ) : (
        <>
          {/* hero banner */}
          {hero && (
            <div className="store-hero">
              {hero.coverUrl && (
                <div
                  className="store-hero-bg"
                  key={hero.id}
                  style={{ backgroundImage: `url(${hero.coverUrl})` }}
                />
              )}
              <div className="store-hero-fade" />
              <button
                className="store-hero-arrow left"
                title="Предыдущая"
                onClick={() => setHeroIdx((i) => (i - 1 + featured.length) % featured.length)}
              >
                ‹
              </button>
              <button
                className="store-hero-arrow right"
                title="Следующая"
                onClick={() => setHeroIdx((i) => (i + 1) % featured.length)}
              >
                ›
              </button>
              <div className="store-hero-content">
                <div className="store-hero-tag">Новинка</div>
                <div className="store-hero-title">{hero.name}</div>
                <div className="store-hero-meta">
                  {formatDate(hero.released) && <span>{formatDate(hero.released)}</span>}
                  {hero.rating ? <span>★ {hero.rating.toFixed(1)} / 5</span> : null}
                  {hero.metacritic ? <span className="store-mc">MC {hero.metacritic}</span> : null}
                  {hero.genres?.slice(0, 3).map((g) => (
                    <span key={g} className="genre-chip">
                      {g}
                    </span>
                  ))}
                </div>
                <div className="store-hero-buttons">
                  <button className="btn btn-primary" onClick={() => setDetailsId(hero.id)}>
                    Подробнее
                  </button>
                </div>
                <div className="store-hero-dots">
                  {featured.map((g, i) => (
                    <button
                      key={g.id}
                      className={i === heroIdx ? 'dot active' : 'dot'}
                      title={g.name}
                      onClick={() => setHeroIdx(i)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* wishlist */}
          {wishlist.length > 0 && (
            <section>
              <div className="store-section-head">
                <div>
                  <div className="store-section-title">⭐ Желаемое</div>
                  <div className="store-section-sub">
                    игры, отмеченные на витрине · сохраняются в профиле
                  </div>
                </div>
              </div>
              <Row>
                {wishlist.map((g) => (
                  <StoreCard key={g.id} game={g} owned={false} wished onOpen={setDetailsId} />
                ))}
              </Row>
            </section>
          )}

          {/* recommendations */}
          <section>
            <div className="store-section-head">
              <div>
                <div className="store-section-title">
                  {basisLabels.length > 0 ? 'Рекомендуем вам' : 'Популярное сейчас'}
                </div>
                <div className="store-section-sub">
                  {basisLabels.length > 0
                    ? `по жанрам вашей библиотеки: ${basisLabels.join(', ')}`
                    : 'определим жанры, когда в играх появятся метаданные'}
                </div>
              </div>
              <button className="icon-btn" title="Обновить рекомендации" onClick={() => setRecTick((t) => t + 1)}>
                ↻
              </button>
            </div>
            {recError ? (
              <RowError message={recError} onRetry={() => setRecTick((t) => t + 1)} />
            ) : !recs ? (
              <div className="store-row-loading">Загрузка…</div>
            ) : recs.length === 0 ? (
              <div className="store-row-loading">Пока нечего посоветовать — добавьте игр в библиотеку.</div>
            ) : (
              <Row>
                {recs.map((g) => (
                  <StoreCard key={g.id} game={g} {...badges(g)} onOpen={setDetailsId} />
                ))}
              </Row>
            )}
          </section>

          {/* similar to your games */}
          {topPlayed.length > 0 && (
            <section>
              <div className="store-section-head">
                <div>
                  <div className="store-section-title">Похожие на ваши игры</div>
                  <div className="store-section-sub">
                    {similarName ? `потому что вы играли в «${similarName}»` : 'выберите игру-источник'}
                  </div>
                </div>
                <div className="store-genres">
                  {topPlayed.map((g) => (
                    <button
                      key={g.id}
                      className={similarSource === g.id ? 'chip active' : 'chip'}
                      title={g.name}
                      onClick={() => setSimilarSource(g.id)}
                    >
                      {g.name}
                    </button>
                  ))}
                </div>
              </div>
              {similarError ? (
                <RowError message={similarError} onRetry={() => setSimilarTick((t) => t + 1)} />
              ) : !similar ? (
                <div className="store-row-loading">Загрузка…</div>
              ) : similar.length === 0 ? (
                <div className="store-row-loading">
                  Не нашли эту игру в каталоге RAWG — попробуйте другую.
                </div>
              ) : (
                <Row>
                  {similar.map((g) => (
                    <StoreCard key={g.id} game={g} {...badges(g)} onOpen={setDetailsId} />
                  ))}
                </Row>
              )}
            </section>
          )}

          {/* new releases + genre filter */}
          <section>
            <div className="store-section-head">
              <div>
                <div className="store-section-title">Новинки</div>
                <div className="store-section-sub">релизы последних 60 дней</div>
              </div>
              <div className="store-genres">
                <button
                  className={genre === null ? 'chip active' : 'chip'}
                  onClick={() => setGenre(null)}
                >
                  Все
                </button>
                {STORE_GENRES.map((g) => (
                  <button
                    key={g.slug}
                    className={genre === g.slug ? 'chip active' : 'chip'}
                    onClick={() => setGenre(g.slug)}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
            {releasesError ? (
              <RowError message={releasesError} onRetry={() => setReleasesTick((t) => t + 1)} />
            ) : !releases ? (
              <div className="store-row-loading">Загрузка…</div>
            ) : (
              <Row>
                {releases.map((g) => (
                  <StoreCard key={g.id} game={g} {...badges(g)} onOpen={setDetailsId} />
                ))}
              </Row>
            )}
            {releasesHasMore && (
              <div className="store-more">
                <button className="btn" disabled={loadingMoreReleases} onClick={() => void loadMoreReleases()}>
                  {loadingMoreReleases ? 'Загрузка…' : 'Показать ещё'}
                </button>
              </div>
            )}
          </section>

          {/* catalogue search */}
          <section>
            <div className="store-section-head">
              <div>
                <div className="store-section-title">Поиск по каталогу</div>
                <div className="store-section-sub">более 800 000 игр RAWG</div>
              </div>
            </div>
            <div className="store-search-row">
              <input
                className="search-input"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void search()}
                placeholder="Название игры…"
              />
              <button className="btn btn-primary" onClick={() => void search()} disabled={searching}>
                {searching ? '…' : 'Найти'}
              </button>
            </div>
            {searchResults && (
              <div className="store-grid">
                {searchResults.map((g) => (
                  <StoreCard key={g.id} game={g} {...badges(g)} onOpen={setDetailsId} />
                ))}
              </div>
            )}
            {searchHasMore && (
              <div className="store-more">
                <button className="btn" disabled={loadingMoreSearch} onClick={() => void loadMoreSearch()}>
                  {loadingMoreSearch ? 'Загрузка…' : 'Показать ещё'}
                </button>
              </div>
            )}
          </section>
        </>
      )}

      {detailsId !== null && (
        createPortal(
          <StoreGameDialog
            gameId={detailsId}
            inWishlist={wishlistIds.has(detailsId)}
            onToggleWishlist={(game, isWished) => void toggleWishlist(game, isWished)}
            onClose={() => setDetailsId(null)}
          />,
          document.body
        )
      )}
    </div>
  )
}

/** Horizontal scrollable row with arrow buttons on the sides */
function Row({ children }: { children: React.ReactNode }): React.JSX.Element {
  const scroller = useRef<HTMLDivElement | null>(null)
  const scroll = (dir: 1 | -1): void => {
    const el = scroller.current
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: 'smooth' })
  }
  return (
    <div className="store-row-wrap">
      <button
        className="store-row-arrow left"
        title="Прокрутить влево"
        onClick={() => scroll(-1)}
      >
        ‹
      </button>
      <div className="store-row" ref={scroller}>
        {children}
      </div>
      <button
        className="store-row-arrow right"
        title="Прокрутить вправо"
        onClick={() => scroll(1)}
      >
        ›
      </button>
    </div>
  )
}
