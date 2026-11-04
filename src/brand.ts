import packageInfo from "../package.json";

export const BRAND = {
  name: "Agentalk",
  wordmark: "agentalk",
  version: packageInfo.version,
  icon: "./brand/icon-256.png",
} as const;
