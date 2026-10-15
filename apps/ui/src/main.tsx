import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/cormorant-garamond/400.css";
import "./styles/global.scss";

import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { brand } from "./config/brand";
import { initTheme } from "./features/theme/theme-store";
import { configureApiClient } from "./lib/api/client";
import { queryClient } from "./lib/api/query-client";

configureApiClient();
initTheme();
document.title = brand.name;

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing from index.html");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
