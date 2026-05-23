/**
 * @fileoverview React entry point for the CrowdCommand command dashboard.
 * Mounts the root App component into the #root DOM element.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const root = ReactDOM.createRoot(document.getElementById("root"));

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);