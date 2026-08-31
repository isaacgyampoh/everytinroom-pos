// ============================================================================
// UPLOAD-SIDE IMAGE COMPRESSION
//
// Photos were being uploaded exactly as they came off the phone. The catalogue
// ended up at 492MB across 534 images — 944KB average, worst case 5.7MB — for
// pictures that are never displayed above 800px wide.
//
// Serving them resized (see thumb()) fixes what the till downloads. This fixes
// what goes in, so the problem stops growing: storage, egress and every future
// transform all shrink with it.
// ============================================================================

const MAX_EDGE = 1600   // plenty for an 800px display on a 2x screen
const QUALITY = 0.82

// Returns a downscaled JPEG Blob, or the original file if it is already small
// or cannot be decoded (never block a save over a compression failure).
export async function compressImage(file, { maxEdge = MAX_EDGE, quality = QUALITY } = {}) {
  if (!file || !file.type?.startsWith('image/')) return file
  // Leave small files and formats that lose out as JPEG (transparency) alone.
  if (file.size < 300 * 1024) return file

  try {
    const bitmap = await createImageBitmap(file)
    const { width, height } = bitmap
    const scale = Math.min(1, maxEdge / Math.max(width, height))
    const w = Math.round(width * scale)
    const h = Math.round(height * scale)

    // Already small enough and not worth re-encoding.
    if (scale === 1 && file.size < 600 * 1024) { bitmap.close?.(); return file }

    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()

    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality))
    if (!blob) return file
    // If compression somehow made it bigger, keep the original.
    if (blob.size >= file.size) return file

    const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() })
  } catch (e) {
    console.warn('Image compression skipped:', e)
    return file
  }
}

export const kb = (bytes) => bytes < 1024 * 1024
  ? Math.round(bytes / 1024) + ' KB'
  : (bytes / 1024 / 1024).toFixed(1) + ' MB'
