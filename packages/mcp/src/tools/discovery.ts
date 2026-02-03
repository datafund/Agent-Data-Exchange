/**
 * Local knowledge discovery tools
 *
 * Privacy-first: These tools scan local files and NEVER send content remotely.
 * Only structural metadata (categories, tags, sizes) leaves the machine.
 */

import * as fs from 'fs'
import * as path from 'path'

const MARKETPLACE_URL = process.env.MARKETPLACE_URL || 'https://agents.datafund.io'

// File type to category mapping
const CATEGORY_MAP: Record<string, string> = {
  // Research
  '.md': 'research',
  '.txt': 'research',
  '.pdf': 'research',
  '.doc': 'research',
  '.docx': 'research',
  // Code
  '.ts': 'code',
  '.js': 'code',
  '.py': 'code',
  '.go': 'code',
  '.rs': 'code',
  '.sol': 'code',
  // Data
  '.json': 'dataset',
  '.csv': 'dataset',
  '.xml': 'dataset',
  '.yaml': 'dataset',
  '.yml': 'dataset',
  // Media
  '.png': 'media',
  '.jpg': 'media',
  '.jpeg': 'media',
  '.gif': 'media',
  '.mp3': 'media',
  '.mp4': 'media',
  '.wav': 'media',
}

// Blocklist patterns - never scan these
const BLOCKLIST_PATTERNS = [
  '.env',
  '.local.md',
  '.git',
  'node_modules',
  '.DS_Store',
  'PRIVATE:',
  '.enc',
  '.key',
  'credentials',
  'secret',
]

const MAX_FILES = 10000

interface AnalysisItem {
  path: string
  type: 'file' | 'directory'
  category: string
  tags: string[]
  size_bytes: number
  file_count: number
}

function matchGlobPattern(name: string, pattern: string): boolean {
  // Handle glob patterns like *.log, build/, etc.
  if (pattern.startsWith('*')) {
    // *.ext pattern - match extension
    const ext = pattern.slice(1)
    return name.endsWith(ext)
  }
  if (pattern.endsWith('/')) {
    // directory/ pattern - match directory name
    const dirName = pattern.slice(0, -1)
    return name === dirName
  }
  // Exact match
  return name === pattern
}

function shouldSkip(filePath: string, gitignorePatterns: string[]): boolean {
  const name = path.basename(filePath)
  const fullPath = filePath.toLowerCase()

  // Check blocklist
  for (const pattern of BLOCKLIST_PATTERNS) {
    if (name.includes(pattern) || fullPath.includes(pattern.toLowerCase())) {
      return true
    }
  }

  // Check gitignore patterns with glob support
  for (const pattern of gitignorePatterns) {
    if (!pattern) continue

    // Check if matches pattern
    if (matchGlobPattern(name, pattern)) {
      return true
    }

    // Also check if any path component matches directory patterns
    if (pattern.endsWith('/')) {
      const dirName = pattern.slice(0, -1)
      if (fullPath.includes('/' + dirName + '/') || fullPath.includes('/' + dirName)) {
        return true
      }
    }
  }

  return false
}

function loadGitignore(basePath: string): string[] {
  const gitignorePath = path.join(basePath, '.gitignore')
  if (fs.existsSync(gitignorePath)) {
    return fs.readFileSync(gitignorePath, 'utf-8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
  }
  return []
}

function getCategoryFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return CATEGORY_MAP[ext] || 'other'
}

function getTagsFromPath(filePath: string): string[] {
  const tags: string[] = []
  const parts = filePath.split(path.sep)

  // Extract meaningful directory names as tags
  for (const part of parts) {
    const lower = part.toLowerCase()
    // Skip common non-semantic directories
    if (['src', 'lib', 'dist', 'build', 'public', 'assets'].includes(lower)) continue
    // Add directory names that might be semantic
    if (part.length > 2 && part.length < 30 && !part.startsWith('.')) {
      tags.push(lower)
    }
  }

  return tags.slice(-5) // Keep last 5 most relevant
}

function scanDirectory(
  dirPath: string,
  depth: 'shallow' | 'deep',
  gitignorePatterns: string[],
  scannedCount: { count: number }
): AnalysisItem[] {
  const items: AnalysisItem[] = []

  if (scannedCount.count >= MAX_FILES) return items

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return items
  }

  for (const entry of entries) {
    if (scannedCount.count >= MAX_FILES) break

    const fullPath = path.join(dirPath, entry.name)

    if (shouldSkip(fullPath, gitignorePatterns)) continue

    scannedCount.count++

    if (entry.isDirectory()) {
      const subItems = scanDirectory(fullPath, depth, gitignorePatterns, scannedCount)

      if (subItems.length > 0) {
        // Aggregate directory stats
        const totalSize = subItems.reduce((sum, item) => sum + item.size_bytes, 0)
        const fileCount = subItems.reduce((sum, item) => sum + item.file_count, 0)

        // Determine dominant category
        const categoryCounts: Record<string, number> = {}
        for (const item of subItems) {
          categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1
        }
        const dominantCategory = Object.entries(categoryCounts)
          .sort((a, b) => b[1] - a[1])[0]?.[0] || 'other'

        // Collect unique tags
        const allTags = new Set<string>()
        for (const item of subItems) {
          item.tags.forEach(t => allTags.add(t))
        }

        items.push({
          path: fullPath,
          type: 'directory',
          category: dominantCategory,
          tags: Array.from(allTags).slice(0, 10),
          size_bytes: totalSize,
          file_count: fileCount,
        })
      }
    } else if (entry.isFile()) {
      let stats: fs.Stats
      try {
        stats = fs.statSync(fullPath)
      } catch {
        continue
      }

      const category = getCategoryFromPath(fullPath)
      const tags = getTagsFromPath(fullPath)

      // In deep mode, try to extract tags from frontmatter
      if (depth === 'deep' && ['.md', '.yaml', '.yml'].includes(path.extname(fullPath))) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8').slice(0, 1000)
          // Extract YAML frontmatter tags
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
          if (frontmatterMatch) {
            const tagsMatch = frontmatterMatch[1].match(/tags:\s*\[([^\]]+)\]/)
            if (tagsMatch) {
              tagsMatch[1].split(',').forEach(t => {
                const tag = t.trim().replace(/['"]/g, '')
                if (tag && !tags.includes(tag)) tags.push(tag)
              })
            }
          }
        } catch {
          // Ignore read errors
        }
      }

      items.push({
        path: fullPath,
        type: 'file',
        category,
        tags,
        size_bytes: stats.size,
        file_count: 1,
      })
    }
  }

  return items
}

export const analyzeKnowledgeTool = {
  name: 'df_analyze_knowledge',
  description: `Scan local files to identify sellable knowledge. Privacy-first: ONLY outputs structural metadata (categories, tags, sizes). NO content, summaries, or text extracts are ever sent remotely.

Categories: research (md, txt, pdf), code (ts, js, py, sol), dataset (json, csv), media (images, audio, video), other.

Automatically skips: .env, .local.md, .git/, node_modules/, PRIVATE: prefixed files, .gitignore entries.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Paths to scan (directories or files)',
      },
      depth: {
        type: 'string',
        enum: ['shallow', 'deep'],
        description: 'shallow: structure only. deep: also reads frontmatter for tags (default: shallow)',
      },
    },
    required: ['paths'],
  },
  execute(args: { paths: string[]; depth?: 'shallow' | 'deep' }) {
    const depth = args.depth || 'shallow'
    const allItems: AnalysisItem[] = []
    const scannedCount = { count: 0 }

    for (const scanPath of args.paths) {
      const resolvedPath = path.resolve(scanPath)

      if (!fs.existsSync(resolvedPath)) {
        continue
      }

      const gitignorePatterns = loadGitignore(resolvedPath)
      const stats = fs.statSync(resolvedPath)

      if (stats.isDirectory()) {
        const items = scanDirectory(resolvedPath, depth, gitignorePatterns, scannedCount)
        allItems.push(...items)
      } else {
        if (!shouldSkip(resolvedPath, gitignorePatterns)) {
          const category = getCategoryFromPath(resolvedPath)
          const tags = getTagsFromPath(resolvedPath)
          allItems.push({
            path: resolvedPath,
            type: 'file',
            category,
            tags,
            size_bytes: stats.size,
            file_count: 1,
          })
        }
      }
    }

    // Aggregate by category
    const byCategory: Record<string, { count: number; total_size: number }> = {}
    for (const item of allItems) {
      if (!byCategory[item.category]) {
        byCategory[item.category] = { count: 0, total_size: 0 }
      }
      byCategory[item.category].count += item.file_count
      byCategory[item.category].total_size += item.size_bytes
    }

    return {
      items: allItems,
      summary: {
        total_items: allItems.length,
        total_files: allItems.reduce((sum, i) => sum + i.file_count, 0),
        total_size_bytes: allItems.reduce((sum, i) => sum + i.size_bytes, 0),
        by_category: byCategory,
        scanned_limit_reached: scannedCount.count >= MAX_FILES,
      },
      privacy_note: 'Only structural metadata was extracted. No file contents were read or transmitted.',
    }
  },
}

export const autoSuggestTool = {
  name: 'df_auto_suggest',
  description: `One-call tool: analyzes local knowledge, fetches bounties + pricing from marketplace, matches locally, returns actionable suggestions.

Privacy: Fetches public bounties/pricing from API. Matching runs locally - only tags/categories compared, no knowledge content sent.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Paths to scan (uses current directory if empty)',
      },
    },
    required: [],
  },
  async execute(args: { paths?: string[] }) {
    const scanPaths = args.paths && args.paths.length > 0 ? args.paths : ['.']

    // Step 1: Analyze local knowledge
    const analysis = analyzeKnowledgeTool.execute({ paths: scanPaths, depth: 'deep' })

    // Step 2: Fetch bounties from marketplace
    let bounties: any[] = []
    try {
      const bountiesRes = await fetch(`${MARKETPLACE_URL}/api/v1/bounties?status=open&limit=100`)
      if (bountiesRes.ok) {
        const data = await bountiesRes.json()
        bounties = data.bounties || []
      }
    } catch {
      // Continue without bounties if marketplace unreachable
    }

    // Step 3: Fetch category pricing
    const categoryPricing: Record<string, any> = {}
    const categories = Object.keys(analysis.summary.by_category)

    await Promise.all(categories.map(async (category) => {
      try {
        const pricingRes = await fetch(`${MARKETPLACE_URL}/api/v1/market/pricing?category=${category}`)
        if (pricingRes.ok) {
          categoryPricing[category] = await pricingRes.json()
        }
      } catch {
        // Ignore pricing fetch errors
      }
    }))

    // Step 4: Match locally - compare tags/categories
    const suggestions: any[] = []

    for (const item of analysis.items) {
      if (item.type !== 'directory' && item.size_bytes < 100) continue // Skip tiny files

      // Find matching bounties by category and tags
      const matchingBounties = bounties.filter(bounty => {
        if (bounty.category === item.category) return true
        const bountyTags = bounty.tags || []
        return item.tags.some(tag => bountyTags.includes(tag))
      }).slice(0, 3)

      // Get pricing suggestion
      const pricing = categoryPricing[item.category]
      const suggestedPrice = pricing?.avg_price || null

      // Calculate demand score
      const demandScore = pricing?.demand_score || (matchingBounties.length > 0 ? 5 : 0)

      if (matchingBounties.length > 0 || demandScore >= 3) {
        suggestions.push({
          local_item: {
            path: item.path,
            category: item.category,
            tags: item.tags,
            size_bytes: item.size_bytes,
          },
          matching_bounties: matchingBounties.map(b => ({
            id: b.id,
            title: b.title,
            reward: b.reward_amount,
          })),
          suggested_price_wei: suggestedPrice,
          demand_score: demandScore,
          action: matchingBounties.length > 0 ? 'fulfill_bounty' : 'sell',
        })
      }
    }

    // Sort by demand score
    suggestions.sort((a, b) => b.demand_score - a.demand_score)

    return {
      suggestions: suggestions.slice(0, 20),
      total_analyzed: analysis.items.length,
      categories_found: categories,
      bounties_checked: bounties.length,
      privacy_note: 'Local analysis only - no file contents were sent to the marketplace.',
      next_steps: suggestions.length > 0
        ? ['Use df_sell to list items for sale', 'Use df_post_bounty to request specific data']
        : ['No strong matches found. Consider browsing the marketplace with df_browse_skills'],
    }
  },
}
