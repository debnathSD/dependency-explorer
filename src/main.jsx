import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { readAppearance, applyAppearance } from './theme.js';

// Apply appearance before first paint so CSS variables are correct immediately
try {
  applyAppearance(readAppearance());
} catch {}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
