import { useStore } from '../hooks/useStore'

export default function Loader() {
  const { loading, loadingText } = useStore()
  if (!loading) return null
  return (
    <div className="fixed inset-0 bg-[#0a0a0a] z-[9999] flex items-center justify-center flex-col gap-5">
      <div className="w-10 h-10 border-3 border-[#222] border-t-[#d4a017] rounded-full animate-spin" />
      <p className="text-[#666] text-sm font-medium">{loadingText}</p>
    </div>
  )
}
