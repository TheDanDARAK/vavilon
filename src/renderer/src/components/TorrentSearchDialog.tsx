import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TorrentResult } from '../../../shared/types'

/**
 * Torrent search sheet backed by search.exfreedomist.com.
 *
 * Opens pre-filled with the game name, lists releases from all supported
 * trackers and resolves the actual magnet URI on demand (the aggregator's
 * magnet links are one-time and short-lived). The resolved URI is cached per
 * release for the lifetime of the dialog.
 */

const ORDER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'd', label: 'по популярности' },
  { value: 's', label: 'по сидам' },
  { value: 't', label: 'по свежести' },
  { value: 'z', label: 'по размеру ↓' },
  { value: 'r', label: 'по размеру ↑' },
  { value: 'l', label: 'по названию' }
]

const PAGE_SIZE = 20

function formatNumber(value?: number): string {
  return value === undefined ? '—' : value.toLocaleString('ru-RU')
}

function formatDate(value?: string): string {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('ru-RU')
}

export function TorrentSearchDialog({
  initialQuery,
  onClose
}: {
  initialQuery: string
  onClose: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState(initialQuery)
  const [orderBy, setOrderBy] = useState('d')
  const [results, setResults] = useState<TorrentResult[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [magnets, setMagnets] = useState<Record<string, string>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const requestId = useRef(0)
  const lastQuery = useRef('')

  const search = async (
    term: string,
    sort: string,
    offset = 0,
    append = false
  ): Promise<void> => {
    const q = term.trim()
    if (q.length < 2) return
    const id = ++requestId.current
    if (append) setLoadingMore(true)
    else {
      setLoading(true)
      setResults([])
      setTotal(0)
    }
    setError(null)
    setNotice(null)
    try {
      const res = await window.api.torrentsSearch(q, { orderBy: sort, offset })
      // a newer request (or a closed dialog) wins
      if (id !== requestId.current) return
      if (!res.ok || !res.data) {
        setError(res.error ?? 'Не удалось выполнить поиск')
        if (append) setResults([])
        return
      }
      setSearched(true)
      setTotal(res.data.total)
      lastQuery.current = q
      setResults((prev) => (append ? [...prev, ...res.data!.results] : res.data!.results))
    } finally {
      if (id === requestId.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }

  /* auto-search the game name as soon as the sheet opens */
  useEffect(() => {
    void search(initialQuery, 'd')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = (): void => {
    const q = query.trim()
    if (q.length < 2) return
    void search(q, orderBy)
  }

  const changeSort = (next: string): void => {
    setOrderBy(next)
    void search(query, next)
  }

  const loadMore = (): void => {
    if (loadingMore || results.length >= total) return
    void search(lastQuery.current || query, orderBy, results.length, true)
  }

  /** Fetches the one-time magnet page, copies the URI and caches it */
  const getMagnet = async (item: TorrentResult): Promise<string | null> => {
    const cached = magnets[item.key]
    if (cached) return cached
    setBusyKey(item.key)
    setNotice(null)
    try {
      const res = await window.api.torrentsMagnet(item.key)
      if (!res.ok || !res.data) {
        setNotice(res.error ?? 'Не удалось получить magnet-ссылку')
        return null
      }
      const uri = res.data
      setMagnets((prev) => ({ ...prev, [item.key]: uri }))
      await window.api.torrentsCopy(uri)
      setNotice('Magnet-ссылка скопирована в буфер обмена')
      return uri
    } finally {
      setBusyKey(null)
    }
  }

  const copy = async (item: TorrentResult): Promise<void> => {
    const uri = await getMagnet(item)
    if (!uri) return
    // getMagnet already copied on the first call; an explicit copy keeps the
    // button predictable on subsequent clicks
    await window.api.torrentsCopy(uri)
    setNotice('Magnet-ссылка скопирована в буфер обмена')
  }

  const open = async (item: TorrentResult): Promise<void> => {
    const uri = await getMagnet(item)
    if (!uri) return
    const ok = await window.api.torrentsOpen(uri)
    setNotice(ok ? 'Передано в торрент-клиент' : 'Не удалось открыть magnet-ссылку')
  }

  return createPortal(
    <div
      className="overlay torrent-overlay"
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
    >
      <div className="torrent-panel" onClick={(e) => e.stopPropagation()}>
        <button className="details-close" title="Закрыть" onClick={onClose}>
          ✕
        </button>

        <div className="torrent-head">
          <div>
            <h2>Найти раздачу</h2>
            <div className="torrent-sub">поиск торрентов через search.exfreedomist.com</div>
          </div>
        </div>

        <div className="torrent-search-row">
          <input
            className="search-input"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Название игры…"
          />
          <select
            className="torrent-sort"
            value={orderBy}
            title="Сортировка"
            onChange={(e) => changeSort(e.target.value)}
          >
            {ORDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={submit} disabled={loading}>
            {loading ? '…' : 'Искать'}
          </button>
        </div>

        {notice && <div className="torrent-notice">{notice}</div>}
        {error && <div className="torrent-error">⚠ {error}</div>}

        {searched && !loading && !error && (
          <div className="torrent-count">
            {total > 0 ? `Найдено раздач: ${formatNumber(total)}` : 'Ничего не найдено'}
          </div>
        )}

        {loading ? (
          <div className="torrent-loading">Ищем раздачи…</div>
        ) : (
          <div className="torrent-list">
            {results.map((item) => {
              const magnet = magnets[item.key]
              return (
                <div key={item.key} className="torrent-result">
                  <div className="torrent-result-top">
                    {item.tracker && <span className="torrent-tracker">{item.tracker}</span>}
                    {item.category && <span className="torrent-cat">{item.category}</span>}
                    {item.verified && (
                      <span className="torrent-verified" title="Проверено агрегатором">
                        ✅
                      </span>
                    )}
                  </div>

                  <div className="torrent-title" title={item.title}>
                    {item.title}
                  </div>

                  <div className="torrent-meta">
                    {item.size && <span>{item.size}</span>}
                    {item.date && <span>{formatDate(item.date)}</span>}
                    <span className="torrent-seeds">S: {formatNumber(item.seeds)}</span>
                    <span className="torrent-leech">L: {formatNumber(item.leechers)}</span>
                  </div>

                  {magnet ? (
                    <div className="torrent-magnet">
                      <input
                        className="search-input"
                        readOnly
                        value={magnet}
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <button className="btn btn-primary" onClick={() => void open(item)}>
                        Открыть в клиенте
                      </button>
                      <button className="btn" onClick={() => void copy(item)}>
                        Скопировать
                      </button>
                    </div>
                  ) : (
                    <div className="torrent-actions">
                      <button
                        className="btn btn-primary"
                        disabled={busyKey === item.key}
                        onClick={() => void copy(item)}
                      >
                        {busyKey === item.key ? 'Получаем…' : 'Скопировать magnet'}
                      </button>
                      <button
                        className="btn"
                        disabled={busyKey === item.key}
                        onClick={() => void open(item)}
                      >
                        Открыть в клиенте
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {!loading && results.length > 0 && results.length < total && (
          <div className="torrent-more">
            <button className="btn" disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? 'Загрузка…' : 'Показать ещё 20'}
            </button>
          </div>
        )}

        <div className="torrent-hint">
          Magnet-ссылка на сайте одноразовая: если она устарела, повторите поиск. Ссылки
          открываются в вашем торрент-клиенте.
        </div>
      </div>
    </div>,
    document.body
  )
}
