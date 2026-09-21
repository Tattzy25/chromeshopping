import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, existsSync, mkdirSync } from 'fs';

function copyExtensionAssetsPlugin() {
  return {
    name: 'copy-extension-assets-plugin',
    closeBundle() {
      const distDir = resolve(__dirname, 'dist');
      if (!existsSync(distDir)) {
        mkdirSync(distDir, { recursive: true });
      }
      // Copy manifest.json
      const manifestSrc = resolve(__dirname, 'extension/manifest.json');
      if (existsSync(manifestSrc)) {
        copyFileSync(manifestSrc, resolve(distDir, 'manifest.json'));
      }
      // Ensure popup.html is at dist root if bundled under extension/
      const nestedPopup = resolve(distDir, 'extension/popup.html');
      const rootPopup = resolve(distDir, 'popup.html');
      if (existsSync(nestedPopup)) {
        copyFileSync(nestedPopup, rootPopup);
      }
      // Copy styles.css
      const stylesSrc = resolve(__dirname, 'extension/styles.css');
      if (existsSync(stylesSrc)) {
        copyFileSync(stylesSrc, resolve(distDir, 'styles.css'));
      }
    }
  };
}

export default defineConfig({
  plugins: [react(), copyExtensionAssetsPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'extension/popup.html'),
        content: resolve(__dirname, 'extension/content.ts'),
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
