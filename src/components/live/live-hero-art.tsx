/** A folded field map in PAI's palette; decorative, with no implied map data. */
export function LiveHeroArt() {
  return (
    <svg className="live-hero-art" viewBox="0 0 240 190" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="live-map-paper" x1="45" y1="20" x2="190" y2="180" gradientUnits="userSpaceOnUse">
          <stop stopColor="#eff3dd" /><stop offset="1" stopColor="#d5dfac" />
        </linearGradient>
        <linearGradient id="live-map-gold" x1="130" y1="40" x2="211" y2="151" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f3dfa0" /><stop offset="1" stopColor="#e8c766" />
        </linearGradient>
        <clipPath id="live-map-cut">
          <path d="m26 55 62-26 67 23 60-24-12 124-62 23-64-25-63 24Z" />
        </clipPath>
      </defs>
      <ellipse cx="123" cy="174" rx="82" ry="8" fill="#7d895a" opacity=".07" />
      <g className="live-map-sheet">
        <path d="m26 55 62-26 67 23 60-24-12 124-62 23-64-25-63 24Z" fill="url(#live-map-paper)" stroke="#c5cda8" />
        <path d="m155 52 60-24-12 124-62 23Z" fill="url(#live-map-gold)" />
        <path d="m88 29 67 23-14 123-64-25Z" fill="#fafbf0" />
        <g clipPath="url(#live-map-cut)" stroke="#8c9c61" strokeWidth=".8" opacity=".28">
          <path d="M-10 87c44-72 66 73 116-4s83-6 146-39M-10 98c44-72 66 73 116-4s83-6 146-39M-10 109c44-72 66 73 116-4s83-6 146-39M-10 120c44-72 66 73 116-4s83-6 146-39M-10 131c44-72 66 73 116-4s83-6 146-39M-10 142c44-72 66 73 116-4s83-6 146-39M-10 153c44-72 66 73 116-4s83-6 146-39M-10 164c44-72 66 73 116-4s83-6 146-39M-10 175c44-72 66 73 116-4s83-6 146-39" />
        </g>
        <path d="m88 29-11 121m78-98-14 123" stroke="#97a174" strokeOpacity=".25" />
        <path className="live-map-route" d="M51 122c26-42 42 29 70-16s40-28 61-38" stroke="#fffef6" strokeWidth="8" strokeLinecap="round" />
        <path className="live-map-route" d="M51 122c26-42 42 29 70-16s40-28 61-38" stroke="#789247" strokeWidth="2" strokeLinecap="round" />
        <circle cx="51" cy="122" r="4" fill="#829b51" stroke="#fffef6" strokeWidth="3" />
        <circle cx="182" cy="68" r="12" fill="#fffef6" />
        <circle cx="182" cy="68" r="6" fill="#cfaa40" />
        <circle cx="182" cy="68" r="2" fill="#fffef6" />
      </g>
    </svg>
  );
}
