#!/usr/bin/env node
import { readdirSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const publicTokensPath = join(__dirname, '../public/tokens')
const outputPath = join(__dirname, '../entities/customTokens.ts')

try {
  // Check if public/tokens directory exists
  if (!existsSync(publicTokensPath)) {
    console.warn('⚠️  public/tokens directory does not exist, creating empty custom tokens list')
    writeFileSync(
      outputPath,
      `// Auto-generated file - do not edit manually
// Generated from public/tokens folder at build time

export const CUSTOM_ICON_TOKENS = new Set<string>([])
`,
    )
    process.exit(0)
  }

  // Read all files from public/tokens
  const files = readdirSync(publicTokensPath)

  // Filter for image files and extract token symbols (filenames without extension)
  const customTokens = files
    .filter(f => /\.(png|svg|jpg|jpeg|webp|gif)$/i.test(f))
    .map(f => f.replace(/\.(png|svg|jpg|jpeg|webp|gif)$/i, ''))

  // Generate TypeScript file
  const content = `// Auto-generated file - do not edit manually
// Generated from public/tokens folder at build time
// Run 'npm run generate:tokens' to regenerate

export const CUSTOM_ICON_TOKENS = new Set<string>([
${customTokens.map(token => `  '${token}',`).join('\n')}
])
`

  writeFileSync(outputPath, content, 'utf-8')

  console.log(`✅ Generated custom tokens list with ${customTokens.length} token(s): ${customTokens.join(', ')}`)
}
catch (error) {
  console.error('❌ Error generating custom tokens:', error)
  process.exit(1)
}
