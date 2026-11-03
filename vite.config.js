import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

// Emits dist/sw.js with the complete list of files in this build, and a
// version derived from their contents.
function serviceWorker() {
  const listPublic = (dir, base = '') => readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? listPublic(p, `${base}${name}/`) : [`${base}${name}`];
  });
  return {
    name: 'siteledger-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter(f => !f.endsWith('.map') && f !== 'sw.js');
      const pub = listPublic('public');
      const files = [...new Set([...built, ...pub])].sort();
      const hash = createHash('sha256');
      for (const f of built) {
        const item = bundle[f];
        hash.update(f).update(item.type === 'chunk' ? item.code : typeof item.source === 'string' ? item.source : Buffer.from(item.source));
      }
      for (const f of pub) hash.update(f).update(readFileSync(join('public', f)));
      const version = hash.digest('hex').slice(0, 12);
      const precache = ['/', ...files.map(f => `/${f}`)];
      const source = readFileSync('src/sw/sw-template.js', 'utf8')
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('__PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  }
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
})
