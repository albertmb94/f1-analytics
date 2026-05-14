import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { DataProvider } from "./context/DataContext";
import { ErrorBoundary } from "./components/ErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DataProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </DataProvider>
  </StrictMode>
);
