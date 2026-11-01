import { mergeConfig } from 'vite';
import config from './vite.config';

// Browser checks have their own port and dependency cache, independent of the
// user's development server and its bind-mounted source/cache.
export default mergeConfig(config, {
  cacheDir: './test-results/games-vite-cache',
  define: { 'import.meta.env.VITE_BACKEND_URL': JSON.stringify('') },
});
