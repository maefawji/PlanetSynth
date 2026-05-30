import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'
import type { Plugin } from 'vite'

// ── Sample-library plugin ──────────────────────────────────────────────────────
// Scans public/samples/ at startup and writes _index.json.
// In dev mode, also watches for added / removed audio files.
const AUDIO_EXTS = new Set(['.wav', '.mp3', '.ogg', '.flac', '.aiff', '.aif', '.m4a', '.mp4', '.webm'])

function sampleLibraryPlugin(): Plugin {
  const samplesDir  = path.resolve('./public/samples')
  const manifestOut = path.join(samplesDir, '_index.json')

  function scanDir(dir: string, root: string): string[] {
    const out: string[] = []
    if (!fs.existsSync(dir)) return out
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      const rel  = path.relative(root, full).replace(/\\/g, '/')
      if (entry.isDirectory()) {
        out.push(...scanDir(full, root))
      } else if (AUDIO_EXTS.has(path.extname(entry.name).toLowerCase())) {
        out.push(rel)
      }
    }
    return out.sort()
  }

  function writeManifest() {
    if (!fs.existsSync(samplesDir)) fs.mkdirSync(samplesDir, { recursive: true })
    const files = scanDir(samplesDir, samplesDir)
    fs.writeFileSync(manifestOut, JSON.stringify(files, null, 2) + '\n')
    return files
  }

  return {
    name: 'sample-library',
    buildStart() { writeManifest() },
    configureServer(server) {
      writeManifest()
      server.watcher.add(samplesDir)
      server.watcher.on('add',   f => { if (f.startsWith(samplesDir)) writeManifest() })
      server.watcher.on('unlink', f => { if (f.startsWith(samplesDir)) writeManifest() })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), sampleLibraryPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
