/** The Hono environment shared by every route file. */

import type { Env } from './env.js';
import type { Account } from './db/auth-store.js';

export type AppEnv = {
  Bindings: Env;
  Variables: {
    account: Account;
  };
};
