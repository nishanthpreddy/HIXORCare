// Hand-drawn 24px stroke icons, so the app has no icon-font dependency.
const P: Record<string, string> = {
  today: 'M4 5h16v15H4zM4 9h16M9 3v4M15 3v4M8 13h3v3H8z',
  pill: 'M10.5 20.5a5 5 0 0 1-7-7l7-7a5 5 0 0 1 7 7zM7 10l7 7',
  residents: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a7 7 0 0 1 14 0v1M17 3.5a4 4 0 0 1 0 7.5M22 21v-1a7 7 0 0 0-4-6.3',
  handover: 'M9 4h6v3H9zM8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2M8.5 13l2.5 2.5 4.5-5',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
  scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  alert: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  stop: 'M8 3h8l5 5v8l-5 5H8l-5-5V8zM12 8v5M12 16v.5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  right: 'M9 5l7 7-7 7',
  left: 'M15 5l-7 7 7 7',
  down: 'M5 9l7 7 7-7',
  heart: 'M12 20s-7.5-4.6-9-9.5C2 6.9 4.5 4 7.5 4c2 0 3.5 1.2 4.5 2.6C13 5.2 14.5 4 16.5 4 19.5 4 22 6.9 21 10.5 19.5 15.4 12 20 12 20zM3 12h5l2-3 3 6 2-3h6',
  temp: 'M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0zM12 17v-6',
  drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
  wound: 'M4 15l5-5a3 3 0 0 1 4 0l1 1a3 3 0 0 1 0 4l-5 5a3 3 0 0 1-4 0l-1-1a3 3 0 0 1 0-4zM14 4l6 6M17 3l4 4',
  note: 'M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6',
  plus: 'M12 5v14M5 12h14',
  lock: 'M6 11h12v10H6zM8 11V8a4 4 0 0 1 8 0v3',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  send: 'M4 12l16-8-6 17-3-7zM11 14l9-10',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 8v4l3 2',
  bed: 'M3 18v-8M3 14h18v4M21 18v-5a3 3 0 0 0-3-3h-7v4M7 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  syringe: 'M18 2l4 4M17 7l3-3M19 9l-9 9H6v-4l9-9zM11 7l6 6M5 19l-3 3',
  vial: 'M8 3h8M9 3v13a3 3 0 0 0 6 0V3M9 10h6',
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10V5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5A6.5 6.5 0 0 1 4 16.5V12a1.5 1.5 0 0 1 3 0v2',
  user: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM4 21a8 8 0 0 1 16 0',
  fwd: 'M13 5l7 7-7 7M4 12h16',
  reset: 'M4 4v6h6M20 20v-6h-6M5 15a7.5 7.5 0 0 0 13.3 2.6M19 9A7.5 7.5 0 0 0 5.7 6.4',
  walk: 'M13 4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM9 21l3-7 3 3v4M7 11l3-4 4 1 2 3h3M12 14l-1-5',
  flame: 'M12 21a6 6 0 0 0 6-6c0-4-3-6-3-9-2 1-4 3.5-4 6-1-1-1.5-2-1.5-3C7 11 6 13 6 15a6 6 0 0 0 6 6z',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.5',
  camera: 'M4 8h3l2-3h6l2 3h3v12H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  filter: 'M4 5h16l-6 8v6l-4-2v-4z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  chart: 'M4 20h16M7 16v-5M12 16V6M17 16v-8',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  home: 'M3 11l9-7 9 7M5 9.5V20h14V9.5M10 20v-6h4v6',
  swap: 'M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
}

export function Icon({ name, size, className, title }: { name: keyof typeof P | string; size?: number; className?: string; title?: string }) {
  const d = P[name] ?? P.info
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} className={className} fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={d} />
    </svg>
  )
}

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-label="HIXOR Care" role="img">
      <rect width="40" height="40" rx="11" fill="#2563eb" />
      <path d="M12 11v18M28 11v18M12 20h16" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="20" cy="20" r="3.2" fill="#f59e0b" />
    </svg>
  )
}
