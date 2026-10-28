import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { AppDataProvider } from "./context/AppData.jsx";
import { UnitsProvider } from "./context/Units.jsx";
import "./styles/theme.css";
import "./styles/app.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <UnitsProvider>
      <AppDataProvider>
        <App />
      </AppDataProvider>
    </UnitsProvider>
  </StrictMode>
);
