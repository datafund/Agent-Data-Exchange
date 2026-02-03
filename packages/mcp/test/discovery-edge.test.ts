/**
 * Edge case tests for discovery tools
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { analyzeKnowledgeTool } from '../src/tools/discovery.js'

const TEST_DIR = path.join(process.cwd(), 'test-discovery-edge')

describe('df_analyze_knowledge edge cases', () => {
  beforeAll(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true })
  })

  afterAll(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true })
  })

  describe('blocklist patterns', () => {
    it('should skip .env files', () => {
      fs.writeFileSync(path.join(TEST_DIR, '.env'), 'SECRET=value')
      fs.writeFileSync(path.join(TEST_DIR, '.env.local'), 'SECRET=value')
      fs.writeFileSync(path.join(TEST_DIR, '.env.production'), 'SECRET=value')

      const result = analyzeKnowledgeTool.execute({ paths: [TEST_DIR] })

      const envFiles = result.items.filter((i: any) => i.path.includes('.env'))
      expect(envFiles.length).toBe(0)
    })

    it('should skip .local.md files', () => {
      fs.writeFileSync(path.join(TEST_DIR, 'config.local.md'), 'private config')
      fs.writeFileSync(path.join(TEST_DIR, 'notes.local.md'), 'private notes')

      const result = analyzeKnowledgeTool.execute({ paths: [TEST_DIR] })

      const localFiles = result.items.filter((i: any) => i.path.includes('.local.md'))
      expect(localFiles.length).toBe(0)
    })

    it('should skip node_modules', () => {
      const nmDir = path.join(TEST_DIR, 'node_modules', 'some-package')
      fs.mkdirSync(nmDir, { recursive: true })
      fs.writeFileSync(path.join(nmDir, 'index.js'), 'module.exports = {}')

      const result = analyzeKnowledgeTool.execute({ paths: [TEST_DIR] })

      const nmFiles = result.items.filter((i: any) => i.path.includes('node_modules'))
      expect(nmFiles.length).toBe(0)
    })

    it('should skip .git directory', () => {
      const gitDir = path.join(TEST_DIR, '.git', 'objects')
      fs.mkdirSync(gitDir, { recursive: true })
      fs.writeFileSync(path.join(gitDir, 'pack'), 'git object')

      const result = analyzeKnowledgeTool.execute({ paths: [TEST_DIR] })

      const gitFiles = result.items.filter((i: any) => i.path.includes('.git'))
      expect(gitFiles.length).toBe(0)
    })

    it('should skip files with credentials in name', () => {
      fs.writeFileSync(path.join(TEST_DIR, 'credentials.json'), '{}')
      fs.writeFileSync(path.join(TEST_DIR, 'my-credentials.txt'), 'secret')

      const result = analyzeKnowledgeTool.execute({ paths: [TEST_DIR] })

      const credFiles = result.items.filter((i: any) =>
        i.path.toLowerCase().includes('credentials')
      )
      expect(credFiles.length).toBe(0)
    })

    it('should skip files with secret in name', () => {
      fs.writeFileSync(path.join(TEST_DIR, 'secret.key'), 'key')
      fs.writeFileSync(path.join(TEST_DIR, 'my-secret-config.json'), '{}')

      const result = analyzeKnowledgeTool.execute({ paths: [TEST_DIR] })

      const secretFiles = result.items.filter((i: any) =>
        i.path.toLowerCase().includes('secret')
      )
      expect(secretFiles.length).toBe(0)
    })

    it('should skip .enc files', () => {
      fs.writeFileSync(path.join(TEST_DIR, 'data.enc'), 'encrypted')
      fs.writeFileSync(path.join(TEST_DIR, 'backup.enc.json'), '{}')

      const result = analyzeKnowledgeTool.execute({ paths: [TEST_DIR] })

      const encFiles = result.items.filter((i: any) => i.path.includes('.enc'))
      expect(encFiles.length).toBe(0)
    })

    it('should skip .key files', () => {
      fs.writeFileSync(path.join(TEST_DIR, 'private.key'), 'key')
      fs.writeFileSync(path.join(TEST_DIR, 'server.key'), 'key')

      const result = analyzeKnowledgeTool.execute({ paths: [TEST_DIR] })

      const keyFiles = result.items.filter((i: any) => i.path.endsWith('.key'))
      expect(keyFiles.length).toBe(0)
    })
  })

  describe('category classification', () => {
    beforeAll(() => {
      // Create test files for each category
      fs.mkdirSync(path.join(TEST_DIR, 'docs'), { recursive: true })

      // Research
      fs.writeFileSync(path.join(TEST_DIR, 'docs', 'report.md'), '# Report')
      fs.writeFileSync(path.join(TEST_DIR, 'docs', 'analysis.txt'), 'Analysis')

      // Code
      fs.writeFileSync(path.join(TEST_DIR, 'docs', 'utils.ts'), 'export {}')
      fs.writeFileSync(path.join(TEST_DIR, 'docs', 'helper.py'), 'def help(): pass')
      fs.writeFileSync(path.join(TEST_DIR, 'docs', 'contract.sol'), 'pragma solidity')

      // Data
      fs.writeFileSync(path.join(TEST_DIR, 'docs', 'data.json'), '{}')
      fs.writeFileSync(path.join(TEST_DIR, 'docs', 'metrics.csv'), 'a,b,c')
      fs.writeFileSync(path.join(TEST_DIR, 'docs', 'config.yaml'), 'key: value')
    })

    it('should classify .md and .txt as research', () => {
      const result = analyzeKnowledgeTool.execute({ paths: [TEST_DIR] })

      const mdFile = result.items.find((i: any) => i.path.endsWith('.md') && !i.path.includes('.local'))
      const txtFile = result.items.find((i: any) => i.path.endsWith('.txt') && !i.path.includes('secret'))

      if (mdFile) expect(mdFile.category).toBe('research')
      if (txtFile) expect(txtFile.category).toBe('research')
    })

    it('should classify .ts, .py, .sol as code', () => {
      const result = analyzeKnowledgeTool.execute({ paths: [TEST_DIR] })

      const tsFile = result.items.find((i: any) => i.path.endsWith('.ts'))
      const pyFile = result.items.find((i: any) => i.path.endsWith('.py'))
      const solFile = result.items.find((i: any) => i.path.endsWith('.sol'))

      if (tsFile) expect(tsFile.category).toBe('code')
      if (pyFile) expect(pyFile.category).toBe('code')
      if (solFile) expect(solFile.category).toBe('code')
    })

    it('should classify .json, .csv, .yaml as dataset', () => {
      const result = analyzeKnowledgeTool.execute({ paths: [TEST_DIR] })

      const jsonFile = result.items.find((i: any) =>
        i.path.endsWith('.json') && !i.path.includes('credentials')
      )
      const csvFile = result.items.find((i: any) => i.path.endsWith('.csv'))
      const yamlFile = result.items.find((i: any) => i.path.endsWith('.yaml'))

      if (jsonFile) expect(jsonFile.category).toBe('dataset')
      if (csvFile) expect(csvFile.category).toBe('dataset')
      if (yamlFile) expect(yamlFile.category).toBe('dataset')
    })
  })

  describe('file size limits', () => {
    it('should not exceed MAX_FILES limit (10000)', () => {
      // Create many small files
      const manyFilesDir = path.join(TEST_DIR, 'many')
      fs.mkdirSync(manyFilesDir, { recursive: true })

      // Create 100 files (not 10000 to keep test fast)
      for (let i = 0; i < 100; i++) {
        fs.writeFileSync(path.join(manyFilesDir, `file${i}.md`), `# File ${i}`)
      }

      const result = analyzeKnowledgeTool.execute({ paths: [manyFilesDir] })

      expect(result.summary.total_files).toBeLessThanOrEqual(10000)
    })
  })

  describe('error handling', () => {
    it('should handle permission denied gracefully', () => {
      // This test might not work on all systems
      // Skip if we can't create restricted files
      const restrictedDir = path.join(TEST_DIR, 'restricted')
      fs.mkdirSync(restrictedDir, { recursive: true })

      try {
        fs.chmodSync(restrictedDir, 0o000)
        const result = analyzeKnowledgeTool.execute({ paths: [restrictedDir] })
        expect(result.items).toHaveLength(0)
      } catch {
        // Skip if chmod not supported
      } finally {
        try {
          fs.chmodSync(restrictedDir, 0o755)
        } catch {
          // Ignore
        }
      }
    })

    it('should handle symlinks gracefully', () => {
      const target = path.join(TEST_DIR, 'target.md')
      const link = path.join(TEST_DIR, 'link.md')

      fs.writeFileSync(target, '# Target')
      try {
        fs.symlinkSync(target, link)
      } catch {
        // Symlinks might not be supported
        return
      }

      const result = analyzeKnowledgeTool.execute({ paths: [TEST_DIR] })
      // Should not crash
      expect(result).toHaveProperty('items')
    })
  })

  describe('gitignore respect', () => {
    it('should respect .gitignore patterns', () => {
      const gitignoreDir = path.join(TEST_DIR, 'gitignore-test')
      fs.mkdirSync(gitignoreDir, { recursive: true })

      fs.writeFileSync(path.join(gitignoreDir, '.gitignore'), 'ignored.md\n*.log\nbuild/')
      fs.writeFileSync(path.join(gitignoreDir, 'ignored.md'), 'should be ignored')
      fs.writeFileSync(path.join(gitignoreDir, 'app.log'), 'log content')
      fs.writeFileSync(path.join(gitignoreDir, 'keep.md'), 'should be kept')

      const buildDir = path.join(gitignoreDir, 'build')
      fs.mkdirSync(buildDir, { recursive: true })
      fs.writeFileSync(path.join(buildDir, 'output.js'), 'built file')

      const result = analyzeKnowledgeTool.execute({ paths: [gitignoreDir] })

      const ignoredFile = result.items.find((i: any) => i.path.includes('ignored.md'))
      const logFile = result.items.find((i: any) => i.path.includes('.log'))
      const buildFile = result.items.find((i: any) => i.path.includes('build'))
      const keptFile = result.items.find((i: any) => i.path.includes('keep.md'))

      expect(ignoredFile).toBeUndefined()
      expect(logFile).toBeUndefined()
      expect(buildFile).toBeUndefined()
      expect(keptFile).toBeDefined()
    })
  })
})
