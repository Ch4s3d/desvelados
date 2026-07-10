import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Preserve explicit CSS declarations (e.g. backdrop-filter + -webkit-backdrop-filter)
    // in generated CSS to avoid optimizer collapsing.
    cssMinify: false,
  },
});
