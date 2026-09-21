// Every icon in uwuSports is inline SVG. No emoji anywhere, no icon font.
// viewBox "0 0 24 24", stroke="currentColor", stroke-width 1.8, round caps
// and joins, fill="none". Icons inherit colour through currentColor, so
// never hardcode a fill or stroke colour here.

const stroke = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

export const icons = {
  // Theme system
  sun: `<svg ${stroke}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>`,
  moon: `<svg ${stroke}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`,
  close: `<svg ${stroke}><path d="M18 6 6 18M6 6l12 12"/></svg>`,
  clock: `<svg ${stroke}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`,

  // Suite furniture
  coffee: `<svg ${stroke}><path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8z"/><path d="M17 9h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M7 2.5v2M10.5 2.5v2M14 2.5v2"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 20.7 4.3 13a4.9 4.9 0 0 1 7-6.9l.7.7.7-.7a4.9 4.9 0 0 1 7 6.9z"/></svg>`,

  // Sports
  basketball: `<svg ${stroke}><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/><path d="M5.6 5.6a9 9 0 0 0 12.8 12.8M18.4 5.6A9 9 0 0 1 5.6 18.4"/></svg>`,
  flag: `<svg ${stroke}><path d="M5 21V4"/><path d="M5 4h9l-1.4 3.2L14 10.4H5z"/><path d="M14 10.4h5l-1.4 3.2L19 16.8h-5"/></svg>`,
  football: `<svg ${stroke}><circle cx="12" cy="12" r="9"/><path d="m12 7.2 4 2.9-1.5 4.7h-5L8 10.1z"/><path d="M12 3v4.2M20.5 9.6 16 10.1M18.5 19l-4-4.2M5.5 19l4-4.2M3.5 9.6 8 10.1"/></svg>`,
  trophy: `<svg ${stroke}><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4.5A2.5 2.5 0 0 0 7 9M17 6h2.5A2.5 2.5 0 0 1 17 9"/><path d="M12 14v3M9 20h6M10 17h4"/></svg>`,
  globe: `<svg ${stroke}><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/></svg>`,

  // Controls and state
  star: `<svg ${stroke}><path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9z"/></svg>`,
  starFilled: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9z"/></svg>`,
  search: `<svg ${stroke}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>`,
  refresh: `<svg ${stroke}><path d="M20 11a8 8 0 0 0-13.7-5.3L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 13.7 5.3L20 16"/><path d="M20 20v-4h-4"/></svg>`,
  chevronLeft: `<svg ${stroke}><path d="m14 6-6 6 6 6"/></svg>`,
  chevronRight: `<svg ${stroke}><path d="m10 6 6 6-6 6"/></svg>`,
  home: `<svg ${stroke}><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/></svg>`,
  calendar: `<svg ${stroke}><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3.5v3M16 3.5v3"/></svg>`,
  pin: `<svg ${stroke}><path d="M12 21s6.5-5.7 6.5-10.5a6.5 6.5 0 0 0-13 0C5.5 15.3 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.5"/></svg>`,
  info: `<svg ${stroke}><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8v.4"/></svg>`,
  warning: `<svg ${stroke}><path d="M12 4.5 21 19.5H3z"/><path d="M12 10v4M12 17.2v.3"/></svg>`,
  cloudOff: `<svg ${stroke}><path d="M3 3l18 18"/><path d="M8.3 8.3A4.5 4.5 0 0 0 7 17h9.2"/><path d="M11.4 5.2A5.5 5.5 0 0 1 20 10a4 4 0 0 1 .9 7.5"/></svg>`,
  live: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="12" r="5"/></svg>`,
};

export function icon(name) {
  return icons[name] || "";
}
