export interface Env {
  DB: D1Database;
  RL: RateLimit;
  DATASET_VERSION: string;
  ENVIRONMENT: string;
  CURSOR_SECRET?: string;
}

interface RateLimit {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}
