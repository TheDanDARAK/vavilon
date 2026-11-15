import { mkdir, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { net } from 'electron'
import { parseAchievementsPage } from '../steamAchievementParsing'

/**
 * Keyless Steam achievement schema fetcher.
 *
 * Sources (no Steam Web API key required):
 * 1. steamcommunity.com/stats/<appid>/achievements/ — the SSR page embeds a JSON
 *    blob per achievement: api_name, name, description, hidden, icon hashes.
 *    Localization is selected with the Steam_Language cookie.
 * 2. ISteamUserStats/GetGlobalAchievementPercentagesForApp — API names + global
 *    unlock rate (keyless).
 *
 * Everything is written as a gbe_fork-compatible steam_settings/achievements.json
 * plus achievement_images/ so the emulator can actually unlock achievements
 * (GBE refuses SetAchievement without a schema) and so our UI can show
 * names, descriptions, icons and rarity.
 */

const ICON_CDN_HOSTS = [
  'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps',
  'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps'
]

export interface SchemaInstallResult {
  total: number
  withIcons: number
  localized: boolean
  rarity: boolean
}

function pageUrl(appId: number): string {
  return `https://steamcommunity.com/stats/${appId}/achievements/`
}

async function fetchPage(appId: number, language: 'english' | 'russian'): Promise<string> {
  const headers: Record<string, string> = {}
  if (language === 'russian') {
    headers.Cookie = 'Steam_Language=russian'
  }
  const res = await net.fetch(pageUrl(appId), {
    headers,
    signal: AbortSignal.timeout(20000)
  })
  if (!res.ok) throw new Error(`steamcommunity вернул ${res.status}`)
  return res.text()
}

async function fetchRarity(appId: number): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  try {
    const res = await net.fetch(
      `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appId}`,
      { signal: AbortSignal.timeout(15000) }
    )
    if (!res.ok) return map
    const data = (await res.json()) as {
      achievementpercentages?: { achievements?: Array<{ name: string; percent: number }> }
    }
    for (const item of data.achievementpercentages?.achievements ?? []) {
      map.set(item.name.toLowerCase(), item.percent)
    }
  } catch {
    // rarity is optional
  }
  return map
}

async function downloadIcon(appId: number, hash: string): Promise<Buffer | null> {
  for (const host of ICON_CDN_HOSTS) {
    try {
      const res = await net.fetch(`${host}/${appId}/${hash}`, {
        signal: AbortSignal.timeout(20000)
      })
      if (res.ok) return Buffer.from(await res.arrayBuffer())
    } catch {
      // try the next mirror
    }
  }
  return null
}

/**
 * Builds and installs the schema for a game:
 * steam_settings/achievements.json + achievement_images/*.
 */
export async function installSchema(gameDir: string, appId: number): Promise<SchemaInstallResult> {
  const [htmlEn, htmlRu] = await Promise.all([
    fetchPage(appId, 'english'),
    fetchPage(appId, 'russian').catch(() => '')
  ])

  const english = parseAchievementsPage(htmlEn)
  if (english.length === 0) {
    throw new Error('Не удалось распарсить страницу достижений Steam')
  }
  const russian = parseAchievementsPage(htmlRu)
  const ruByApi = new Map(russian.map((a) => [a.api.toLowerCase(), a]))
  const rarity = await fetchRarity(appId)

  const settingsDir = join(gameDir, 'steam_settings')
  const imagesDir = join(settingsDir, 'achievement_images')
  await mkdir(imagesDir, { recursive: true })

  const schema: Array<Record<string, unknown>> = []
  let withIcons = 0

  for (const ach of english) {
    const ru = ruByApi.get(ach.api.toLowerCase())

    const iconFull = `achievement_images/${ach.api}_full.jpg`
    const iconGray = `achievement_images/${ach.api}_gray.jpg`
    let iconsOk = true

    if (!existsSync(join(gameDir, 'steam_settings', iconFull))) {
      const buf = await downloadIcon(appId, ach.iconHash)
      if (buf) await writeFile(join(imagesDir, `${ach.api}_full.jpg`), buf)
      else iconsOk = false
    }
    if (!existsSync(join(gameDir, 'steam_settings', iconGray))) {
      const buf = await downloadIcon(appId, ach.iconGrayHash)
      if (buf) await writeFile(join(imagesDir, `${ach.api}_gray.jpg`), buf)
      else iconsOk = false
    }
    if (iconsOk) withIcons++

    const displayName =
      ru?.name && ru.name !== ach.name
        ? { english: ach.name, russian: ru.name }
        : ach.name
    const description =
      ru?.description && ru.description !== ach.description
        ? { english: ach.description, russian: ru.description }
        : ach.description

    const entry: Record<string, unknown> = {
      name: ach.api,
      displayName,
      hidden: ach.hidden ? '1' : '0',
      icon: iconFull,
      icon_gray: iconGray
    }
    if (description) entry.description = description
    const percent = rarity.get(ach.api.toLowerCase())
    if (percent !== undefined) entry.unlock_percentage = percent

    schema.push(entry)
  }

  await writeFile(
    join(settingsDir, 'achievements.json'),
    JSON.stringify(schema, null, 2),
    'utf-8'
  )

  return {
    total: schema.length,
    withIcons,
    localized: russian.length > 0,
    rarity: rarity.size > 0
  }
}
