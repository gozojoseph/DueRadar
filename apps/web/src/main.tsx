import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { ToastProvider } from "./components/ui";
import { markAndroidApp } from "./lib/android";
import { AuthProvider } from "./lib/session";
import "./index.css";

// The Play Store (TWA) build launches at /?src=play; persist the Android flag
// before any component renders so billing UI is hidden from the first paint.
if (new URLSearchParams(window.location.search).get("src") === "play") {
  markAndroidApp();
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      gcTime: 10 * 60_000,
    },
    mutations: {
      retry: 0,
    },
  },
});

if (import.meta.env.PROD) {
  registerSW({ immediate: true });
}

const container = document.getElementById("root");
if (!container) throw new Error("Root element missing from index.html");

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
