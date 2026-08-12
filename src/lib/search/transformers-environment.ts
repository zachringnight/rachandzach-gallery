export const QUERY_EMBEDDING_VERCEL_CACHE_DIR =
  "/tmp/rachandzach-transformers-cache";

interface TransformersEnvironment {
  allowLocalModels: boolean;
  cacheDir: string | null;
  useBrowserCache: boolean;
  useFSCache: boolean;
}

/**
 * Keeps the server-side text encoder on a writable cache path. Vercel mounts
 * the function bundle at /var/task read-only, while /tmp is writable for the
 * lifetime of a warm function instance.
 */
export function configureTransformersEnvironment(
  runtimeEnv: TransformersEnvironment,
  isVercel = Boolean(process.env.VERCEL),
): void {
  runtimeEnv.useBrowserCache = false;
  if (isVercel) {
    runtimeEnv.allowLocalModels = false;
    runtimeEnv.useFSCache = true;
    runtimeEnv.cacheDir = QUERY_EMBEDDING_VERCEL_CACHE_DIR;
  }
}
