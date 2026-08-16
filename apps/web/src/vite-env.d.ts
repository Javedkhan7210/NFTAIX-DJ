/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Admin SPA only: user app origin for “← App” and login register links. */
  readonly VITE_MAIN_APP_ORIGIN?: string;
  /** Admin SPA only: default post-login path when no `redirect` query (e.g. `/`). */
  readonly VITE_DEFAULT_AFTER_LOGIN?: string;
  /** User app: separate admin panel origin (open ADM button in new document location). */
  readonly VITE_ADMIN_ORIGIN?: string;
  /** e.g. https://opbnb.bscscan.com or https://testnet.opbnbscan.com */
  readonly VITE_OPBNB_EXPLORER_URL?: string;
  /** 204 mainnet, 5611 testnet. */
  readonly VITE_OPBNB_CHAIN_ID?: string;
  /** Optional override RPC for selected chain. */
  readonly VITE_OPBNB_RPC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
