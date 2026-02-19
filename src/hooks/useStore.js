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

export const useStore = create((set, get) => ({
  // Data
  products: [], bundles: [], sales: [], staff: [], expenses: [],
  customers: [], waOrders: [], refunds: [],
  loading: true, loadingText: 'Connecting...',

  // Auth
  user: null, isAdmin: false,

  // UI
  page: 'pos', cart: [], mode: 'retail', selectedCat: 'all', waFilter: 'Pending',
  perfPeriod: 'today',

  // Setters
  setPage: page => set({ page }),
  setMode: mode => set({ mode }),
  setCat: cat => set({ selectedCat: cat }),
  setWAFilter: f => set({ waFilter: f }),
  setPerfPeriod: p => set({ perfPeriod: p }),
  setLoading: (loading, text) => set({ loading, loadingText: text || 'Loading...' }),

  // Auth
  login: (user, isAdmin) => set({ user, isAdmin }),
  logout: () => set({ user: null, isAdmin: false }),

  // Cart
  addToCart: (item) => {
    const cart = [...get().cart]
    const existing = cart.find(c => c.isBundle ? c.bundleId === item.bundleId : c.productId === item.productId)
    if (existing) {
      if (!item.isBundle) {
        const prod = get().products.find(p => p.id === item.productId)
        if (prod && existing.qty >= prod.quantity) return false
      }
      existing.qty++
      existing.lineTotal = existing.qty * existing.price
    } else {
      cart.push({ ...item, qty: 1, lineTotal: item.price })
    }
    set({ cart })
    return true
  },
  updateCartQty: (index, delta) => {
    const cart = [...get().cart]
    const item = cart[index]
    if (!item) return
    const newQty = item.qty + delta
    if (newQty < 1) { cart.splice(index, 1) }
    else {
      if (!item.isBundle) {
        const prod = get().products.find(p => p.id === item.productId)
        if (prod && newQty > prod.quantity) return false
      }
      item.qty = newQty; item.lineTotal = newQty * item.price
    }
    set({ cart })
    return true
  },
  removeFromCart: index => { const cart = [...get().cart]; cart.splice(index, 1); set({ cart }) },
  clearCart: () => set({ cart: [] }),

  // Load all data
  loadAll: async () => {
    const sb = getSupabase()
    if (!sb) return
    set({ loading: true, loadingText: 'Loading data...' })
    try {
      const [products, bundles, sales, staff, expenses, customers, waOrders, refunds] = await Promise.all([
        sb.from('products').select('*').order('name'),
        sb.from('bundles').select('*'),
        sb.from('sales').select('*').order('date', { ascending: false }).limit(300),
        sb.from('staff').select('*'),
        sb.from('expenses').select('*').order('date', { ascending: false }),
        sb.from('customers').select('*').order('total_spent', { ascending: false }),
        sb.from('whatsapp_orders').select('*').order('date', { ascending: false }),
        sb.from('refunds').select('*').order('date', { ascending: false }),
      ])
      set({
        products: (products.data || []).map(mapProduct),
        bundles: (bundles.data || []).map(mapBundle),
        sales: (sales.data || []).map(mapSale),
        staff: (staff.data || []).map(mapStaff),
        expenses: (expenses.data || []).map(mapExpense),
        customers: (customers.data || []).map(mapCustomer),
        waOrders: (waOrders.data || []).map(mapWAOrder),
        refunds: (refunds.data || []).map(mapRefund),
        loading: false,
      })
    } catch (e) {
      console.error('Load error:', e)
      set({ loading: false })
    }
  },

  // Refresh specific tables
  refreshProducts: async () => {
    const sb = getSupabase(); if (!sb) return
    const { data } = await sb.from('products').select('*').order('name')
    set({ products: (data || []).map(mapProduct) })
  },
  refreshSales: async () => {
    const sb = getSupabase(); if (!sb) return
    const { data } = await sb.from('sales').select('*').order('date', { ascending: false }).limit(300)
    set({ sales: (data || []).map(mapSale) })
  },
  refreshWAOrders: async () => {
    const sb = getSupabase(); if (!sb) return
    const { data } = await sb.from('whatsapp_orders').select('*').order('date', { ascending: false })
    set({ waOrders: (data || []).map(mapWAOrder) })
  },
  refreshStaff: async () => {
    const sb = getSupabase(); if (!sb) return
    const { data } = await sb.from('staff').select('*')
    set({ staff: (data || []).map(mapStaff) })
  },
  refreshBundles: async () => {
    const sb = getSupabase(); if (!sb) return
    const { data } = await sb.from('bundles').select('*')
    set({ bundles: (data || []).map(mapBundle) })
  },
  refreshExpenses: async () => {
    const sb = getSupabase(); if (!sb) return
    const { data } = await sb.from('expenses').select('*').order('date', { ascending: false })
    set({ expenses: (data || []).map(mapExpense) })
  },
  refreshCustomers: async () => {
    const sb = getSupabase(); if (!sb) return
    const { data } = await sb.from('customers').select('*').order('total_spent', { ascending: false })
    set({ customers: (data || []).map(mapCustomer) })
  },
  refreshRefunds: async () => {
    const sb = getSupabase(); if (!sb) return
    const { data } = await sb.from('refunds').select('*').order('date', { ascending: false })
    set({ refunds: (data || []).map(mapRefund) })
  },

  // Deduct stock locally (optimistic update after sale)
  deductStock: (cartItems) => {
    const products = [...get().products]
    for (const c of cartItems) {
      if (c.isBundle && c.bundleItems) {
        for (const bi of c.bundleItems) {
          const p = products.find(x => x.id === bi.productId)
          if (p) p.quantity = Math.max(0, p.quantity - num(bi.qty) * c.qty)
        }
      } else if (c.productId) {
        const p = products.find(x => x.id === c.productId)
        if (p) p.quantity = Math.max(0, p.quantity - c.qty)
      }
    }
    set({ products })
  },
}))
