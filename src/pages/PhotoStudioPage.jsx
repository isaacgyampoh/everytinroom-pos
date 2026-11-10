import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase, storageUrl } from '../lib/supabase'
import { thumb } from '../lib/utils'
import {
  STUDIO_BUCKET, STUDIO_PREFIX, candidatePath, pendingReviews,
  eligibleProducts, isUsingStudioImage,
} from '../lib/photoStudio'
import { IconImage, IconSearch, EmptyState } from '../components/Icons'
import toast from 'react-hot-toast'

// ============================================================================
// AI PRODUCT STUDIO — the review desk
//
// The processing happens elsewhere: a Python job on a free GitHub runner that
// cuts the background out, centres the product and writes the result beside
// the original as studio/<product-id>.webp. It never touches the products
// table, so until somebody approves one here, nothing in the shop or on the
// website has changed.
//
// This screen is the gate. It exists because the pipeline cannot tell a clean
// cut-out from an ugly one — across the first sample the misses were all
// marketing collages and lifestyle scenes, and no cheap heuristic separated
// them from the good ones. A person can tell at a glance, which is the whole
// design: the machine proposes, a shopkeeper decides.
// ============================================================================

export default function PhotoStudioPage() {
  const { products, refreshProducts, setLoading } = useStore()
  const [files, setFiles] = useState(null)        // null = still looking
  const [busy, setBusy] = useState('')
  const [q, setQ] = useState('')

  const load = async () => {
    const sb = getSupabase()
    const { data, error } = await sb.storage.from(STUDIO_BUCKET)
      .list(STUDIO_PREFIX, { limit: 1000, sortBy: { column: 'name', order: 'asc' } })
    if (error) { console.error('studio list:', error.message); setFiles([]); return }
    setFiles(data || [])
  }
  useEffect(() => { load() }, []) // eslint-disable-line

  const waiting = useMemo(() => {
    const list = pendingReviews(products, files || [])
    const needle = q.trim().toLowerCase()
    return needle ? list.filter(p => (p.name || '').toLowerCase().includes(needle)) : list
  }, [products, files, q])

  const candidateUrl = (p) => storageUrl(STUDIO_BUCKET, candidatePath(p.id))

  const approve = async (p) => {
    setBusy(p.id)
    const sb = getSupabase()
    // The original is left exactly where it is. Approving only re-points the
    // column, so restoring it later is the same operation in reverse.
    const { error } = await sb.from('products')
      .update({ image: candidateUrl(p) }).eq('id', p.id)
    setBusy('')
    if (error) { toast.error(error.message || 'Could not apply it'); return }
    await refreshProducts()
    toast.success('Applied — the shop and the website both use it now')
  }

  const reject = async (p) => {
    if (!confirm(`Discard the new photo for ${p.name}? The original is untouched.`)) return
    setBusy(p.id)
    const sb = getSupabase()
    const { error } = await sb.storage.from(STUDIO_BUCKET).remove([candidatePath(p.id)])
    setBusy('')
    if (error) { toast.error(error.message || 'Could not discard it'); return }
    setFiles(f => (f || []).filter(x => x.name !== `${p.id}.webp`))
    toast('Discarded')
  }

  const eligible = eligibleProducts(products).length
  const live = (products || []).filter(isUsingStudioImage).length

  return (
    <div className="max-w-5xl mx-auto pb-16">
      <div className="mb-5">
        <h1 className="text-[22px] md:text-[26px] font-bold tracking-tight">AI Product Studio</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Background removed, product centred, sized for the web. Nothing changes until you say so.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2.5 mb-5">
        {[['Waiting for you', files === null ? '—' : waiting.length],
          ['Already applied', live],
          ['Not yet processed', eligible]].map(([label, n]) => (
          <div key={label} className="panel panel-pad">
            <div className="panel-head">{label}</div>
            <div className="figure text-[22px] text-gray-900 mt-1">{n}</div>
          </div>
        ))}
      </div>

      {files === null ? (
        <div className="py-16 text-center text-sm text-gray-400">Looking for new photos…</div>
      ) : waiting.length === 0 ? (
        <EmptyState
          icon={IconImage}
          title="Nothing waiting for review"
          hint={eligible > 0
            ? `${eligible} product photos have not been through the studio yet. Run the Product Studio job from the Actions tab, then come back.`
            : 'Every product photo has been through the studio.'} />
      ) : (
        <>
          <div className="relative mb-4">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-300 pointer-events-none"><IconSearch size={16} /></span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search these"
              className="w-full h-11 pl-10 pr-3 panel text-sm focus:outline-none focus:border-gray-900" />
          </div>

          <div className="space-y-3">
            {waiting.map(p => (
              <div key={p.id} className="panel p-4">
                <div className="text-[13.5px] font-semibold text-gray-900 mb-3 truncate">{p.name}</div>
                <div className="grid grid-cols-2 gap-3">
                  {[['Now', thumb(p.image, 480)], ['Proposed', candidateUrl(p)]].map(([label, src]) => (
                    <figure key={label} className="m-0">
                      <figcaption className="text-[11px] font-bold tracking-wide uppercase text-gray-400 mb-1.5">{label}</figcaption>
                      <div className="thumb-shot rounded-xl aspect-square flex items-center justify-center overflow-hidden">
                        <img src={src} alt={`${p.name} — ${label}`} loading="lazy" />
                      </div>
                    </figure>
                  ))}
                </div>
                <div className="flex gap-2 mt-3.5">
                  <button onClick={() => approve(p)} disabled={busy === p.id}
                    className="flex-1 h-11 rounded-xl bg-gray-900 text-white text-[13px] font-bold disabled:opacity-40">
                    {busy === p.id ? 'Applying…' : 'Use the new photo'}
                  </button>
                  <button onClick={() => reject(p)} disabled={busy === p.id}
                    className="h-11 px-4 rounded-xl border-2 border-stone-200 text-[13px] font-bold text-stone-500 disabled:opacity-40">
                    Discard
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
