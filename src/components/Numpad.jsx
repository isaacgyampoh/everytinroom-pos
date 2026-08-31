// ============================================================================
// TOUCH NUMPAD
//
// A POS terminal is a touchscreen with no keyboard attached. `type="tel"` gets
// you a soft keyboard on a phone, but on a Windows or Linux till it gets you
// nothing at all — the cashier taps the PIN box and cannot type. This is the
// on-screen keypad that makes the app usable on real hardware.
//
// Keys are sized for a fingertip on a resistive screen (the cheap ones need a
// deliberate press), not for a mouse.
// ============================================================================

export default function Numpad({ onKey, onBackspace, onClear, onEnter, decimal = false, enterLabel = 'Enter', disabled = false }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

  const Key = ({ children, onClick, tone = 'plain', wide = false }) => (
    <button
      type="button"
      disabled={disabled}
      // Never let a keypad press steal focus from the field being typed into.
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      className={[
        'h-[56px] rounded-[14px] text-[22px] font-bold select-none transition active:scale-95 disabled:opacity-30',
        wide ? 'col-span-2' : '',
        tone === 'plain' ? 'bg-white border-2 border-gray-200 text-gray-800 active:bg-gray-100 active:border-gray-900' : '',
        tone === 'muted' ? 'bg-gray-100 border-2 border-gray-200 text-gray-500 text-[17px]' : '',
        tone === 'go' ? 'bg-[#16181d] text-white text-[16px]' : '',
      ].join(' ')}
    >
      {children}
    </button>
  )

  return (
    <div className="grid grid-cols-3 gap-2 select-none">
      {keys.map(k => <Key key={k} onClick={() => onKey(k)}>{k}</Key>)}

      {decimal
        ? <Key onClick={() => onKey('.')}>.</Key>
        : onClear
          ? <Key tone="muted" onClick={onClear}>Clear</Key>
          : <span />}

      <Key onClick={() => onKey('0')}>0</Key>

      <Key tone="muted" onClick={onBackspace} aria-label="Backspace">⌫</Key>

      {onEnter && <Key tone="go" wide onClick={onEnter}>{enterLabel}</Key>}
    </div>
  )
}
