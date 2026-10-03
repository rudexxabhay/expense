import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

const preventGestureZoom = (event) => event.preventDefault();
document.addEventListener("gesturestart", preventGestureZoom, { passive: false });
document.addEventListener("gesturechange", preventGestureZoom, { passive: false });
document.addEventListener("gestureend", preventGestureZoom, { passive: false });

const inAppContext = (target) => target instanceof Element && Boolean(target.closest("#root"));
window.addEventListener("wheel", (event) => {
  if (inAppContext(event.target) && (event.ctrlKey || event.metaKey)) event.preventDefault();
}, { passive: false });
window.addEventListener("keydown", (event) => {
  if (!inAppContext(event.target) || !(event.ctrlKey || event.metaKey)) return;
  if (["+", "=", "-", "0"].includes(event.key)) event.preventDefault();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
