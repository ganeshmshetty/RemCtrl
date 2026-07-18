/**
 * @file main.tsx
 * @description Application entry point for the Electron renderer process.
 * Bootstraps the React client application, imports the global index.css stylesheet, and mounts
 * the root App component into the HTML DOM container under the 'root' identifier.
 * Primarily coordinates with the bundler (e.g., Vite/Webpack) and Electron window setup to initialize client-side UI.
 */

import ReactDOM from 'react-dom/client';
import '@fontsource-variable/geist';
import App from './App';
// @ts-ignore
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
