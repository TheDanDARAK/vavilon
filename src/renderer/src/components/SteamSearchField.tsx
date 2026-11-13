import { useState } from 'react'
import type { SteamSearchHit } from '../../../shared/types'

/**
 * Name → AppID search field backed by the Steam community search.
 * Picking a suggestion hands it to the parent dialog (which decides
 * what to fill in and whether to fetch metadata right away).
 */
export function SteamSearchField({
  onPick,
  placeholder
}: {
  onPick: (hit: SteamSearchHit) => void
  placeholder?: string
}): React.JSX.Element {
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<SteamSearchHit[]>([])
  const [searched, setSearched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = async (): Promise<void> => {
    if (term.trim().length < 2) return
    setBusy(true)
    setError(null)
    try {
      setHits(await window.api.searchSteam(term))
      setSearched(true)
    } catch (e) {
      setError(`Ошибка сети: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="steam-search">
      <div className="steam-search-row">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search()
          }}
          placeholder={placeholder ?? 'Название игры в Steam…'}
        />
        <button className="btn" disabled={busy || term.trim().length < 2} onClick={() => void search()}>
          {busy ? '…' : '🔍'}
        </button>
      </div>
      {error && <div className="setup-error">{error}</div>}
      {hits.length > 0 && (
        <div className="steam-hits">
          {hits.map((h) => (
            <button
              key={h.appId}
              className="steam-hit"
              onClick={() => {
                onPick(h)
                setHits([])
                setTerm('')
                setSearched(false)
              }}
            >
              {h.iconUrl && <img src={h.iconUrl} alt="" />}
              <span className="steam-hit-name">{h.name}</span>
              <small>{h.appId}</small>
            </button>
          ))}
        </div>
      )}
      {searched && !busy && hits.length === 0 && (
        <div className="steam-search-empty">Ничего не найдено в Steam</div>
      )}
    </div>
  )
}
