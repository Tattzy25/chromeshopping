/**
 * build_extension.mjs - Production Extension Bundler
 *
 * Produces:
 *  1. dist/popup.html + dist/popup.js (ES Module for action popup)
 *  2. dist/background.js (ES Module Service Worker)
 *  3. dist/content.js (Self-contained IIFE without module exports for Chrome Content Scripts)
 *  4. dist/manifest.json + dist/styles.css
 */
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, 'dist');

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

let defaultOpenAiKey = '';
const envPath = resolve(__dirname, '.env.local');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf8');
  const match = envContent.match(/OPENAI_API_KEY=["']?([^"'\r\n]+)["']?/);
  if (match) {
    defaultOpenAiKey = match[1].trim();
  }
}

console.log('[Build] 1/2: Building popup and background service worker...');
await build({
  configFile: false,
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': '{}',
    'process.platform': JSON.stringify('browser'),
    '__DEFAULT_OPENAI_KEY__': JSON.stringify(defaultOpenAiKey),
  },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'extension/popup.html'),
        background: resolve(__dirname, 'extension/background.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },
});

console.log('[Build] 2/2: Building content.js as self-contained IIFE...');
try {
  await build({
    configFile: false,
    plugins: [react()],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env': '{}',
      'process.platform': JSON.stringify('browser'),
      'process.version': JSON.stringify(''),
      'process.arch': JSON.stringify('x64'),
      '__DEFAULT_OPENAI_KEY__': JSON.stringify(defaultOpenAiKey),
      global: 'globalThis',
    },
    base: './',
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        input: {
          content: resolve(__dirname, 'extension/content.ts'),
        },
        output: {
          format: 'iife',
          entryFileNames: '[name].js',
          name: 'LiveCommerceContentScript',
          extend: true,
        },
        treeshake: {
          moduleSideEffects: 'no-external',
        },
      },
    },
  });
} catch (err) {
  console.error('\n[BUILD ERROR]:', err.message);
  if (err.frame) console.error(err.frame);
  if (err.loc) console.error('Location:', err.loc);
  process.exit(1);
}

// Copy manifest.json
copyFileSync(resolve(__dirname, 'extension/manifest.json'), resolve(distDir, 'manifest.json'));

// Copy styles.css
copyFileSync(resolve(__dirname, 'extension/styles.css'), resolve(distDir, 'styles.css'));

// Ensure popup.html is at root of dist
const nestedPopup = resolve(distDir, 'extension/popup.html');
const rootPopup = resolve(distDir, 'popup.html');
if (existsSync(nestedPopup)) {
  copyFileSync(nestedPopup, rootPopup);
}

// Fix relative script tag in dist/popup.html
if (existsSync(rootPopup)) {
  let popupHtml = readFileSync(rootPopup, 'utf8');
  popupHtml = popupHtml.replace(/src="\.\.\/popup\.js"/g, 'src="./popup.js"');
  popupHtml = popupHtml.replace(/src="\/popup\.js"/g, 'src="./popup.js"');
  writeFileSync(rootPopup, popupHtml);
}

console.log('==============================================');
console.log('✓ Extension build successfully generated in dist/');
console.log('==============================================');
