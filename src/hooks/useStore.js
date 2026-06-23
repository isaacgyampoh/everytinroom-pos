import { create } from 'zustand'
import { getSupabase } from '../lib/supabase'
import { num } from '../lib/utils'

const mapProduct = p => ({ id: p.id, name: p.name, category: p.category || '', costPrice: num(p.cost_price), price: num(p.price), wholesalePrice: num(p.wholesale_price), wholesaleMinQty: num(p.wholesale_min_qty) || 0, quantity: num(p.quantity), image: p.image || '' })
const mapBundle = b => ({ id: b.id, name: b.name, products: typeof b.products === 'string' ? JSON.parse(b.products) : (b.products || []), bundlePrice: num(b.bundle_price), active: b.active })
const mapSale = s => ({ id: s.id, receiptNo: s.receipt_no, date: s.date, items: typeof s.items === 'string' ? JSON.parse(s.items) : (s.items || []), subtotal: num(s.subtotal), discount: num(s.discount), total: num(s.total), profit: num(s.profit), payment: s.payment, splitCash: num(s.split_cash), splitMomo: num(s.split_momo), customer: s.customer || 'Walk-in', type: s.type || 'Retail', cashier: s.cashier || '', voided: s.voided })
const mapStaff = s => ({ id: s.id, name: s.name, role: s.role, active: s.active })
const mapExpense = e => ({ id: e.id, date: e.date, category: e.category, description: e.description, amount: num(e.amount) })
const mapCustomer = c => ({ id: c.id, phone: c.phone, visitCount: num(c.visit_count), totalSpent: num(c.total_spent), lastVisit: c.last_visit })
const mapWAOrder = o => ({ id: o.id, orderNo: o.order_no, date: o.date, customerName: o.customer_name, customerPhone: o.customer_phone, items: typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []), subtotal: num(o.subtotal), deliveryFee: num(o.delivery_fee), total: num(o.total), address: o.address, notes: o.notes, status: o.status, paystackRef: o.paystack_ref, paidAt: o.paid_at, processedBy: o.processed_by, processedAt: o.processed_at, ussdCode: o.ussd_code, trackingNo: o.tracking_no || '', deliveryStatus: o.delivery_status || '', deliveryGuy: o.delivery_guy || '', deliveredAt: o.delivered_at, deliveryNotes: o.delivery_notes || '' })
const mapRefund = r => ({ id: r.id, refundNo: r.refund_no, date: r.date, originalReceiptNo: r.original_receipt_no, items: typeof r.items === 'string' ? JSON.parse(r.items) : (r.items || []), refundAmount: num(r.refund_amount), reason: r.reason, processedBy: r.processed_by, customer: r.customer, status: r.status })
const mapPromo = p => ({ id: p.id, name: p.name, startDate: p.start_date, endDate: p.end_date, items: typeof p.items === 'string' ? JSON.parse(p.items) : (p.items || []), active: p.active })
const mapInvoice = i => ({ id: i.id, invoiceId: i.invoice_id, date: i.date, supplier: i.supplier, amount: num(i.amount), notes: i.notes, image: i.image || '' })
const mapStockTake = s => ({ id: s.id, date: s.date, items: typeof s.items === 'string' ? JSON.parse(s.items) : (s.items || []), notes: s.notes, conductedBy: s.conducted_by })
const mapStockAdj = a => ({ id: a.id, date: a.date, productId: a.product_id, productName: a.product_name, qty: num(a.qty), reason: a.reason, notes: a.notes, adjustedBy: a.adjusted_by })

// Fast query with select only needed columns where possible
const q = async (sb, table, opts = {}) => {
  try {
    let query = sb.from(table).select(opts.select || '*')
    if (opts.order) query = query.order(opts.order, { ascending: opts.asc ?? false })
    if (opts.limit) query = query.limit(opts.limit)
    if (opts.gt) query = query.gt(opts.gt[0], opts.gt[1])
    const { data, error } = await query
    if (error) return []
    return data || []
  } catch { return [] }
}

export const useStore = create((set, get) => ({
  products: [], bundles: [], sales: [], staff: [], expenses: [],
  customers: [], waOrders: [], refunds: [], promos: [], invoices: [], stockTakes: [], stockAdjustments: [],
  loading: true, loadingText: 'Connecting...',
  user: null, isAdmin: false,
  page: 'pos', cart: [], mode: 'retail', selectedCat: 'all', waFilter: 'Pending', perfPeriod: 'today',
  _secondaryLoaded: false,
  darkMode: localStorage.getItem('pos-dark') === 'true',
  toggleDark: () => set(s => { const d = !s.darkMode; localStorage.setItem('pos-dark', d); return { darkMode: d } }),

  setPage: page => {
    set({ page })
    // Lazy load secondary data when navigating to those pages
    const s = get()
    if (!s._secondaryLoaded && ['reports', 'invoices', 'stocktakes', 'stockadjustments', 'promos', 'customers'].includes(page)) {
      s._loadSecondary()
    }
  },
  setMode: mode => set({ mode }), setCat: cat => set({ selectedCat: cat }),
  setWAFilter: f => set({ waFilter: f }), setPerfPeriod: p => set({ perfPeriod: p }),
  setLoading: (loading, text) => set({ loading, loadingText: text || 'Loading...' }),
  login: (user, isAdmin) => set({ user, isAdmin }),
  logout: () => set({ user: null, isAdmin: false }),

  // Shop on/off switch (shared with the e-commerce site via store_settings)
  shopOpen: true,
  shopSettingLoaded: false,
  fetchShopOpen: async () => {
    const sb = getSupabase(); if (!sb) return
    try {
      const { data, error } = await sb.from('store_settings').select('shop_open').limit(1)
      if (error) console.error('store_settings read error:', error.message)
      const row = Array.isArray(data) ? data[0] : null
      set({ shopOpen: row ? row.shop_open === true : true, shopSettingLoaded: true })
    } catch (e) { console.error('fetchShopOpen failed:', e); set({ shopSettingLoaded: true }) }
  },
  setShopOpen: async (open) => {
    const sb = getSupabase(); if (!sb) return { ok: false, error: 'No connection' }
    set({ shopOpen: open }) // optimistic
    try {
      // upsert (not update) so a missing row gets created; select back to verify it actually saved
      const { data, error } = await sb.from('store_settings')
        .upsert({ id: 1, shop_open: open, updated_at: new Date().toISOString() }, { onConflict: 'id' })
        .select('shop_open')
      if (error) { set({ shopOpen: !open }); console.error('setShopOpen error:', error.message); return { ok: false, error: error.message } }
      const saved = Array.isArray(data) ? data[0] : null
      if (!saved || saved.shop_open !== open) { set({ shopOpen: !open }); return { ok: false, error: 'Save did not persist (check table/permissions)' } }
      return { ok: true }
    } catch (e) { set({ shopOpen: !open }); console.error('setShopOpen failed:', e); return { ok: false, error: String(e) } }
  },

  addToCart: (item) => {
    const cart = [...get().cart]
    const existing = cart.find(c => c.isBundle ? c.bundleId === item.bundleId : c.productId === item.productId)
    if (existing) {
      if (!item.isBundle) { const prod = get().products.find(p => p.id === item.productId); if (prod && existing.qty >= prod.quantity) return false }
      existing.qty++
      // Auto-switch price based on wholesale min qty
      if (!existing.isBundle) {
        const prod = get().products.find(p => p.id === existing.productId)
        if (prod && prod.wholesalePrice > 0 && prod.wholesaleMinQty > 0 && existing.qty >= prod.wholesaleMinQty) {
          existing.price = prod.wholesalePrice
        } else if (prod) {
          existing.price = item.originalPrice || prod.price
        }
      }
      existing.lineTotal = existing.qty * existing.price
    } else { cart.push({ ...item, qty: 1, lineTotal: item.price, originalPrice: item.price }) }
    set({ cart }); return true
  },
  updateCartQty: (index, delta) => {
    const cart = [...get().cart]; const item = cart[index]; if (!item) return
    const newQty = item.qty + delta
    if (newQty < 1) { cart.splice(index, 1) }
    else {
      if (!item.isBundle) {
        const prod = get().products.find(p => p.id === item.productId)
        if (prod && newQty > prod.quantity) return false
        // Auto-switch price based on wholesale min qty
        if (prod && prod.wholesalePrice > 0 && prod.wholesaleMinQty > 0 && newQty >= prod.wholesaleMinQty) {
          item.price = prod.wholesalePrice
        } else if (prod) {
          item.price = item.originalPrice || prod.price
        }
      }
      item.qty = newQty; item.lineTotal = newQty * item.price
    }
    set({ cart }); return true
  },
  removeFromCart: index => { const cart = [...get().cart]; cart.splice(index, 1); set({ cart }) },
  clearCart: () => set({ cart: [] }),

  // PHASE 1: Load only essential data (products, staff, sales, bundles)
  loadAll: async () => {
    const sb = getSupabase(); if (!sb) { set({ loading: false }); return }
    set({ loading: true, loadingText: 'Loading...' })
    try {
      // PHASE 1: Only what POS needs immediately
      const [prodData, staffData, bunData, promoData] = await Promise.all([
        q(sb, 'products', { select: 'id,name,category,cost_price,price,wholesale_price,wholesale_min_qty,quantity,image', order: 'name', asc: true }),
        q(sb, 'staff', { select: 'id,name,role,active' }),
        q(sb, 'bundles', { select: 'id,name,products,bundle_price,active' }),
        q(sb, 'promos', { select: 'id,name,start_date,end_date,items,active', limit: 50 }),
      ])

      set({
        products: prodData.map(mapProduct),
        staff: staffData.map(mapStaff),
        bundles: bunData.map(mapBundle),
        promos: promoData.map(mapPromo),
        loading: false,
      })

      // PHASE 2: Load everything else in background (non-blocking)
      get()._loadSecondary()
    } catch (e) {
      console.error('Load error:', e)
      set({ loading: false })
    }
  },

  // Background load for secondary tables
  _loadSecondary: async () => {
    if (get()._secondaryLoaded) return
    const sb = getSupabase(); if (!sb) return
    try {
      const [saleData, expData, custData, waData, refData, invData, stData, adjData] = await Promise.all([
        q(sb, 'sales', { select: 'id,receipt_no,date,items,subtotal,discount,total,profit,payment,split_cash,split_momo,customer,type,cashier,voided', order: 'date', limit: 150 }),
        q(sb, 'expenses', { select: 'id,date,category,description,amount', order: 'date', limit: 100 }),
        q(sb, 'customers', { select: 'id,phone,visit_count,total_spent,last_visit', order: 'total_spent', limit: 300 }),
        q(sb, 'whatsapp_orders', { order: 'date', limit: 500 }),
        q(sb, 'refunds', { order: 'date', limit: 50 }),
        q(sb, 'invoices', { order: 'date', limit: 50 }),
        q(sb, 'stock_takes', { order: 'date', limit: 20 }),
        q(sb, 'stock_adjustments', { select: 'id,date,product_id,product_name,qty,reason,notes,adjusted_by', order: 'date', limit: 100 }),
      ])
      set({
        sales: saleData.map(mapSale),
        expenses: expData.map(mapExpense),
        customers: custData.map(mapCustomer),
        waOrders: waData.map(mapWAOrder),
        refunds: refData.map(mapRefund),
        invoices: invData.map(mapInvoice),
        stockTakes: stData.map(mapStockTake),
        stockAdjustments: adjData.map(mapStockAdj),
        _secondaryLoaded: true,
      })
    } catch (e) { console.warn('Secondary load:', e) }
  },

  refreshProducts: async () => { const sb = getSupabase(); if (!sb) return; const d = await q(sb, 'products', { order: 'name', asc: true }); set({ products: d.map(mapProduct) }) },
  refreshSales: async () => { const sb = getSupabase(); if (!sb) return; const d = await q(sb, 'sales', { order: 'date', limit: 300 }); set({ sales: d.map(mapSale) }) },
  refreshWAOrders: async () => { const sb = getSupabase(); if (!sb) return; const d = await q(sb, 'whatsapp_orders', { order: 'date', limit: 500 }); set({ waOrders: d.map(mapWAOrder) }) },
  refreshStaff: async () => { const sb = getSupabase(); if (!sb) return; const d = await q(sb, 'staff', { select: 'id,name,role,active' }); set({ staff: d.map(mapStaff) }) },
  refreshBundles: async () => { const sb = getSupabase(); if (!sb) return; const d = await q(sb, 'bundles'); set({ bundles: d.map(mapBundle) }) },
  refreshExpenses: async () => { const sb = getSupabase(); if (!sb) return; const d = await q(sb, 'expenses', { order: 'date', limit: 200 }); set({ expenses: d.map(mapExpense) }) },
  refreshCustomers: async () => { const sb = getSupabase(); if (!sb) return; const d = await q(sb, 'customers', { order: 'total_spent', limit: 500 }); set({ customers: d.map(mapCustomer) }) },
  refreshRefunds: async () => { const sb = getSupabase(); if (!sb) return; const d = await q(sb, 'refunds', { order: 'date', limit: 100 }); set({ refunds: d.map(mapRefund) }) },
  refreshPromos: async () => { const sb = getSupabase(); if (!sb) return; const d = await q(sb, 'promos', { order: 'created_at', limit: 50 }); set({ promos: d.map(mapPromo) }) },
  refreshInvoices: async () => { const sb = getSupabase(); if (!sb) return; const d = await q(sb, 'invoices', { order: 'date', limit: 100 }); set({ invoices: d.map(mapInvoice) }) },
  refreshStockTakes: async () => { const sb = getSupabase(); if (!sb) return; const d = await q(sb, 'stock_takes', { order: 'date', limit: 50 }); set({ stockTakes: d.map(mapStockTake) }) },
  refreshStockAdjustments: async () => { const sb = getSupabase(); if (!sb) return; const d = await q(sb, 'stock_adjustments', { order: 'date', limit: 200 }); set({ stockAdjustments: d.map(mapStockAdj) }) },

  deductStock: (cartItems) => {
    const products = [...get().products]
    for (const c of cartItems) {
      if (c.isBundle && c.bundleItems) { for (const bi of c.bundleItems) { const p = products.find(x => x.id === bi.productId); if (p) p.quantity = Math.max(0, p.quantity - num(bi.qty) * c.qty) } }
      else if (c.productId) { const p = products.find(x => x.id === c.productId); if (p) p.quantity = Math.max(0, p.quantity - c.qty) }
    }
    set({ products })
  },
}))
