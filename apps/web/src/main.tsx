import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./css/globals.css";
import { App } from "./app";
import { AuthProvider } from "./lib/auth";
import { PREFERENCE_DEFAULTS } from "./lib/preferences/preferences-config";
import { PreferencesStoreProvider } from "./stores/preferences/preferences-provider";
import { runThemeBoot } from "./scripts/theme-boot";

// Atribut tema dan layout diterapkan sebelum render, supaya tidak berkedip.
runThemeBoot();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <PreferencesStoreProvider initialValues={PREFERENCE_DEFAULTS}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </PreferencesStoreProvider>
    </QueryClientProvider>
  </StrictMode>,
);
