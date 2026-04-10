export default function Modal({ open, onClose, title, children, footer }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[400] flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl md:rounded-2xl w-full md:max-w-[560px] max-h-[90vh] flex flex-col animate-slide-up md:animate-fade">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h3 className="text-xl font-bold">{title}</h3>
          <button onClick={onClose} className="w-11 h-11 bg-gray-100 rounded-xl text-xl flex items-center justify-center">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
        {footer && <div className="p-5 border-t border-gray-100 flex gap-3 safe-bottom">{footer}</div>}
      </div>
    </div>
  )
}
