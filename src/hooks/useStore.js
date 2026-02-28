import { create } from 'zustand'
import { getSupabase } from '../lib/supabase'
import { num } from '../lib/utils'

const mapProduct = p => ({ id: p.id, name: p.name, category: p.category || '', costPrice: num(p.cost_price), price: num(p.price), wholesalePrice: num(p.wholesale_price), quantity: num(p.quantity), image: p.image || '' })
const mapBundle = b => ({ id: b.id, name: b.name, products: typeof b.products === 'string' ? JSON.parse(b.products) : (b.products || []), bundlePrice: num(b.bundle_price), active: b.active })
const mapSale = s => ({ id: s.id, receiptNo: s.receipt_no, date: s.date, items: typeof s.items === 'string' ? JSON.parse(s.items) : (s.items || []), subtotal: num(s.subtotal), discount: num(s.discount), total: num(s.total), profit: num(s.profit), payment: s.payment, splitCash: num(s.split_cash), splitMomo: num(s.split_momo), customer: s.customer || 'Walk-in', type: s.type || 'Retail', cashier: s.cashier || '', voided: s.voided })
const mapStaff = s => ({ id: s.id, name: s.name, role: s.role, pin: s.pin, active: s.active })
const mapExpense = e => ({ id: e.id, date: e.date, category: e.category, description: e.description, amount: num(e.amount) })
const mapCustomer = c => ({ id: c.id, phone: c.phone, visitCount: num(c.visit_count), totalSpent: num(c.total_spent), lastVisit: c.last_visit })
const mapWAOrder = o => ({ id: o.id, orderNo: o.order_no, date: o.date, customerName: o.customer_name, customerPhone: o.customer_phone, items: typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []), subtotal: num(o.subtotal), deliveryFee: num(o.delivery_fee), total: num(o.total), address: o.address, notes: o.notes, status: o.status, paystackRef: o.paystack_ref, paidAt: o.paid_at, processedBy: o.processed_by, processedAt: o.processed_at })
const mapRefund = r => ({ id: r.id, refundNo: r.refund_no, date: r.date, originalReceiptNo: r.original_receipt_no, items: typeof r.items === 'string' ? JSON.parse(r.items) : (r.items || []), refundAmount: num(r.refund_amount), reason: r.reason, processedBy: r.processed_by, customer: r.customer, status: r.status })
const mapPromo = p => ({ id: p.id, name: p.name, startDate: p.start_date, endDate: p.end_date, items: typeof p.items === 'string' ? JSON.parse(p.items) : (p.items || []), active: p.active })
const mapInvoice = i => ({ id: i.id, invoiceId: i.invoice_id, date: i.date, supplier: i.supplier, amount: num(i.amount), notes: i.notes, image: i.image || '' })
const mapStockTake = s => ({ id: s.id, date: s.date, items: typeof s.items === 'string' ? JSON.parse(s.items) : (s.items || []), notes: s.notes, conductedBy: s.conducted_by })
const mapStockAdj = a => ({ id: a.id, date: a.date, productId: a.product_id, productName: a.product_name, qty: num(a.qty), reason: a.reason, notes: a.notes, adjustedBy: a.adjusted_by })

// Safe query - returns empty array if table doesn't exist
const safeQuery = async (sb, table, opts = {}) => {
  try {
    let q = sb.from(table).select('*')
    if (opts.order) q = q.order(opts.order, { ascending: opts.asc ?? false })
    if (opts.limit) q = q.limit(opts.limit)
    const { data, error } = await q
    if (error) { console.warn(`Table ${table}:`, error.message); return [] }
    return data || []
  } catch (e) { console.warn(`Table ${table} failed:`, e.message); return [] }
}

export const useStore = create((set, get) => ({
  products: [], bundles: [], sales: [], staff: [], expenses: [],
  customers: [], waOrders: [], refunds: [], promos: [], invoices: [], stockTakes: [], stockAdjustments: [],
  loading: true, loadingText: 'Connecting...',
  user: null, isAdmin: false,
  page: 'pos', cart: [], mode: 'retail', selectedCat: 'all', waFilter: 'Pending', perfPeriod: 'today',

  setPage: page => set({ page }), setMode: mode => set({ mode }), setCat: cat => set({ selectedCat: cat }),
  setWAFilter: f => set({ waFilter: f }), setPerfPeriod: p => set({ perfPeriod: p }),
  setLoading: (loading, text) => set({ loading, loadingText: text || 'Loading...' }),
  login: (user, isAdmin) => set({ user, isAdmin }),
  logout: () => set({ user: null, isAdmin: false }),

  addToCart: (item) => {
    const cart = [...get().cart]
    const existing = cart.find(c => c.isBundle ? c.bundleId === item.bundleId : c.productId === item.productId)
    if (existing) {
      if (!item.isBundle) { const prod = get().products.find(p => p.id === item.productId); if (prod && existing.qty >= prod.quantity) return false }
      existing.qty++; existing.lineTotal = existing.qty * existing.price
    } else { cart.push({ ...item, qty: 1, lineTotal: item.price }) }
    set({ cart }); return true
  },
  updateCartQty: (index, delta) => {
    const cart = [...get().cart]; const item = cart[index]; if (!item) return
    const newQty = item.qty + delta
    if (newQty < 1) { cart.splice(index, 1) }
    else { if (!item.isBundle) { const prod = get().products.find(p => p.id === item.productId); if (prod && newQty > prod.quantity) return false }
      item.qty = newQty; item.lineTotal = newQty * item.price }
    set({ cart }); return true
  },
  removeFromCart: index => { const cart = [...get().cart]; cart.splice(index, 1); set({ cart }) },
  clearCart: () => set({ cart: [] }),

  loadAll: async () => {
    const sb = getSupabase(); if (!sb) { set({ loading: false }); return }
    set({ loading: true, loadingText: 'Loading data...' })
    try {
      // Load core tables first (these must exist)
      const [prodData, bunData, saleData, staffData, expData, custData, waData, refData] = await Promise.all([
        safeQuery(sb, 'products', { order: 'name', asc: true }),
        safeQuery(sb, 'bundles'),
        safeQuery(sb, 'sales', { order: 'date', limit: 500 }),
        safeQuery(sb, 'staff'),
        safeQuery(sb, 'expenses', { order: 'date' }),
        safeQuery(sb, 'customers', { order: 'total_spent' }),
        safeQuery(sb, 'whatsapp_orders', { order: 'date' }),
        safeQuery(sb, 'refunds', { order: 'date' }),
      ])

      // Load optional tables (may not exist yet)
      const [promoData, invData, stData, adjData] = await Promise.all([
        safeQuery(sb, 'promos', { order: 'created_at' }),
        safeQuery(sb, 'invoices', { order: 'date' }),
        safeQuery(sb, 'stock_takes', { order: 'date' }),
        safeQuery(sb, 'stock_adjustments', { order: 'date' }),
      ])

      set({
        products: prodData.map(mapProduct),
        bundles: bunData.map(mapBundle),
        sales: saleData.map(mapSale),
        staff: staffData.map(mapStaff),
        expenses: expData.map(mapExpense),
        customers: custData.map(mapCustomer),
        waOrders: waData.map(mapWAOrder),
        refunds: refData.map(mapRefund),
        promos: promoData.map(mapPromo),
        invoices: invData.map(mapInvoice),
        stockTakes: stData.map(mapStockTake),
        stockAdjustments: adjData.map(mapStockAdj),
        loading: false,
      })
    } catch (e) {
      console.error('Load error:', e)
      set({ loading: false })
    }
  },

  refreshProducts: async () => { const sb = getSupabase(); if (!sb) return; const d = await safeQuery(sb, 'products', { order: 'name', asc: true }); set({ products: d.map(mapProduct) }) },
  refreshSales: async () => { const sb = getSupabase(); if (!sb) return; const d = await safeQuery(sb, 'sales', { order: 'date', limit: 500 }); set({ sales: d.map(mapSale) }) },
  refreshWAOrders: async () => { const sb = getSupabase(); if (!sb) return; const d = await safeQuery(sb, 'whatsapp_orders', { order: 'date' }); set({ waOrders: d.map(mapWAOrder) }) },
  refreshStaff: async () => { const sb = getSupabase(); if (!sb) return; const d = await safeQuery(sb, 'staff'); set({ staff: d.map(mapStaff) }) },
  refreshBundles: async () => { const sb = getSupabase(); if (!sb) return; const d = await safeQuery(sb, 'bundles'); set({ bundles: d.map(mapBundle) }) },
  refreshExpenses: async () => { const sb = getSupabase(); if (!sb) return; const d = await safeQuery(sb, 'expenses', { order: 'date' }); set({ expenses: d.map(mapExpense) }) },
  refreshCustomers: async () => { const sb = getSupabase(); if (!sb) return; const d = await safeQuery(sb, 'customers', { order: 'total_spent' }); set({ customers: d.map(mapCustomer) }) },
  refreshRefunds: async () => { const sb = getSupabase(); if (!sb) return; const d = await safeQuery(sb, 'refunds', { order: 'date' }); set({ refunds: d.map(mapRefund) }) },
  refreshPromos: async () => { const sb = getSupabase(); if (!sb) return; const d = await safeQuery(sb, 'promos', { order: 'created_at' }); set({ promos: d.map(mapPromo) }) },
  refreshInvoices: async () => { const sb = getSupabase(); if (!sb) return; const d = await safeQuery(sb, 'invoices', { order: 'date' }); set({ invoices: d.map(mapInvoice) }) },
  refreshStockTakes: async () => { const sb = getSupabase(); if (!sb) return; const d = await safeQuery(sb, 'stock_takes', { order: 'date' }); set({ stockTakes: d.map(mapStockTake) }) },
  refreshStockAdjustments: async () => { const sb = getSupabase(); if (!sb) return; const d = await safeQuery(sb, 'stock_adjustments', { order: 'date' }); set({ stockAdjustments: d.map(mapStockAdj) }) },

  deductStock: (cartItems) => {
    const products = [...get().products]
    for (const c of cartItems) {
      if (c.isBundle && c.bundleItems) { for (const bi of c.bundleItems) { const p = products.find(x => x.id === bi.productId); if (p) p.quantity = Math.max(0, p.quantity - num(bi.qty) * c.qty) } }
      else if (c.productId) { const p = products.find(x => x.id === c.productId); if (p) p.quantity = Math.max(0, p.quantity - c.qty) }
    }
    set({ products })
  },
}))
