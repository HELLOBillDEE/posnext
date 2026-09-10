import { getLineSettings } from '@/lib/lineStaff'

export const dynamic = 'force-dynamic'

export async function POST(req) {
  try {
    const { userIds } = await req.json()
    if (!Array.isArray(userIds) || !userIds.length)
      return Response.json({})

    const lineCfg = await getLineSettings()
    if (!lineCfg?.line_channel_token)
      return Response.json({})

    const token = lineCfg.line_channel_token
    const results = await Promise.allSettled(
      userIds.map(uid =>
        fetch(`https://api.line.me/v2/bot/profile/${uid}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.ok ? r.json() : null)
      )
    )

    const map = {}
    userIds.forEach((uid, i) => {
      const val = results[i].status === 'fulfilled' ? results[i].value : null
      if (val?.displayName) map[uid] = val.displayName
    })
    return Response.json(map)
  } catch (e) {
    return Response.json({})
  }
}
