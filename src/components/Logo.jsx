/**
 * EVERYTINROOM — typographic logo, drawn as SVG so it's razor-sharp at
 * any size (rail icon, login, big customer display, thermal receipt).
 * Two forms, one identity:
 *   <Logo />        full wordmark "EVERYTINROOM" (+ optional & BEDTIME)
 *   <LogoMark />    compact monogram for square slots
 * Colours come from currentColor / props so it adapts to dark surfaces.
 */

const INK = '#1a3d30'   // brand forest green
const GOLD = '#b08642'  // brand gold accent

// Full wordmark — letter-spaced serif caps with a gold hairline rule,
// the classic premium boutique treatment.
export function Logo({ height = 40, color = INK, accent = GOLD, tagline = true, className = '' }) {
  // viewBox sized to the artwork; height scales it, width follows ratio
  const w = 320, h = tagline ? 92 : 64
  return (
    <svg className={className} height={height} viewBox={`0 0 ${w} ${h}`} fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="EVERYTINROOM">
      <text x={w/2} y={tagline ? 36 : 42} textAnchor="middle"
        fontFamily="'Fraunces', Georgia, serif" fontWeight="600" fontSize="38"
        letterSpacing="3.5" fill={color}
        style={{ fontOpticalSizing: 'auto' }}>EVERYTINROOM</text>
      {/* gold hairline rules flanking a small diamond — boutique mark */}
      <line x1={tagline ? 96 : 70} y1={tagline ? 58 : 56} x2={tagline ? 150 : 140} y2={tagline ? 58 : 56} stroke={accent} strokeWidth="1.3" />
      <rect x={w/2 - 3} y={(tagline ? 58 : 56) - 3} width="6" height="6" fill={accent} transform={`rotate(45 ${w/2} ${tagline ? 58 : 56})`} />
      <line x1={tagline ? 170 : 180} y1={tagline ? 58 : 56} x2={tagline ? 224 : 250} y2={tagline ? 58 : 56} stroke={accent} strokeWidth="1.3" />
      {tagline && (
        <text x={w/2} y={80} textAnchor="middle"
          fontFamily="'Hanken Grotesk', system-ui, sans-serif" fontWeight="600" fontSize="11"
          letterSpacing="6" fill={color} opacity="0.62">&amp; BEDTIME</text>
      )}
    </svg>
  )
}

// Compact monogram — serif "E" with a gold underline tick, in a rounded
// tile. Used in the nav rail and small avatar slots.
export function LogoMark({ size = 40, bg = INK, fg = '#ffffff', accent = GOLD, rounded = 12, className = '' }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="EVERYTINROOM">
      <rect width="48" height="48" rx={rounded} fill={bg} />
      <text x="24" y="33" textAnchor="middle"
        fontFamily="'Fraunces', Georgia, serif" fontWeight="600" fontSize="28"
        fill={fg} style={{ fontOpticalSizing: 'auto' }}>E</text>
      <line x1="17" y1="37" x2="31" y2="37" stroke={accent} strokeWidth="1.6" />
    </svg>
  )
}

export default Logo
