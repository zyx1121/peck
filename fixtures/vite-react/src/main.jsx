import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App.jsx"
import Save from "./Save.jsx"

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
    <Save />
  </StrictMode>
)
