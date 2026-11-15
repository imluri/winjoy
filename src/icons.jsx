import React from 'react'

const paths = {
  brand: <><path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
  home: <><rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/></>,
  settings: <><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" className="icon-cutout"/><circle cx="16" cy="12" r="2" className="icon-cutout"/><circle cx="10" cy="18" r="2" className="icon-cutout"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
  minimize: <path d="M5 12h14"/>,
  maximize: <rect x="5" y="5" width="14" height="14" rx="1"/>,
  restore: <><rect x="4" y="8" width="12" height="12" rx="1"/><path d="M8 8V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-3"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  reset: <><path d="M3 12a9 9 0 1 1 2.4 6.1M3 7v5h5"/></>,
  arrow: <path d="M4 12h15m-6-6 6 6-6 6"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  gamepad: <><path d="M8 7h8a4 4 0 0 1 3.9 3.1l1.2 5.1a2 2 0 0 1-3.4 1.8L15 14h-6l-2.7 3a2 2 0 0 1-3.4-1.8l1.2-5.1A4 4 0 0 1 8 7Z"/><path d="M8 9.7v3.6m-1.8-1.8h3.6m5.8-.9h.01m2.6 2h.01"/></>,
  host: <><rect x="3.5" y="4.5" width="17" height="13" rx="2"/><path d="M8 21h8m-4-3.5V21M8.5 11h7m-3.5-3.5v7"/></>,
  join: <path d="M13 4h6a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-6M3 12h12m-4-4 4 4-4 4"/>,
  keyboard: <><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.02M10.3 10h.02m3.3 0h.02m3.3 0h.02M7 14h.02m3.5 0h6.5"/></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 4H6a2 2 0 0 0-2 2v10"/></>,
  download: <path d="M12 3v12m-4-4 4 4 4-4M4 17v3h16v-3"/>,
}

export function Icon({ name, size = 19 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}
