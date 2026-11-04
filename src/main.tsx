import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./theme-variants.css";
import "./refinements.css";
import { readAppearance, applyAppearance } from "./themes";

// Başlangıçta kayıtlı temayı derhal uygula (FOUC önlemi)
const saved = readAppearance();
applyAppearance(saved.theme, saved.appearance);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
