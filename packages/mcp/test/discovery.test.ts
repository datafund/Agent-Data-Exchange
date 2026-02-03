import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { analyzeKnowledgeTool, autoSuggestTool } from '../src/tools/discovery.js'

const TEST_DIR = path.join(process.cwd(), 'test-fixtures')

describe('df_analyze_knowledge', () => {
  beforeAll(() => {
    // Create test fixtures
    fs.mkdirSync(path.join(TEST_DIR, 'research'), { recursive: true })
    fs.mkdirSync(path.join(TEST_DIR, 'code'), { recursive: true })
    fs.mkdirSync(path.join(TEST_DIR, 'data'), { recursive: true })

    // Research files
    fs.writeFileSync(path.join(TEST_DIR, 'research', 'analysis.md'), '# Market Analysis\n\nThis is research content.')
    fs.writeFileSync(path.join(TEST_DIR, 'research', 'report.txt'), 'Quarterly report data')

    // Code files
    fs.writeFileSync(path.join(TEST_DIR, 'code', 'utils.ts'), 'export function helper() {}')
    fs.writeFileSync(path.join(TEST_DIR, 'code', 'index.js'), 'module.exports = {}')

    // Data files
    fs.writeFileSync(path.join(TEST_DIR, 'data', 'metrics.json'), '{"sales": 1000}')
    fs.writeFileSync(path.join(TEST_DIR, 'data', 'users.csv'), 'id,name\n1,Alice')

    // Files that should be skipped
    fs.writeFileSync(path.join(TEST_DIR, '.env'), 'SECRET=value')

    // Create .gitignore
    fs.writeFileSync(path.join(TEST_DIR, '.gitignore'), 'ignored-file.txt\n')
    fs.writeFileSync(path.join(TEST_DIR, 'ignored-file.txt'), 'should be ignored')
  })

  afterAll(() => {
    // Cleanup
    fs.rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('should scan directories and categorize files', () => {
    const result = analyzeKnowledgeTool.execute({ paths: [TEST_DIR] })

    expect(result).toHaveProperty('items')
    expect(result).toHaveProperty('summary')
    expect(result.summary.total_files).toBeGreaterThan(0)
  })

  it('should categorize files correctly', () => {
    const result = analyzeKnowledgeTool.execute({ paths: [TEST_DIR] })

    // Check categories exist
    expect(result.summary.by_category).toHaveProperty('research')
    expect(result.summary.by_category).toHaveProperty('code')
    expect(result.summary.by_category).toHaveProperty('dataset')
  })

  it('should skip blocklisted files', () => {
    const result = analyzeKnowledgeTool.execute({ paths: [TEST_DIR] })

    // .env should be skipped
    const envFile = result.items.find((i: any) => i.path.endsWith('.env'))
    expect(envFile).toBeUndefined()

    // .local.md should be skipped (creating one for this test)
    fs.writeFileSync(path.join(TEST_DIR, 'config.local.md'), 'local config')
    const result2 = analyzeKnowledgeTool.execute({ paths: [TEST_DIR] })
    const localFile = result2.items.find((i: any) => i.path.includes('.local.md'))
    expect(localFile).toBeUndefined()
  })

  it('should skip .gitignore patterns', () => {
    const result = analyzeKnowledgeTool.execute({ paths: [TEST_DIR] })

    const ignoredFile = result.items.find((i: any) => i.path.includes('ignored-file.txt'))
    expect(ignoredFile).toBeUndefined()
  })

  it('should extract tags from directory structure', () => {
    const result = analyzeKnowledgeTool.execute({ paths: [TEST_DIR] })

    // Find an item in the research directory
    const researchItem = result.items.find((i: any) =>
      i.path.includes('research') && i.type === 'file'
    )

    if (researchItem) {
      expect(researchItem.tags).toContain('research')
    }
  })

  it('should include privacy note', () => {
    const result = analyzeKnowledgeTool.execute({ paths: [TEST_DIR] })
    expect(result.privacy_note).toBeDefined()
    expect(result.privacy_note).toContain('metadata')
  })

  it('should handle deep mode', () => {
    // Create a file with frontmatter
    fs.writeFileSync(
      path.join(TEST_DIR, 'research', 'tagged.md'),
      '---\ntags: [climate, research]\n---\n# Content'
    )

    const result = analyzeKnowledgeTool.execute({
      paths: [TEST_DIR],
      depth: 'deep',
    })

    expect(result).toHaveProperty('items')
    // Deep mode should work without errors
  })

  it('should handle non-existent paths gracefully', () => {
    const result = analyzeKnowledgeTool.execute({
      paths: ['/non/existent/path'],
    })

    expect(result.items).toHaveLength(0)
    expect(result.summary.total_files).toBe(0)
  })
})

describe('df_auto_suggest', () => {
  beforeAll(() => {
    // Ensure test fixtures exist
    fs.mkdirSync(path.join(TEST_DIR, 'research'), { recursive: true })
    fs.writeFileSync(
      path.join(TEST_DIR, 'research', 'climate-report.md'),
      '# Climate Research\n\nImportant findings...'
    )
  })

  afterAll(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('should analyze local knowledge and return suggestions', async () => {
    const result = await autoSuggestTool.execute({ paths: [TEST_DIR] })

    expect(result).toHaveProperty('suggestions')
    expect(result).toHaveProperty('total_analyzed')
    expect(result).toHaveProperty('categories_found')
    expect(result).toHaveProperty('privacy_note')
    expect(Array.isArray(result.suggestions)).toBe(true)
  })

  it('should include next steps', async () => {
    const result = await autoSuggestTool.execute({ paths: [TEST_DIR] })

    expect(result).toHaveProperty('next_steps')
    expect(Array.isArray(result.next_steps)).toBe(true)
  })

  it('should use current directory when paths empty', async () => {
    const result = await autoSuggestTool.execute({})

    expect(result).toHaveProperty('total_analyzed')
    // Should not throw
  })
})
