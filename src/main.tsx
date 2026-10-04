import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { TaskThemeProvider } from "@/components/task-theme"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TaskThemeProvider>
      <App />
    </TaskThemeProvider>
  </StrictMode>
)
