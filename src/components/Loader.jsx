import { useStore } from '../hooks/useStore'

export default function Loader() {
  const { loading, loadingText } = useStore()
  if (!loading) return null
  return (
    <div className="fixed inset-0 brand-gradient z-[9999] flex items-center justify-center flex-col gap-6 transition-opacity">
      <img src="/logo.png" alt="Everytin Room" className="w-28 h-28 rounded-3xl object-contain animate-float" />
      <div className="w-10 h-10 border-3 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
      <p className="text-white/80 text-base font-semibold">{loadingText}</p>
    </div>
  )
}
