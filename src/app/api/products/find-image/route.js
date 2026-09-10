import { NextResponse } from 'next/server'

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const query = searchParams.get('q')
  if (!query) return NextResponse.json({ error: 'missing q' }, { status: 400 })

  const key = process.env.GEMINI_API_KEY
  const cx  = process.env.GOOGLE_CSE_ID
  if (!key || !cx) return NextResponse.json({ error: 'missing config' }, { status: 500 })

  const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(query)}&searchType=image&num=5&imgSize=medium&safe=active`

  const res = await fetch(url)
  const data = await res.json()

  if (!res.ok) return NextResponse.json({ error: data.error?.message || 'search failed' }, { status: 500 })

  const items = (data.items || []).map(item => ({
    url: item.link,
    thumb: item.image?.thumbnailLink,
    title: item.title,
  }))

  return NextResponse.json({ items })
}
