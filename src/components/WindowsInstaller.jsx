import { useState, useEffect, useRef } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { rpcMessage } from '../lib/rpcError'
import toast from 'react-hot-toast'

// Setting up a new counter should not involve GitHub. The installer is
// published to the shop's own storage, and this is where it is collected —
// from inside the till software, on the machine being set up.
//
// Anyone signed in can download it. Only an admin can publish a new one.
const BUCKET = 'app-releases'

const mb = (b) => b ? (b / 1024 / 1024).toFixed(0) + ' MB' : ''

export default function WindowsInstaller() {
  const { token, isAdmin, user } = useStore()
  const [rel, setRel] = useState(undefined)     // undefined = still looking
  const [busy, setBusy] = useState(false)
  const [version, setVersion] = useState('')
  const fileRef = useRef(null)

  const load = async () => {
    const { data, error } = await getSupabase()
      .from('app_releases')
      .select('version,object_path,size_bytes,notes,published_at,published_by')
      .eq('platform', 'windows').eq('active', true)
      .order('published_at', { ascending: false }).limit(1)
    if (error) { setRel(null); return }
    setRel(data?.[0] || null)
  }
  useEffect(() => { load() }, []) // eslint-disable-line

  const downloadUrl = rel
    ? getSupabase().storage.from(BUCKET).getPublicUrl(rel.object_path).data.publicUrl
    : null

  const publish = async (file) => {
    if (!file) return
    if (!/\.exe$/i.test(file.name)) { toast.error('That is not a Windows installer (.exe)'); return }
    const v = version.trim()
    if (!v) { toast.error('Give the build a version, e.g. 2.1.0'); return }

    setBusy(true)
    try {
      const sb = getSupabase()
      const path = `windows/EVERYTINROOM-POS-${v}.exe`
      const { error: upErr } = await sb.storage.from(BUCKET)
        .upload(path, file, { upsert: true, contentType: 'application/vnd.microsoft.portable-executable' })
      if (upErr) throw new Error(upErr.message)

      const { data, error } = await sb.rpc('publish_release', {
        p_token: token, p_version: v, p_path: path,
        p_size: file.size, p_notes: '', p_platform: 'windows',
      })
      if (error || !data?.success) throw new Error(rpcMessage(error, data, 'Could not publish'))

      toast.success(`Version ${v} is now available on every till`)
      setVersion(''); if (fileRef.current) fileRef.current.value = ''
      load()
    } catch (e) {
      toast.error(e.message || 'Upload failed')
    } finally { setBusy(false) }
  }

  return (
    <div className="bg-white rounded-2xl p-5 md:p-6 shadow-md mb-5">
      <h2 className="text-sm font-bold text-gray-800 mb-1">Windows till app</h2>
      <p className="text-[11px] text-gray-400 mb-4 leading-relaxed max-w-[68ch]">
        Installs the till onto a Windows machine, so it opens and sells without internet —
        the application lives on the PC rather than in a browser. Run this on each new counter.
      </p>

      {rel === undefined && <div className="text-[13px] text-gray-400">Checking…</div>}

      {rel === null && (
        <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
          <div className="text-[13px] font-semibold text-gray-700">No build published yet</div>
          <p className="text-[12px] text-gray-500 mt-1 leading-relaxed">
            {isAdmin
              ? 'Build one from the Windows desktop build workflow, then upload the .exe below. Every till will offer it from then on.'
              : 'Ask an admin to publish the Windows build.'}
          </p>
        </div>
      )}

      {rel && (
        <div className="rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-gray-900">
              Version {rel.version} <span className="text-gray-400 font-normal">· {mb(rel.size_bytes)}</span>
            </div>
            <div className="text-[11.5px] text-gray-400 mt-0.5">
              Published {new Date(rel.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              {rel.published_by ? ` by ${rel.published_by}` : ''}
            </div>
          </div>
          <a href={downloadUrl} download
            className="h-11 px-5 rounded-xl bg-[#16181d] text-white text-[13px] font-semibold flex items-center justify-center shrink-0">
            Download installer
          </a>
        </div>
      )}

      {rel && (
        <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
          Windows will warn that the publisher is unknown — the installer is not code-signed.
          Choose <b>More info → Run anyway</b>.
        </p>
      )}

      {isAdmin && (
        <details className="mt-4 group">
          <summary className="text-[12px] font-semibold text-gray-500 cursor-pointer select-none">
            Publish a new build
          </summary>
          <div className="mt-3 rounded-xl bg-gray-50 border border-gray-200 p-4">
            <p className="text-[11.5px] text-gray-500 mb-3 leading-relaxed">
              Download the installer from the <b>Windows desktop build</b> workflow in GitHub Actions,
              then upload it here. It replaces whatever every till is currently offered.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input value={version} onChange={e => setVersion(e.target.value)}
                placeholder="Version, e.g. 2.1.0"
                className="h-11 px-3 w-full sm:w-[150px] bg-white border-2 border-gray-200 rounded-xl text-[14px]" />
              <input ref={fileRef} type="file" accept=".exe" disabled={busy}
                onChange={e => publish(e.target.files?.[0])}
                className="flex-1 text-[13px] file:mr-3 file:py-2.5 file:px-4 file:rounded-lg file:border-0 file:text-[13px] file:font-semibold file:bg-[#16181d] file:text-white disabled:opacity-50" />
            </div>
            {busy && <div className="text-[12px] text-gray-500 mt-2">Uploading — this is a large file, give it a moment.</div>}
            <p className="text-[11px] text-gray-400 mt-2">Uploading as {user?.name}.</p>
          </div>
        </details>
      )}
    </div>
  )
}
