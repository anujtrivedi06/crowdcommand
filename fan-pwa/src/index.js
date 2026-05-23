import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

/**
 * CrowdCommand Fan PWA entry point.
 * Mounts the React app into the #root div defined in public/index.html.
 * StrictMode is enabled in development to surface potential issues early.
 */
const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);