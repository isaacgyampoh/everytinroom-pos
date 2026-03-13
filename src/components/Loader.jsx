import { useStore } from '../hooks/useStore'

export default function Loader() {
  const { loading, loadingText } = useStore()
  if (!loading) return null
  return (
    <div className="fixed inset-0 bg-brand-900 z-[9999] flex items-center justify-center flex-col gap-5">
      <div className="w-10 h-10 border-3 border-brand-700 border-t-brand-400 rounded-full animate-spin" />
      <p className="text-brand-500 text-sm font-medium">{loadingText}</p>
    </div>
  )
}
