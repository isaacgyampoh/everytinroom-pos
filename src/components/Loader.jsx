import { useStore } from '../hooks/useStore'

export default function Loader() {
  const { loading, loadingText } = useStore()
  if (!loading) return null
  return (
    <div className="fixed inset-0 bg-[#0A0A0A] z-[9999] flex items-center justify-center flex-col gap-5">
      <div className="w-10 h-10 border-3 border-gray-700 border-t-white rounded-full animate-spin" />
      <p className="text-gray-400 text-sm font-medium">{loadingText}</p>
    </div>
  )
}
