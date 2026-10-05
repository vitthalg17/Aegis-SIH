const env = import.meta.env;

export const config = {
  supabaseUrl: (env.VITE_SUPABASE_URL as string | undefined)?.trim() || "",
  supabaseKey: (env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || "",
  verifySite: (env.VITE_VERIFY_SITE as string | undefined)?.trim().replace(/\/+$/, "") || "",
  rpcUrl: (env.VITE_RPC_URL as string | undefined)?.trim() || "https://polygon-amoy-bor-rpc.publicnode.com",
  rpcFallback: (env.VITE_RPC_FALLBACK as string | undefined)?.trim() || "https://polygon-amoy.drpc.org",
  registry: (env.VITE_REGISTRY as string | undefined)?.trim() || "0xA82128628b7Ae42183d9B76020CD37C007c18c46",
  explorer: "https://amoy.polygonscan.com",
  priceInr: Number(env.VITE_NODE_PRICE_INR) || null,
};

export const liveMode = Boolean(config.supabaseUrl && config.supabaseKey);
