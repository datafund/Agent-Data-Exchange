import { Router } from 'express'
import type { AgentsDatabase } from '../../db/database.js'
import { verifySignature } from '../middleware/verify-signature.js'

export function productTypeRoutes(db: AgentsDatabase): Router {
  const router = Router()

  // POST /product-types — register a new data product type (requires signature)
  router.post('/', verifySignature, (req, res) => {
    const { id, name, description, schema, content_format, free_download_allowed } = req.body
    const creator = (req as any).verifiedAddress

    if (!id || !name || !schema) {
      res.status(400).json({ error: 'id, name, and schema are required' })
      return
    }

    // Validate id format (lowercase alphanumeric + hyphens)
    if (!/^[a-z0-9-]+$/.test(id)) {
      res.status(400).json({ error: 'id must be lowercase alphanumeric with hyphens only' })
      return
    }

    // Check if type already exists
    if (db.getProductType(id)) {
      res.status(409).json({ error: `Product type "${id}" already exists` })
      return
    }

    // Validate schema is valid JSON
    let schemaStr: string
    if (typeof schema === 'string') {
      try {
        JSON.parse(schema)
        schemaStr = schema
      } catch {
        res.status(400).json({ error: 'schema must be valid JSON' })
        return
      }
    } else {
      schemaStr = JSON.stringify(schema)
    }

    const now = Math.floor(Date.now() / 1000)
    const created = db.createProductType({
      id,
      name,
      description,
      schema: schemaStr,
      contentFormat: content_format,
      freeDownloadAllowed: free_download_allowed,
      creator,
      createdAt: now,
    })

    if (!created) {
      res.status(500).json({ error: 'Failed to create product type' })
      return
    }

    res.status(201).json({ id, name })
  })

  // GET /product-types — list all registered types
  router.get('/', (_req, res) => {
    const types = db.listProductTypes()
    res.json({
      product_types: types.map(t => ({
        ...t,
        schema: JSON.parse(t.schema),
      })),
    })
  })

  // GET /product-types/:id — get type details with schema
  router.get('/:id', (req, res) => {
    const type = db.getProductType(req.params.id)
    if (!type) {
      res.status(404).json({ error: 'Product type not found' })
      return
    }
    res.json({ ...type, schema: JSON.parse(type.schema) })
  })

  return router
}
