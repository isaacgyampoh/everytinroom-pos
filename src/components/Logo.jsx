/**
 * EVERYTINROOM — typographic logo system (SVG, sharp at any size).
 *   <Logo />      arched "crest" wordmark (default) — EVERYTINROOM on a
 *                 gentle arc, "& BEDTIME" straight beneath.
 *   <LogoFlat />  straight one-line wordmark (clipping fixed).
 *   <LogoMark />  compact "E" monogram for square slots.
 */

const INK = '#1a3d30'
const GOLD = '#b08642'

let _id = 0
const uid = () => `arc${++_id}`

export function Logo({ height = 96, color = INK, accent = GOLD, tagline = true, className = '' }) {
  const id = uid()
  const W = 440, H = tagline ? 150 : 120
  const cx = W / 2
  const arcY = 96, arcLift = 34
  const arcPath = `M 60 ${arcY} Q ${cx} ${arcY - arcLift} ${W - 60} ${arcY}`
  return (
    <svg className={className} height={height} viewBox={`0 0 ${W} ${H}`} fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="EVERYTINROOM & BEDTIME">
      <defs><path id={id} d={arcPath} /></defs>
      <text fill={color} fontFamily="'Fraunces', Georgia, serif" fontWeight="600" fontSize="40" letterSpacing="2.5" style={{ fontOpticalSizing: 'auto' }}>
        <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">EVERYTINROOM</textPath>
      </text>
      <line x1={cx - 78} y1={arcY + 18} x2={cx - 14} y2={arcY + 18} stroke={accent} strokeWidth="1.4" />
      <rect x={cx - 3.5} y={arcY + 18 - 3.5} width="7" height="7" fill={accent} transform={`rotate(45 ${cx} ${arcY + 18})`} />
      <line x1={cx + 14} y1={arcY + 18} x2={cx + 78} y2={arcY + 18} stroke={accent} strokeWidth="1.4" />
      {tagline && (
        <text x={cx} y={arcY + 44} textAnchor="middle" fill={color} opacity="0.6"
          fontFamily="'Hanken Grotesk', system-ui, sans-serif" fontWeight="600" fontSize="13" letterSpacing="7">&amp; BEDTIME</text>
      )}
    </svg>
  )
}

export function LogoFlat({ height = 44, color = INK, accent = GOLD, tagline = true, className = '' }) {
  const id = uid()
  const W = 460, H = tagline ? 96 : 66
  const cx = W / 2
  const ruleY = 58
  return (
    <svg className={className} height={height} viewBox={`0 0 ${W} ${H}`} fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="EVERYTINROOM">
      <text x={cx} y={tagline ? 38 : 44} textAnchor="middle" fill={color}
        fontFamily="'Fraunces', Georgia, serif" fontWeight="600" fontSize="40" letterSpacing="3"
        style={{ fontOpticalSizing: 'auto' }}>EVERYTINROOM</text>
      <line x1={cx - 78} y1={ruleY} x2={cx - 14} y2={ruleY} stroke={accent} strokeWidth="1.4" />
      <rect x={cx - 3.5} y={ruleY - 3.5} width="7" height="7" fill={accent} transform={`rotate(45 ${cx} ${ruleY})`} />
      <line x1={cx + 14} y1={ruleY} x2={cx + 78} y2={ruleY} stroke={accent} strokeWidth="1.4" />
      {tagline && (
        <text x={cx} y={84} textAnchor="middle" fill={color} opacity="0.6"
          fontFamily="'Hanken Grotesk', system-ui, sans-serif" fontWeight="600" fontSize="13" letterSpacing="7">&amp; BEDTIME</text>
      )}
    </svg>
  )
}

export function LogoMark({ size = 40, bg = INK, fg = '#ffffff', accent = GOLD, rounded = 12, className = '' }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="EVERYTINROOM">
      <rect width="48" height="48" rx={rounded} fill={bg} />
      <text x="24" y="33" textAnchor="middle" fill={fg}
        fontFamily="'Fraunces', Georgia, serif" fontWeight="600" fontSize="28"
        style={{ fontOpticalSizing: 'auto' }}>E</text>
      <line x1="17" y1="37" x2="31" y2="37" stroke={accent} strokeWidth="1.6" />
    </svg>
  )
}

export default Logo
