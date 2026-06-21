import { useState, useMemo } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { money, num } from '../lib/utils'
import toast from 'react-hot-toast'

export default function RestockPage() {
  const { products, refreshProducts, user } = useStore()
  const [query, setQuery] = useState('')
  const [cart, setCart] = useState([]) // { productId, name, currentQty, addQty, costPrice }
  const [saving, setSaving] = useState(false)
  const [history, setHistory] = useState([])

  const filtered = useMemo(() => {
    if (!query.trim()) return []
    const q = query.toLowerCase()
    return products.filter(p => p.name.toLowerCase().includes(q)).slice(0, 10)
  }, [products, query])

  const addToRestock = (product) => {
    const existing = cart.find(c => c.productId === product.id)
    if (existing) {
      toast('Already in restock list', { icon: '' })
      return
    }
    setCart([...cart, {
      productId: product.id,
      name: product.name,
      currentQty: product.quantity,
      addQty: '',
      costPrice: product.costPrice,
      image: product.image
    }])
    setQuery('')
    toast.success(`${product.name} added`)
  }

  const updateQty = (index, value) => {
    const updated = [...cart]
    updated[index].addQty = value
    setCart(updated)
  }

  const removeItem = (index) => {
    const updated = [...cart]
    updated.splice(index, 1)
    setCart(updated)
  }

  const totalItems = cart.reduce((a, c) => a + (num(c.addQty) || 0), 0)
  const totalCost = cart.reduce((a, c) => a + (num(c.addQty) * num(c.costPrice)), 0)

  const handleRestock = async () => {
    const validItems = cart.filter(c => num(c.addQty) > 0)
    if (validItems.length === 0) {
      toast.error('Enter quantities to restock')
      return
    }

    setSaving(true)
    const sb = getSupabase()
    let success = 0
    let failed = 0

    for (const item of validItems) {
      const product = products.find(p => p.id === item.productId)
      if (!product) { failed++; continue }
      
      const newQty = product.quantity + num(item.addQty)
      const { error } = await sb.from('products').update({ quantity: newQty }).eq('id', item.productId)
      
      if (error) {
        failed++
        console.error(`Failed to restock ${item.name}:`, error)
      } else {
        success++
        // Log as stock adjustment
        await sb.from('stock_adjustments').insert({
          date: new Date().toISOString(),
          product_id: item.productId,
          product_name: item.name,
          qty: num(item.addQty),
          reason: 'Restock',
          notes: `Added ${num(item.addQty)} units (${product.quantity} → ${newQty})`,
          adjusted_by: user?.name || 'Admin'
        }).catch(() => {})
      }
    }

    await refreshProducts()

    // Save to local history
    setHistory(prev => [{
      date: new Date().toLocaleString('en-GB'),
      items: validItems.map(i => ({ name: i.name, qty: num(i.addQty) })),
      by: user?.name
    }, ...prev.slice(0, 9)])

    setCart([])
    setSaving(false)

    if (success > 0) toast.success(`${success} product${success > 1 ? 's' : ''} restocked!`)
    if (failed > 0) toast.error(`${failed} failed to update`)
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-black text-gray-800">Restock</h1>
          <p className="text-sm text-gray-400 mt-0.5">Add stock to existing products</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <input
          type="text"
          placeholder="Search product to restock..."
          className="w-full h-14 px-5 pl-12 bg-white border-2 border-gray-200 rounded-2xl text-base font-medium focus:border-gray-500 focus:outline-none transition"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl"></span>

        {/* Search Results Dropdown */}
        {filtered.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-2xl shadow-xl border border-gray-100 z-50 max-h-72 overflow-y-auto">
            {filtered.map(p => (
              <button
                key={p.id}
                onClick={() => addToRestock(p)}
                className="flex items-center gap-3 w-full p-3.5 hover:bg-gray-50 transition text-left border-b border-gray-50 last:border-0"
              >
                {p.image ? (
                  <img src={p.image} alt="" className="w-11 h-11 rounded-xl object-cover bg-gray-100" />
                ) : (
                  <div className="w-11 h-11 rounded-xl bg-gray-100 flex items-center justify-center text-gray-300"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-gray-800 truncate">{p.name}</div>
                  <div className="text-xs text-gray-400">{p.category} • {money(p.costPrice)} cost</div>
                </div>
                <div className="text-right">
                  <div className={`text-sm font-bold ${p.quantity <= 5 ? 'text-red-500' : 'text-green-600'}`}>{p.quantity}</div>
                  <div className="text-[10px] text-gray-400">in stock</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Restock Cart */}
      {cart.length > 0 && (
        <div className="bg-white rounded-2xl border-2 border-gray-100 overflow-hidden mb-4">
          <div className="bg-gray-50 px-5 py-3 border-b border-gray-100">
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold text-gray-600">Restock List ({cart.length} items)</span>
              <button onClick={() => setCart([])} className="text-xs font-semibold text-red-500 hover:text-red-600">Clear All</button>
            </div>
          </div>

          <div className="divide-y divide-gray-50">
            {cart.map((item, i) => (
              <div key={item.productId} className="flex items-center gap-3 p-4">
                {item.image ? (
                  <img src={item.image} alt="" className="w-12 h-12 rounded-xl object-cover bg-gray-100" />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center text-gray-300"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-gray-800 truncate">{item.name}</div>
                  <div className="text-xs text-gray-400">
                    Current: <span className={`font-bold ${item.currentQty <= 5 ? 'text-red-500' : 'text-gray-600'}`}>{item.currentQty}</span>
                    {num(item.addQty) > 0 && (
                      <span className="text-green-600 font-bold"> → {item.currentQty + num(item.addQty)}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <input
                      type="number"
                      placeholder="Qty"
                      className="w-20 h-11 px-3 bg-green-50 border-2 border-green-200 rounded-xl text-center text-base font-bold text-green-700 focus:border-green-500 focus:outline-none"
                      value={item.addQty}
                      onChange={e => updateQty(i, e.target.value)}
                      min="1"
                    />
                    <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-[#33363d] text-white text-[9px] font-bold px-1.5 rounded-full">+ADD</span>
                  </div>
                  <button onClick={() => removeItem(i)} className="w-11 h-11 bg-red-50 rounded-xl flex items-center justify-center text-red-400 hover:bg-red-100 transition">✕</button>
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="bg-gray-50 px-5 py-4 border-t border-gray-100">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-500">Total units to add:</span>
              <span className="font-bold text-green-600">+{totalItems}</span>
            </div>
            <div className="flex justify-between text-sm mb-4">
              <span className="text-gray-500">Estimated cost:</span>
              <span className="font-bold text-gray-700">{money(totalCost)}</span>
            </div>
            <button
              onClick={handleRestock}
              disabled={saving || totalItems === 0}
              className="w-full h-14 bg-[#16181d] hover:bg-[#2a2d34] disabled:bg-gray-300 text-white rounded-2xl text-base font-bold active:scale-[0.98] transition flex items-center justify-center gap-2"
            >
              {saving ? (
                <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Updating...</>
              ) : (
                <>Restock {totalItems} Units</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {cart.length === 0 && (
        <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-10 text-center">
          <div className="flex justify-center mb-3 text-gray-300"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>
          <h3 className="text-base font-bold text-gray-600 mb-1">Search and add products above</h3>
          <p className="text-sm text-gray-400">Enter quantities bought, then hit Restock.<br />Stock will be added to current quantities automatically.</p>
        </div>
      )}

      {/* Recent Restocks */}
      {history.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-bold text-gray-500 mb-3">Recent Restocks</h3>
          <div className="space-y-2">
            {history.map((h, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 p-3.5">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-bold text-gray-400">{h.date}</span>
                  <span className="text-xs font-semibold text-gray-500">by {h.by}</span>
                </div>
                <div className="text-sm text-gray-600">
                  {h.items.map((item, j) => (
                    <span key={j}>{j > 0 ? ', ' : ''}<span className="font-bold">{item.name}</span> +{item.qty}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
