import './style.css'
import { initializeApp } from 'firebase/app'
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'

const PUBLIC_ROUTES = new Set(['dashboard', 'menu', 'admin'])
const PRIVATE_ROUTES = new Set(['edicion', 'nueva-orden'])
const EDITOR_TABS = ['resumen', 'pedidos', 'catalogo', 'insumos', 'caja']
const PEDIDO_VIEWS = ['active', 'history']
const ORDER_STATES = ['Pendiente', 'Preparando', 'Entregado', 'Pagado']
const MENU_CATEGORIES = ['Platos Fuertes', 'Bebidas', 'Postres']
const BOOTSTRAP_ADMIN_EMAIL = 'j0bsch453d@gmail.com'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_MEASUREMENT_ID,
}

const hasFirebaseConfig = [
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.projectId,
  firebaseConfig.storageBucket,
  firebaseConfig.messagingSenderId,
  firebaseConfig.appId,
].every(Boolean)

const bootstrapAdminEmails = new Set([BOOTSTRAP_ADMIN_EMAIL])

const appRoot = document.querySelector('#app')
const state = {
  route: 'menu',
  menuCategory: MENU_CATEGORIES[0],
  editorTab: 'resumen',
  pedidoView: 'active',
  isBooting: true,
  user: null,
  accessProfile: null,
  accessEntries: [],
  menu: [],
  pedidos: [],
  inventario: [],
  notices: [],
  mobileSidebarOpen: false,
  shouldAnimateView: true,
  viewAnimationToken: 0,
  orderDraft: {
    mesa: '',
    query: '',
    items: [],
    editingItemId: null,
    customMode: false,
  },
  editingMenuId: null,
}

const noticeTimers = new Map()

const subscriptions = {
  accessEntries: null,
  accessProfile: null,
  inventario: null,
  menu: null,
  pedidos: null,
}

const firebaseApp = hasFirebaseConfig ? initializeApp(firebaseConfig) : null
const auth = firebaseApp ? getAuth(firebaseApp) : null
const db = firebaseApp ? getFirestore(firebaseApp) : null
const provider = firebaseApp ? new GoogleAuthProvider() : null

setupAnalytics()
setupRouteWatcher()
setupViewportWatcher()
setupMenuStream()
setupAuthWatcher()
attachEvents()
enforceRouteAccess(true)
render()

function setupAuthWatcher() {
  if (!auth) {
    state.isBooting = false
    return
  }

  onAuthStateChanged(auth, async (user) => {
    state.user = user
    await syncAccessProfile()
    syncAdminStreams()
    enforceRouteAccess(true)
    state.isBooting = false
    render()
  })
}

function setupRouteWatcher() {
  window.addEventListener('popstate', () => {
    triggerViewAnimation()
    enforceRouteAccess(true)
    syncAdminStreams()
    render()
  })
}

function setupViewportWatcher() {
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768 && state.mobileSidebarOpen) {
      state.mobileSidebarOpen = false
      render()
    }
  })
}

function normalizeHashRoute() {
  const rawPath = window.location.pathname.replace(/^\/+|\/+$/g, '').toLowerCase()
  const rawHash = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase()

  const routeFromPath = rawPath || ''
  const candidate = routeFromPath || rawHash || 'menu'

  if (PUBLIC_ROUTES.has(candidate) || PRIVATE_ROUTES.has(candidate)) {
    return candidate
  }

  return 'menu'
}

function routeToPath(route) {
  return `/${route}`
}

function setRoute(route) {
  const targetPath = routeToPath(route)
  const nextRoute = String(route || '').toLowerCase()

  if (window.location.pathname !== targetPath || window.location.hash) {
    window.history.replaceState(null, '', targetPath)
  }

  if (state.route !== nextRoute) {
    triggerViewAnimation()
  }

  state.route = nextRoute
}

function enforceRouteAccess(redirectIfNeeded = false) {
  const desired = normalizeHashRoute()
  const canAccessPrivate = isAuthorizedUser()

  if (desired === 'admin') {
    if (canAccessPrivate) {
      state.route = 'edicion'
      if (redirectIfNeeded) {
        setRoute('edicion')
      }
      return
    }

    state.route = 'admin'
    if (redirectIfNeeded && window.location.pathname !== routeToPath('admin')) {
      setRoute('admin')
    }
    return
  }

  if (PRIVATE_ROUTES.has(desired) && !canAccessPrivate) {
    state.route = 'menu'
    if (redirectIfNeeded) {
      setRoute('menu')
    }
    return
  }

  state.route = desired
  if (redirectIfNeeded && window.location.pathname !== routeToPath(desired)) {
    setRoute(desired)
  }
}

function setupMenuStream() {
  if (!db) {
    return
  }

  subscriptions.menu?.()
  subscriptions.menu = onSnapshot(collection(db, 'menu'), (snapshot) => {
    state.menu = snapshot.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }))
      .sort((left, right) => {
        const leftIndex = MENU_CATEGORIES.indexOf(left.categoria)
        const rightIndex = MENU_CATEGORIES.indexOf(right.categoria)
        if (leftIndex !== rightIndex) {
          return leftIndex - rightIndex
        }
        return (left.nombre || '').localeCompare(right.nombre || '', 'es')
      })

    if (state.editingMenuId && !state.menu.some((item) => item.id === state.editingMenuId)) {
      state.editingMenuId = null
    }

    render()
  })
}

async function syncAccessProfile() {
  subscriptions.accessProfile?.()
  subscriptions.accessProfile = null
  state.accessProfile = null

  if (!db || !state.user) {
    return
  }

  await ensureAccessRecord(state.user)

  const accessRef = doc(db, 'admin_access', state.user.uid)
  subscriptions.accessProfile = onSnapshot(accessRef, (snapshot) => {
    state.accessProfile = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null
    enforceRouteAccess(true)
    syncAdminStreams()
    render()
  })
}

function syncAdminStreams() {
  const canReadAdmin = isAuthorizedUser()
  const canReviewAccess = canManageAccess()

  if (!canReadAdmin) {
    subscriptions.pedidos?.()
    subscriptions.inventario?.()
    subscriptions.pedidos = null
    subscriptions.inventario = null
    state.pedidos = []
    state.inventario = []
  } else {
    if (!subscriptions.pedidos) {
      subscriptions.pedidos = onSnapshot(collection(db, 'pedidos'), (snapshot) => {
        state.pedidos = snapshot.docs
          .map((entry) => ({ id: entry.id, ...entry.data() }))
          .sort((left, right) => toMillis(right.creadoEn) - toMillis(left.creadoEn))
        render()
      })
    }

    if (!subscriptions.inventario) {
      subscriptions.inventario = onSnapshot(collection(db, 'inventario'), (snapshot) => {
        state.inventario = snapshot.docs
          .map((entry) => ({ id: entry.id, ...entry.data() }))
          .sort((left, right) => (left.nombre || '').localeCompare(right.nombre || '', 'es'))
        render()
      })
    }
  }

  if (!canReviewAccess) {
    subscriptions.accessEntries?.()
    subscriptions.accessEntries = null
    state.accessEntries = []
    return
  }

  if (!subscriptions.accessEntries) {
    subscriptions.accessEntries = onSnapshot(collection(db, 'admin_access'), (snapshot) => {
      state.accessEntries = snapshot.docs
        .map((entry) => ({ id: entry.id, ...entry.data() }))
        .sort((left, right) => sortAccessEntries(left, right))
      render()
    })
  }
}

function attachEvents() {
  document.addEventListener('click', async (event) => {
    const actionNode = event.target.closest('[data-action]')
    if (!actionNode) {
      return
    }

    const action = actionNode.dataset.action
    const clickedInsideMobileSidebar = Boolean(actionNode.closest('.mobile-sidebar'))

    if (clickedInsideMobileSidebar && action !== 'close-mobile-sidebar') {
      state.mobileSidebarOpen = false
    }

    if (action === 'toggle-mobile-sidebar') {
      state.mobileSidebarOpen = true
      render()
      return
    }

    if (action === 'close-mobile-sidebar') {
      state.mobileSidebarOpen = false
      render()
      return
    }

    if (action === 'set-editor-tab') {
      const nextTab = actionNode.dataset.tab
      if (EDITOR_TABS.includes(nextTab)) {
        if (state.editorTab !== nextTab) {
          triggerViewAnimation()
        }
        state.editorTab = nextTab
        render()
      }
      return
    }

    if (action === 'set-pedido-view') {
      const nextView = actionNode.dataset.view
      if (PEDIDO_VIEWS.includes(nextView)) {
        if (state.pedidoView !== nextView) {
          triggerViewAnimation()
        }
        state.pedidoView = nextView
        render()
      }
      return
    }

    if (action === 'go-new-order-screen') {
      state.editorTab = 'pedidos'
      state.mobileSidebarOpen = false
      setRoute('nueva-orden')
      render()
      return
    }

    if (action === 'back-to-pedidos') {
      state.editorTab = 'pedidos'
      state.mobileSidebarOpen = false
      setRoute('edicion')
      render()
      return
    }

    if (action === 'set-menu-category') {
      const nextCategory = actionNode.dataset.category
      if (MENU_CATEGORIES.includes(nextCategory)) {
        state.menuCategory = nextCategory
        render()
      }
      return
    }

    if (action === 'set-order-query') {
      state.orderDraft.query = actionNode.dataset.query || ''
      render()
      return
    }

    if (action === 'add-order-item') {
      const itemId = actionNode.dataset.id
      addOrderItemById(itemId)
      render()
      return
    }

    if (action === 'order-item-plus') {
      const draftId = actionNode.dataset.id
      const item = state.orderDraft.items.find((entry) => entry.draftId === draftId)
      if (!item) {
        return
      }
      item.cantidad += 1
      render()
      return
    }

    if (action === 'order-item-minus') {
      const draftId = actionNode.dataset.id
      const item = state.orderDraft.items.find((entry) => entry.draftId === draftId)
      if (!item) {
        return
      }
      item.cantidad -= 1
      if (item.cantidad <= 0) {
        removeOrderDraftItem(draftId)
      }
      render()
      return
    }

    if (action === 'order-item-remove') {
      const draftId = actionNode.dataset.id
      removeOrderDraftItem(draftId)
      render()
      return
    }

    if (action === 'order-item-edit') {
      const draftId = actionNode.dataset.id
      state.orderDraft.editingItemId = state.orderDraft.editingItemId === draftId ? null : draftId
      render()
      return
    }

    if (action === 'toggle-order-modifier') {
      const draftId = actionNode.dataset.id
      const modifierKey = actionNode.dataset.modifier
      toggleOrderModifier(draftId, modifierKey)
      render()
      return
    }

    if (action === 'save-order-note') {
      const draftId = actionNode.dataset.id
      const noteNode = document.querySelector(`[data-order-note-input="${draftId}"]`)
      const item = state.orderDraft.items.find((entry) => entry.draftId === draftId)
      if (!noteNode || !item) {
        return
      }
      item.note = noteNode.value?.trim() || ''
      pushNotice('Detalles de platillo actualizados.')
      state.orderDraft.editingItemId = null
      render()
      return
    }

    if (action === 'add-custom-item') {
      const nameNode = document.querySelector('[data-custom-name]')
      const priceNode = document.querySelector('[data-custom-price]')
      const nombre = nameNode?.value?.trim()
      const precio = Number(priceNode?.value || 0)

      if (!nombre || Number.isNaN(precio) || precio < 0) {
        pushNotice('Escribe nombre y precio valido para el platillo personalizado.')
        render()
        return
      }

      state.orderDraft.items.push({
        draftId: createDraftId(),
        id: null,
        nombre,
        categoria: 'Personalizado',
        basePrecio: precio,
        cantidad: 1,
        modifiers: [],
        note: '',
        isCustom: true,
      })

      if (nameNode) {
        nameNode.value = ''
      }
      if (priceNode) {
        priceNode.value = ''
      }

      render()
      return
    }

    if (action === 'set-route') {
      event.preventDefault()
      const nextRoute = actionNode.dataset.route
      if (!PUBLIC_ROUTES.has(nextRoute) && !PRIVATE_ROUTES.has(nextRoute)) {
        return
      }
      state.mobileSidebarOpen = false
      setRoute(nextRoute)
      enforceRouteAccess(true)
      syncAdminStreams()
      render()
      return
    }

    if (action === 'go-menu') {
      state.mobileSidebarOpen = false
      setRoute('menu')
      render()
      return
    }

    if (action === 'login') {
      state.mobileSidebarOpen = false
      await handleLogin()
      return
    }

    if (action === 'logout') {
      await signOut(auth)
      state.mobileSidebarOpen = false
      state.editingMenuId = null
      enforceRouteAccess(true)
      render()
      return
    }

    if (action === 'close-notice') {
      const noticeId = actionNode.dataset.id
      if (!noticeId) {
        return
      }
      removeNotice(noticeId)
      render()
      return
    }

    if (action === 'change-status') {
      const pedidoId = actionNode.dataset.id
      const select = document.querySelector(`[data-status-select="${pedidoId}"]`)
      if (!pedidoId || !select) {
        return
      }

      const nextState = select.value
      const payload = {
        estado: nextState,
        actualizadoEn: serverTimestamp(),
      }

      if (nextState === 'Pagado') {
        payload.pagadoEn = serverTimestamp()
      }

      await updateDoc(doc(db, 'pedidos', pedidoId), payload)
      return
    }

    if (action === 'close-order') {
      const pedidoId = actionNode.dataset.id
      if (!pedidoId) {
        return
      }

      await updateDoc(doc(db, 'pedidos', pedidoId), {
        cerrado: true,
        cerradoEn: serverTimestamp(),
        actualizadoEn: serverTimestamp(),
      })
      return
    }

    if (action === 'save-stock') {
      const ingredientId = actionNode.dataset.id
      const stockInput = document.querySelector(`[data-stock-input="${ingredientId}"]`)
      const usageInput = document.querySelector(`[data-usage-input="${ingredientId}"]`)
      if (!ingredientId || !stockInput || !usageInput) {
        return
      }

      await updateDoc(doc(db, 'inventario', ingredientId), {
        stock: Number(stockInput.value || 0),
        en_uso: usageInput.checked,
        actualizadoEn: serverTimestamp(),
      })
      return
    }

    if (action === 'edit-menu-item') {
      state.editingMenuId = actionNode.dataset.id || null
      render()
      return
    }

    if (action === 'cancel-menu-edit') {
      state.editingMenuId = null
      render()
      return
    }

    if (action === 'delete-menu-item') {
      const itemId = actionNode.dataset.id
      if (!itemId) {
        return
      }
      await deleteDoc(doc(db, 'menu', itemId))
      state.editingMenuId = state.editingMenuId === itemId ? null : state.editingMenuId
      return
    }

    if (action === 'approve-access' || action === 'revoke-access') {
      const accessId = actionNode.dataset.id
      const accessEntry = state.accessEntries.find((entry) => entry.id === accessId)
      if (!accessId || !accessEntry || !canManageAccess()) {
        return
      }

      const isBootstrapEntry = (accessEntry.email || '').toLowerCase() === BOOTSTRAP_ADMIN_EMAIL
      if (isBootstrapEntry) {
        pushNotice('El administrador principal no se puede revocar ni editar.')
        render()
        return
      }

      await updateDoc(doc(db, 'admin_access', accessId), {
        approved: action === 'approve-access',
        role: action === 'approve-access' ? 'editor' : 'requested',
        reviewStatus: action === 'approve-access' ? 'approved' : 'pending',
        reviewedAt: serverTimestamp(),
        reviewedBy: getUserEmail(),
        updatedAt: serverTimestamp(),
      })
      return
    }
  })

  document.addEventListener('submit', async (event) => {
    if (event.target.matches('[data-form="menu-item"]')) {
      event.preventDefault()
      await saveMenuItem(new FormData(event.target))
      event.target.reset()
      return
    }

    if (event.target.matches('[data-form="inventario"]')) {
      event.preventDefault()
      await createIngredient(new FormData(event.target))
      event.target.reset()
      return
    }

    if (event.target.matches('[data-form="pedido"]')) {
      event.preventDefault()
      await createPedido(new FormData(event.target))
      event.target.reset()
      render()
      return
    }
  })

  document.addEventListener('input', (event) => {
    if (event.target.matches('[data-order-item-note]')) {
      const draftId = event.target.dataset.id
      const item = state.orderDraft.items.find((entry) => entry.draftId === draftId)
      if (!item) {
        return
      }
      item.note = event.target.value || ''
      return
    }

    if (event.target.matches('[data-order-table]')) {
      state.orderDraft.mesa = event.target.value || ''
      return
    }

    if (event.target.matches('[data-order-search]')) {
      state.orderDraft.query = event.target.value || ''
      render()
      return
    }

    if (event.target.matches('[data-order-custom-toggle]')) {
      state.orderDraft.customMode = event.target.checked
      render()
    }
  })
}

async function handleLogin() {
  if (!auth || !provider) {
    pushNotice('Configura Firebase antes de iniciar sesion.')
    render()
    return
  }

  try {
    await signInWithPopup(auth, provider)
  } catch (error) {
    console.error(error)
    pushNotice(getFriendlyAuthMessage(error))
    render()
  }
}

function getFriendlyAuthMessage(error) {
  const code = error?.code || ''
  const messages = {
    'auth/popup-closed-by-user': 'Vaya desvelo. Parece que cerraste la ventana antes de tiempo.',
    'auth/popup-blocked': 'Tu navegador bloqueo la ventana emergente. Activa popups e intenta de nuevo.',
    'auth/cancelled-popup-request': 'Ya habia una ventana de inicio abierta. Intenta de nuevo en un momento.',
    'auth/network-request-failed': 'No pudimos conectar con Firebase. Revisa tu internet y vuelve a intentar.',
    'auth/too-many-requests': 'Demasiados intentos seguidos. Espera un momento y vuelve a intentar.',
  }

  return messages[code] || 'No se pudo iniciar sesion por ahora. Intenta de nuevo en unos segundos.'
}

async function createIngredient(formData) {
  if (!db) {
    pushNotice('Firebase no esta configurado todavia.')
    render()
    return
  }

  const nombre = formData.get('nombre')?.toString().trim()
  const stock = Number(formData.get('stock') || 0)
  const unidad = formData.get('unidad')?.toString().trim() || 'pzas'
  const enUso = formData.get('en_uso') === 'on'

  if (!nombre) {
    pushNotice('Escribe un nombre para el insumo.')
    render()
    return
  }

  await addDoc(collection(db, 'inventario'), {
    nombre,
    stock,
    unidad,
    en_uso: enUso,
    actualizadoEn: serverTimestamp(),
  })
}

async function createPedido(formData) {
  if (!db) {
    pushNotice('Firebase no esta configurado todavia.')
    render()
    return
  }

  const mesa = state.orderDraft.mesa || formData.get('mesa')?.toString().trim()
  const platillos = state.orderDraft.items
  const total = getOrderDraftTotal()

  if (!mesa || platillos.length === 0) {
    pushNotice('Captura mesa y agrega al menos un platillo a la comanda.')
    render()
    return
  }

  await addDoc(collection(db, 'pedidos'), {
    mesa,
    platillos: platillos.map((item) => ({
      id: item.id,
      nombre: item.nombre,
      precio: Number(getOrderItemUnitPrice(item)),
      cantidad: Number(item.cantidad || 1),
      categoria: item.categoria,
      modificadores: (item.modifiers || []).map((modifier) => ({
        key: modifier.key,
        label: modifier.label,
        delta: Number(modifier.delta || 0),
      })),
      nota: item.note || null,
      personalizado: item.isCustom === true,
    })),
    total,
    estado: 'Pendiente',
    cerrado: false,
    creadoEn: serverTimestamp(),
    actualizadoEn: serverTimestamp(),
  })

  state.orderDraft.items = []
  state.orderDraft.editingItemId = null
  state.orderDraft.query = ''
  state.orderDraft.mesa = ''
}

function createDraftId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function getOrderModifierOptions() {
  const dynamicOptions = state.inventario
    .filter((item) => item.en_uso)
    .slice(0, 6)
    .map((item) => ({
      key: `sin-${item.id}`,
      label: `Sin ${item.nombre}`,
      delta: 0,
    }))

  return [
    { key: 'doble-carne', label: 'Doble carne', delta: 35 },
    { key: 'huevo-extra', label: 'Huevo extra', delta: 12 },
    { key: 'queso-extra', label: 'Queso extra', delta: 18 },
    ...dynamicOptions,
  ]
}

function addOrderItemById(itemId) {
  const menuItem = getVisibleMenuItems().find((item) => item.id === itemId)
  if (!menuItem) {
    return
  }

  const existing = state.orderDraft.items.find(
    (item) => item.id === menuItem.id && !item.isCustom && (item.modifiers || []).length === 0 && !item.note,
  )

  if (existing) {
    existing.cantidad += 1
    return
  }

  state.orderDraft.items.push({
    draftId: createDraftId(),
    id: menuItem.id,
    nombre: menuItem.nombre,
    categoria: menuItem.categoria,
    basePrecio: Number(menuItem.precio || 0),
    cantidad: 1,
    modifiers: [],
    note: '',
    isCustom: false,
  })
}

function removeOrderDraftItem(draftId) {
  state.orderDraft.items = state.orderDraft.items.filter((item) => item.draftId !== draftId)
  if (state.orderDraft.editingItemId === draftId) {
    state.orderDraft.editingItemId = null
  }
}

function getOrderItemUnitPrice(item) {
  const extras = (item.modifiers || []).reduce((sum, modifier) => sum + Number(modifier.delta || 0), 0)
  return Number(item.basePrecio || 0) + extras
}

function getOrderItemTotal(item) {
  return getOrderItemUnitPrice(item) * Number(item.cantidad || 1)
}

function getOrderDraftTotal() {
  return state.orderDraft.items.reduce((sum, item) => sum + getOrderItemTotal(item), 0)
}

function toggleOrderModifier(draftId, modifierKey) {
  const item = state.orderDraft.items.find((entry) => entry.draftId === draftId)
  if (!item) {
    return
  }

  const options = getOrderModifierOptions()
  const option = options.find((entry) => entry.key === modifierKey)
  if (!option) {
    return
  }

  const exists = (item.modifiers || []).find((modifier) => modifier.key === modifierKey)
  if (exists) {
    item.modifiers = item.modifiers.filter((modifier) => modifier.key !== modifierKey)
    return
  }

  item.modifiers = [...(item.modifiers || []), option]
}

async function saveMenuItem(formData) {
  if (!db) {
    pushNotice('Firebase no esta configurado todavia.')
    render()
    return
  }

  const nombre = formData.get('nombre')?.toString().trim()
  const descripcion = formData.get('descripcion')?.toString().trim()
  const precio = Number(formData.get('precio') || 0)
  const categoria = formData.get('categoria')?.toString().trim()
  const ingredientes = parseIngredients(formData.get('ingredientes'))
  const activo = formData.get('activo') === 'on'

  if (!nombre || !descripcion || !categoria || Number.isNaN(precio)) {
    pushNotice('Completa nombre, descripcion, precio y categoria.')
    render()
    return
  }

  const payload = {
    nombre,
    descripcion,
    precio,
    categoria,
    ingredientes,
    activo,
    actualizadoEn: serverTimestamp(),
  }

  if (state.editingMenuId) {
    await updateDoc(doc(db, 'menu', state.editingMenuId), payload)
    pushNotice('Platillo actualizado.')
  } else {
    await addDoc(collection(db, 'menu'), {
      ...payload,
      creadoEn: serverTimestamp(),
    })
    pushNotice('Platillo agregado.')
  }

  state.editingMenuId = null
  render()
}

async function ensureAccessRecord(user) {
  const email = getUserEmail(user)
  if (!email) {
    return
  }

  const accessRef = doc(db, 'admin_access', user.uid)
  const accessSnapshot = await getDoc(accessRef)
  const isBootstrap = bootstrapAdminEmails.has(email)

  if (!accessSnapshot.exists()) {
    await setDoc(accessRef, {
      email,
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      approved: isBootstrap,
      role: isBootstrap ? 'admin' : 'requested',
      reviewStatus: isBootstrap ? 'approved' : 'pending',
      requestedAt: serverTimestamp(),
      reviewedAt: isBootstrap ? serverTimestamp() : null,
      reviewedBy: isBootstrap ? email : null,
      lastLoginAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return
  }

  const currentAccess = accessSnapshot.data()
  const patch = {
    email,
    displayName: user.displayName || '',
    photoURL: user.photoURL || '',
    lastLoginAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }

  if (isBootstrap && (!currentAccess.approved || currentAccess.role !== 'admin')) {
    patch.approved = true
    patch.role = 'admin'
    patch.reviewStatus = 'approved'
    patch.reviewedAt = serverTimestamp()
    patch.reviewedBy = email
  }

  await setDoc(accessRef, patch, { merge: true })
}

async function setupAnalytics() {
  if (!firebaseApp || !firebaseConfig.measurementId || typeof window === 'undefined') {
    return
  }

  try {
    const { getAnalytics, isSupported } = await import('firebase/analytics')
    if (await isSupported()) {
      getAnalytics(firebaseApp)
    }
  } catch {
    pushNotice('Analytics no pudo inicializarse. La app sigue operando.')
    render()
  }
}

function isAuthorizedUser() {
  if (!state.user || !state.accessProfile) {
    return false
  }

  if (isBootstrapAdmin()) {
    return true
  }

  return Boolean(state.accessProfile.approved) && state.accessProfile.role === 'editor'
}

function canManageAccess() {
  return Boolean(state.user) && isBootstrapAdmin()
}

function isBootstrapAdmin(user = state.user) {
  return bootstrapAdminEmails.has(getUserEmail(user))
}

function getUserEmail(user = state.user) {
  return user?.email?.trim().toLowerCase() || ''
}

function getVisibleMenuItems() {
  return state.menu.filter((item) => item.activo !== false)
}

function getMenuByCategory(category) {
  return getVisibleMenuItems().filter((item) => item.categoria === category)
}

function getMenuEditorItem() {
  return state.menu.find((item) => item.id === state.editingMenuId) || null
}

function sortAccessEntries(left, right) {
  const leftPriority = getAccessPriority(left)
  const rightPriority = getAccessPriority(right)
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority
  }
  return (left.email || '').localeCompare(right.email || '', 'es')
}

function getAccessPriority(entry) {
  if ((entry.email || '').toLowerCase() === BOOTSTRAP_ADMIN_EMAIL) {
    return 0
  }

  if (!entry.approved) {
    return 1
  }

  return 2
}

function getAccessMessage() {
  if (!state.user) {
    return 'Inicia sesion para acceder a las funciones internas.'
  }
  return 'Tu acceso esta siendo revisado por un administrador.'
}

function getAccessStatusLabel(entry) {
  if ((entry.email || '').toLowerCase() === BOOTSTRAP_ADMIN_EMAIL) {
    return 'Administrador'
  }

  if (entry.role === 'editor' && entry.approved) {
    return 'Editor'
  }

  if (entry.approved) {
    return 'Aprobado'
  }
  return 'Pendiente'
}

function parseIngredients(value) {
  return value
    ?.toString()
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean) || []
}

function toDate(value) {
  if (!value) {
    return null
  }
  if (typeof value.toDate === 'function') {
    return value.toDate()
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function toMillis(value) {
  return toDate(value)?.getTime() || 0
}

function getActiveOrders() {
  return state.pedidos.filter((pedido) => !pedido.cerrado)
}

function getClosedOrders() {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTomorrow = new Date(startOfToday)
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1)

  return state.pedidos
    .filter((pedido) => {
      if (!pedido.cerrado) {
        return false
      }

      const referenceDate =
        toDate(pedido.cerradoEn) ||
        toDate(pedido.actualizadoEn) ||
        toDate(pedido.pagadoEn) ||
        toDate(pedido.creadoEn)

      if (!referenceDate) {
        return false
      }

      return referenceDate >= startOfToday && referenceDate < startOfTomorrow
    })
    .slice(0, 8)
}

function getPaidTodayTotal() {
  const today = new Date().toDateString()
  return state.pedidos
    .filter((pedido) => pedido.estado === 'Pagado' && toDate(pedido.pagadoEn)?.toDateString() === today)
    .reduce((sum, pedido) => sum + Number(pedido.total || 0), 0)
}

function getPaidTodayCount() {
  const today = new Date().toDateString()
  return state.pedidos.filter(
    (pedido) => pedido.estado === 'Pagado' && toDate(pedido.pagadoEn)?.toDateString() === today,
  ).length
}

function currency(value) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 2,
  }).format(Number(value || 0))
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function pushNotice(message) {
  const notice = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    message,
  }

  state.notices = [...state.notices, notice]

  const timeoutId = window.setTimeout(() => {
    removeNotice(notice.id)
    render()
  }, 4000)

  noticeTimers.set(notice.id, timeoutId)
}

function removeNotice(noticeId) {
  state.notices = state.notices.filter((notice) => notice.id !== noticeId)
  const timeoutId = noticeTimers.get(noticeId)
  if (timeoutId) {
    clearTimeout(timeoutId)
    noticeTimers.delete(noticeId)
  }
}

function updatePedidoTotal() {
  const totalNode = document.querySelector('[data-order-total]')
  if (!totalNode) {
    return
  }
  totalNode.textContent = currency(getOrderDraftTotal())
}

function triggerViewAnimation() {
  state.shouldAnimateView = true
  state.viewAnimationToken = Date.now() + Math.floor(Math.random() * 1000)
}

function applyViewAnimationLifecycle() {
  if (!state.shouldAnimateView) {
    return
  }

  const shellNode = appRoot.querySelector('[data-view-animation]')
  if (!shellNode) {
    state.shouldAnimateView = false
    return
  }

  const token = String(state.viewAnimationToken)
  const clearAnimationClass = () => {
    if (shellNode.dataset.viewAnimation !== token) {
      return
    }
    shellNode.classList.remove('is-view-animating')
  }

  shellNode.addEventListener('animationend', clearAnimationClass, { once: true })
  window.setTimeout(clearAnimationClass, 420)
  state.shouldAnimateView = false
}

function render() {
  if (state.isBooting) {
    appRoot.innerHTML = `
      <div class="app-loading" role="status" aria-live="polite" aria-label="Cargando aplicacion">
        <div class="loading-spinner" aria-hidden="true"></div>
        <p>Preparando los desayunos...</p>
      </div>
    `
    return
  }

  appRoot.innerHTML = `
    <div class="shell ${state.shouldAnimateView ? 'is-view-animating' : ''}" data-view-animation="${state.viewAnimationToken}">
      ${renderNavbar()}
      <main class="content">
        ${renderConfigBanner()}
        ${renderRouteView()}
      </main>
    </div>
    ${renderAlerts()}
  `

  applyViewAnimationLifecycle()
  updatePedidoTotal()
}

function renderNavbar() {
  const isMobileSidebarOpen = window.matchMedia('(max-width: 768px)').matches && state.mobileSidebarOpen
  const navAuthArea = renderNavAuthArea()

  return `
    <header class="topbar">
      <a class="brand" href="/dashboard" data-action="set-route" data-route="dashboard">
        <span class="brand__title">Desvelados</span>
      </a>
      <button class="mobile-menu-button" type="button" data-action="toggle-mobile-sidebar" aria-label="Abrir menu" aria-expanded="${isMobileSidebarOpen ? 'true' : 'false'}" aria-controls="mobile-sidebar">
        <i class="bi bi-list" aria-hidden="true"></i>
      </button>
      <nav class="nav-links" aria-label="Navegacion principal">
        <a class="nav-link ${state.route === 'dashboard' ? 'is-active' : ''}" href="/dashboard" data-action="set-route" data-route="dashboard">Inicio</a>
        <a class="nav-link ${state.route === 'menu' ? 'is-active' : ''}" href="/menu" data-action="set-route" data-route="menu">Menu</a>
        ${
          isAuthorizedUser()
            ? `<a class="nav-link nav-link--icon ${state.route === 'edicion' || state.route === 'nueva-orden' ? 'is-active' : ''}" href="/edicion" data-action="set-route" data-route="edicion" aria-label="Edicion" title="Edicion"><span class="nav-link__icon" aria-hidden="true"><i class="bi bi-pencil-fill"></i></span><span class="nav-link__text">Edicion</span></a>`
            : ''
        }
      </nav>
      ${navAuthArea ? `<div class="topbar-auth">${navAuthArea}</div>` : ''}
    </header>
    <button class="mobile-sidebar-overlay ${isMobileSidebarOpen ? 'open' : ''}" type="button" data-action="close-mobile-sidebar" aria-label="Cerrar menu"></button>
    <aside id="mobile-sidebar" class="mobile-sidebar ${isMobileSidebarOpen ? 'open' : ''}" aria-label="Menu movil">
      <header class="mobile-sidebar__head">
        <strong>Menu</strong>
        <button class="mobile-sidebar__close" type="button" data-action="close-mobile-sidebar" aria-label="Cerrar menu">×</button>
      </header>
      <nav class="mobile-sidebar__nav" aria-label="Navegacion movil">
        <a class="mobile-sidebar__link ${state.route === 'dashboard' ? 'is-active' : ''}" href="/dashboard" data-action="set-route" data-route="dashboard">Inicio</a>
        <a class="mobile-sidebar__link ${state.route === 'menu' ? 'is-active' : ''}" href="/menu" data-action="set-route" data-route="menu">Menu</a>
        ${
          isAuthorizedUser()
            ? `<button class="button button--cta mobile-sidebar__quick" type="button" data-action="go-new-order-screen">⚡ Nueva Orden</button>`
            : ''
        }
        ${
          isAuthorizedUser()
            ? `<a class="mobile-sidebar__link ${state.route === 'edicion' || state.route === 'nueva-orden' ? 'is-active' : ''}" href="/edicion" data-action="set-route" data-route="edicion"><span aria-hidden="true"><i class="bi bi-pencil-fill"></i></span><span>Edicion</span></a>`
            : ''
        }
        ${
          isBootstrapAdmin()
            ? `<a class="mobile-sidebar__link ${state.route === 'admin' ? 'is-active' : ''}" href="/admin" data-action="set-route" data-route="admin"><span aria-hidden="true"><i class="bi bi-gear-fill"></i></span><span>Administrador</span></a>`
            : ''
        }
      </nav>
      <div class="mobile-sidebar__footer">
        ${
          state.user
            ? `<button class="button button--ghost mobile-sidebar__logout" type="button" data-action="logout">Cerrar Sesion</button>`
            : `<button class="button button--ghost mobile-sidebar__logout" type="button" data-action="login">Iniciar Sesion</button>`
        }
      </div>
    </aside>
  `
}

function renderNavAuthArea() {
  if (!state.user) {
    return ''
  }

  if (!isAuthorizedUser()) {
    return `
      <span class="pending-pill role-pill" title="Acceso en revision" aria-label="Acceso en revision">
        <span class="role-pill__icon" aria-hidden="true"><i class="bi bi-hourglass-split"></i></span>
        <span class="role-pill__text">En revision</span>
      </span>
      <button class="button button--ghost icon-action" type="button" data-action="logout" aria-label="Cerrar sesion" title="Cerrar sesion">
        <span class="icon-action__icon" aria-hidden="true"><i class="bi bi-box-arrow-right"></i></span>
        <span class="icon-action__text">Cerrar Sesion</span>
      </button>
    `
  }

  return `
    <button class="button button--ghost icon-action quick-order-nav" type="button" data-action="go-new-order-screen" aria-label="Nueva orden" title="Nueva orden">
      <span class="icon-action__icon" aria-hidden="true"><i class="bi bi-lightning-charge-fill"></i></span>
      <span class="icon-action__text">Nueva Orden</span>
    </button>
    <span class="user-pill role-pill" title="${isBootstrapAdmin() ? 'Administrador' : 'Editor'}" aria-label="${isBootstrapAdmin() ? 'Administrador' : 'Editor'}">
      <span class="role-pill__icon" aria-hidden="true"><i class="bi ${isBootstrapAdmin() ? 'bi-gear-fill' : 'bi-pencil-fill'}"></i></span>
      <span class="role-pill__text">${isBootstrapAdmin() ? 'Administrador' : 'Editor'}</span>
    </span>
    <button class="button button--ghost icon-action" type="button" data-action="logout" aria-label="Cerrar sesion" title="Cerrar sesion">
      <span class="icon-action__icon" aria-hidden="true"><i class="bi bi-box-arrow-right"></i></span>
      <span class="icon-action__text">Cerrar Sesion</span>
    </button>
  `
}

function renderAlerts() {
  if (state.notices.length === 0) {
    return ''
  }
  return `<section class="alerts" role="status" aria-live="polite">${state.notices
    .map(
      (notice) => `<article class="alert-item toast" data-notice-id="${escapeHtml(notice.id)}">
        <p>${escapeHtml(notice.message)}</p>
        <button class="toast-close" type="button" data-action="close-notice" data-id="${escapeHtml(notice.id)}" aria-label="Cerrar notificacion">x</button>
      </article>`,
    )
    .join('')}</section>`
}

function renderConfigBanner() {
  if (hasFirebaseConfig) {
    return ''
  }
  return `
    <section class="card setup-card">
      <p>Configuracion pendiente</p>
      <h2>Conecta Firebase para activar autenticacion y datos en tiempo real.</h2>
    </section>
  `
}

function renderRouteView() {
  if (state.route === 'admin') {
    return renderAdminAccessView()
  }

  if (state.route === 'menu') {
    return renderPublicMenuView()
  }

  if (state.route === 'dashboard') {
    return renderPublicDashboardView()
  }

  if (state.route === 'edicion') {
    if (!isAuthorizedUser()) {
      return renderUnauthorizedAdminState()
    }

    return renderPrivateAdminView()
  }

  if (state.route === 'nueva-orden') {
    if (!isAuthorizedUser()) {
      return renderUnauthorizedAdminState()
    }

    return renderNewOrderScreen()
  }

  return renderPublicDashboardView()
}

function renderAdminAccessView() {
  if (state.user && isAuthorizedUser()) {
    return renderPrivateAdminView()
  }

  return `
    <section class="card guard-card">
      <p class="eyebrow">Acceso privado</p>
      <h2>Inicia sesion para entrar al panel de edicion.</h2>
      <div class="actions-inline">
        ${!state.user ? '<button class="button" type="button" data-action="login">Entrar con Google</button>' : ''}
        ${state.user ? '<button class="button button--ghost" type="button" data-action="logout">Cerrar Sesion</button>' : ''}
      </div>
      ${state.user && !isAuthorizedUser() ? `<p>${escapeHtml(getAccessMessage())}</p>` : ''}
    </section>
  `
}

function renderPublicDashboardView() {
  return `
    <section class="card hero-card">
      <h1 class="hero-main-title">Desvelados</h1>
      <p>
        Para los que andan trabajando temprano, los que se van de fiesta o los que simplemente traen un hambre feroz.
        Aqui hay comida real: huevito al gusto, chilaquiles bien servidos, tortillas hechas a mano y pan brioche artesanal.
      </p>
      <div class="hero-meta">
        <article class="hero-schedule">
          <span class="schedule-label">Horario</span>
          <strong class="schedule-days">Martes a Domingo</strong>
          <p class="schedule-hours">8:00 AM a 2:00 PM</p>
          <small class="schedule-note">Lunes cerrado</small>
        </article>
      </div>
      <article class="hero-contact card">
        <h2>Contacto y ubicacion</h2>
        <ul class="contact-list">
          <li>
            <a
              class="contact-link"
              href="https://www.google.com/maps/search/?api=1&query=Jose+Maria+Iglesias+3364%2C+Miguel+Hidalgo%2C+44760"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span class="contact-icon">MAP</span>
              <div>
                <strong>Direccion</strong>
                <p>Jose Maria Iglesias 3364, col. Miguel Hidalgo, CP 44760.</p>
              </div>
            </a>
          </li>
          <li>
            <a class="contact-link" href="tel:+523300000000">
              <span class="contact-icon">TEL</span>
              <div>
                <strong>Telefono / WhatsApp</strong>
                <p>Toca para llamar</p>
              </div>
            </a>
          </li>
          <li>
            <a class="contact-link" href="https://www.instagram.com/losdesvelados.brunch" target="_blank" rel="noopener noreferrer">
              <span class="contact-icon">IG</span>
              <div>
                <strong>Redes Sociales</strong>
                <p>@losdesvelados.brunch</p>
              </div>
            </a>
          </li>
        </ul>
      </article>
      <div class="hero-cta-wrap">
        <button class="button button--cta" type="button" data-action="go-menu">Ver el menu de hoy</button>
      </div>
    </section>
  `
}

function renderPublicMenuView() {
  const selectedCategory = MENU_CATEGORIES.includes(state.menuCategory) ? state.menuCategory : MENU_CATEGORIES[0]
  return `
    <nav class="menu-category-tabs" aria-label="Categorias del menu">
      ${MENU_CATEGORIES.map(
        (category) =>
          `<button class="menu-category-tab ${selectedCategory === category ? 'is-active' : ''}" type="button" data-action="set-menu-category" data-category="${category}">${category}</button>`,
      ).join('')}
    </nav>
    <section class="menu-sections">
      ${renderPublicCategory(selectedCategory)}
    </section>
  `
}

function renderPublicCategory(category) {
  const items = getMenuByCategory(category)
  return `
    <article class="category-wrap">
      <header>
        <p class="eyebrow">${escapeHtml(category)}</p>
        <h2>${escapeHtml(category)}</h2>
      </header>
      <div class="dish-grid">
        ${items.length > 0 ? items.map((item) => renderDishCard(item)).join('') : '<article class="card empty">Sin elementos activos.</article>'}
      </div>
    </article>
  `
}

function renderDishCard(item) {
  return `
    <article class="card dish-card">
      <div class="dish-head">
        <h3>${escapeHtml(item.nombre)}</h3>
        <div class="dish-price">${currency(item.precio)}</div>
      </div>
      <p>${escapeHtml(item.descripcion || '')}</p>
    </article>
  `
}

function renderUnauthorizedAdminState() {
  return `
    <section class="card guard-card">
      <p class="eyebrow">Acceso restringido</p>
      <h2>${escapeHtml(getAccessMessage())}</h2>
      ${state.user ? '<button class="button button--ghost" type="button" data-action="logout">Cerrar Sesion</button>' : ''}
    </section>
  `
}

function renderPrivateAdminView() {
  const currentTab = EDITOR_TABS.includes(state.editorTab) ? state.editorTab : 'resumen'

  return `
    <section class="admin-layout editor-shell">
      <aside class="card sidebar editor-sidebar">
        <p class="eyebrow">Panel de control</p>
        <h2>Edicion</h2>
        <nav class="sidebar-links editor-tabs editor-tabs--rail" aria-label="Herramientas de edicion">
          <button class="sidebar-link editor-tab ${currentTab === 'resumen' ? 'is-active' : ''}" type="button" data-action="set-editor-tab" data-tab="resumen">Resumen</button>
          <button class="sidebar-link editor-tab ${currentTab === 'pedidos' ? 'is-active' : ''}" type="button" data-action="set-editor-tab" data-tab="pedidos">Pedidos y Comandas</button>
          <button class="sidebar-link editor-tab ${currentTab === 'catalogo' ? 'is-active' : ''}" type="button" data-action="set-editor-tab" data-tab="catalogo">Catalogo</button>
          <button class="sidebar-link editor-tab ${currentTab === 'insumos' ? 'is-active' : ''}" type="button" data-action="set-editor-tab" data-tab="insumos">Insumos</button>
          <button class="sidebar-link editor-tab ${currentTab === 'caja' ? 'is-active' : ''}" type="button" data-action="set-editor-tab" data-tab="caja">Caja</button>
        </nav>
      </aside>
      <section class="admin-main">
        ${renderAdminModule(currentTab)}
      </section>
    </section>
  `
}

function renderAdminKpis() {
  return `
    <section class="kpi-grid">
      <article class="card kpi"><span>Pedidos activos</span><strong>${getActiveOrders().length}</strong></article>
      <article class="card kpi"><span>Ventas del dia</span><strong>${currency(getPaidTodayTotal())}</strong></article>
      <article class="card kpi"><span>Menu activo</span><strong>${getVisibleMenuItems().length}</strong></article>
      <article class="card kpi"><span>Insumos</span><strong>${state.inventario.length}</strong></article>
    </section>
  `
}

function renderAdminModule(tab) {
  if (tab === 'resumen') {
    return `
      <section class="module-grid">
        ${renderAdminKpis()}
      </section>
    `
  }

  if (tab === 'catalogo') {
    return renderMenuCrudModule()
  }
  if (tab === 'insumos') {
    return renderInventarioModule()
  }
  if (tab === 'caja') {
    return renderCajaModule()
  }

  if (tab === 'pedidos') {
    return `
      <section class="editor-pedidos-layout">
        <div class="editor-pedidos-main">${renderPedidosModule()}</div>
        ${canManageAccess() ? `<aside class="editor-pedidos-side">${renderAccessModule(true)}</aside>` : ''}
      </section>
    `
  }

  return renderPedidosModule()
}

function renderMenuCrudModule() {
  const editor = getMenuEditorItem()
  return `
    <section class="module-grid">
      <article class="card module-card">
        <header class="module-header">
          <h2>${editor ? 'Editar platillo' : 'Agregar / Editar Platillo'}</h2>
          ${editor ? '<button class="button button--secondary" type="button" data-action="cancel-menu-edit">Cancelar</button>' : ''}
        </header>
        <form class="form-grid" data-form="menu-item">
          <label><span>Nombre</span><input name="nombre" value="${escapeHtml(editor?.nombre || '')}" required /></label>
          <label><span>Precio</span><input name="precio" type="number" min="0" step="0.01" value="${escapeHtml(editor?.precio || '')}" required /></label>
          <label class="wide"><span>Descripcion</span><textarea name="descripcion" required>${escapeHtml(editor?.descripcion || '')}</textarea></label>
          <label><span>Categoria</span>
            <select name="categoria" required>
              <option value="">Selecciona categoria</option>
              ${MENU_CATEGORIES.map((category) => `<option value="${category}" ${editor?.categoria === category ? 'selected' : ''}>${category}</option>`).join('')}
            </select>
          </label>
          <label class="wide"><span>Ingredientes (separados por comas)</span><input name="ingredientes" value="${escapeHtml((editor?.ingredientes || []).join(', '))}" /></label>
          <label class="checkbox-inline wide"><input name="activo" type="checkbox" ${editor?.activo !== false ? 'checked' : ''} /><span>Visible en menu publico</span></label>
          <div class="actions wide">
            <button class="button" type="submit">${editor ? 'Guardar cambios' : 'Agregar platillo'}</button>
            ${editor ? `<button class="button button--ghost" type="button" data-action="delete-menu-item" data-id="${editor.id}">Eliminar</button>` : ''}
          </div>
        </form>
      </article>
      <article class="card module-card">
        <h2>Catalogo actual</h2>
        <div class="admin-card-grid">
          ${
            state.menu.length > 0
              ? state.menu.map((item) => renderAdminMenuCard(item)).join('')
              : '<article class="card empty">No hay platillos registrados.</article>'
          }
        </div>
      </article>
    </section>
  `
}

function renderAdminMenuCard(item) {
  return `
    <article class="menu-item-card ${item.activo === false ? 'is-muted' : ''}">
      <header>
        <h3>${escapeHtml(item.nombre)}</h3>
        <strong>${currency(item.precio)}</strong>
      </header>
      <p>${escapeHtml(item.descripcion || '')}</p>
      <div class="chips">
        ${(item.ingredientes || []).map((ingredient) => `<span class="chip">${escapeHtml(ingredient)}</span>`).join('')}
      </div>
      <footer>
        <span>${escapeHtml(item.categoria || 'Sin categoria')}</span>
        <button class="button button--secondary" type="button" data-action="edit-menu-item" data-id="${item.id}">Editar</button>
      </footer>
    </article>
  `
}

function renderInventarioModule() {
  return `
    <section class="module-grid">
      <article class="card module-card">
        <h2>Control de Insumos</h2>
        <form class="form-grid" data-form="inventario">
          <label><span>Ingrediente</span><input name="nombre" required /></label>
          <label><span>Stock actual</span><input name="stock" type="number" min="0" step="1" /></label>
          <label><span>Unidad</span><input name="unidad" placeholder="pzas, kg, lts" /></label>
          <label class="checkbox-inline"><input name="en_uso" type="checkbox" checked /><span>En uso</span></label>
          <div class="actions wide"><button class="button" type="submit">Agregar insumo</button></div>
        </form>
      </article>
      <article class="card module-card">
        <h2>Inventario en vivo</h2>
        <div class="stack">
          ${
            state.inventario.length > 0
              ? state.inventario.map((item) => renderInventarioRow(item)).join('')
              : '<article class="card empty">Sin insumos registrados.</article>'
          }
        </div>
      </article>
    </section>
  `
}

function renderInventarioRow(item) {
  return `
    <article class="inventory-row ${item.en_uso ? '' : 'warn'}">
      <div>
        <h3>${escapeHtml(item.nombre)}</h3>
        <p>${item.en_uso ? 'Activo' : 'No asignado a platillo activo'}</p>
      </div>
      <label><span>Stock</span><input data-stock-input="${item.id}" type="number" value="${Number(item.stock || 0)}" /></label>
      <label class="checkbox-inline"><input data-usage-input="${item.id}" type="checkbox" ${item.en_uso ? 'checked' : ''} /><span>En uso</span></label>
      <button class="button button--secondary" type="button" data-action="save-stock" data-id="${item.id}">Guardar</button>
    </article>
  `
}

function renderPedidosModule() {
  const currentView = PEDIDO_VIEWS.includes(state.pedidoView) ? state.pedidoView : 'active'

  let viewContent = renderPedidoActiveView()
  if (currentView === 'active') {
    viewContent = renderPedidoActiveView()
  }
  if (currentView === 'history') {
    viewContent = renderPedidoHistoryView()
  }

  return `
    <section class="module-grid order-workspace">
      <nav class="order-subnav" aria-label="Submenu de comandas">
        <button class="order-subnav__tab ${currentView === 'active' ? 'is-active' : ''}" type="button" data-action="set-pedido-view" data-view="active">Cocina (Activos)</button>
        <button class="order-subnav__tab ${currentView === 'history' ? 'is-active' : ''}" type="button" data-action="set-pedido-view" data-view="history">Historial (Cerrados)</button>
      </nav>
      ${viewContent}
    </section>
  `
}

function renderNewOrderScreen() {
  const menuItems = getVisibleMenuItems()
  return `
    <section class="card module-card new-order-screen">
      <header class="new-order-screen__head">
        <button class="button button--ghost" type="button" data-action="back-to-pedidos">← Volver</button>
        <h2>Nueva Orden</h2>
      </header>
      ${renderPedidoCreateView(menuItems)}
    </section>
  `
}

function renderPedidoCreateView(menuItems) {
  const query = state.orderDraft.query.trim().toLowerCase()
  const filteredMenu = query
    ? menuItems.filter(
        (item) =>
          (item.nombre || '').toLowerCase().includes(query) ||
          (item.descripcion || '').toLowerCase().includes(query) ||
          (item.categoria || '').toLowerCase().includes(query),
      )
    : menuItems
  const editingItem = state.orderDraft.items.find((item) => item.draftId === state.orderDraft.editingItemId) || null
  const modifierOptions = getOrderModifierOptions()

  return `
    <form class="form-grid form-grid--order new-order-form" data-form="pedido">
      <div class="order-create-layout new-order-layout">
          <section class="order-create-main new-order-panel card">
            <div class="order-top-controls">
              <label class="mesa-field"><span>Mesa</span>
                <select name="mesa" class="mesa-select" data-order-table required>
                  <option value="">Selecciona</option>
                  ${Array.from(
                    { length: 10 },
                    (_, index) => `<option value="${index + 1}" ${String(index + 1) === String(state.orderDraft.mesa || '') ? 'selected' : ''}>${index + 1}</option>`,
                  ).join('')}
                </select>
              </label>
              <label class="order-mode-toggle">
                <span class="order-mode-toggle__label">Platillo personalizado</span>
                <input type="checkbox" data-order-custom-toggle ${state.orderDraft.customMode ? 'checked' : ''} />
                <span class="order-mode-toggle__switch" aria-hidden="true"></span>
              </label>
            </div>

            <div class="order-search-block ${state.orderDraft.customMode ? 'is-hidden' : ''}">
              <span>Buscador de platillos</span>
              <input data-order-search type="search" placeholder="Busca por nombre, categoria o descripcion" value="${escapeHtml(state.orderDraft.query)}" />
              <div class="order-search-results">
                ${
                  filteredMenu.length > 0
                    ? filteredMenu
                        .slice(0, 12)
                        .map(
                          (item) => `
                            <article class="order-result-item">
                              <div>
                                <strong>${escapeHtml(item.nombre)}</strong>
                                <p>${escapeHtml(item.categoria || 'Sin categoria')} · ${currency(item.precio)}</p>
                              </div>
                              <button class="button button--secondary" type="button" data-action="add-order-item" data-id="${item.id}">Agregar</button>
                            </article>
                          `,
                        )
                        .join('')
                    : '<article class="card empty">No encontramos coincidencias para la busqueda.</article>'
                }
              </div>
            </div>

            <div class="order-custom-box ${state.orderDraft.customMode ? '' : 'is-hidden'}">
              <span>Platillo improvisado</span>
              <div class="order-custom-grid">
                <input data-custom-name type="text" placeholder="Ej. Chilaquiles especiales" />
                <input data-custom-price type="number" min="0" step="0.01" placeholder="Precio" />
                <button class="button button--secondary" type="button" data-action="add-custom-item">+ Platillo Personalizado</button>
              </div>
            </div>
          </section>
          <aside class="order-ticket card new-order-ticket">
            <p class="eyebrow">Resumen</p>
            <h3>Ticket rapido</h3>
            <div class="order-ticket-list">
              ${
                state.orderDraft.items.length > 0
                  ? state.orderDraft.items
                      .map(
                        (item) => `
                          <article class="order-ticket-item">
                            <header>
                              <div>
                                <strong>${escapeHtml(item.nombre)}</strong>
                                <p>${currency(getOrderItemUnitPrice(item))} c/u · ${escapeHtml(item.categoria || 'General')}</p>
                              </div>
                              <strong>${currency(getOrderItemTotal(item))}</strong>
                            </header>
                            <div class="order-ticket-controls">
                              <button type="button" data-action="order-item-minus" data-id="${item.draftId}" aria-label="Disminuir cantidad">-</button>
                              <span>${Number(item.cantidad || 1)}</span>
                              <button type="button" data-action="order-item-plus" data-id="${item.draftId}" aria-label="Aumentar cantidad">+</button>
                              <button type="button" data-action="order-item-edit" data-id="${item.draftId}">Editar</button>
                              <button type="button" data-action="order-item-remove" data-id="${item.draftId}">Quitar</button>
                            </div>
                            <label class="order-item-note-field">
                              <span>Nota</span>
                              <input
                                type="text"
                                data-order-item-note
                                data-id="${item.draftId}"
                                placeholder="Ej. Sin cebolla"
                                value="${escapeHtml(item.note || '')}"
                              />
                            </label>
                            ${(item.modifiers || []).length > 0 || item.note ? `<p class="order-ticket-note">${escapeHtml([
                              ...(item.modifiers || []).map((modifier) => modifier.label),
                              item.note || '',
                            ].filter(Boolean).join(' · '))}</p>` : ''}
                          </article>
                        `,
                      )
                      .join('')
                  : '<article class="card empty">Agrega platillos para empezar la comanda.</article>'
              }
            </div>

            ${
              editingItem
                ? `
                  <section class="order-edit-panel card">
                    <p class="eyebrow">Editar platillo</p>
                    <h3>${escapeHtml(editingItem.nombre)}</h3>
                    <div class="order-modifier-grid">
                      ${modifierOptions
                        .map((option) => {
                          const checked = (editingItem.modifiers || []).some((modifier) => modifier.key === option.key)
                          return `<button class="order-modifier ${checked ? 'is-active' : ''}" type="button" data-action="toggle-order-modifier" data-id="${editingItem.draftId}" data-modifier="${option.key}">${escapeHtml(option.label)} ${option.delta > 0 ? `(+${currency(option.delta)})` : ''}</button>`
                        })
                        .join('')}
                    </div>
                    <label><span>Notas</span><textarea data-order-note-input="${editingItem.draftId}" placeholder="Ej. Bien cocido, salsa aparte">${escapeHtml(editingItem.note || '')}</textarea></label>
                    <button class="button button--secondary" type="button" data-action="save-order-note" data-id="${editingItem.draftId}">Guardar detalles</button>
                  </section>
                `
                : ''
            }

            <div class="total-box"><span>Total estimado</span><strong data-order-total>${currency(0)}</strong></div>
            <button class="button button--cta" type="submit">Crear Pedido</button>
          </aside>
      </div>
    </form>
  `
}

function renderPedidoActiveView() {
  return `
    <article class="card module-card">
      <h2>Monitor de cocina</h2>
      <div class="stack">
        ${
          getActiveOrders().length > 0
            ? getActiveOrders().map((pedido) => renderPedidoCard(pedido)).join('')
            : '<article class="card empty">Sin pedidos activos.</article>'
        }
      </div>
    </article>
  `
}

function renderPedidoHistoryView() {
  return `
    <article class="card module-card">
      <h2>Historial reciente</h2>
      <div class="stack">
        ${
          getClosedOrders().length > 0
            ? getClosedOrders().map((pedido) => renderPedidoCard(pedido, true)).join('')
            : '<article class="card empty">Sin pedidos cerrados.</article>'
        }
      </div>
    </article>
  `
}

function renderPedidoCard(pedido, isClosed = false) {
  const stateClass = (pedido.estado || 'Pendiente').toLowerCase()

  return `
    <article class="order-card ${stateClass} ${isClosed ? 'is-muted' : ''}">
      <header>
        <div>
          <span>Mesa ${escapeHtml(pedido.mesa)}</span>
          <strong>${currency(pedido.total)}</strong>
        </div>
        <span class="order-state">${escapeHtml(pedido.estado || 'Pendiente')}</span>
      </header>
      <ul>
        ${(pedido.platillos || [])
          .map((item) => {
            const qty = Number(item.cantidad || 1)
            const mods = (item.modificadores || []).map((modifier) => modifier.label).filter(Boolean)
            const note = item.nota ? [item.nota] : []
            const details = [...mods, ...note]
            return `<li>${escapeHtml(item.nombre)} x${qty} · ${currency(Number(item.precio || 0) * qty)}${details.length > 0 ? ` <small>(${escapeHtml(details.join(' · '))})</small>` : ''}</li>`
          })
          .join('')}
      </ul>
      <footer>
        <select data-status-select="${pedido.id}" ${isClosed ? 'disabled' : ''}>
          ${ORDER_STATES.map((status) => `<option value="${status}" ${pedido.estado === status ? 'selected' : ''}>${status}</option>`).join('')}
        </select>
        <button class="button button--secondary" type="button" data-action="change-status" data-id="${pedido.id}" ${isClosed ? 'disabled' : ''}>Actualizar</button>
        <button class="button button--ghost" type="button" data-action="close-order" data-id="${pedido.id}" ${isClosed ? 'disabled' : ''}>Cerrar</button>
      </footer>
    </article>
  `
}

function renderCajaModule() {
  return `
    <section class="module-grid">
      <article class="card module-card">
        <p class="eyebrow">Reporte de ganancias</p>
        <h2>Caja diaria</h2>
        <div class="cash-box">
          <strong>${currency(getPaidTodayTotal())}</strong>
          <span>${getPaidTodayCount()} pedidos pagados hoy</span>
        </div>
      </article>
    </section>
  `
}

function renderAccessModule(isSidePanel = false) {
  return `
    <section class="module-grid access-panel ${isSidePanel ? 'is-side' : ''}">
      <article class="card module-card">
        <h2>Solicitudes de acceso</h2>
        <div class="stack">
          ${
            state.accessEntries.length > 0
              ? state.accessEntries.map((entry) => renderAccessRow(entry)).join('')
              : '<article class="card empty">No hay solicitudes.</article>'
          }
        </div>
      </article>
    </section>
  `
}

function renderAccessRow(entry) {
  const isCurrentUser = entry.email === getUserEmail()
  const isBootstrapEntry = (entry.email || '').toLowerCase() === BOOTSTRAP_ADMIN_EMAIL
  return `
    <article class="access-row ${entry.approved ? '' : 'warn'}">
      <div>
        <h3>${escapeHtml(entry.displayName || entry.email || 'Sin nombre')}</h3>
        <p>${escapeHtml(entry.email || '')}${isCurrentUser ? ' · Sesion actual' : ''}</p>
      </div>
      <span class="status-label">${getAccessStatusLabel(entry)}</span>
      <div class="actions-inline">
        <button class="button button--secondary" type="button" data-action="approve-access" data-id="${entry.id}" ${entry.approved || isBootstrapEntry ? 'disabled' : ''}>Aprobar como editor</button>
        <button class="button button--ghost" type="button" data-action="revoke-access" data-id="${entry.id}" ${!entry.approved || isCurrentUser || isBootstrapEntry ? 'disabled' : ''}>Revocar</button>
      </div>
    </article>
  `
}