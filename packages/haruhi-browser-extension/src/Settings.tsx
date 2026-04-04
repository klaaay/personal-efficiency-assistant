import React from "react";
import ReactDOM from "react-dom/client";
import { Theme } from "@radix-ui/themes";
import { SettingsPage } from "./components/SettingsPage";
import "./main.css";
import "@radix-ui/themes/styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Theme>
      <div className="p-6 max-w-2xl mx-auto">
        <SettingsPage />
      </div>
    </Theme>
  </React.StrictMode>
);
