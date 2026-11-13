import './notifications.css';

const COLOR_MAP: Record<string, string> = {
  red: '#ff4e45',
  green: '#2ba640',
  yellow: '#ffd600',
  blue: '#3ea6ff',
  indigo: '#7c4dff',
  grey: 'rgba(255, 255, 255, 0.5)',
  none: 'transparent'
};

const MAX_VISIBLE = 3;

let container: HTMLElement | null = null;

function getContainer() {
  if (container?.isConnected) return container;
  container = document.createElement('div');
  container.className = 'ytaf-notification-container';
  document.body.appendChild(container);
  return container;
}

/**
 * Show a toast in the bottom-right corner.
 * @param text Message
 * @param time How long it stays visible (ms)
 * @param color Accent colour name (see COLOR_MAP) or any CSS colour
 */
export function showNotification(text: string, time = 3000, color = 'grey') {
  const root = getContainer();

  while (root.childElementCount >= MAX_VISIBLE) {
    root.firstElementChild?.remove();
  }

  const elm = document.createElement('div');
  elm.className = 'ytaf-toast ytaf-toast-hidden';
  elm.textContent = text;
  elm.style.borderLeftColor = COLOR_MAP[color] ?? color;
  root.appendChild(elm);

  // Two frames so the transition runs from the hidden state.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => elm.classList.remove('ytaf-toast-hidden'))
  );

  setTimeout(() => {
    elm.classList.add('ytaf-toast-hidden');
    setTimeout(() => elm.remove(), 400);
  }, time);
}
