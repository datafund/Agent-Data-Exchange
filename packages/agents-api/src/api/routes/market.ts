import { Router } from 'express'
import type { AgentsDatabase } from '../../db/database.js'

export function marketRoutes(db: AgentsDatabase): Router {
  const router = Router()

  // GET /market/summary — aggregate marketplace stats
  router.get('/summary', (req, res) => {
    const timeframe = (req.query.timeframe as string) ?? '7d'

    // Parse timeframe to days
    let days = 7
    if (timeframe === '24h') days = 1
    else if (timeframe === '30d') days = 30

    const summary = db.getMarketSummary(days)

    res.json({
      ...summary,
      timeframe,
      message: summary.is_early_network
        ? 'Early network - great opportunity to be among the first sellers!'
        : undefined,
    })
  })

  // GET /market/pricing — price data by category
  router.get('/pricing', (req, res) => {
    const { category, tags } = req.query

    if (!category) {
      res.status(400).json({ error: 'category parameter is required' })
      return
    }

    const tagList = tags ? (tags as string).split(',').map(t => t.trim()) : undefined
    const pricing = db.getCategoryPricing(category as string, tagList)

    res.json({
      ...pricing,
      suggestion: pricing.insufficient_data
        ? 'Limited pricing data available. Consider starting with a competitive price to build reputation.'
        : undefined,
    })
  })

  // GET /market/activity — recent listings, bounties, sales by category
  router.get('/activity', (req, res) => {
    const { categories, since } = req.query

    const categoryList = categories
      ? (categories as string).split(',').map(c => c.trim())
      : []

    // Default to last 24 hours if not specified
    let sinceTimestamp: number
    if (since) {
      sinceTimestamp = Math.floor(new Date(since as string).getTime() / 1000)
    } else {
      sinceTimestamp = Math.floor(Date.now() / 1000) - 86400
    }

    const activity = db.getMarketActivity(categoryList, sinceTimestamp)

    res.json({
      ...activity,
      since: new Date(sinceTimestamp * 1000).toISOString(),
      categories: categoryList.length > 0 ? categoryList : 'all',
    })
  })

  return router
}
