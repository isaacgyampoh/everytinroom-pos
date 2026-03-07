import { useStore } from '../hooks/useStore'

export default function Loader() {
  const { loading, loadingText } = useStore()
  if (!loading) return null
  return (
    <div className="fixed inset-0 bg-gray-900 z-[9999] flex items-center justify-center flex-col gap-5 transition-opacity">
      <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
      <p className="text-white text-base font-semibold">{loadingText}</p>
    </div>
  )
}
