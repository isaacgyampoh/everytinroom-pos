// Shared inline icons and empty states.
//
// Emoji were stripped out of this app at some point and the markup was left
// behind: `<span className="text-xl opacity-15">—</span>` in front of every
// empty-state message (rendering as a faint dash jammed against the text),
// blank grey squares where a product image placeholder should be, and stray
// gaps in flex rows where an icon used to sit. These replace them.

const S = ({ size = 24, children, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...rest}>{children}</svg>
)

export const IconImage = (p) => <S {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></S>
export const IconSearch = (p) => <S {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></S>
export const IconCart = (p) => <S {...p}><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></S>
export const IconTag = (p) => <S {...p}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><circle cx="7" cy="7" r="1.2" /></S>
export const IconBox = (p) => <S {...p}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" /></S>
export const IconChart = (p) => <S {...p}><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></S>
export const IconFile = (p) => <S {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></S>
export const IconClipboard = (p) => <S {...p}><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /></S>
export const IconBarcode = (p) => <S {...p}><path d="M3 5v14M7 5v14M11 5v10M15 5v14M19 5v14" /></S>

// One consistent empty state everywhere, instead of six slightly different
// hand-rolled ones.
export function EmptyState({ icon: Icon = IconBox, title, hint, className = '' }) {
  return (
    <div className={`text-center py-14 ${className}`}>
      <div className="flex justify-center mb-3 text-stone-300"><Icon size={34} /></div>
      <p className="text-sm font-semibold text-gray-500">{title}</p>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}
