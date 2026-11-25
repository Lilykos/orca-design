// The canvas's element helpers (UP canvas.ts el/button) for UI outside the canvas closure.
import { icon, type IconName } from "./icons";

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(label: string, iconName: IconName | null, onClick: () => void, className = "dc-btn"): HTMLButtonElement {
  const node = el("button", className);
  node.type = "button";
  node.innerHTML = iconName ? icon(iconName) : "";
  if (label) node.append(document.createTextNode(label));
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return node;
}
