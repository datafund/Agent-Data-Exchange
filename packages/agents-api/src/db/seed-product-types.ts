import type { AgentsDatabase } from './database.js'

const ENGRAM_PACK = {
  id: 'engram-pack',
  name: 'Engram Pack',
  description: 'Curated AI knowledge packs (engrams) for agent learning',
  schema: JSON.stringify({
    type: 'object',
    properties: {
      engram_count: { type: 'integer', minimum: 1 },
      domain: { type: 'string' },
      match_terms: { type: 'array', items: { type: 'string' } },
      fitness_score: { type: 'number', minimum: 0, maximum: 1 },
      version: { type: 'string' },
      license: { type: 'string' },
    },
    required: ['engram_count', 'domain', 'version'],
  }),
  contentFormat: 'tar.gz',
  freeDownloadAllowed: 1,
  creator: 'system',
  createdAt: Math.floor(Date.now() / 1000),
}

export function seedProductTypes(db: AgentsDatabase): void {
  if (!db.getProductType('engram-pack')) {
    db.createProductType(ENGRAM_PACK)
    console.log('[seed] Registered engram-pack product type')
  }
}
