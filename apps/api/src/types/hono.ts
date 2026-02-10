import type { Env } from './env';
import type { Database } from '../db/client';

export type HonoEnv = {
  Bindings: Env;
  Variables: {
    db: Database;
    agentId?: string;
  };
};
