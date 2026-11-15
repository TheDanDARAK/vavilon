/**
 * Pure parser for the Steam Community achievements page. Kept Electron-free so
 * the fragile regex can be tested against captured HTML fixtures.
 */

const ACH_PAGE_REGEX =
  /\{"internal_key":\d+,"api_name":"([^"]+)","name":"([^"]*)","description":"([^"]*)","hidden":(true|false),"archived":(?:true|false),"icon_achieved":"([^"]+)","icon_unachieved":"([^"]+)"/g

export interface CommunityAch {
  api: string
  name: string
  description: string
  hidden: boolean
  iconHash: string
  iconGrayHash: string
}

export function parseAchievementsPage(html: string): CommunityAch[] {
  const unescaped = html.replaceAll('\\"', '"')
  const out: CommunityAch[] = []
  for (const m of unescaped.matchAll(ACH_PAGE_REGEX)) {
    out.push({
      api: m[1],
      name: m[2],
      description: m[3],
      hidden: m[4] === 'true',
      iconHash: m[5],
      iconGrayHash: m[6]
    })
  }
  return out
}
