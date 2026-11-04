export type Appearance = "light" | "dark";
export type ThemeId =
  | "sage"
  | "obsidian"
  | "midnight"
  | "sunset"
  | "paper"
  | "monokai"
  | "sakura"
  | "whatsapp"
  | "ios"
  | "telegram"
  | "discord"
  | "catppuccin"
  | "nord"
  | "onedark"
  | "dracula";

type Preview = [string, string, string];
export interface ThemeConfig {
  id: ThemeId;
  name: string;
  defaultAppearance: Appearance;
  light: Preview;
  dark: Preview;
}

// Existing palette IDs remain valid. Agentalk's original themes come first.
export const THEMES: ThemeConfig[] = [
  {
    id: "sage",
    name: "Sage",
    defaultAppearance: "light",
    light: ["#f8faf6", "#ffffff", "#375b39"],
    dark: ["#121913", "#1e2920", "#97c18e"],
  },
  {
    id: "obsidian",
    name: "Obsidian",
    defaultAppearance: "dark",
    light: ["#f5f7f8", "#ffffff", "#047857"],
    dark: ["#0b0d13", "#151924", "#10b981"],
  },
  {
    id: "midnight",
    name: "Midnight",
    defaultAppearance: "dark",
    light: ["#f2f7fc", "#ffffff", "#0369a1"],
    dark: ["#060913", "#10182e", "#38bdf8"],
  },
  {
    id: "sunset",
    name: "Twilight",
    defaultAppearance: "dark",
    light: ["#faf5fc", "#ffffff", "#7e22ce"],
    dark: ["#0e0a1b", "#1b1433", "#a855f7"],
  },
  {
    id: "paper",
    name: "Swan",
    defaultAppearance: "light",
    light: ["#ffffff", "#f6f8fa", "#0969da"],
    dark: ["#111820", "#1c2631", "#79b8ff"],
  },
  {
    id: "monokai",
    name: "Amber",
    defaultAppearance: "dark",
    light: ["#fbf7ef", "#fffdf8", "#8b5c0d"],
    dark: ["#201c17", "#302920", "#e8b55f"],
  },
  {
    id: "sakura",
    name: "Sakura",
    defaultAppearance: "dark",
    light: ["#fdf5f9", "#fffafd", "#b4236b"],
    dark: ["#13141c", "#1f2030", "#f472b6"],
  },
  {
    id: "whatsapp",
    name: "Emerald",
    defaultAppearance: "dark",
    light: ["#efeae2", "#ffffff", "#008069"],
    dark: ["#0c1317", "#202c33", "#00a884"],
  },
  {
    id: "ios",
    name: "Blue Glass",
    defaultAppearance: "dark",
    light: ["#f2f2f7", "#ffffff", "#007aff"],
    dark: ["#000000", "#1c1c1e", "#0a84ff"],
  },
  {
    id: "telegram",
    name: "Horizon",
    defaultAppearance: "dark",
    light: ["#eef2f5", "#ffffff", "#2481cc"],
    dark: ["#0e1621", "#1e2c3a", "#5288c1"],
  },
  {
    id: "discord",
    name: "Night Shift",
    defaultAppearance: "dark",
    light: ["#f5f5fa", "#ffffff", "#4f46c8"],
    dark: ["#1e1f22", "#313338", "#5865f2"],
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    defaultAppearance: "dark",
    light: ["#eff1f5", "#e6e9ef", "#8839ef"],
    dark: ["#181825", "#313244", "#cba6f7"],
  },
  {
    id: "nord",
    name: "Nord",
    defaultAppearance: "dark",
    light: ["#eceff4", "#ffffff", "#406477"],
    dark: ["#242933", "#3b4252", "#88c0d0"],
  },
  {
    id: "onedark",
    name: "One Dark",
    defaultAppearance: "dark",
    light: ["#f7f8fa", "#ffffff", "#2465a5"],
    dark: ["#21252b", "#282c34", "#61afef"],
  },
  {
    id: "dracula",
    name: "Dracula",
    defaultAppearance: "dark",
    light: ["#f8f5fc", "#ffffff", "#7042a6"],
    dark: ["#1e1f29", "#282a36", "#bd93f9"],
  },
];

export function readAppearance() {
  const saved = localStorage.getItem("agentalk_theme") || "sage";
  const theme =
    THEMES.find((item) => item.id === saved.replace(/-(light|dark)$/, "")) ||
    THEMES[0];
  const mode = localStorage.getItem("agentalk_appearance");
  const appearance: Appearance =
    mode === "light" || mode === "dark"
      ? mode
      : saved.endsWith("-light")
        ? "light"
        : saved.endsWith("-dark")
          ? "dark"
          : theme.defaultAppearance;
  return { theme: theme.id, appearance };
}

export function applyAppearance(theme: ThemeId, appearance: Appearance) {
  const config = THEMES.find((item) => item.id === theme)!;
  const variant =
    appearance === config.defaultAppearance ? theme : `${theme}-${appearance}`;
  document.documentElement.dataset.theme = variant;
  document.documentElement.dataset.appearance = appearance;
  localStorage.setItem("agentalk_theme", variant);
  localStorage.setItem("agentalk_appearance", appearance);
}
