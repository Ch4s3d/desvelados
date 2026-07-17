import './style.css'
import './style-shifts.css'
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
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'

const PUBLIC_ROUTES = new Set(['dashboard', 'menu', 'admin'])
const PRIVATE_ROUTES = new Set(['edicion', 'nueva-orden'])
const EDITOR_TABS = ['resumen', 'pedidos', 'catalogo', 'combos', 'insumos', 'configuracion', 'accesos']
const ADMIN_ONLY_EDITOR_TABS = new Set(['accesos'])
const EDITOR_TAB_LABELS = {
  resumen: 'Resumen',
  pedidos: 'Pedidos',
  catalogo: 'Catalogo',
  combos: 'Combos',
  insumos: 'Insumos',
  configuracion: 'Configuracion',
  accesos: 'Solicitudes de acceso',
}
const PEDIDO_VIEWS = ['active', 'history']
const ORDER_STATES = ['Pendiente', 'Preparando', 'Entregado', 'Pagado']
const ORDER_SERVICE_TYPES = ['mesa', 'domicilio', 'recoger']
const MENU_CATEGORIES = ['Platos Fuertes', 'Bebidas', 'Postres']
const ADVANCED_MENU_CATEGORIES = ['Entradas', ...MENU_CATEGORIES]
const WEEK_DAYS = [
  { key: 'lunes', label: 'Lunes' },
  { key: 'martes', label: 'Martes' },
  { key: 'miercoles', label: 'Miercoles' },
  { key: 'jueves', label: 'Jueves' },
  { key: 'viernes', label: 'Viernes' },
  { key: 'sabado', label: 'Sabado' },
  { key: 'domingo', label: 'Domingo' },
]
const BOOTSTRAP_ADMIN_EMAIL = 'j0bsch453d@gmail.com'
const LOADING_COURTESY_DELAY_MS = 3000
const LOADING_FADE_MS = 420
const COMBO_COLLECTION = 'combos'
const NOTIFICATION_COLLECTION = 'notifications'
const INVENTORY_UNIT_OPTIONS = [
  { value: 'pza', label: 'Pieza' },
  { value: 'g', label: 'Gramo' },
  { value: 'kg', label: 'Kilogramo' },
  { value: 'ml', label: 'Mililitro' },
  { value: 'l', label: 'Litro' },
]

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
  isLoading: true,
  hasStartedLoadingExit: false,
  loadingScreenVisible: true,
  loadingScreenExiting: false,
  settings: createDefaultPublicSettings(),
  user: null,
  accessProfile: null,
  accessEntries: [],
  menu: [],
  combos: [],
  pedidos: [],
  inventario: [],
  notifications: [],
  notices: [],
  mobileSidebarOpen: false,
  notificationPanelOpen: false,
  shouldAnimateView: true,
  viewAnimationToken: 0,
  orderDraft: {
    mesa: '',
    serviceType: 'mesa',
    delivery: {
      calle: '',
      numeroCasa: '',
      entreCalles: '',
      horaEntrega: '',
      telefono: '',
      nombreCliente: '',
    },
    pickup: {
      nombre: '',
      apellido: '',
      telefono: '',
      horaRecoger: '',
    },
    query: '',
    items: [],
    editingItemId: null,
    customMode: false,
  },
  menuCreateModalOpen: false,
  comboCreateModalOpen: false,
  ingredientCreateModalOpen: false,
  editingMenuId: null,
  editingComboId: null,
  menuFormDraft: createDefaultMenuFormDraft(),
  menuPriceDraft: '',
  comboDraft: createDefaultComboDraft(),
  recipeDraft: createDefaultRecipeDraft(),
  inventorySearch: '',
  inventorySelectedId: null,
  inventoryDraft: createDefaultInventoryDraft(),
  inventoryDraftDirty: false,
  inventoryDraftSourceId: null,
  inventoryMobileView: 'list',
  currentShift: null,
  mermas: [],
  shifts: [],
  shiftOpenModalOpen: false,
  shiftCloseModalOpen: false,
  cashOutflowModalOpen: false,
  wasteModalOpen: false,
  shiftOpenDraft: {
    efectivoInicial: '',
    notasInicio: '',
  },
  shiftCloseDraft: {
    efectivoFinal: '',
    notasCierre: '',
  },
  cashOutflowDraft: {
    monto: '',
    razon: 'compra_insumos',
    items: '',
  },
  wasteModalState: {
    ingredientSearch: '',
    selectedIngredient: null,
    cantidadDraft: '',
    unidadDraft: 'g',
    razonDraft: 'error_cocina',
  },
}

const noticeTimers = new Map()
let loadingCourtesyTimer = null
let loadingFadeTimer = null
let lowStockAlertedIds = new Set()
let knownPedidoIds = new Set()
let inventoryAlertsPrimed = false
const loadingReadiness = {
  authReady: false,
  menuReady: false,
  settingsReady: false,
}

const subscriptions = {
  accessEntries: null,
  accessProfile: null,
  inventario: null,
  combos: null,
  notifications: null,
  menu: null,
  settings: null,
  pedidos: null,
  mermas: null,
  shifts: null,
}

const firebaseApp = hasFirebaseConfig ? initializeApp(firebaseConfig) : null
const auth = firebaseApp ? getAuth(firebaseApp) : null
const db = firebaseApp ? getFirestore(firebaseApp) : null
const provider = firebaseApp ? new GoogleAuthProvider() : null

setupAnalytics()
setupRouteWatcher()
setupViewportWatcher()
setupMenuStream()
setupCombosStream()
setupNotificationsStream()
setupMermasStream()
setupShiftsStream()
setupPublicSettingsStream()
setupAuthWatcher()
attachEvents()
enforceRouteAccess(true)
render()

function setupAuthWatcher() {
  if (!auth) {
    loadingReadiness.authReady = true
    evaluateLoadingState()
    return
  }

  onAuthStateChanged(auth, async (user) => {
    state.user = user
    await syncAccessProfile()
    syncAdminStreams()
    enforceRouteAccess(true)
    loadingReadiness.authReady = true
    evaluateLoadingState()
    render()
  })
}

function evaluateLoadingState() {
  const isDataReady = loadingReadiness.authReady && loadingReadiness.menuReady && loadingReadiness.settingsReady
  if (!isDataReady) {
    return
  }

  if (state.hasStartedLoadingExit || !state.loadingScreenVisible) {
    return
  }

  state.hasStartedLoadingExit = true
  clearTimeout(loadingCourtesyTimer)
  clearTimeout(loadingFadeTimer)

  loadingCourtesyTimer = window.setTimeout(() => {
    state.loadingScreenExiting = true
    render()

    loadingFadeTimer = window.setTimeout(() => {
      state.loadingScreenVisible = false
      state.loadingScreenExiting = false
      state.isLoading = false
      render()
    }, LOADING_FADE_MS)
  }, LOADING_COURTESY_DELAY_MS)
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
    loadingReadiness.menuReady = true
    evaluateLoadingState()
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

    if (!loadingReadiness.menuReady) {
      loadingReadiness.menuReady = true
      evaluateLoadingState()
    }

    render()
  }, () => {
    if (!loadingReadiness.menuReady) {
      loadingReadiness.menuReady = true
      evaluateLoadingState()
      render()
    }
  })
}

function setupCombosStream() {
  if (!db) {
    return
  }

  subscriptions.combos?.()
  subscriptions.combos = onSnapshot(collection(db, COMBO_COLLECTION), (snapshot) => {
    state.combos = snapshot.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }))
      .sort((left, right) => {
        const leftActive = left.activo !== false ? 0 : 1
        const rightActive = right.activo !== false ? 0 : 1
        if (leftActive !== rightActive) {
          return leftActive - rightActive
        }
        return (left.nombre || '').localeCompare(right.nombre || '', 'es')
      })

    if (state.editingComboId && !state.combos.some((combo) => combo.id === state.editingComboId)) {
      state.editingComboId = null
      state.comboCreateModalOpen = false
      state.comboDraft = createDefaultComboDraft()
    }

    render()
  })
}

function setupNotificationsStream() {
  if (!db || !state.user || !isAuthorizedUser()) {
    subscriptions.notifications?.()
    subscriptions.notifications = null
    state.notifications = []
    return
  }

  if (subscriptions.notifications) {
    return
  }

  subscriptions.notifications = onSnapshot(collection(db, NOTIFICATION_COLLECTION), (snapshot) => {
    state.notifications = snapshot.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }))
      .sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt))
    render()
  })
}

function setupMermasStream() {
  if (!db || !state.user || !isAuthorizedUser()) {
    subscriptions.mermas?.()
    subscriptions.mermas = null
    state.mermas = []
    return
  }

  subscriptions.mermas?.()
  subscriptions.mermas = onSnapshot(collection(db, 'mermas'), (snapshot) => {
    state.mermas = snapshot.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }))
      .sort((left, right) => {
        const leftTime = toMillis(left.registradoEn)
        const rightTime = toMillis(right.registradoEn)
        return rightTime - leftTime
      })
    render()
  })
}

function setupShiftsStream() {
  if (!db || !state.user || !isAuthorizedUser()) {
    subscriptions.shifts?.()
    subscriptions.shifts = null
    state.shifts = []
    return
  }

  subscriptions.shifts?.()
  subscriptions.shifts = onSnapshot(collection(db, 'shifts'), (snapshot) => {
    state.shifts = snapshot.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }))
      .sort((left, right) => {
        const leftTime = toMillis(right.fechaInicio)
        const rightTime = toMillis(left.fechaInicio)
        return rightTime - leftTime
      })

    // Si hay un turno abierto del usuario actual, sincronizarlo
    const openShift = state.shifts.find(
      (s) => s.estado === 'abierto' && s.vendedorEmail === getUserEmail(),
    )
    if (openShift && !state.currentShift) {
      state.currentShift = {
        id: openShift.id,
        estado: 'abierto',
        efectivoInicial: openShift.efectivoInicial,
        ventasRegistradas: openShift.ventasRegistradas,
      }
    }

    render()
  })
}

function setupPublicSettingsStream() {
  if (!db) {
    loadingReadiness.settingsReady = true
    evaluateLoadingState()
    return
  }

  subscriptions.settings?.()
  subscriptions.settings = onSnapshot(doc(db, 'app_config', 'public_profile'), (snapshot) => {
    const payload = snapshot.exists() ? snapshot.data() : null
    state.settings = normalizePublicSettings(payload)

    if (!loadingReadiness.settingsReady) {
      loadingReadiness.settingsReady = true
      evaluateLoadingState()
    }

    render()
  }, () => {
    if (!loadingReadiness.settingsReady) {
      loadingReadiness.settingsReady = true
      evaluateLoadingState()
      render()
    }
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
    subscriptions.notifications?.()
    subscriptions.pedidos = null
    subscriptions.inventario = null
    subscriptions.notifications = null
    state.pedidos = []
    state.inventario = []
    state.inventorySearch = ''
    state.inventorySelectedId = null
    state.inventoryDraft = createDefaultInventoryDraft()
    state.inventoryDraftDirty = false
    state.inventoryDraftSourceId = null
    state.inventoryMobileView = 'list'
    state.notifications = []
    knownPedidoIds = new Set()
    lowStockAlertedIds = new Set()
    inventoryAlertsPrimed = false
  } else {
    if (!subscriptions.pedidos) {
      subscriptions.pedidos = onSnapshot(collection(db, 'pedidos'), (snapshot) => {
        const nextPedidos = snapshot.docs
          .map((entry) => ({ id: entry.id, ...entry.data() }))
          .sort((left, right) => toMillis(right.creadoEn) - toMillis(left.creadoEn))
        syncNewOrderNotifications(nextPedidos)
        state.pedidos = nextPedidos
        render()
      })
    }

    if (!subscriptions.inventario) {
      subscriptions.inventario = onSnapshot(collection(db, 'inventario'), (snapshot) => {
        const nextInventory = snapshot.docs
          .map((entry) => ({ id: entry.id, ...entry.data() }))
          .sort((left, right) => (left.nombre || '').localeCompare(right.nombre || '', 'es'))
        state.inventario = nextInventory
        syncInventorySelectionFromData()
        syncLowStockNotifications(nextInventory)
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

  setupNotificationsStream()
  setupMermasStream()
  setupShiftsStream()
}

function attachEvents() {
  document.addEventListener('click', async (event) => {
    // Cerrar modales al clickear overlay
    if (event.target.classList.contains('modal-overlay')) {
      if (state.shiftOpenModalOpen) {
        state.shiftOpenModalOpen = false
        render()
        return
      }
      if (state.shiftCloseModalOpen) {
        state.shiftCloseModalOpen = false
        render()
        return
      }
      if (state.cashOutflowModalOpen) {
        state.cashOutflowModalOpen = false
        render()
        return
      }
      if (state.wasteModalOpen) {
        state.wasteModalOpen = false
        render()
        return
      }
    }

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
      if (getAvailableEditorTabs().includes(nextTab)) {
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
      await saveSelectedInventoryDraft()
      return
    }

    if (action === 'open-ingredient-create-modal') {
      state.inventorySelectedId = 'new'
      state.inventoryDraft = createDefaultInventoryDraft()
      state.inventoryDraftSourceId = 'new'
      state.inventoryDraftDirty = false
      state.inventoryMobileView = 'detail'
      render()
      return
    }

    if (action === 'close-ingredient-create-modal') {
      cancelInventoryDraft()
      render()
      return
    }

    if (action === 'select-inventory-item') {
      const ingredientId = actionNode.dataset.id
      if (!ingredientId) {
        return
      }

      state.inventorySelectedId = ingredientId
      syncInventorySelectionFromData(true)
      state.inventoryMobileView = 'detail'
      render()
      return
    }

    if (action === 'inventory-back-to-list') {
      state.inventoryMobileView = 'list'
      render()
      return
    }

    if (action === 'toggle-inventory-usage') {
      state.inventoryDraft.en_uso = !state.inventoryDraft.en_uso
      state.inventoryDraftDirty = true
      render()
      return
    }

    if (action === 'save-inventory-draft') {
      await saveSelectedInventoryDraft()
      return
    }

    if (action === 'cancel-inventory-draft') {
      cancelInventoryDraft()
      render()
      return
    }

    if (action === 'delete-inventory-item') {
      const selectedId = state.inventorySelectedId
      if (!selectedId || selectedId === 'new' || !db) {
        return
      }

      await deleteDoc(doc(db, 'inventario', selectedId))
      pushNotice('Insumo eliminado.')
      state.inventorySelectedId = null
      state.inventoryDraftDirty = false
      state.inventoryDraftSourceId = null
      state.inventoryDraft = createDefaultInventoryDraft()
      state.inventoryMobileView = 'list'
      render()
      return
    }

    if (action === 'toggle-ingredient-create-usage') {
      const usageInput = document.querySelector('[data-new-ingredient-usage]')
      const usageLabel = document.querySelector('[data-new-ingredient-usage-label]')
      if (!usageInput || !usageLabel) {
        return
      }

      const nextValue = usageInput.value !== 'true'
      usageInput.value = nextValue ? 'true' : 'false'
      usageLabel.textContent = nextValue ? 'En uso' : 'Sin uso'
      actionNode.dataset.value = nextValue ? 'true' : 'false'
      actionNode.classList.toggle('is-active', nextValue)
      actionNode.setAttribute('aria-pressed', nextValue ? 'true' : 'false')
      return
    }

    if (action === 'toggle-stock-usage') {
      const isActive = actionNode.dataset.value === 'true'
      const nextValue = !isActive
      actionNode.dataset.value = nextValue ? 'true' : 'false'
      actionNode.classList.toggle('is-active', nextValue)
      actionNode.setAttribute('aria-pressed', nextValue ? 'true' : 'false')
      const textNode = actionNode.querySelector('.status-toggle__text')
      if (textNode) {
        textNode.textContent = nextValue ? 'En uso' : 'Sin uso'
      }
      return
    }

    if (action === 'toggle-menu-create-active') {
      const activeInput = document.querySelector('[data-menu-create-active]')
      const activeLabel = document.querySelector('[data-menu-create-active-label]')
      if (!activeInput || !activeLabel) {
        return
      }

      const nextValue = activeInput.value !== 'true'
      activeInput.value = nextValue ? 'true' : 'false'
      state.menuFormDraft.activo = nextValue
      activeLabel.textContent = nextValue ? 'Visible en menu publico' : 'Oculto del menu publico'
      actionNode.dataset.value = nextValue ? 'true' : 'false'
      actionNode.classList.toggle('is-active', nextValue)
      actionNode.setAttribute('aria-pressed', nextValue ? 'true' : 'false')
      return
    }

    if (action === 'toggle-menu-edit-active') {
      const activeInput = document.querySelector('[data-menu-edit-active]')
      const activeLabel = document.querySelector('[data-menu-edit-active-label]')
      if (!activeInput || !activeLabel) {
        return
      }

      const nextValue = activeInput.value !== 'true'
      activeInput.value = nextValue ? 'true' : 'false'
      state.menuFormDraft.activo = nextValue
      activeLabel.textContent = nextValue ? 'Visible en menu publico' : 'Oculto del menu publico'
      actionNode.dataset.value = nextValue ? 'true' : 'false'
      actionNode.classList.toggle('is-active', nextValue)
      actionNode.setAttribute('aria-pressed', nextValue ? 'true' : 'false')
      return
    }

    if (action === 'add-recipe-row') {
      const rows = state.recipeDraft.rows || []
      const pendingRow = rows.find((row) => !row.saved)
      if (pendingRow) {
        pendingRow.mode = 'existing'
      } else {
        state.recipeDraft.rows = [...rows, createRecipeRow('existing')]
      }
      syncRecipePreview()
      render()
      return
    }

    if (action === 'add-recipe-new-row') {
      const rows = state.recipeDraft.rows || []
      const pendingRow = rows.find((row) => !row.saved)
      if (pendingRow) {
        pendingRow.mode = 'new'
      } else {
        state.recipeDraft.rows = [...rows, createRecipeRow('new')]
      }
      syncRecipePreview()
      render()
      return
    }

    if (action === 'save-recipe-row') {
      const rowId = actionNode.dataset.rowId
      const row = (state.recipeDraft.rows || []).find((entry) => entry.rowId === rowId)
      if (!row) {
        return
      }

      const validationMessage = getRecipeRowValidationMessage(row)
      if (validationMessage) {
        pushNotice(validationMessage)
        render()
        return
      }

      row.saved = true
      syncRecipePreview()
      render()
      return
    }

    if (action === 'edit-recipe-row') {
      const rowId = actionNode.dataset.rowId
      const row = (state.recipeDraft.rows || []).find((entry) => entry.rowId === rowId)
      if (!row) {
        return
      }

      const pendingRow = (state.recipeDraft.rows || []).find((entry) => !entry.saved && entry.rowId !== rowId)
      if (pendingRow) {
        pushNotice('Guarda o elimina el insumo en captura antes de editar otro.')
        render()
        return
      }

      row.saved = false
      syncRecipePreview()
      render()
      return
    }

    if (action === 'remove-recipe-row') {
      const rowId = actionNode.dataset.rowId
      state.recipeDraft.rows = state.recipeDraft.rows.filter((row) => row.rowId !== rowId)
      if (state.recipeDraft.rows.length === 0) {
        state.recipeDraft.rows = [createRecipeRow('existing')]
      }
      syncRecipePreview()
      render()
      return
    }

    if (action === 'edit-menu-item') {
      state.editingMenuId = actionNode.dataset.id || null
      state.menuCreateModalOpen = false
      state.recipeDraft = buildRecipeDraftFromMenu(getMenuEditorItem())
      state.menuFormDraft = createDefaultMenuFormDraft(getMenuEditorItem())
      state.menuPriceDraft = String(getMenuEditorItem()?.precio ?? '')
      render()
      return
    }

    if (action === 'open-menu-create-modal') {
      state.menuCreateModalOpen = true
      state.editingMenuId = null
      state.menuFormDraft = createDefaultMenuFormDraft()
      state.menuPriceDraft = ''
      state.recipeDraft = createDefaultRecipeDraft()
      render()
      return
    }

    if (action === 'open-combo-create-modal') {
      state.comboCreateModalOpen = true
      state.editingComboId = null
      state.comboDraft = createDefaultComboDraft()
      render()
      return
    }

    if (action === 'close-menu-create-modal') {
      state.menuCreateModalOpen = false
      state.menuFormDraft = createDefaultMenuFormDraft()
      state.recipeDraft = createDefaultRecipeDraft()
      state.menuPriceDraft = ''
      render()
      return
    }

    if (action === 'close-combo-modal') {
      state.comboCreateModalOpen = false
      state.editingComboId = null
      state.comboDraft = createDefaultComboDraft()
      render()
      return
    }

    if (action === 'close-menu-modal') {
      state.editingMenuId = null
      state.menuFormDraft = createDefaultMenuFormDraft()
      state.recipeDraft = createDefaultRecipeDraft()
      state.menuPriceDraft = ''
      render()
      return
    }

    if (action === 'toggle-notifications-panel') {
      state.notificationPanelOpen = !state.notificationPanelOpen
      render()
      return
    }

    if (action === 'close-notifications-panel') {
      state.notificationPanelOpen = false
      render()
      return
    }

    if (action === 'mark-notification-read') {
      const notificationId = actionNode.dataset.id
      if (!notificationId || !db) {
        return
      }

      await updateDoc(doc(db, NOTIFICATION_COLLECTION, notificationId), {
        readAt: serverTimestamp(),
      })
      return
    }

    if (action === 'edit-combo') {
      const comboId = actionNode.dataset.id
      const combo = state.combos.find((entry) => entry.id === comboId)
      if (!combo) {
        return
      }

      state.editingComboId = comboId
      state.comboCreateModalOpen = true
      state.comboDraft = buildComboDraftFromCombo(combo)
      render()
      return
    }

    if (action === 'toggle-combo-item') {
      const itemId = actionNode.dataset.id
      if (!itemId) {
        return
      }

      const currentIds = new Set(state.comboDraft.selectedIds)
      if (currentIds.has(itemId)) {
        currentIds.delete(itemId)
      } else {
        currentIds.add(itemId)
      }

      state.comboDraft.selectedIds = Array.from(currentIds)
      render()
      return
    }

    if (action === 'delete-combo') {
      const comboId = actionNode.dataset.id
      if (!comboId) {
        return
      }

      await deleteDoc(doc(db, COMBO_COLLECTION, comboId))
      if (state.editingComboId === comboId) {
        state.editingComboId = null
        state.comboCreateModalOpen = false
        state.comboDraft = createDefaultComboDraft()
      }
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
      render()
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

    // ===== MANEJO DE MODALES DE TURNOS Y MERMAS =====

    if (action === 'open-shift-open-modal') {
      state.shiftOpenModalOpen = true
      state.shiftOpenDraft = { efectivoInicial: '', notasInicio: '' }
      render()
      return
    }

    if (action === 'close-shift-open-modal' || action === 'close-modal-overlay' && event.target.matches('.modal-overlay')) {
      state.shiftOpenModalOpen = false
      render()
      return
    }

    if (action === 'open-shift-close-modal') {
      state.shiftCloseModalOpen = true
      state.shiftCloseDraft = { efectivoFinal: '', notasCierre: '' }
      render()
      return
    }

    if (action === 'close-shift-close-modal') {
      state.shiftCloseModalOpen = false
      render()
      return
    }

    if (action === 'open-cash-outflow-modal') {
      state.cashOutflowModalOpen = true
      state.cashOutflowDraft = { monto: '', razon: 'compra_insumos', items: '' }
      render()
      return
    }

    if (action === 'close-cash-outflow-modal') {
      state.cashOutflowModalOpen = false
      render()
      return
    }

    if (action === 'set-outflow-reason') {
      const reason = actionNode.dataset.reason
      if (reason) {
        state.cashOutflowDraft.razon = reason
        render()
      }
      return
    }

    if (action === 'open-waste-modal') {
      state.wasteModalOpen = true
      state.wasteModalState = {
        ingredientSearch: '',
        selectedIngredient: null,
        cantidadDraft: '',
        unidadDraft: 'g',
        razonDraft: 'error_cocina',
      }
      render()
      return
    }

    if (action === 'close-waste-modal') {
      state.wasteModalOpen = false
      render()
      return
    }

    if (action === 'waste-select-ingredient') {
      const ingredientId = actionNode.dataset.id
      const ingredient = state.inventario.find((i) => i.id === ingredientId)
      if (ingredient) {
        state.wasteModalState.selectedIngredient = ingredient
        state.wasteModalState.cantidadDraft = ''
        render()
      }
      return
    }

    if (action === 'clear-waste-ingredient') {
      state.wasteModalState.selectedIngredient = null
      state.wasteModalState.cantidadDraft = ''
      render()
      return
    }

    if (action === 'waste-set-reason') {
      const reason = actionNode.dataset.reason
      if (reason) {
        state.wasteModalState.razonDraft = reason
        render()
      }
      return
    }

    if (action === 'submit-shift-open') {
      const formNode = document.querySelector('[data-form="shift-open"]')
      if (!formNode) {
        return
      }
      const formData = new FormData(formNode)
      const efectivoInicial = Number(formData.get('efectivoInicial') || 0)
      const notasInicio = String(formData.get('notasInicio') || '').trim()

      openShift(efectivoInicial, notasInicio)
      state.shiftOpenModalOpen = false
      render()
      return
    }

    if (action === 'submit-shift-close') {
      const formNode = document.querySelector('[data-form="shift-close"]')
      if (!formNode) {
        return
      }
      const formData = new FormData(formNode)
      const efectivoFinal = Number(formData.get('efectivoFinal') || 0)
      const notasCierre = String(formData.get('notasCierre') || '').trim()

      closeShift(efectivoFinal, notasCierre)
      state.shiftCloseModalOpen = false
      render()
      return
    }

    if (action === 'submit-cash-outflow') {
      if (!state.currentShift?.id) {
        pushNotice('No hay turno abierto.')
        return
      }

      const formNode = document.querySelector('[data-form="cash-outflow"]')
      if (!formNode) {
        return
      }

      const formData = new FormData(formNode)
      const monto = Number(formData.get('monto') || 0)
      const razon = String(formData.get('razon') || 'otro').trim()
      const items = String(formData.get('items') || '').trim()

      if (monto <= 0) {
        pushNotice('Ingresa un monto válido.')
        return
      }

      registerEmergencyCashOutflow(monto, razon, items ? items.split(',').map((s) => s.trim()) : [])
      state.cashOutflowModalOpen = false
      render()
      return
    }

    if (action === 'submit-waste-entry') {
      if (!state.currentShift?.id) {
        pushNotice('No hay turno abierto.')
        return
      }

      const wasteState = state.wasteModalState
      if (!wasteState.selectedIngredient) {
        pushNotice('Selecciona un insumo.')
        return
      }

      const cantidad = Number(wasteState.cantidadDraft || 0)
      if (cantidad <= 0) {
        pushNotice('Ingresa una cantidad válida.')
        return
      }

      registerWaste(wasteState.selectedIngredient.id, cantidad, wasteState.razonDraft)
      state.wasteModalOpen = false
      render()
      return
    }
  })

  document.addEventListener('submit', async (event) => {
    if (event.target.matches('[data-form="menu-item-create"]')) {
      event.preventDefault()
      await saveMenuItem(new FormData(event.target), null)
      event.target.reset()
      return
    }

    if (event.target.matches('[data-form="menu-item-edit"]')) {
      event.preventDefault()
      await saveMenuItem(new FormData(event.target), state.editingMenuId)
      event.target.reset()
      return
    }

    if (event.target.matches('[data-form="combo-save"]')) {
      event.preventDefault()
      await saveCombo(new FormData(event.target))
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

    if (event.target.matches('[data-form="advanced-settings"]')) {
      event.preventDefault()
      await saveAdvancedSettings(new FormData(event.target))
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

    if (event.target.matches('[data-order-service]')) {
      const nextService = event.target.value || 'mesa'
      if (!ORDER_SERVICE_TYPES.includes(nextService)) {
        return
      }
      state.orderDraft.serviceType = nextService
      render()
      return
    }

    if (event.target.matches('[data-order-service-field]')) {
      const group = event.target.dataset.group
      const field = event.target.dataset.field
      if (!group || !field || !state.orderDraft[group] || typeof state.orderDraft[group] !== 'object') {
        return
      }
      state.orderDraft[group][field] = event.target.value || ''
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
      return
    }

    if (event.target.matches('[data-inventory-search]')) {
      state.inventorySearch = event.target.value || ''
      render()
      return
    }

    if (event.target.matches('[data-inventory-field]')) {
      const field = event.target.dataset.inventoryField
      if (!field) {
        return
      }

      const isCheckbox = event.target.type === 'checkbox'
      state.inventoryDraft[field] = isCheckbox ? event.target.checked : event.target.value || ''
      state.inventoryDraftDirty = true
      return
    }

    if (event.target.matches('[data-menu-price]')) {
      state.menuPriceDraft = event.target.value || ''
      syncRecipePreview()
      return
    }

    if (event.target.matches('[data-menu-field]')) {
      const field = event.target.dataset.menuField
      if (!field) {
        return
      }

      state.menuFormDraft[field] = event.target.value || ''
      return
    }

    if (event.target.matches('[data-recipe-search]')) {
      state.recipeDraft.search = event.target.value || ''
      syncRecipePreview()
      return
    }

    if (event.target.matches('[data-recipe-field]')) {
      const rowId = event.target.dataset.rowId
      const field = event.target.dataset.field
      if (!rowId || !field) {
        return
      }

      const row = state.recipeDraft.rows.find((entry) => entry.rowId === rowId)
      if (!row) {
        return
      }

      row[field] = event.target.value || ''
      syncRecipePreview()
      return
    }

    if (event.target.matches('[data-recipe-row-mode]')) {
      const rowId = event.target.dataset.rowId
      const row = state.recipeDraft.rows.find((entry) => entry.rowId === rowId)
      if (!row) {
        return
      }

      row.mode = event.target.value === 'new' ? 'new' : 'existing'
      syncRecipePreview()
      render()
      return
    }

    if (event.target.matches('[data-combo-search]')) {
      state.comboDraft.search = event.target.value || ''
      render()
      return
    }

    if (event.target.matches('[data-combo-field]')) {
      const field = event.target.dataset.comboField
      if (!field) {
        return
      }

      state.comboDraft[field] = event.target.value || ''
      return
    }

    if (event.target.matches('[name^="day_closed_"]')) {
      const dayKey = event.target.name.replace('day_closed_', '')
      const row = event.target.closest('.settings-day-row')
      if (row) {
        row.classList.toggle('is-closed', event.target.checked)
      }
      const openInput = document.querySelector(`[name="day_open_${dayKey}"]`)
      const closeInput = document.querySelector(`[name="day_close_${dayKey}"]`)
      if (openInput) {
        openInput.disabled = event.target.checked
      }
      if (closeInput) {
        closeInput.disabled = event.target.checked
      }
    }

    const advancedSettingsForm = event.target.closest('[data-form="advanced-settings"]')
    if (advancedSettingsForm) {
      syncAdvancedSettingsSubmitState(advancedSettingsForm)
    }

    // ===== INPUTS DE MODALES DE TURNOS Y MERMAS =====

    if (event.target.matches('[data-form="shift-open"] input, [data-form="shift-open"] textarea')) {
      const name = event.target.name
      if (name === 'efectivoInicial') {
        state.shiftOpenDraft.efectivoInicial = event.target.value || ''
      } else if (name === 'notasInicio') {
        state.shiftOpenDraft.notasInicio = event.target.value || ''
      }
      return
    }

    if (event.target.matches('[data-form="shift-close"] input, [data-form="shift-close"] textarea')) {
      const name = event.target.name
      if (name === 'efectivoFinal') {
        state.shiftCloseDraft.efectivoFinal = event.target.value || ''
      } else if (name === 'notasCierre') {
        state.shiftCloseDraft.notasCierre = event.target.value || ''
      }
      return
    }

    if (event.target.matches('[data-form="cash-outflow"] input')) {
      const name = event.target.name
      if (name === 'monto') {
        state.cashOutflowDraft.monto = event.target.value || ''
      } else if (name === 'items') {
        state.cashOutflowDraft.items = event.target.value || ''
      }
      return
    }

    if (event.target.dataset.action === 'waste-search-ingredients') {
      state.wasteModalState.ingredientSearch = event.target.value || ''
      render()
      return
    }

    if (event.target.dataset.action === 'waste-set-cantidad') {
      state.wasteModalState.cantidadDraft = event.target.value || ''
      return
    }
  })

  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-inventory-field]')) {
      const inventoryField = event.target.dataset.inventoryField
      if (!inventoryField) {
        return
      }

      const isCheckbox = event.target.type === 'checkbox'
      state.inventoryDraft[inventoryField] = isCheckbox ? event.target.checked : event.target.value || ''
      state.inventoryDraftDirty = true
      return
    }

    if (!event.target.matches('[data-menu-field]')) {
      return
    }

    const field = event.target.dataset.menuField
    if (!field) {
      return
    }

    state.menuFormDraft[field] = event.target.value || ''
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
  const stockMinimo = Number(formData.get('stockMinimo') || 0)
  const unidadPaquete = normalizeInventoryUnit(formData.get('unidadPaquete') || formData.get('unidad') || 'pza')
  const cantidadPaquete = Number(formData.get('cantidadPaquete') || 0)
  const precioPaquete = Number(formData.get('precioPaquete') || 0)
  const enUso = String(formData.get('en_uso') || 'true') === 'true'

  if (!nombre) {
    pushNotice('Escribe un nombre para el insumo.')
    render()
    return
  }

  if (!precioPaquete || !cantidadPaquete) {
    pushNotice('Captura precio por paquete y cantidad del paquete.')
    render()
    return
  }

  const cantidadPaqueteBase = convertInventoryQuantity(cantidadPaquete, unidadPaquete)
  const costoUnitarioBase = cantidadPaqueteBase > 0 ? precioPaquete / cantidadPaqueteBase : 0

  await addDoc(collection(db, 'inventario'), {
    nombre,
    stock,
    stockMinimo,
    unidad: getInventoryBaseUnit(unidadPaquete),
    unidadBase: getInventoryBaseUnit(unidadPaquete),
    unidadPaquete,
    cantidadPaquete,
    precioPaquete,
    costoUnitarioBase,
    costoUnitarioTexto: `${currency(costoUnitarioBase)} / ${formatInventoryUnit(getInventoryBaseUnit(unidadPaquete))}`,
    en_uso: enUso,
    alertaActiva: false,
    actualizadoEn: serverTimestamp(),
    creadoEn: serverTimestamp(),
  })

  state.ingredientCreateModalOpen = false
  pushNotice('Ingrediente agregado.')
  render()
}

async function createPedido(formData) {
  if (!db) {
    pushNotice('Firebase no esta configurado todavia.')
    render()
    return
  }

  const serviceType = state.orderDraft.serviceType || 'mesa'
  const mesa = state.orderDraft.mesa || formData.get('mesa')?.toString().trim()
  const platillos = state.orderDraft.items
  const total = getOrderDraftTotal()

  if (platillos.length === 0) {
    pushNotice('Agrega al menos un platillo a la comanda.')
    render()
    return
  }

  if (serviceType === 'mesa' && !mesa) {
    pushNotice('Selecciona la mesa para continuar.')
    render()
    return
  }

  if (serviceType === 'domicilio') {
    const delivery = state.orderDraft.delivery
    const deliveryFields = [
      delivery.calle,
      delivery.numeroCasa,
      delivery.entreCalles,
      delivery.horaEntrega,
      delivery.telefono,
      delivery.nombreCliente,
    ]
    if (deliveryFields.some((value) => !String(value || '').trim())) {
      pushNotice('Completa los datos de entrega a domicilio.')
      render()
      return
    }
  }

  if (serviceType === 'recoger') {
    const pickup = state.orderDraft.pickup
    const pickupFields = [pickup.nombre, pickup.apellido, pickup.telefono, pickup.horaRecoger]
    if (pickupFields.some((value) => !String(value || '').trim())) {
      pushNotice('Completa los datos de recoger pedido.')
      render()
      return
    }
  }

  const serviceDetails = getOrderServiceDetails()
  if (!serviceDetails) {
    pushNotice('No pudimos preparar el tipo de servicio del pedido.')
    render()
    return
  }

  await addDoc(collection(db, 'pedidos'), {
    mesa: serviceDetails.label,
    tipoServicio: serviceType,
    detalleServicio: serviceDetails.payload,
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
    shiftId: state.currentShift?.id || null,
    tomadoEn: serverTimestamp(),
    creadoEn: serverTimestamp(),
    actualizadoEn: serverTimestamp(),
  })

  // ✅ NUEVO: Descontar inventario automáticamente
  await deductInventoryFromOrder(platillos)

  state.orderDraft.items = []
  state.orderDraft.editingItemId = null
  state.orderDraft.query = ''
  state.orderDraft.mesa = ''
  state.orderDraft.serviceType = 'mesa'
  state.orderDraft.delivery = {
    calle: '',
    numeroCasa: '',
    entreCalles: '',
    horaEntrega: '',
    telefono: '',
    nombreCliente: '',
  }
  state.orderDraft.pickup = {
    nombre: '',
    apellido: '',
    telefono: '',
    horaRecoger: '',
  }
}

function getOrderServiceDetails() {
  const serviceType = state.orderDraft.serviceType || 'mesa'

  if (serviceType === 'mesa') {
    const mesa = String(state.orderDraft.mesa || '').trim()
    return {
      label: mesa ? `Mesa ${mesa}` : 'Mesa',
      payload: {
        mesa,
      },
    }
  }

  if (serviceType === 'domicilio') {
    const delivery = state.orderDraft.delivery
    return {
      label: 'Domicilio',
      payload: {
        calle: String(delivery.calle || '').trim(),
        numeroCasa: String(delivery.numeroCasa || '').trim(),
        entreCalles: String(delivery.entreCalles || '').trim(),
        horaEntrega: String(delivery.horaEntrega || '').trim(),
        telefono: String(delivery.telefono || '').trim(),
        nombreCliente: String(delivery.nombreCliente || '').trim(),
      },
    }
  }

  if (serviceType === 'recoger') {
    const pickup = state.orderDraft.pickup
    return {
      label: 'Recoger',
      payload: {
        nombre: String(pickup.nombre || '').trim(),
        apellido: String(pickup.apellido || '').trim(),
        telefono: String(pickup.telefono || '').trim(),
        horaRecoger: String(pickup.horaRecoger || '').trim(),
      },
    }
  }

  return null
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

async function saveMenuItem(formData, editingId = state.editingMenuId) {
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
  const activo = String(formData.get('activo') || 'true') === 'true'
  const salePrice = Number.isNaN(precio) ? 0 : precio
  const recipeRows = (state.recipeDraft.rows || []).filter((row) => row.saved)
  const pendingRows = (state.recipeDraft.rows || []).filter((row) => !row.saved && !isRecipeRowEmpty(row))

  if (!nombre || !descripcion || !categoria || Number.isNaN(precio)) {
    pushNotice('Completa nombre, descripcion, precio y categoria.')
    render()
    return
  }

  if (pendingRows.length > 0) {
    pushNotice('Guarda o elimina el insumo que estas capturando antes de guardar el platillo.')
    render()
    return
  }

  const resolvedRecipe = []
  for (const row of recipeRows) {
    if (row.mode === 'existing') {
      const ingredient = state.inventario.find((item) => item.id === row.ingredientId)
      if (!ingredient) {
        continue
      }

      resolvedRecipe.push({
        ingredientId: ingredient.id,
        nombre: ingredient.nombre || '',
        cantidad: Number(row.cantidad || 0),
        unidad: normalizeInventoryUnit(row.unidad || ingredient.unidadBase || ingredient.unidadPaquete || ingredient.unidad),
        precioPaquete: Number(ingredient.precioPaquete || 0),
        cantidadPaquete: Number(ingredient.cantidadPaquete || 0),
        unidadPaquete: ingredient.unidadPaquete || ingredient.unidadBase || ingredient.unidad || 'g',
        costoUnitarioBase: Number(ingredient.costoUnitarioBase || getIngredientUnitCost(ingredient) || 0),
        costoLinea: getRecipeLineCost(row, ingredient),
      })
      continue
    }

    const nombreInsumo = String(row.nombre || '').trim()
    if (!nombreInsumo) {
      continue
    }

    const existingIngredient = state.inventario.find(
      (item) => (item.nombre || '').trim().toLowerCase() === nombreInsumo.toLowerCase(),
    )

    let ingredientId = existingIngredient?.id || ''
    let ingredientPayload = existingIngredient || null

    if (!ingredientId) {
      const purchaseUnit = normalizeInventoryUnit(row.unidadPaquete || row.unidad || 'g')
      const purchaseQuantity = Number(row.cantidadPaquete || 0)
      const purchasePrice = Number(row.precioPaquete || 0)
      const stock = Number(row.stock || 0)
      const stockMinimo = Number(row.stockMinimo || 0)
      const cantidadPaqueteBase = convertInventoryQuantity(purchaseQuantity, purchaseUnit)

      if (!purchasePrice || !purchaseQuantity || cantidadPaqueteBase <= 0) {
        pushNotice(`Completa precio y cantidad del paquete para ${nombreInsumo}.`)
        render()
        return
      }

      ingredientPayload = {
        nombre: nombreInsumo,
        stock,
        stockMinimo,
        unidad: getInventoryBaseUnit(purchaseUnit),
        unidadBase: getInventoryBaseUnit(purchaseUnit),
        unidadPaquete: purchaseUnit,
        cantidadPaquete: purchaseQuantity,
        precioPaquete: purchasePrice,
        costoUnitarioBase: purchasePrice / cantidadPaqueteBase,
        costoUnitarioTexto: `${currency(purchasePrice / cantidadPaqueteBase)} / ${formatInventoryUnit(getInventoryBaseUnit(purchaseUnit))}`,
        en_uso: true,
        actualizadoEn: serverTimestamp(),
        creadoEn: serverTimestamp(),
      }

      const createdIngredient = await addDoc(collection(db, 'inventario'), ingredientPayload)
      ingredientId = createdIngredient.id
    }

    const unit = normalizeInventoryUnit(row.unidad || ingredientPayload?.unidadBase || ingredientPayload?.unidadPaquete || 'g')
    resolvedRecipe.push({
      ingredientId,
      nombre: nombreInsumo,
      cantidad: Number(row.cantidad || 0),
      unidad: unit,
      precioPaquete: Number(ingredientPayload?.precioPaquete || 0),
      cantidadPaquete: Number(ingredientPayload?.cantidadPaquete || 0),
      unidadPaquete: ingredientPayload?.unidadPaquete || unit,
      costoUnitarioBase: Number(ingredientPayload?.costoUnitarioBase || getIngredientUnitCost(ingredientPayload) || 0),
      costoLinea: getRecipeLineCost(row, ingredientPayload || { costoUnitarioBase: getIngredientUnitCost(ingredientPayload) }),
    })
  }

  if (recipeRows.length > 0 && resolvedRecipe.length === 0) {
    pushNotice('Si agregas renglones de receta, captura al menos un insumo valido o elimina los renglones vacios.')
    render()
    return
  }

  const costoTotal = resolvedRecipe.reduce((sum, item) => sum + Number(item.costoLinea || 0), 0)
  const gananciaNeta = salePrice - costoTotal
  const margenPorcentaje = salePrice > 0 ? (gananciaNeta / salePrice) * 100 : 0

  const payload = {
    nombre,
    descripcion,
    precio,
    categoria,
    ingredientes,
    receta: resolvedRecipe,
    costoTotal,
    gananciaNeta,
    margenPorcentaje,
    costoPorPlato: costoTotal,
    gananciaReal: gananciaNeta,
    activo,
    actualizadoEn: serverTimestamp(),
  }

  if (editingId) {
    await updateDoc(doc(db, 'menu', editingId), payload)
    pushNotice('Platillo actualizado.')
  } else {
    await addDoc(collection(db, 'menu'), {
      ...payload,
      creadoEn: serverTimestamp(),
    })
    state.menuCreateModalOpen = false
    pushNotice('Platillo agregado.')
  }

  state.editingMenuId = null
  state.menuFormDraft = createDefaultMenuFormDraft()
  state.menuPriceDraft = ''
  state.recipeDraft = createDefaultRecipeDraft()
  render()
}

async function saveCombo(formData) {
  if (!db) {
    pushNotice('Firebase no esta configurado todavia.')
    render()
    return
  }

  const nombre = formData.get('nombre')?.toString().trim()
  const descripcion = formData.get('descripcion')?.toString().trim()
  const precioCombo = Number(formData.get('precioCombo') || 0)
  const selectedItems = getComboDraftSelectedItems()

  if (!nombre || !descripcion || selectedItems.length === 0 || Number.isNaN(precioCombo)) {
    pushNotice('Completa nombre, descripcion, selecciona componentes y define el precio del combo.')
    render()
    return
  }

  const componentes = selectedItems.map((item) => ({
    id: item.id,
    nombre: item.nombre || '',
    precio: Number(item.precio || 0),
    categoria: item.categoria || '',
  }))
  const precioOriginalTotal = componentes.reduce((sum, item) => sum + Number(item.precio || 0), 0)
  const existingCombo = state.editingComboId ? getComboEditorItem() : null
  const payload = {
    nombre,
    descripcion,
    precioCombo,
    precioOriginalTotal,
    ahorro: Math.max(precioOriginalTotal - precioCombo, 0),
    componentIds: componentes.map((item) => item.id),
    componentes,
    activo: existingCombo ? existingCombo.activo !== false : true,
    actualizadoEn: serverTimestamp(),
  }

  if (state.editingComboId) {
    await updateDoc(doc(db, COMBO_COLLECTION, state.editingComboId), payload)
    pushNotice('Combo actualizado.')
  } else {
    await addDoc(collection(db, COMBO_COLLECTION), {
      ...payload,
      creadoEn: serverTimestamp(),
    })
    pushNotice('Combo agregado.')
  }

  state.comboCreateModalOpen = false
  state.editingComboId = null
  state.comboDraft = createDefaultComboDraft()
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

function getAvailableEditorTabs() {
  return EDITOR_TABS.filter((tab) => !ADMIN_ONLY_EDITOR_TABS.has(tab) || canManageAccess())
}

function isBootstrapAdmin(user = state.user) {
  return bootstrapAdminEmails.has(getUserEmail(user))
}

function createDefaultPublicSettings() {
  const menuCategoriesEnabled = {}
  for (const category of ADVANCED_MENU_CATEGORIES) {
    menuCategoriesEnabled[category] = true
  }

  const schedule = {}
  for (const day of WEEK_DAYS) {
    schedule[day.key] = {
      open: '08:00',
      close: '14:00',
      closed: day.key === 'lunes',
    }
  }

  return {
    menuCategoriesEnabled,
    contact: {
      telefono: '',
      whatsapp: '',
      direccion: '',
      instagram: '',
      facebook: '',
      tiktok: '',
    },
    schedule,
  }
}

function createDefaultComboDraft() {
  return {
    nombre: '',
    descripcion: '',
    search: '',
    selectedIds: [],
    precioCombo: '',
  }
}

function createDefaultMenuFormDraft(menuItem = null) {
  return {
    nombre: menuItem?.nombre || '',
    descripcion: menuItem?.descripcion || '',
    categoria: menuItem?.categoria || '',
    activo: menuItem?.activo !== false,
  }
}

function createDefaultInventoryDraft(item = null) {
  const packageUnit = normalizeInventoryUnit(item?.unidadPaquete || item?.unidadBase || item?.unidad || 'pza')
  return {
    nombre: item?.nombre || '',
    stock: String(item?.stock ?? 0),
    stockMinimo: String(item?.stockMinimo ?? 0),
    precioPaquete: String(item?.precioPaquete ?? ''),
    cantidadPaquete: String(item?.cantidadPaquete ?? ''),
    unidadPaquete: packageUnit,
    en_uso: item?.en_uso !== false,
  }
}

function getSelectedInventoryItem() {
  if (!state.inventorySelectedId || state.inventorySelectedId === 'new') {
    return null
  }
  return state.inventario.find((item) => item.id === state.inventorySelectedId) || null
}

function syncInventorySelectionFromData(forceDraftRefresh = false) {
  const hasNewSelection = state.inventorySelectedId === 'new'
  const selectedItem = getSelectedInventoryItem()

  if (!hasNewSelection && !selectedItem) {
    state.inventorySelectedId = state.inventario[0]?.id || null
  }

  if (state.inventorySelectedId === 'new') {
    if (forceDraftRefresh || state.inventoryDraftSourceId !== 'new') {
      state.inventoryDraft = createDefaultInventoryDraft()
      state.inventoryDraftSourceId = 'new'
      state.inventoryDraftDirty = false
    }
    return
  }

  const currentItem = getSelectedInventoryItem()
  if (!currentItem) {
    state.inventoryDraft = createDefaultInventoryDraft()
    state.inventoryDraftSourceId = null
    state.inventoryDraftDirty = false
    return
  }

  if (forceDraftRefresh || !state.inventoryDraftDirty || state.inventoryDraftSourceId !== currentItem.id) {
    state.inventoryDraft = createDefaultInventoryDraft(currentItem)
    state.inventoryDraftSourceId = currentItem.id
    state.inventoryDraftDirty = false
  }
}

function cancelInventoryDraft() {
  if (state.inventorySelectedId === 'new') {
    state.inventorySelectedId = state.inventario[0]?.id || null
    state.inventoryMobileView = 'list'
    syncInventorySelectionFromData(true)
    return
  }

  syncInventorySelectionFromData(true)
}

function buildInventoryPayloadFromDraft(draft, currentItem = null) {
  const unidadPaquete = normalizeInventoryUnit(draft.unidadPaquete || 'pza')
  const cantidadPaquete = Number(draft.cantidadPaquete || 0)
  const precioPaquete = Number(draft.precioPaquete || 0)
  const cantidadPaqueteBase = convertInventoryQuantity(cantidadPaquete, unidadPaquete)
  const costoUnitarioBase = cantidadPaqueteBase > 0 ? precioPaquete / cantidadPaqueteBase : 0
  const unidadBase = getInventoryBaseUnit(unidadPaquete)

  return {
    ...(currentItem || {}),
    nombre: String(draft.nombre || '').trim(),
    stock: Number(draft.stock || 0),
    stockMinimo: Number(draft.stockMinimo || 0),
    unidad: unidadBase,
    unidadBase,
    unidadPaquete,
    cantidadPaquete,
    precioPaquete,
    costoUnitarioBase,
    costoUnitarioTexto: costoUnitarioBase > 0 ? `${currency(costoUnitarioBase)} / ${formatInventoryUnit(unidadBase)}` : '',
    en_uso: draft.en_uso !== false,
    actualizadoEn: serverTimestamp(),
  }
}

async function saveSelectedInventoryDraft() {
  if (!db) {
    pushNotice('Firebase no esta configurado todavia.')
    render()
    return
  }

  const draft = state.inventoryDraft || createDefaultInventoryDraft()
  const nombre = String(draft.nombre || '').trim()
  if (!nombre) {
    pushNotice('Escribe un nombre para el insumo.')
    render()
    return
  }

  const isNew = state.inventorySelectedId === 'new'
  const payload = buildInventoryPayloadFromDraft(draft, getSelectedInventoryItem())

  if (isNew && (!Number(payload.precioPaquete || 0) || !Number(payload.cantidadPaquete || 0))) {
    pushNotice('Captura precio por paquete y cantidad del paquete.')
    render()
    return
  }

  if (isNew) {
    const createdDoc = await addDoc(collection(db, 'inventario'), {
      ...payload,
      alertaActiva: false,
      creadoEn: serverTimestamp(),
    })
    state.inventorySelectedId = createdDoc.id
    state.inventoryMobileView = 'detail'
    pushNotice('Insumo agregado.')
  } else if (state.inventorySelectedId) {
    await updateDoc(doc(db, 'inventario', state.inventorySelectedId), payload)
    pushNotice('Insumo actualizado.')
  }

  state.inventoryDraftDirty = false
  syncInventorySelectionFromData(true)
  render()
}

// ============================================================================
// NUEVAS FUNCIONES: TURNOS, MERMAS, DEDUCCIÓN AUTOMÁTICA, Y FINANCIERO
// ============================================================================

/**
 * Decrementa automáticamente inventario cuando se crea una orden
 * Consulta recetas de cada platillo y resta insumos
 */
async function deductInventoryFromOrder(platillos) {
  if (!db || !platillos || platillos.length === 0) return

  try {
    const batch = writeBatch(db)

    for (const platillo of platillos) {
      const menuItem = state.menu.find((m) => m.id === platillo.id)
      if (!menuItem || !menuItem.receta) continue

      // Por cada insumo en la receta del platillo
      for (const recipeLine of menuItem.receta) {
        if (!recipeLine.ingredientId) continue

        const ingredient = state.inventario.find((i) => i.id === recipeLine.ingredientId)
        if (!ingredient) continue

        // Cantidad total a descontar = cantidad en receta × cantidad de platillos
        const quantityToDeduct = Number(recipeLine.cantidad || 0) * Number(platillo.cantidad || 1)
        if (quantityToDeduct <= 0) continue

        const ingredientRef = doc(db, 'inventario', recipeLine.ingredientId)
        const currentStock = Number(ingredient.stock || 0)
        const newStock = Math.max(currentStock - quantityToDeduct, 0)

        batch.update(ingredientRef, {
          stock: newStock,
          actualizadoEn: serverTimestamp(),
        })
      }
    }

    await batch.commit()
  } catch (error) {
    console.error('Error deducting inventory:', error)
  }
}

/**
 * Registra comida tirada (mermas) en la bitácora
 * Descuenta del inventario y guarda registro
 */
async function registerWaste(ingredientId, quantityInBaseUnit, reason = 'otro') {
  if (!db || !ingredientId) return

  try {
    const ingredient = state.inventario.find((i) => i.id === ingredientId)
    if (!ingredient) {
      pushNotice('No encontramos el insumo para registrar merma.')
      return
    }

    const costPerUnit = Number(ingredient.costoUnitarioBase || 0)
    const wasteCost = costPerUnit * Number(quantityInBaseUnit || 0)

    // Guardar registro de merma
    await addDoc(collection(db, 'mermas'), {
      ingredientId,
      ingredientNombre: ingredient.nombre,
      cantidadBase: Number(quantityInBaseUnit || 0),
      unidadBase: ingredient.unidadBase || 'g',
      razon: reason,
      costo: wasteCost,
      registradoPor: getUserEmail(),
      registradoEn: serverTimestamp(),
      shiftId: state.currentShift?.id || null,
    })

    // Actualizar stock del insumo
    const newStock = Math.max(Number(ingredient.stock || 0) - Number(quantityInBaseUnit || 0), 0)
    await updateDoc(doc(db, 'inventario', ingredientId), {
      stock: newStock,
      actualizadoEn: serverTimestamp(),
    })

    pushNotice(`Merma registrada: ${ingredient.nombre} (${currency(wasteCost)})`)
    render()
  } catch (error) {
    console.error('Error registering waste:', error)
    pushNotice('Error al registrar merma.')
  }
}

/**
 * Abre un nuevo turno de vendedor
 * Registra efectivo inicial y crea punto de control
 */
async function openShift(initialCash = 0, notes = '') {
  if (!db) {
    pushNotice('Firebase no esta configurado todavia.')
    render()
    return
  }

  try {
    const shiftDoc = await addDoc(collection(db, 'shifts'), {
      fechaInicio: serverTimestamp(),
      vendedorEmail: getUserEmail(),
      vendedorNombre: state.user?.displayName || 'Desconocido',
      estado: 'abierto',
      efectivoInicial: Number(initialCash || 0),
      notasInicio: String(notes || '').trim(),
      ventasRegistradas: 0,
      costoMermas: 0,
      totalSalidas: 0,
      fechaCierre: null,
      cierreFinal: null,
    })

    state.currentShift = {
      id: shiftDoc.id,
      estado: 'abierto',
      efectivoInicial: Number(initialCash || 0),
      ventasRegistradas: 0,
    }

    pushNotice(`✅ Turno abierto\nEfectivo inicial: ${currency(initialCash)}`)
    render()
  } catch (error) {
    console.error('Error opening shift:', error)
    pushNotice('Error al abrir turno.')
  }
}

/**
 * Registra compra o salida de caja durante el turno
 * Ejemplo: compra de proteínas emergente, pago de terceros
 */
async function registerEmergencyCashOutflow(amount, reason = '', items = []) {
  if (!db || !state.currentShift?.id) {
    pushNotice('Necesitas tener un turno abierto para registrar salida.')
    render()
    return
  }

  try {
    const outflow = {
      monto: Number(amount || 0),
      razon: String(reason || '').trim(),
      items: items || [],
      registradoEn: serverTimestamp(),
      registradoPor: getUserEmail(),
    }

    await updateDoc(doc(db, 'shifts', state.currentShift.id), {
      salidas: arrayUnion(outflow),
    })

    if (state.currentShift.salidas) {
      state.currentShift.salidas.push(outflow)
    } else {
      state.currentShift.salidas = [outflow]
    }

    pushNotice(`💸 Salida registrada: ${currency(amount)} - ${reason}`)
    render()
  } catch (error) {
    console.error('Error registering outflow:', error)
    pushNotice('Error al registrar salida.')
  }
}

/**
 * Cierra el turno, calcula totales y segrega financiero 50/30/10/10
 * Retorna resumen de cierre con segregación automática
 */
async function closeShift(finalCash = 0, notes = '') {
  if (!db || !state.currentShift?.id) {
    pushNotice('No hay turno abierto para cerrar.')
    render()
    return
  }

  try {
    // Calcular totales del turno
    const shiftPedidos = state.pedidos.filter((p) => p.shiftId === state.currentShift.id && p.estado === 'Pagado')
    const totalSalesForShift = shiftPedidos.reduce((sum, p) => sum + Number(p.total || 0), 0)

    const wasteEntries = state.mermas.filter((m) => m.shiftId === state.currentShift.id)
    const totalWasteCost = wasteEntries.reduce((sum, m) => sum + m.costo, 0)

    // Calcula diferencia de caja
    const expectedCash = Number(state.currentShift.efectivoInicial || 0) + totalSalesForShift
    const difference = Number(finalCash || 0) - expectedCash

    // ✅ SEGREGACIÓN 50/30/10/10 AUTOMÁTICA
    const operationAllocation = totalSalesForShift * 0.5 // 50% operaciones/insumos
    const ownerSalary = totalSalesForShift * 0.3 // 30% dueño
    const reserveFund = totalSalesForShift * 0.1 // 10% fondo de reserva
    const discretionary = totalSalesForShift * 0.1 // 10% comodín/ahorro

    await updateDoc(doc(db, 'shifts', state.currentShift.id), {
      estado: 'cerrado',
      efectivoFinal: Number(finalCash || 0),
      diferencia: difference,
      notasCierre: String(notes || '').trim(),
      ventasDelTurno: totalSalesForShift,
      costoMermas: totalWasteCost,
      fechaCierre: serverTimestamp(),
      segregacion: {
        operaciones: operationAllocation,
        duenoSalario: ownerSalary,
        fondoReserva: reserveFund,
        comodin: discretionary,
      },
    })

    // Resumen de cierre
    const closingSummary = `
📋 CIERRE DE TURNO
═══════════════════════════════════════
Vendedor: ${state.user?.displayName || 'Desconocido'}
Turno: ${new Date(state.currentShift.fechaInicio).toLocaleTimeString()}

💰 VENTAS & CAJA
───────────────────────────────────────
Ventas registradas: ${currency(totalSalesForShift)}
Mermas registradas: ${currency(totalWasteCost)}
Efectivo inicial: ${currency(state.currentShift.efectivoInicial || 0)}
Efectivo esperado: ${currency(expectedCash)}
Efectivo final: ${currency(finalCash)}
DIFERENCIA: ${difference > 0 ? '+' : ''}${currency(difference)}

📊 SEGREGACIÓN (50/30/10/10)
───────────────────────────────────────
Operaciones/Insumos: ${currency(operationAllocation)}
Salario Dueño: ${currency(ownerSalary)}
Fondo de Reserva: ${currency(reserveFund)}
Comodín/Ahorro: ${currency(discretionary)}

⚠️ Notas: ${notes || 'Sin notas'}
═══════════════════════════════════════`

    pushNotice(closingSummary)
    state.currentShift = null
    render()
  } catch (error) {
    console.error('Error closing shift:', error)
    pushNotice('Error al cerrar turno.')
  }
}

/**
 * Obtiene total de ventas pagadas en un turno específico
 */
function getPaidOrdersInShift(shiftId) {
  if (!shiftId) return 0
  return state.pedidos
    .filter((p) => p.shiftId === shiftId && p.estado === 'Pagado')
    .reduce((sum, p) => sum + Number(p.total || 0), 0)
}

/**
 * Obtiene total de costos por mermas en un turno
 */
function getWasteCostInShift(shiftId) {
  if (!shiftId) return 0
  return state.mermas
    .filter((m) => m.shiftId === shiftId)
    .reduce((sum, m) => sum + m.costo, 0)
}

function createDefaultRecipeDraft() {
  return {
    search: '',
    rows: [createRecipeRow('existing')],
  }
}

function createRecipeRow(mode = 'existing') {
  return {
    rowId: createDraftId(),
    mode,
    ingredientId: '',
    nombre: '',
    cantidad: '',
    unidad: 'g',
    precioPaquete: '',
    cantidadPaquete: '',
    unidadPaquete: 'g',
    stock: '',
    stockMinimo: '',
    saved: false,
    enUso: true,
  }
}

function isRecipeRowEmpty(row) {
  if (!row || typeof row !== 'object') {
    return true
  }

  return ![
    row.ingredientId,
    row.nombre,
    row.cantidad,
    row.precioPaquete,
    row.cantidadPaquete,
    row.stock,
    row.stockMinimo,
  ]
    .map((value) => String(value || '').trim())
    .some(Boolean)
}

function getRecipeRowValidationMessage(row) {
  if (!row || typeof row !== 'object') {
    return 'No pudimos guardar el insumo en captura.'
  }

  if (row.mode === 'existing') {
    if (!String(row.ingredientId || '').trim()) {
      return 'Selecciona un insumo existente antes de guardarlo.'
    }
    if (Number(row.cantidad || 0) <= 0) {
      return 'Captura una cantidad mayor a 0 para el insumo existente.'
    }
    return ''
  }

  const nombreInsumo = String(row.nombre || '').trim()
  if (!nombreInsumo) {
    return 'Escribe el nombre del insumo nuevo antes de guardarlo.'
  }

  if (Number(row.cantidad || 0) <= 0) {
    return 'Captura una cantidad mayor a 0 para el insumo nuevo.'
  }

  const alreadyExists = state.inventario.some(
    (item) => String(item.nombre || '').trim().toLowerCase() === nombreInsumo.toLowerCase(),
  )

  if (alreadyExists) {
    return ''
  }

  if (Number(row.precioPaquete || 0) <= 0 || Number(row.cantidadPaquete || 0) <= 0) {
    return 'Para un insumo nuevo captura precio y cantidad del paquete antes de guardarlo.'
  }

  return ''
}

function normalizeInventoryUnit(unit) {
  const raw = String(unit || '').trim().toLowerCase()
  if (['kg', 'kilo', 'kilogramo', 'kilogramos'].includes(raw)) {
    return 'kg'
  }
  if (['g', 'gramo', 'gramos'].includes(raw)) {
    return 'g'
  }
  if (['l', 'lt', 'litro', 'litros'].includes(raw)) {
    return 'l'
  }
  if (['ml', 'mililitro', 'mililitros'].includes(raw)) {
    return 'ml'
  }
  return 'pza'
}

function getInventoryBaseUnit(unit) {
  const normalized = normalizeInventoryUnit(unit)
  if (normalized === 'kg') {
    return 'g'
  }
  if (normalized === 'l') {
    return 'ml'
  }
  return normalized
}

function getInventoryBaseFactor(unit) {
  const normalized = normalizeInventoryUnit(unit)
  if (normalized === 'kg') {
    return 1000
  }
  if (normalized === 'l') {
    return 1000
  }
  return 1
}

function convertInventoryQuantity(value, unit) {
  const amount = Number(value || 0)
  if (Number.isNaN(amount) || amount <= 0) {
    return 0
  }
  return amount * getInventoryBaseFactor(unit)
}

function formatInventoryUnit(unit) {
  const normalized = normalizeInventoryUnit(unit)
  const labels = {
    pza: 'pieza',
    g: 'g',
    kg: 'kg',
    ml: 'ml',
    l: 'l',
  }
  return labels[normalized] || normalized
}

function getIngredientUnitCost(ingredient) {
  const packageCost = Number(ingredient?.precioPaquete || 0)
  const packageQuantity = convertInventoryQuantity(ingredient?.cantidadPaquete || 0, ingredient?.unidadPaquete || ingredient?.unidad)
  if (!packageCost || !packageQuantity) {
    return 0
  }
  return packageCost / packageQuantity
}

function getRecipeLineCost(recipeLine, ingredient) {
  const unitCost = Number(ingredient?.costoUnitarioBase || getIngredientUnitCost(ingredient) || 0)
  const quantity = convertInventoryQuantity(recipeLine?.cantidad || 0, recipeLine?.unidad || ingredient?.unidadBase || ingredient?.unidadPaquete || ingredient?.unidad)
  return unitCost * quantity
}

function normalizePublicSettings(rawSettings) {
  const defaults = createDefaultPublicSettings()
  const payload = rawSettings && typeof rawSettings === 'object' ? rawSettings : {}

  const menuCategoriesEnabled = { ...defaults.menuCategoriesEnabled }
  const incomingCategories = payload.menuCategoriesEnabled && typeof payload.menuCategoriesEnabled === 'object'
    ? payload.menuCategoriesEnabled
    : {}

  for (const category of ADVANCED_MENU_CATEGORIES) {
    if (typeof incomingCategories[category] === 'boolean') {
      menuCategoriesEnabled[category] = incomingCategories[category]
    }
  }

  const contactInput = payload.contact && typeof payload.contact === 'object' ? payload.contact : {}
  const contact = {
    telefono: String(contactInput.telefono || defaults.contact.telefono),
    whatsapp: String(contactInput.whatsapp || defaults.contact.whatsapp),
    direccion: String(contactInput.direccion || defaults.contact.direccion),
    instagram: String(contactInput.instagram || defaults.contact.instagram),
    facebook: String(contactInput.facebook || defaults.contact.facebook),
    tiktok: String(contactInput.tiktok || defaults.contact.tiktok),
  }

  const scheduleInput = payload.schedule && typeof payload.schedule === 'object' ? payload.schedule : {}
  const schedule = {}
  for (const day of WEEK_DAYS) {
    const source = scheduleInput[day.key] && typeof scheduleInput[day.key] === 'object' ? scheduleInput[day.key] : {}
    schedule[day.key] = {
      open: String(source.open || defaults.schedule[day.key].open),
      close: String(source.close || defaults.schedule[day.key].close),
      closed: typeof source.closed === 'boolean' ? source.closed : defaults.schedule[day.key].closed,
    }
  }

  return {
    menuCategoriesEnabled,
    contact,
    schedule,
  }
}

function getUserEmail(user = state.user) {
  return user?.email?.trim().toLowerCase() || ''
}

function getCategoryFieldKey(category) {
  return String(category || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function isMenuCategoryEnabled(category) {
  const categories = state.settings?.menuCategoriesEnabled || {}
  if (typeof categories[category] !== 'boolean') {
    return true
  }
  return categories[category]
}

function getEnabledPublicMenuCategories() {
  return MENU_CATEGORIES.filter((category) => isMenuCategoryEnabled(category))
}

function getPublicContact() {
  return state.settings?.contact || createDefaultPublicSettings().contact
}

function getPublicScheduleDay(dayKey) {
  const fallback = createDefaultPublicSettings().schedule[dayKey]
  const value = state.settings?.schedule?.[dayKey] || fallback
  return {
    open: String(value.open || fallback.open),
    close: String(value.close || fallback.close),
    closed: Boolean(value.closed),
  }
}

function getCurrentWeekDayKey() {
  return ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'][new Date().getDay()]
}

function buildAdvancedSettingsFromFormData(formData) {
  const nextSettings = createDefaultPublicSettings()

  for (const category of ADVANCED_MENU_CATEGORIES) {
    const key = getCategoryFieldKey(category)
    nextSettings.menuCategoriesEnabled[category] = formData.get(`category_enabled_${key}`) === 'on'
  }

  nextSettings.contact.telefono = String(formData.get('contact_telefono') || '').trim()
  nextSettings.contact.whatsapp = String(formData.get('contact_whatsapp') || '').trim()
  nextSettings.contact.direccion = String(formData.get('contact_direccion') || '').trim()
  nextSettings.contact.instagram = String(formData.get('contact_instagram') || '').trim()
  nextSettings.contact.facebook = String(formData.get('contact_facebook') || '').trim()
  nextSettings.contact.tiktok = String(formData.get('contact_tiktok') || '').trim()

  for (const day of WEEK_DAYS) {
    const closed = formData.get(`day_closed_${day.key}`) === 'on'
    nextSettings.schedule[day.key] = {
      open: String(formData.get(`day_open_${day.key}`) || '08:00'),
      close: String(formData.get(`day_close_${day.key}`) || '14:00'),
      closed,
    }
  }

  return nextSettings
}

function createAdvancedSettingsSnapshot(settings) {
  const normalized = normalizePublicSettings(settings)

  return JSON.stringify({
    categories: ADVANCED_MENU_CATEGORIES.map((category) => [category, normalized.menuCategoriesEnabled[category] === true]),
    contact: {
      telefono: String(normalized.contact.telefono || '').trim(),
      whatsapp: String(normalized.contact.whatsapp || '').trim(),
      direccion: String(normalized.contact.direccion || '').trim(),
      instagram: String(normalized.contact.instagram || '').trim(),
      facebook: String(normalized.contact.facebook || '').trim(),
      tiktok: String(normalized.contact.tiktok || '').trim(),
    },
    schedule: WEEK_DAYS.map((day) => {
      const value = normalized.schedule[day.key]
      return [day.key, String(value.open || '08:00'), String(value.close || '14:00'), value.closed === true]
    }),
  })
}

function syncAdvancedSettingsSubmitState(formNode) {
  if (!formNode) {
    return
  }

  const button = formNode.querySelector('[data-advanced-settings-submit]')
  if (!button) {
    return
  }

  const initialSnapshot = formNode.dataset.initialSnapshot || ''
  const currentSettings = buildAdvancedSettingsFromFormData(new FormData(formNode))
  const currentSnapshot = createAdvancedSettingsSnapshot(currentSettings)
  const hasChanges = currentSnapshot !== initialSnapshot

  button.disabled = !hasChanges
  button.setAttribute('aria-disabled', hasChanges ? 'false' : 'true')
}

async function saveAdvancedSettings(formData) {
  if (!db) {
    pushNotice('Firebase no esta configurado todavia.')
    render()
    return
  }

  const nextSettings = buildAdvancedSettingsFromFormData(formData)

  await setDoc(doc(db, 'app_config', 'public_profile'), {
    ...nextSettings,
    updatedAt: serverTimestamp(),
    updatedBy: getUserEmail(),
  }, { merge: true })

  state.settings = normalizePublicSettings(nextSettings)
  pushNotice('Configuracion avanzada actualizada.')
  render()
}

function getVisibleMenuItems() {
  return state.menu.filter((item) => item.activo !== false)
}

function getVisibleCombos() {
  return state.combos.filter((combo) => combo.activo !== false)
}

function getComboEditorItem() {
  return state.combos.find((combo) => combo.id === state.editingComboId) || null
}

function getComboItems(combo) {
  const rawItems = Array.isArray(combo?.componentes) && combo.componentes.length > 0
    ? combo.componentes
    : Array.isArray(combo?.items)
      ? combo.items
      : []

  return rawItems
    .map((item) => {
      if (item && typeof item === 'object') {
        return {
          id: String(item.id || ''),
          nombre: String(item.nombre || ''),
          precio: Number(item.precio || 0),
          categoria: String(item.categoria || ''),
        }
      }

      const source = getVisibleMenuItems().find((menuItem) => menuItem.id === item)
      return source
        ? {
            id: source.id,
            nombre: source.nombre || '',
            precio: Number(source.precio || 0),
            categoria: source.categoria || '',
          }
        : null
    })
    .filter(Boolean)
}

function getComboOriginalTotal(combo) {
  return getComboItems(combo).reduce((sum, item) => sum + Number(item.precio || 0), 0)
}

function getComboSavings(combo) {
  return Math.max(getComboOriginalTotal(combo) - Number(combo?.precioCombo || combo?.precio || 0), 0)
}

function getComboDraftSelectedItems() {
  const selectedIds = new Set(state.comboDraft.selectedIds)
  return getVisibleMenuItems().filter((item) => selectedIds.has(item.id))
}

function buildComboDraftFromCombo(combo) {
  const comboItems = getComboItems(combo)
  return {
    nombre: combo?.nombre || '',
    descripcion: combo?.descripcion || '',
    search: '',
    selectedIds: comboItems.map((item) => item.id).filter(Boolean),
    precioCombo: String(combo?.precioCombo ?? combo?.precio ?? ''),
  }
}

function buildRecipeDraftFromMenu(menuItem) {
  const rawRecipe = Array.isArray(menuItem?.receta) ? menuItem.receta : []

  return {
    search: '',
    rows: rawRecipe.length > 0
      ? rawRecipe.map((item) => ({
          rowId: createDraftId(),
          mode: item.mode || (item.ingredientId ? 'existing' : 'new'),
          ingredientId: item.ingredientId || '',
          nombre: item.nombre || '',
          cantidad: String(item.cantidad ?? ''),
          unidad: item.unidad || 'g',
          precioPaquete: String(item.precioPaquete ?? ''),
          cantidadPaquete: String(item.cantidadPaquete ?? ''),
          unidadPaquete: item.unidadPaquete || 'g',
          stock: String(item.stock ?? ''),
          stockMinimo: String(item.stockMinimo ?? ''),
          saved: true,
          enUso: item.enUso !== false,
        }))
      : [createRecipeRow('existing')],
  }
}

function buildInventoryPayloadFromForm(formData, currentItem = null) {
  const nombre = formData.get('nombre')?.toString().trim()
  const stock = Number(formData.get('stock') || 0)
  const stockMinimo = Number(formData.get('stockMinimo') || 0)
  const unidadPaquete = normalizeInventoryUnit(formData.get('unidadPaquete') || formData.get('unidad') || 'pza')
  const cantidadPaquete = Number(formData.get('cantidadPaquete') || 0)
  const precioPaquete = Number(formData.get('precioPaquete') || 0)
  const enUso = String(formData.get('en_uso') || 'true') === 'true'

  const cantidadPaqueteBase = convertInventoryQuantity(cantidadPaquete, unidadPaquete)
  const costoUnitarioBase = cantidadPaqueteBase > 0 ? precioPaquete / cantidadPaqueteBase : 0
  const unidadBase = getInventoryBaseUnit(unidadPaquete)

  return {
    ...(currentItem || {}),
    nombre,
    stock,
    stockMinimo,
    unidad: unidadBase,
    unidadBase,
    unidadPaquete,
    cantidadPaquete,
    precioPaquete,
    costoUnitarioBase,
    costoUnitarioTexto: costoUnitarioBase > 0 ? `${currency(costoUnitarioBase)} / ${formatInventoryUnit(unidadBase)}` : '',
    en_uso: enUso,
    actualizadoEn: serverTimestamp(),
  }
}

function getRecipeDraftItems() {
  return (state.recipeDraft.rows || [])
    .filter((row) => row.saved)
    .map((row) => {
      if (row.mode === 'existing') {
        const ingredient = state.inventario.find((item) => item.id === row.ingredientId)
        if (!ingredient) {
          return null
        }
        return {
          rowId: row.rowId,
          mode: 'existing',
          ingredientId: ingredient.id,
          nombre: ingredient.nombre || '',
          cantidad: Number(row.cantidad || 0),
          unidad: normalizeInventoryUnit(row.unidad || ingredient.unidadBase || ingredient.unidadPaquete || ingredient.unidad),
          precioPaquete: Number(ingredient.precioPaquete || 0),
          cantidadPaquete: Number(ingredient.cantidadPaquete || 0),
          unidadPaquete: ingredient.unidadPaquete || ingredient.unidadBase || ingredient.unidad || 'g',
          costoUnitarioBase: Number(ingredient.costoUnitarioBase || getIngredientUnitCost(ingredient) || 0),
          costoLinea: getRecipeLineCost(row, ingredient),
          baseUnit: ingredient.unidadBase || getInventoryBaseUnit(ingredient.unidadPaquete || ingredient.unidad),
        }
      }

      if (!String(row.nombre || '').trim()) {
        return null
      }

      const packageUnit = normalizeInventoryUnit(row.unidadPaquete || row.unidad || 'g')
      const packageQuantityBase = convertInventoryQuantity(row.cantidadPaquete || 0, packageUnit)
      const costoUnitarioBase = packageQuantityBase > 0 ? Number(row.precioPaquete || 0) / packageQuantityBase : 0
      const recipeUnit = normalizeInventoryUnit(row.unidad || getInventoryBaseUnit(packageUnit))
      const quantityBase = convertInventoryQuantity(row.cantidad || 0, recipeUnit)

      return {
        rowId: row.rowId,
        mode: 'new',
        ingredientId: '',
        nombre: String(row.nombre || '').trim(),
        cantidad: Number(row.cantidad || 0),
        unidad: recipeUnit,
        precioPaquete: Number(row.precioPaquete || 0),
        cantidadPaquete: Number(row.cantidadPaquete || 0),
        unidadPaquete: packageUnit,
        stock: Number(row.stock || 0),
        stockMinimo: Number(row.stockMinimo || 0),
        costoUnitarioBase,
        costoLinea: costoUnitarioBase * quantityBase,
        baseUnit: getInventoryBaseUnit(packageUnit),
      }
    })
    .filter(Boolean)
}

function calculateRecipeSummary(price = state.menuPriceDraft) {
  const salePrice = Number(price || 0)
  const items = getRecipeDraftItems()
  const costoTotal = items.reduce((sum, item) => sum + Number(item.costoLinea || 0), 0)
  const gananciaNeta = salePrice - costoTotal
  const margenPorcentaje = salePrice > 0 ? (gananciaNeta / salePrice) * 100 : 0
  return {
    items,
    salePrice,
    costoTotal,
    gananciaNeta,
    margenPorcentaje,
  }
}

function syncRecipePreview() {
  const costNode = document.querySelector('[data-recipe-cost-total]')
  const netNode = document.querySelector('[data-recipe-net-profit]')
  const marginNode = document.querySelector('[data-recipe-margin]')
  const perUnitNode = document.querySelector('[data-recipe-unit-cost]')
  if (!costNode || !netNode || !marginNode || !perUnitNode) {
    return
  }

  const summary = calculateRecipeSummary()
  costNode.textContent = currency(summary.costoTotal)
  netNode.textContent = currency(summary.gananciaNeta)
  marginNode.textContent = `${Math.max(summary.margenPorcentaje, 0).toFixed(1)}%`
  perUnitNode.textContent = summary.items.length > 0 ? `${summary.items.length} insumos` : 'Sin receta'
}

async function ensureNotificationDoc(payload) {
  if (!db) {
    return
  }

  await addDoc(collection(db, NOTIFICATION_COLLECTION), {
    ...payload,
    readAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

function syncLowStockNotifications(inventoryItems) {
  const currentLowIds = new Set()

  if (!inventoryAlertsPrimed) {
    for (const item of inventoryItems) {
      const stock = Number(item.stock || 0)
      const stockMinimo = Number(item.stockMinimo || 0)
      if (stock <= stockMinimo || stock <= 0) {
        currentLowIds.add(item.id)
      }
    }
    lowStockAlertedIds = currentLowIds
    inventoryAlertsPrimed = true
    return
  }

  for (const item of inventoryItems) {
    const stock = Number(item.stock || 0)
    const stockMinimo = Number(item.stockMinimo || 0)
    const isLow = stock <= stockMinimo || stock <= 0
    if (!isLow) {
      lowStockAlertedIds.delete(item.id)
      continue
    }

    currentLowIds.add(item.id)
    if (lowStockAlertedIds.has(item.id)) {
      continue
    }

    lowStockAlertedIds.add(item.id)
    ensureNotificationDoc({
      type: stock <= 0 ? 'inventory_empty' : 'inventory_low',
      severity: stock <= 0 ? 'danger' : 'warning',
      title: stock <= 0 ? `Insumo agotado: ${item.nombre}` : `Inventario bajo: ${item.nombre}`,
      message: stock <= 0
        ? `El insumo ${item.nombre} llego a 0 ${formatInventoryUnit(item.unidadBase || item.unidadPaquete || item.unidad || 'pza')}.`
        : `El insumo ${item.nombre} esta por debajo del minimo configurado.`,
      sourceCollection: 'inventario',
      sourceId: item.id,
      metadata: {
        stock,
        stockMinimo,
        unidad: item.unidadBase || item.unidadPaquete || item.unidad || 'pza',
      },
    }).catch((error) => console.error(error))
  }

  for (const id of Array.from(lowStockAlertedIds)) {
    if (!currentLowIds.has(id)) {
      lowStockAlertedIds.delete(id)
    }
  }
}

function syncNewOrderNotifications(pedidos) {
  const nextIds = new Set(pedidos.map((pedido) => pedido.id))

  if (knownPedidoIds.size === 0) {
    knownPedidoIds = nextIds
    return
  }

  for (const pedido of pedidos) {
    if (knownPedidoIds.has(pedido.id)) {
      continue
    }

    ensureNotificationDoc({
      type: 'new_order',
      severity: 'info',
      title: `Nueva orden recibida - ${pedido.mesa || 'Sin mesa'}`,
      message: `Se registró un nuevo pedido ${pedido.tipoServicio ? `(${pedido.tipoServicio})` : ''}.`,
      sourceCollection: 'pedidos',
      sourceId: pedido.id,
      metadata: {
        mesa: pedido.mesa || '',
        total: Number(pedido.total || 0),
        estado: pedido.estado || 'Pendiente',
      },
    }).catch((error) => console.error(error))
  }

  knownPedidoIds = nextIds
}

function getMenuByCategory(category) {
  return getVisibleMenuItems().filter((item) => item.categoria === category && isMenuCategoryEnabled(category))
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

function getPaidOrders() {
  return state.pedidos.filter((pedido) => pedido.estado === 'Pagado')
}

function getTotalSales() {
  return getPaidOrders().reduce((sum, pedido) => sum + Number(pedido.total || 0), 0)
}

function isDeliveryOrder(pedido) {
  const mesa = String(pedido?.mesa || '').toLowerCase()
  if (!mesa) {
    return false
  }
  return ['envio', 'domicilio', 'uber', 'rappi', 'didifood'].some((keyword) => mesa.includes(keyword))
}

function getDeliverySalesTotal() {
  return getPaidOrders()
    .filter((pedido) => isDeliveryOrder(pedido))
    .reduce((sum, pedido) => sum + Number(pedido.total || 0), 0)
}

function getTopSellingDishLabel() {
  const totals = new Map()

  for (const pedido of getPaidOrders()) {
    for (const item of pedido.platillos || []) {
      const name = String(item?.nombre || '').trim()
      if (!name) {
        continue
      }
      const qty = Number(item?.cantidad || 1)
      totals.set(name, (totals.get(name) || 0) + (Number.isFinite(qty) ? qty : 1))
    }
  }

  let winnerName = ''
  let winnerQty = 0
  for (const [name, qty] of totals.entries()) {
    if (qty > winnerQty) {
      winnerName = name
      winnerQty = qty
    }
  }

  return winnerName ? `${winnerName} (${winnerQty})` : 'Sin datos'
}

function normalizeClientKey(value) {
  return String(value || '').trim().toLowerCase()
}

function getClientsPerDayCount() {
  const today = new Date().toDateString()
  const keys = new Set(
    getPaidOrders()
      .filter((pedido) => toDate(pedido.pagadoEn)?.toDateString() === today)
      .map((pedido) => normalizeClientKey(pedido.mesa))
      .filter(Boolean),
  )

  return keys.size
}

function getClientsTotalCount() {
  const keys = new Set(getPaidOrders().map((pedido) => normalizeClientKey(pedido.mesa)).filter(Boolean))
  return keys.size
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
  appRoot.innerHTML = `
    <div class="shell ${state.shouldAnimateView ? 'is-view-animating' : ''}" data-view-animation="${state.viewAnimationToken}">
      ${renderNavbar()}
      <main class="content">
        ${renderConfigBanner()}
        ${isAuthorizedUser() && !state.currentShift ? renderShiftLockScreen() : renderRouteView()}
      </main>
      ${renderShiftStatusBadge()}
    </div>
    ${renderShiftOpenModal()}
    ${renderShiftCloseModal()}
    ${renderCashOutflowModal()}
    ${renderWasteModal()}
    ${renderAlerts()}
    ${renderLoadingScreen()}
  `

  applyViewAnimationLifecycle()
  updatePedidoTotal()
}

function renderLoadingScreen() {
  if (!state.isLoading || !state.loadingScreenVisible) {
    return ''
  }

  return `
    <section class="app-loading-screen ${state.loadingScreenExiting ? 'is-exiting' : ''}" role="status" aria-live="polite" aria-label="Cargando aplicacion">
      <div class="app-loading-screen__panel">
        <div class="modern-loader" aria-hidden="true"></div>
        <p>Preparando los desayunos...</p>
      </div>
    </section>
  `
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
    ${state.notificationPanelOpen ? renderNotificationsPanel() : ''}
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
            ? `<div class="mobile-sidebar__legend" aria-label="Administrador"><span aria-hidden="true"><i class="bi bi-gear-fill"></i></span><span>Administrador</span></div>`
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

  const unreadCount = state.notifications.filter((notification) => !notification.readAt).length
  const bellButton = isAuthorizedUser()
    ? `
      <button class="button button--ghost icon-action notification-bell ${state.notificationPanelOpen ? 'is-active' : ''}" type="button" data-action="toggle-notifications-panel" aria-label="Notificaciones" title="Notificaciones">
        <span class="icon-action__icon notification-bell__icon" aria-hidden="true"><i class="bi bi-bell-fill"></i>${unreadCount > 0 ? `<span class="notification-bell__badge">${unreadCount > 9 ? '9+' : unreadCount}</span>` : ''}</span>
        <span class="icon-action__text">Alertas</span>
      </button>
    `
    : ''

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
    ${bellButton}
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

function renderNotificationsPanel() {
  const notifications = state.notifications.slice(0, 8)
  return `
    <aside class="notifications-panel card" role="dialog" aria-label="Panel de notificaciones">
      <header class="notifications-panel__head">
        <div>
          <p class="eyebrow">Centro de alertas</p>
          <h3>Notificaciones</h3>
        </div>
        <button class="button button--ghost" type="button" data-action="close-notifications-panel">Cerrar</button>
      </header>
      <div class="notifications-panel__list">
        ${notifications.length > 0 ? notifications.map((notification) => renderNotificationItem(notification)).join('') : '<article class="card empty">Sin alertas por ahora.</article>'}
      </div>
    </aside>
  `
}

function renderNotificationItem(notification) {
  const unread = !notification.readAt
  return `
    <article class="notification-item ${unread ? 'is-unread' : ''}">
      <div class="notification-item__body">
        <strong>${escapeHtml(notification.title || 'Notificacion')}</strong>
        <p>${escapeHtml(notification.message || '')}</p>
      </div>
      <div class="notification-item__meta">
        <span>${escapeHtml(notification.type || 'info')}</span>
        ${unread ? `<button class="button button--secondary" type="button" data-action="mark-notification-read" data-id="${notification.id}">Marcar leida</button>` : '<span class="notification-item__read">Leida</span>'}
      </div>
    </article>
  `
}

// ============================================================================
// COMPONENTES UI: TURNOS, MERMAS, SALIDAS DE EFECTIVO (TOUCH-OPTIMIZED)
// ============================================================================

/**
 * Panel flotante de estado del turno
 * Siempre visible si el usuario está autorizado
 */
function renderShiftStatusBadge() {
  if (!isAuthorizedUser() || !state.currentShift) {
    return ''
  }

  const shiftData = state.shifts.find((s) => s.id === state.currentShift.id) || {}
  const ventasDelTurno = getPaidOrdersInShift(state.currentShift.id)
  const costeMermas = getWasteCostInShift(state.currentShift.id)
  const efectivoEsperado = (state.currentShift.efectivoInicial || 0) + ventasDelTurno

  return `
    <aside class="shift-status-badge">
      <div class="shift-status-badge__header">
        <strong>
          <span class="shift-status-badge__indicator ${state.currentShift ? 'open' : 'closed'}"></span>
          Turno
        </strong>
        <span class="shift-status-badge__time">${new Date(state.currentShift.fechaInicio || Date.now()).toLocaleTimeString().slice(0, 5)}</span>
      </div>
      
      <div class="shift-status-badge__metrics">
        <div class="shift-metric">
          <span class="shift-metric__label">Ventas</span>
          <strong class="shift-metric__value">${currency(ventasDelTurno)}</strong>
        </div>
        <div class="shift-metric">
          <span class="shift-metric__label">Gastos</span>
          <strong class="shift-metric__value">${currency(costeMermas)}</strong>
        </div>
        <div class="shift-metric">
          <span class="shift-metric__label">Caja</span>
          <strong class="shift-metric__value">${currency(efectivoEsperado)}</strong>
        </div>
      </div>
      
      <div class="shift-status-badge__actions">
        <button class="button button--small button--secondary" type="button" data-action="open-cash-outflow-modal" title="Registrar salida de efectivo">
          <span aria-hidden="true">💸</span> Salida
        </button>
        <button class="button button--small button--secondary" type="button" data-action="open-waste-modal" title="Registrar merma">
          <span aria-hidden="true">🗑️</span> Merma
        </button>
        <button class="button button--small button--ghost" type="button" data-action="open-shift-close-modal" title="Cerrar turno">
          <span aria-hidden="true">✕</span>
        </button>
      </div>
    </aside>
  `
}

/**
 * Modal para abrir un nuevo turno
 */
function renderShiftOpenModal() {
  if (!isAuthorizedUser() || !state.shiftOpenModalOpen || state.currentShift) {
    return ''
  }

  return `
    <div class="modal-overlay" data-action="close-shift-open-modal"></div>
    <dialog class="modal shift-open-modal" open>
      <div class="modal__content">
        <header class="modal__header">
          <h2>Abrir Turno</h2>
          <button type="button" class="modal__close" data-action="close-shift-open-modal" aria-label="Cerrar">×</button>
        </header>
        
        <form class="modal__body shift-open-form" data-form="shift-open">
          <div class="form-group">
            <label for="shift-initial-cash">Efectivo Inicial (MXN)</label>
            <input 
              id="shift-initial-cash"
              class="input input--numeric" 
              type="number" 
              step="0.01" 
              min="0"
              placeholder="0.00"
              name="efectivoInicial"
              value="${state.shiftOpenDraft.efectivoInicial}"
              inputmode="decimal"
              autofocus
            />
          </div>
          
          <div class="form-group">
            <label for="shift-notes">Notas (Opcional)</label>
            <textarea 
              id="shift-notes"
              class="input input--textarea"
              name="notasInicio"
              placeholder="Ej: Abierto normal, fondo de caja OK"
              rows="3"
            >${state.shiftOpenDraft.notasInicio}</textarea>
          </div>
          
          <div class="modal__footer">
            <button type="button" class="button button--ghost" data-action="close-shift-open-modal">Cancelar</button>
            <button type="button" class="button button--cta" data-action="submit-shift-open">Abrir Turno</button>
          </div>
        </form>
      </div>
    </dialog>
  `
}

/**
 * Modal para cerrar turno con resumen de segregación
 */
function renderShiftCloseModal() {
  if (!isAuthorizedUser() || !state.shiftCloseModalOpen || !state.currentShift) {
    return ''
  }

  return `
    <div class="modal-overlay" data-action="close-shift-close-modal"></div>
    <dialog class="modal shift-close-modal" open>
      <div class="modal__content">
        <header class="modal__header">
          <h2>Cerrar Turno</h2>
          <button type="button" class="modal__close" data-action="close-shift-close-modal" aria-label="Cerrar">×</button>
        </header>
        
        <form class="modal__body shift-close-form" data-form="shift-close">
          <div class="form-group">
            <label for="shift-final-cash">Efectivo en Caja (MXN)</label>
            <input 
              id="shift-final-cash"
              class="input input--numeric" 
              type="number" 
              step="0.01" 
              min="0"
              placeholder="0.00"
              name="efectivoFinal"
              value="${state.shiftCloseDraft.efectivoFinal}"
              inputmode="decimal"
              autofocus
            />
          </div>
          
          <div class="form-group">
            <label for="shift-close-notes">Notas (Opcional)</label>
            <textarea 
              id="shift-close-notes"
              class="input input--textarea"
              name="notasCierre"
              placeholder="Ej: Día normal, faltó $50"
              rows="3"
            >${state.shiftCloseDraft.notasCierre}</textarea>
          </div>
          
          <div class="modal__footer">
            <button type="button" class="button button--ghost" data-action="close-shift-close-modal">Cancelar</button>
            <button type="button" class="button button--cta" data-action="submit-shift-close">Cerrar & Ver Resumen</button>
          </div>
        </form>
      </div>
    </dialog>
  `
}

/**
 * Modal para registrar salida de efectivo (emergencias)
 */
function renderCashOutflowModal() {
  if (!isAuthorizedUser() || !state.cashOutflowModalOpen || !state.currentShift) {
    return ''
  }

  const reasons = [
    { value: 'compra_insumos', label: '🍗 Proteínas', icon: '🍗' },
    { value: 'hielo', label: '🧊 Hielo', icon: '🧊' },
    { value: 'gas', label: '🔥 Gas', icon: '🔥' },
    { value: 'otro', label: '❓ Otro', icon: '❓' },
  ]

  return `
    <div class="modal-overlay" data-action="close-cash-outflow-modal"></div>
    <dialog class="modal cash-outflow-modal" open>
      <div class="modal__content">
        <header class="modal__header">
          <h2>Salida de Efectivo</h2>
          <button type="button" class="modal__close" data-action="close-cash-outflow-modal" aria-label="Cerrar">×</button>
        </header>
        
        <form class="modal__body cash-outflow-form" data-form="cash-outflow">
          <div class="form-group">
            <label for="outflow-amount">Monto (MXN)</label>
            <input 
              id="outflow-amount"
              class="input input--numeric input--large" 
              type="number" 
              step="0.01" 
              min="0"
              placeholder="0.00"
              name="monto"
              value="${state.cashOutflowDraft.monto}"
              inputmode="decimal"
              autofocus
            />
          </div>
          
          <div class="form-group">
            <label>¿Para qué?</label>
            <div class="reason-buttons">
              ${reasons
                .map(
                  (reason) => `
                <button 
                  type="button" 
                  class="reason-btn ${state.cashOutflowDraft.razon === reason.value ? 'is-selected' : ''}"
                  data-action="set-outflow-reason"
                  data-reason="${reason.value}"
                  title="${reason.label}"
                >
                  <span class="reason-btn__icon">${reason.icon}</span>
                  <span class="reason-btn__label">${reason.label}</span>
                </button>
              `,
                )
                .join('')}
            </div>
          </div>
          
          <div class="form-group">
            <label for="outflow-items">Artículos (Opcional)</label>
            <input 
              id="outflow-items"
              class="input" 
              type="text" 
              placeholder="Ej: 2kg proteína, 5 bolsas hielo"
              name="items"
              value="${state.cashOutflowDraft.items}"
            />
          </div>
          
          <div class="modal__footer">
            <button type="button" class="button button--ghost" data-action="close-cash-outflow-modal">Cancelar</button>
            <button type="button" class="button button--cta" data-action="submit-cash-outflow">Registrar Salida</button>
          </div>
        </form>
      </div>
    </dialog>
  `
}

/**
 * Modal para registrar mermas (comida tirada)
 */
function renderWasteModal() {
  if (!isAuthorizedUser() || !state.wasteModalOpen || !state.currentShift) {
    return ''
  }

  const wasteState = state.wasteModalState
  const filteredInventario = wasteState.ingredientSearch
    ? state.inventario.filter((item) =>
        item.nombre.toLowerCase().includes(wasteState.ingredientSearch.toLowerCase()),
      )
    : state.inventario.filter((item) => item.en_uso)

  const reasons = [
    { value: 'error_cocina', label: 'Comida quemada', icon: '🍳' },
    { value: 'comida_tirada', label: 'Tirado', icon: '🗑️' },
    { value: 'vencimiento', label: 'Vencido', icon: '🤢' },
    { value: 'otro', label: 'Otro', icon: '❓' },
  ]

  return `
    <div class="modal-overlay" data-action="close-waste-modal"></div>
    <dialog class="modal waste-modal" open>
      <div class="modal__content">
        <header class="modal__header">
          <h2>Registrar Merma</h2>
          <button type="button" class="modal__close" data-action="close-waste-modal" aria-label="Cerrar">×</button>
        </header>
        
        <div class="modal__body waste-form">
          <!-- PASO 1: SELECCIONAR INSUMO -->
          <div class="form-group waste-search">
            <label for="waste-ingredient-search">Buscar Insumo</label>
            <input 
              id="waste-ingredient-search"
              class="input" 
              type="text" 
              placeholder="Huevo, aguacate, queso..."
              value="${escapeHtml(wasteState.ingredientSearch)}"
              data-action="waste-search-ingredients"
              autofocus
            />
          </div>
          
          ${
            wasteState.selectedIngredient
              ? `
            <div class="waste-selected-ingredient">
              <div class="waste-ingredient-info">
                <strong>${escapeHtml(wasteState.selectedIngredient.nombre)}</strong>
                <small>${wasteState.selectedIngredient.unidadBase || 'pieza'} | Stock: ${wasteState.selectedIngredient.stock || 0}</small>
              </div>
              <button type="button" class="button button--ghost" data-action="clear-waste-ingredient">Cambiar</button>
            </div>
            
            <!-- PASO 2: CANTIDAD Y RAZÓN -->
            <div class="form-group">
              <label>Cantidad</label>
              <div class="quantity-input-group">
                <input 
                  class="input input--numeric quantity-input" 
                  type="number" 
                  step="1" 
                  min="0"
                  placeholder="0"
                  value="${wasteState.cantidadDraft}"
                  data-action="waste-set-cantidad"
                  inputmode="decimal"
                />
                <span class="quantity-input-group__unit">${wasteState.unidadDraft}</span>
              </div>
            </div>
            
            <div class="form-group">
              <label>Razón</label>
              <div class="reason-buttons waste-reasons">
                ${reasons
                  .map(
                    (reason) => `
                  <button 
                    type="button" 
                    class="reason-btn ${wasteState.razonDraft === reason.value ? 'is-selected' : ''}"
                    data-action="waste-set-reason"
                    data-reason="${reason.value}"
                    title="${reason.label}"
                  >
                    <span class="reason-btn__icon">${reason.icon}</span>
                    <span class="reason-btn__label">${reason.label}</span>
                  </button>
                `,
                  )
                  .join('')}
              </div>
            </div>
            
            <div class="modal__footer">
              <button type="button" class="button button--ghost" data-action="close-waste-modal">Cancelar</button>
              <button type="button" class="button button--cta" data-action="submit-waste-entry">Registrar Merma</button>
            </div>
          `
              : `
            <!-- LISTA DE INSUMOS -->
            <div class="waste-ingredient-list">
              ${filteredInventario.length > 0 ? `
                ${filteredInventario
                  .slice(0, 12)
                  .map(
                    (item) => `
                  <button 
                    type="button" 
                    class="waste-ingredient-btn"
                    data-action="waste-select-ingredient"
                    data-id="${item.id}"
                  >
                    <strong>${escapeHtml(item.nombre)}</strong>
                    <small>${item.stock || 0} ${item.unidadBase || 'pza'}</small>
                  </button>
                `,
                  )
                  .join('')}
              ` : `<p class="empty-state">No hay insumos. Intenta otra búsqueda.</p>`}
            </div>
          `
          }
        </div>
      </div>
    </dialog>
  `
}

/**
 * Pantalla de bloqueo si no hay turno abierto
 */
function renderShiftLockScreen() {
  if (!isAuthorizedUser() || state.currentShift || state.shiftOpenModalOpen) {
    return ''
  }

  return `
    <div class="shift-lock-screen">
      <div class="shift-lock-screen__content">
        <div class="shift-lock-screen__icon">🔒</div>
        <h2>Turno Cerrado</h2>
        <p>Necesitas abrir un turno para continuar</p>
        <button class="button button--cta" type="button" data-action="open-shift-open-modal">
          📂 Abrir Turno
        </button>
      </div>
    </div>
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
  const contact = getPublicContact()
  const currentDayKey = getCurrentWeekDayKey()
  const scheduleRows = WEEK_DAYS.map((day) => {
    const schedule = getPublicScheduleDay(day.key)
    const isToday = day.key === currentDayKey
    const rowClasses = ['schedule-list__item']
    if (isToday) {
      rowClasses.push('is-today')
    }
    if (schedule.closed) {
      rowClasses.push('is-closed')
    }

    return `
      <li class="${rowClasses.join(' ')}">
        <span class="schedule-list__day">${day.label}${isToday ? ' · Hoy' : ''}</span>
        <div class="schedule-list__meta">
          ${!schedule.closed ? `<strong>${escapeHtml(schedule.open)} - ${escapeHtml(schedule.close)}</strong>` : ''}
          ${schedule.closed ? '<span class="schedule-list__badge">Cerrado</span>' : ''}
          ${isToday ? '<span class="schedule-list__badge schedule-list__badge--today">Hoy</span>' : ''}
        </div>
      </li>
    `
  }).join('')

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
          <strong class="schedule-days">Horarios del restaurante</strong>
          <ul class="schedule-list">
            ${scheduleRows}
          </ul>
        </article>
      </div>
      <article class="hero-contact card">
        <h2>Contacto y ubicacion</h2>
        <ul class="contact-list">
          <li>
            <a
              class="contact-link"
              href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(contact.direccion || 'Jose Maria Iglesias 3364, Miguel Hidalgo, 44760')}"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span class="contact-icon">MAP</span>
              <div>
                <strong>Direccion</strong>
                <p>${escapeHtml(contact.direccion || 'Jose Maria Iglesias 3364, col. Miguel Hidalgo, CP 44760.')}</p>
              </div>
            </a>
          </li>
          <li>
            <a class="contact-link" href="tel:${escapeHtml((contact.telefono || '+523300000000').replace(/\s+/g, ''))}">
              <span class="contact-icon">TEL</span>
              <div>
                <strong>Telefono</strong>
                <p>${escapeHtml(contact.telefono || 'Toca para llamar')}</p>
              </div>
            </a>
          </li>
          <li>
            <a class="contact-link" href="${escapeHtml(contact.whatsapp || 'https://wa.me/5233000000000')}" target="_blank" rel="noopener noreferrer">
              <span class="contact-icon">WA</span>
              <div>
                <strong>WhatsApp</strong>
                <p>${escapeHtml(contact.whatsapp || 'Contacto por WhatsApp')}</p>
              </div>
            </a>
          </li>
          <li>
            <a class="contact-link" href="mailto:desveladovoy@gmail.com">
              <span class="contact-icon">MAIL</span>
              <div>
                <strong>Correo</strong>
                <p>desveladovoy@gmail.com</p>
              </div>
            </a>
          </li>
          <li>
            <a class="contact-link" href="${escapeHtml(contact.instagram || 'https://www.instagram.com/losdesvelados.brunch')}" target="_blank" rel="noopener noreferrer">
              <span class="contact-icon">IG</span>
              <div>
                <strong>Instagram</strong>
                <p>${escapeHtml(contact.instagram || '@losdesvelados.brunch')}</p>
              </div>
            </a>
          </li>
          <li>
            <a class="contact-link" href="${escapeHtml(contact.facebook || 'https://facebook.com')}" target="_blank" rel="noopener noreferrer">
              <span class="contact-icon">FB</span>
              <div>
                <strong>Facebook</strong>
                <p>${escapeHtml(contact.facebook || 'Perfil de Facebook')}</p>
              </div>
            </a>
          </li>
          <li>
            <a class="contact-link" href="${escapeHtml(contact.tiktok || 'https://tiktok.com')}" target="_blank" rel="noopener noreferrer">
              <span class="contact-icon">TT</span>
              <div>
                <strong>TikTok</strong>
                <p>${escapeHtml(contact.tiktok || 'Perfil de TikTok')}</p>
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
  const enabledCategories = getEnabledPublicMenuCategories()
  const selectedCategory = enabledCategories.includes(state.menuCategory) ? state.menuCategory : enabledCategories[0] || ''

  return `
    ${renderPublicCombosSection()}
    ${enabledCategories.length > 0 ? `
      <nav class="menu-category-tabs" aria-label="Categorias del menu">
        ${enabledCategories.map(
          (category) =>
            `<button class="menu-category-tab ${selectedCategory === category ? 'is-active' : ''}" type="button" data-action="set-menu-category" data-category="${category}">${category}</button>`,
        ).join('')}
      </nav>
      <section class="menu-sections">
        ${renderPublicCategory(selectedCategory)}
      </section>
    ` : '<section class="card empty">El menu no esta disponible por el momento.</section>'}
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

function renderPublicCombosSection() {
  const combos = getVisibleCombos()

  return `
    <section class="combo-showcase">
      <div class="combo-showcase__head">
        <p class="eyebrow">Combos especiales</p>
        <h2>Promociones listas para pedir</h2>
      </div>
      <div class="combo-grid">
        ${combos.length > 0 ? combos.map((combo) => renderComboPublicCard(combo)).join('') : '<article class="card empty combo-empty">Aun no hay combos activos.</article>'}
      </div>
    </section>
  `
}

function renderComboPublicCard(combo) {
  const items = getComboItems(combo)
  const originalTotal = getComboOriginalTotal(combo)
  const comboPrice = Number(combo.precioCombo || 0)
  const savings = Math.max(originalTotal - comboPrice, 0)

  return `
    <article class="card combo-card">
      <header class="combo-card__head">
        <div>
          <p class="combo-card__eyebrow">Combo</p>
          <h3>${escapeHtml(combo.nombre || 'Combo sin nombre')}</h3>
        </div>
        <span class="combo-card__savings">¡Ahorra ${currency(savings)}!</span>
      </header>
      <p class="combo-card__description">${escapeHtml(combo.descripcion || '')}</p>
      <ul class="combo-card__components">
        ${items.map((item) => `<li>${escapeHtml(item.nombre)} <span>${currency(item.precio)}</span></li>`).join('')}
      </ul>
      <div class="combo-card__pricing">
        <span class="combo-card__old-price">${currency(originalTotal)}</span>
        <strong class="combo-card__new-price">${currency(comboPrice)}</strong>
      </div>
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
  const availableTabs = getAvailableEditorTabs()
  const currentTab = availableTabs.includes(state.editorTab) ? state.editorTab : 'resumen'

  return `
    <section class="admin-layout editor-shell">
      <aside class="card sidebar editor-sidebar">
        <p class="eyebrow">Panel de control</p>
        <h2>Edicion</h2>
        <nav class="sidebar-links editor-tabs editor-tabs--rail" aria-label="Herramientas de edicion">
          ${availableTabs
            .map(
              (tab) =>
                `<button class="sidebar-link editor-tab ${currentTab === tab ? 'is-active' : ''}" type="button" data-action="set-editor-tab" data-tab="${tab}">${EDITOR_TAB_LABELS[tab] || tab}</button>`,
            )
            .join('')}
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
    <section class="kpi-grid kpi-grid--primary">
      <article class="card kpi"><span>Pedidos activos</span><strong>${getActiveOrders().length}</strong></article>
      <article class="card kpi"><span>Ventas del dia</span><strong>${currency(getPaidTodayTotal())}</strong></article>
      <article class="card kpi"><span>Menu activo</span><strong>${getVisibleMenuItems().length}</strong></article>
      <article class="card kpi"><span>Combos activos</span><strong>${getVisibleCombos().length}</strong></article>
      <article class="card kpi"><span>Insumos</span><strong>${state.inventario.length}</strong></article>
    </section>
    <section class="kpi-grid kpi-grid--extended">
      <article class="card kpi"><span>Ventas totales</span><strong>${currency(getTotalSales())}</strong></article>
      <article class="card kpi"><span>Ventas por envio</span><strong>${currency(getDeliverySalesTotal())}</strong></article>
      <article class="card kpi kpi--wide"><span>Platillo mas vendido</span><strong>${escapeHtml(getTopSellingDishLabel())}</strong></article>
      <article class="card kpi"><span>Clientes por dia</span><strong>${getClientsPerDayCount()}</strong></article>
      <article class="card kpi"><span>Clientes totales</span><strong>${getClientsTotalCount()}</strong></article>
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
  if (tab === 'combos') {
    return renderCombosModule()
  }
  if (tab === 'insumos') {
    return renderInventarioModule()
  }

  if (tab === 'configuracion') {
    return renderAdvancedSettingsModule()
  }

  if (tab === 'accesos') {
    return canManageAccess() ? renderAccessModule(false) : renderPedidosModule()
  }

  if (tab === 'pedidos') {
    return renderPedidosModule()
  }

  return renderPedidosModule()
}

function renderMenuCrudModule() {
  const editor = getMenuEditorItem()
  const categorySections = getCatalogMenuSections()

  return `
    <section class="module-grid">
      <article class="card module-card">
        <header class="catalog-module-head">
          <h2>Catalogo actual</h2>
          <button class="catalog-add-button" type="button" data-action="open-menu-create-modal" aria-label="Agregar platillo" title="Agregar platillo">+</button>
        </header>
        <div class="catalog-sections">
          ${
            state.menu.length > 0
              ? categorySections
                  .map(
                    (section) => `
                      <section class="catalog-section">
                        <h3 class="catalog-section__title">${escapeHtml(section.label)}</h3>
                        <div class="catalog-compact-grid">
                          ${section.items.map((item) => renderCatalogCompactCard(item)).join('')}
                        </div>
                      </section>
                    `,
                  )
                  .join('')
              : '<article class="card empty">No hay platillos registrados.</article>'
          }
        </div>
      </article>
      ${state.menuCreateModalOpen ? renderMenuCreateModal() : ''}
      ${editor ? renderMenuEditModal(editor) : ''}
    </section>
  `
}

function renderMenuCreateModal() {
  const formDraft = state.menuFormDraft || createDefaultMenuFormDraft()
  const isActive = formDraft.activo !== false

  return `
    <button class="menu-edit-modal__overlay" type="button" data-action="close-menu-create-modal" aria-label="Cerrar nuevo platillo"></button>
    <section class="menu-edit-modal" role="dialog" aria-modal="true" aria-label="Agregar platillo">
      <header class="menu-edit-modal__head">
        <h3>Agregar platillo</h3>
        <button class="button button--ghost" type="button" data-action="close-menu-create-modal">Cerrar</button>
      </header>
      <form class="form-grid" data-form="menu-item-create">
        <label><span>Nombre</span><input name="nombre" data-menu-field="nombre" value="${escapeHtml(formDraft.nombre || '')}" required /></label>
        <label><span>Precio</span><input name="precio" type="number" min="0" step="0.01" value="${escapeHtml(state.menuPriceDraft)}" data-menu-price required /></label>
        <label class="wide"><span>Descripcion</span><textarea name="descripcion" data-menu-field="descripcion" required>${escapeHtml(formDraft.descripcion || '')}</textarea></label>
        <label><span>Categoria</span>
          <select name="categoria" data-menu-field="categoria" required>
            <option value="">Selecciona categoria</option>
            ${MENU_CATEGORIES.map((category) => `<option value="${category}" ${formDraft.categoria === category ? 'selected' : ''}>${category}</option>`).join('')}
          </select>
        </label>
        <section class="recipe-builder wide">
          ${renderRecipeConfigurator()}
        </section>
        <input type="hidden" name="activo" value="${isActive ? 'true' : 'false'}" data-menu-create-active />
        <label class="wide">
          <span>Estado</span>
          <button class="status-toggle ${isActive ? 'is-active' : ''}" type="button" data-action="toggle-menu-create-active" data-value="${isActive ? 'true' : 'false'}" aria-pressed="${isActive ? 'true' : 'false'}">
            <span class="status-toggle__dot" aria-hidden="true"></span>
            <span data-menu-create-active-label>${isActive ? 'Visible en menu publico' : 'Oculto del menu publico'}</span>
          </button>
        </label>
        <div class="actions wide">
          <button class="button" type="submit">Agregar platillo</button>
        </div>
      </form>
    </section>
  `
}

function renderCatalogCompactCard(item) {
  return `
    <article class="menu-compact-card ${item.activo === false ? 'is-muted' : ''}">
      <button class="menu-compact-card__button" type="button" data-action="edit-menu-item" data-id="${item.id}">
        <strong>${escapeHtml(item.nombre)}</strong>
        <span>${currency(item.precio)}</span>
      </button>
    </article>
  `
}

function renderMenuEditModal(item) {
  const formDraft = state.menuFormDraft || createDefaultMenuFormDraft(item)
  const isActive = formDraft.activo !== false

  return `
    <button class="menu-edit-modal__overlay" type="button" data-action="close-menu-modal" aria-label="Cerrar detalles de platillo"></button>
    <section class="menu-edit-modal" role="dialog" aria-modal="true" aria-label="Editar platillo">
      <header class="menu-edit-modal__head">
        <h3>Editar platillo</h3>
        <button class="button button--ghost" type="button" data-action="close-menu-modal">Cerrar</button>
      </header>
      <form class="form-grid" data-form="menu-item-edit">
        <label><span>Nombre</span><input name="nombre" data-menu-field="nombre" value="${escapeHtml(formDraft.nombre || '')}" required /></label>
        <label><span>Precio</span><input name="precio" type="number" min="0" step="0.01" value="${escapeHtml(state.menuPriceDraft || item.precio || '')}" data-menu-price required /></label>
        <label class="wide"><span>Descripcion</span><textarea name="descripcion" data-menu-field="descripcion" required>${escapeHtml(formDraft.descripcion || '')}</textarea></label>
        <label><span>Categoria</span>
          <select name="categoria" data-menu-field="categoria" required>
            <option value="">Selecciona categoria</option>
            ${MENU_CATEGORIES.map((category) => `<option value="${category}" ${formDraft.categoria === category ? 'selected' : ''}>${category}</option>`).join('')}
          </select>
        </label>
        <label class="wide"><span>Ingredientes (separados por comas)</span><input name="ingredientes" value="${escapeHtml((item.ingredientes || []).join(', '))}" /></label>
        <section class="recipe-builder wide">
          ${renderRecipeConfigurator()}
        </section>
        <input type="hidden" name="activo" value="${isActive ? 'true' : 'false'}" data-menu-edit-active />
        <label class="wide">
          <span>Estado</span>
          <button class="status-toggle ${isActive ? 'is-active' : ''}" type="button" data-action="toggle-menu-edit-active" data-value="${isActive ? 'true' : 'false'}" aria-pressed="${isActive ? 'true' : 'false'}">
            <span class="status-toggle__dot" aria-hidden="true"></span>
            <span data-menu-edit-active-label>${isActive ? 'Visible en menu publico' : 'Oculto del menu publico'}</span>
          </button>
        </label>
        <div class="actions wide">
          <button class="button" type="submit">Guardar cambios</button>
          <button class="button button--ghost" type="button" data-action="delete-menu-item" data-id="${item.id}">Eliminar</button>
        </div>
      </form>
    </section>
  `
}

function renderRecipeConfigurator() {
  const summary = calculateRecipeSummary()
  const search = state.recipeDraft.search || ''
  const ingredientOptions = state.inventario
    .filter((item) => {
      if (!search) {
        return true
      }
      const needle = search.trim().toLowerCase()
      return [item.nombre, item.descripcion, item.categoria].filter(Boolean).some((field) => String(field).toLowerCase().includes(needle))
    })

  return `
    <header class="recipe-builder__head">
      <div>
        <p class="eyebrow">Configurar receta</p>
        <h3>Relacion platillo-insumos</h3>
      </div>
      <div class="recipe-builder__actions">
        <button class="button button--secondary" type="button" data-action="add-recipe-row">+ Insumo existente</button>
        <button class="button button--ghost" type="button" data-action="add-recipe-new-row">+ Insumo nuevo</button>
      </div>
    </header>
    <label class="recipe-builder__search">
      <span>Buscar insumos registrados</span>
      <input type="search" data-recipe-search value="${escapeHtml(search)}" placeholder="Filtra por nombre o categoria" />
    </label>
    <div class="recipe-builder__rows">
      ${state.recipeDraft.rows.map((row) => renderRecipeRow(row, ingredientOptions)).join('')}
    </div>
    <div class="recipe-builder__summary">
      <article class="recipe-summary-card">
        <span>Costo total del platillo</span>
        <strong data-recipe-cost-total>${currency(summary.costoTotal)}</strong>
      </article>
      <article class="recipe-summary-card">
        <span>Ganancia neta real</span>
        <strong data-recipe-net-profit>${currency(summary.gananciaNeta)}</strong>
      </article>
      <article class="recipe-summary-card">
        <span>Margen estimado</span>
        <strong data-recipe-margin>${Math.max(summary.margenPorcentaje, 0).toFixed(1)}%</strong>
      </article>
      <article class="recipe-summary-card">
        <span>Componentes</span>
        <strong data-recipe-unit-cost>${summary.items.length > 0 ? `${summary.items.length} insumos` : 'Sin receta'}</strong>
      </article>
    </div>
  `
}

function renderRecipeRow(row, ingredientOptions) {
  const existingIngredients = ingredientOptions
  if (row.saved) {
    const linkedIngredient = state.inventario.find((item) => item.id === row.ingredientId)
    const rowName = row.mode === 'existing' ? linkedIngredient?.nombre || row.nombre || 'Insumo existente' : row.nombre || 'Insumo nuevo'
    const rowAmount = Number(row.cantidad || 0)
    const rowUnit = formatInventoryUnit(row.unidad || 'g')

    return `
      <article class="recipe-row recipe-row--saved">
        <header class="recipe-row__head">
          <strong>${row.mode === 'existing' ? 'Insumo existente' : 'Insumo nuevo'}</strong>
          <div class="recipe-row__tools">
            <button class="button button--secondary" type="button" data-action="edit-recipe-row" data-row-id="${row.rowId}">Editar</button>
            <button class="button button--ghost" type="button" data-action="remove-recipe-row" data-row-id="${row.rowId}">Quitar</button>
          </div>
        </header>
        <p>${escapeHtml(rowName)} · ${rowAmount > 0 ? `${escapeHtml(String(rowAmount))} ${escapeHtml(rowUnit)}` : 'Sin cantidad'}</p>
      </article>
    `
  }

  if (row.mode === 'new') {
    return `
      <article class="recipe-row recipe-row--new">
        <header class="recipe-row__head">
          <strong>Insumo nuevo</strong>
          <div class="recipe-row__tools">
            <button class="button button--secondary" type="button" data-action="save-recipe-row" data-row-id="${row.rowId}">Guardar insumo</button>
            <button class="button button--ghost" type="button" data-action="remove-recipe-row" data-row-id="${row.rowId}">Quitar</button>
          </div>
        </header>
        <div class="recipe-row__grid">
          <label><span>Nombre</span><input type="text" data-recipe-field data-row-id="${row.rowId}" data-field="nombre" value="${escapeHtml(row.nombre || '')}" /></label>
          <label><span>Cantidad por porcion</span><input type="number" min="0" step="0.01" data-recipe-field data-row-id="${row.rowId}" data-field="cantidad" value="${escapeHtml(row.cantidad || '')}" /></label>
          <label><span>Unidad de uso</span>
            <select data-recipe-field data-row-id="${row.rowId}" data-field="unidad">
              ${INVENTORY_UNIT_OPTIONS.map((option) => `<option value="${option.value}" ${normalizeInventoryUnit(row.unidad || 'g') === option.value ? 'selected' : ''}>${option.label}</option>`).join('')}
            </select>
          </label>
          <label><span>Stock inicial</span><input type="number" min="0" step="1" data-recipe-field data-row-id="${row.rowId}" data-field="stock" value="${escapeHtml(row.stock || '')}" /></label>
          <label><span>Stock minimo</span><input type="number" min="0" step="1" data-recipe-field data-row-id="${row.rowId}" data-field="stockMinimo" value="${escapeHtml(row.stockMinimo || '')}" /></label>
          <label><span>Precio por paquete</span><input type="number" min="0" step="0.01" data-recipe-field data-row-id="${row.rowId}" data-field="precioPaquete" value="${escapeHtml(row.precioPaquete || '')}" /></label>
          <label><span>Cantidad del paquete</span><input type="number" min="0" step="0.01" data-recipe-field data-row-id="${row.rowId}" data-field="cantidadPaquete" value="${escapeHtml(row.cantidadPaquete || '')}" /></label>
          <label><span>Unidad del paquete</span>
            <select data-recipe-field data-row-id="${row.rowId}" data-field="unidadPaquete">
              ${INVENTORY_UNIT_OPTIONS.map((option) => `<option value="${option.value}" ${normalizeInventoryUnit(row.unidadPaquete || 'g') === option.value ? 'selected' : ''}>${option.label}</option>`).join('')}
            </select>
          </label>
        </div>
      </article>
    `
  }

  return `
    <article class="recipe-row">
      <header class="recipe-row__head">
        <strong>Insumo existente</strong>
        <div class="recipe-row__tools">
          <button class="button button--secondary" type="button" data-action="save-recipe-row" data-row-id="${row.rowId}">Guardar insumo</button>
          <button class="button button--ghost" type="button" data-action="remove-recipe-row" data-row-id="${row.rowId}">Quitar</button>
        </div>
      </header>
      <div class="recipe-row__grid">
        <label><span>Insumo</span>
          <select data-recipe-field data-row-id="${row.rowId}" data-field="ingredientId">
            <option value="">Selecciona insumo</option>
            ${existingIngredients.map((ingredient) => `<option value="${ingredient.id}" ${row.ingredientId === ingredient.id ? 'selected' : ''}>${escapeHtml(ingredient.nombre)}${ingredient.costoUnitarioBase ? ` · ${currency(ingredient.costoUnitarioBase)} / ${escapeHtml(getInventoryBaseUnit(ingredient.unidadPaquete || ingredient.unidadBase || ingredient.unidad || 'pza'))}` : ''}</option>`).join('')}
          </select>
        </label>
        <label><span>Cantidad por porcion</span><input type="number" min="0" step="0.01" data-recipe-field data-row-id="${row.rowId}" data-field="cantidad" value="${escapeHtml(row.cantidad || '')}" /></label>
        <label><span>Unidad de uso</span>
          <select data-recipe-field data-row-id="${row.rowId}" data-field="unidad">
            ${INVENTORY_UNIT_OPTIONS.map((option) => `<option value="${option.value}" ${normalizeInventoryUnit(row.unidad || 'g') === option.value ? 'selected' : ''}>${option.label}</option>`).join('')}
          </select>
        </label>
      </div>
    </article>
  `
}

function renderCombosModule() {
  return `
    <section class="module-grid">
      <article class="card module-card combo-admin-card">
        <header class="catalog-module-head">
          <div>
            <p class="eyebrow">Panel de administración</p>
            <h2>Combos</h2>
          </div>
          <button class="catalog-add-button" type="button" data-action="open-combo-create-modal" aria-label="Agregar combo" title="Agregar combo">+</button>
        </header>
        <div class="combo-admin-grid">
          ${state.combos.length > 0 ? state.combos.map((combo) => renderComboAdminCard(combo)).join('') : '<article class="card empty">No hay combos registrados.</article>'}
        </div>
      </article>
      ${state.comboCreateModalOpen ? renderComboModal() : ''}
    </section>
  `
}

function renderComboAdminCard(combo) {
  const items = getComboItems(combo)
  const originalTotal = getComboOriginalTotal(combo)
  const comboPrice = Number(combo.precioCombo || 0)
  const savings = Math.max(originalTotal - comboPrice, 0)

  return `
    <article class="combo-admin-card__item ${combo.activo === false ? 'is-muted' : ''}">
      <div class="combo-admin-card__content">
        <div class="combo-admin-card__title-row">
          <h3>${escapeHtml(combo.nombre || 'Combo sin nombre')}</h3>
          <span class="combo-admin-card__badge">${combo.activo === false ? 'Oculto' : 'Activo'}</span>
        </div>
        <p>${escapeHtml(combo.descripcion || '')}</p>
        <div class="combo-admin-card__meta">
          <strong>${currency(comboPrice)}</strong>
          <span>Precio original ${currency(originalTotal)}</span>
          <span>¡Ahorra ${currency(savings)}!</span>
        </div>
        <ul class="combo-admin-card__components">
          ${items.map((item) => `<li>${escapeHtml(item.nombre)}</li>`).join('')}
        </ul>
      </div>
      <div class="combo-admin-card__actions">
        <button class="button button--secondary" type="button" data-action="edit-combo" data-id="${combo.id}">Editar</button>
        <button class="button button--ghost" type="button" data-action="delete-combo" data-id="${combo.id}">Eliminar</button>
      </div>
    </article>
  `
}

function renderComboModal() {
  const selectedItems = getComboDraftSelectedItems()
  const originalTotal = selectedItems.reduce((sum, item) => sum + Number(item.precio || 0), 0)
  const search = state.comboDraft.search.trim().toLowerCase()
  const visibleItems = getVisibleMenuItems().filter((item) => {
    if (!search) {
      return true
    }

    return [item.nombre, item.descripcion, item.categoria]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(search))
  })

  return `
    <button class="menu-edit-modal__overlay" type="button" data-action="close-combo-modal" aria-label="Cerrar combo"></button>
    <section class="menu-edit-modal combo-modal" role="dialog" aria-modal="true" aria-label="Crear combo">
      <header class="menu-edit-modal__head">
        <h3>${state.editingComboId ? 'Editar combo' : 'Crear combo'}</h3>
        <button class="button button--ghost" type="button" data-action="close-combo-modal">Cerrar</button>
      </header>
      <form class="form-grid combo-form" data-form="combo-save">
        <label class="wide"><span>Nombre del combo</span><input name="nombre" value="${escapeHtml(state.comboDraft.nombre)}" data-combo-field="nombre" required /></label>
        <label class="wide"><span>Descripcion</span><textarea name="descripcion" data-combo-field="descripcion" required>${escapeHtml(state.comboDraft.descripcion)}</textarea></label>
        <div class="combo-summary wide">
          <article class="combo-summary__tile">
            <span>Precio original total</span>
            <strong>${currency(originalTotal)}</strong>
          </article>
          <label class="combo-summary__tile">
            <span>Precio de combo</span>
            <input name="precioCombo" type="number" min="0" step="0.01" value="${escapeHtml(state.comboDraft.precioCombo)}" data-combo-field="precioCombo" required />
          </label>
        </div>
        <section class="combo-picker wide">
          <div class="combo-picker__head">
            <div>
              <p class="eyebrow">Selector de componentes</p>
              <strong>${selectedItems.length} seleccionados</strong>
            </div>
            <input type="search" placeholder="Buscar platillos o bebidas" value="${escapeHtml(state.comboDraft.search)}" data-combo-search />
          </div>
          <div class="combo-picker__selected">
            ${selectedItems.length > 0 ? selectedItems.map((item) => `<button class="combo-chip is-selected" type="button" data-action="toggle-combo-item" data-id="${item.id}">${escapeHtml(item.nombre)} <span>×</span></button>`).join('') : '<span class="combo-picker__empty">Aun no agregas elementos.</span>'}
          </div>
          <div class="combo-picker__list">
            ${visibleItems.length > 0 ? visibleItems.map((item) => renderComboPickerItem(item, state.comboDraft.selectedIds.includes(item.id))).join('') : '<article class="card empty">No encontramos coincidencias.</article>'}
          </div>
        </section>
        <div class="actions wide">
          <button class="button" type="submit">${state.editingComboId ? 'Guardar combo' : 'Crear combo'}</button>
          <button class="button button--ghost" type="button" data-action="close-combo-modal">Cancelar</button>
        </div>
      </form>
    </section>
  `
}

function renderComboPickerItem(item, isSelected) {
  return `
    <article class="combo-picker__item ${isSelected ? 'is-selected' : ''}">
      <div>
        <strong>${escapeHtml(item.nombre)}</strong>
        <p>${escapeHtml(item.categoria || 'Sin categoria')} · ${currency(item.precio)}</p>
      </div>
      <button class="button button--secondary" type="button" data-action="toggle-combo-item" data-id="${item.id}">${isSelected ? 'Quitar' : 'Agregar'}</button>
    </article>
  `
}

function getCatalogMenuSections() {
  const grouped = new Map()

  for (const item of state.menu) {
    const category = (item.categoria || '').trim() || 'Sin categoria'
    if (!grouped.has(category)) {
      grouped.set(category, [])
    }
    grouped.get(category).push(item)
  }

  const sections = []

  for (const category of MENU_CATEGORIES) {
    if (!grouped.has(category)) {
      continue
    }
    sections.push({
      label: category,
      items: grouped.get(category),
    })
    grouped.delete(category)
  }

  const otherCategories = Array.from(grouped.keys()).sort((left, right) => left.localeCompare(right, 'es'))
  for (const category of otherCategories) {
    sections.push({
      label: category,
      items: grouped.get(category),
    })
  }

  return sections
}

function renderInventarioModule() {
  syncInventorySelectionFromData()

  const search = String(state.inventorySearch || '').trim().toLowerCase()
  const visibleItems = state.inventario.filter((item) => {
    if (!search) {
      return true
    }
    return [item.nombre, item.descripcion, item.categoria]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(search))
  })

  const lowStockCount = state.inventario.filter((item) => Number(item.stock || 0) <= Number(item.stockMinimo || 0) || Number(item.stock || 0) <= 0).length
  const inUseCount = state.inventario.filter((item) => item.en_uso !== false).length
  const inventoryValue = state.inventario.reduce((sum, item) => {
    const stock = Number(item.stock || 0)
    const cost = Number(item.costoUnitarioBase || getIngredientUnitCost(item) || 0)
    return sum + stock * cost
  }, 0)
  const selectedItem = getSelectedInventoryItem()
  const selectedName = state.inventorySelectedId === 'new'
    ? 'Nuevo insumo'
    : selectedItem?.nombre || 'Selecciona un insumo'
  const usageBadge = state.inventoryDraft.en_uso ? '🟢 En uso' : '🔴 Inactivo'

  return `
    <section class="module-grid">
      <article class="card module-card inventory-workspace">
        <header class="catalog-module-head">
          <div>
            <p class="eyebrow">Costeo y existencia</p>
            <h2>Control de Insumos</h2>
          </div>
          <button class="catalog-add-button" type="button" data-action="open-ingredient-create-modal" aria-label="Nuevo insumo" title="Nuevo insumo">+ Nuevo</button>
        </header>
        <div class="inventory-kpis inventory-kpis--compact">
          <article class="kpi inventory-kpi"><span>Insumos</span><strong>${state.inventario.length}</strong></article>
          <article class="kpi inventory-kpi"><span>Bajo minimo</span><strong>${lowStockCount}</strong></article>
          <article class="kpi inventory-kpi"><span>En uso</span><strong>${inUseCount}</strong></article>
          <article class="kpi inventory-kpi"><span>Valor inventario</span><strong>${currency(inventoryValue)}</strong></article>
        </div>

        <div class="inventory-layout ${state.inventoryMobileView === 'detail' ? 'is-detail-visible' : ''}">
          <section class="inventory-list-panel card ${state.inventoryMobileView === 'detail' ? 'is-mobile-hidden' : ''}">
            <label class="inventory-search">
              <span>Buscar insumo</span>
              <input type="search" placeholder="Busca por nombre" data-inventory-search value="${escapeHtml(state.inventorySearch)}" />
            </label>
            <div class="inventory-list">
              ${
                visibleItems.length > 0
                  ? visibleItems.map((item) => renderInventoryListCard(item, item.id === state.inventorySelectedId)).join('')
                  : '<article class="card empty">No encontramos insumos con ese filtro.</article>'
              }
            </div>
          </section>

          <section class="inventory-detail-panel card ${state.inventoryMobileView === 'list' ? 'is-mobile-hidden' : ''}">
            <header class="inventory-detail-head">
              <button class="button button--ghost inventory-mobile-back" type="button" data-action="inventory-back-to-list">Volver</button>
              <div>
                <p class="eyebrow">Informacion del insumo</p>
                <h3>${escapeHtml(selectedName)}</h3>
              </div>
              <span class="inventory-status-badge ${state.inventoryDraft.en_uso ? 'is-active' : 'is-inactive'}">${usageBadge}</span>
            </header>

            ${state.inventorySelectedId || state.inventario.length === 0
              ? `
                <div class="inventory-detail-body">
                  <section class="inventory-section">
                    <h4>General</h4>
                    <div class="inventory-field-grid">
                      <label><span>Nombre</span><input type="text" data-inventory-field="nombre" value="${escapeHtml(state.inventoryDraft.nombre || '')}" /></label>
                    </div>
                  </section>

                  <section class="inventory-section">
                    <h4>Inventario</h4>
                    <div class="inventory-field-grid">
                      <label><span>Stock actual</span><input type="number" min="0" step="1" data-inventory-field="stock" value="${escapeHtml(state.inventoryDraft.stock || '0')}" /></label>
                      <label><span>Stock minimo</span><input type="number" min="0" step="1" data-inventory-field="stockMinimo" value="${escapeHtml(state.inventoryDraft.stockMinimo || '0')}" /></label>
                    </div>
                  </section>

                  <section class="inventory-section">
                    <h4>Compra</h4>
                    <div class="inventory-field-grid">
                      <label><span>Precio por paquete</span><input type="number" min="0" step="0.01" data-inventory-field="precioPaquete" value="${escapeHtml(state.inventoryDraft.precioPaquete || '')}" /></label>
                      <label><span>Cantidad del paquete</span><input type="number" min="0" step="0.01" data-inventory-field="cantidadPaquete" value="${escapeHtml(state.inventoryDraft.cantidadPaquete || '')}" /></label>
                      <label><span>Unidad</span>
                        <select data-inventory-field="unidadPaquete">
                          ${INVENTORY_UNIT_OPTIONS.map((option) => `<option value="${option.value}" ${normalizeInventoryUnit(state.inventoryDraft.unidadPaquete || 'pza') === option.value ? 'selected' : ''}>${option.label}</option>`).join('')}
                        </select>
                      </label>
                    </div>
                  </section>

                  <section class="inventory-section">
                    <h4>Estado</h4>
                    <label class="settings-switch inventory-usage-switch">
                      <input type="checkbox" data-inventory-field="en_uso" ${state.inventoryDraft.en_uso ? 'checked' : ''} />
                      <span class="settings-switch__track"><span class="settings-switch__thumb"></span></span>
                      <span class="settings-switch__label">${state.inventoryDraft.en_uso ? 'En uso' : 'Inactivo'}</span>
                    </label>
                  </section>

                  <footer class="inventory-actions">
                    ${state.inventorySelectedId && state.inventorySelectedId !== 'new' ? '<button class="button button--ghost" type="button" data-action="delete-inventory-item">Eliminar</button>' : ''}
                    <div class="inventory-actions__right">
                      <button class="button button--ghost" type="button" data-action="cancel-inventory-draft">Cancelar</button>
                      <button class="button button--cta" type="button" data-action="save-inventory-draft">Guardar cambios</button>
                    </div>
                  </footer>
                </div>
              `
              : '<article class="card empty">Selecciona un insumo de la lista para editarlo o crea uno nuevo.</article>'}
          </section>
        </div>
      </article>
    </section>
  `
}

function renderInventoryListCard(item, isSelected = false) {
  const stock = Number(item.stock || 0)
  const stockMinimo = Number(item.stockMinimo || 0)
  const packageUnit = normalizeInventoryUnit(item.unidadPaquete || item.unidadBase || item.unidad || 'pza')
  const unitCost = Number(item.costoUnitarioBase || getIngredientUnitCost(item) || 0)
  const isLow = stock <= stockMinimo || stock <= 0

  return `
    <button class="inventory-list-card ${isSelected ? 'is-selected' : ''} ${isLow ? 'is-low' : ''}" type="button" data-action="select-inventory-item" data-id="${item.id}">
      <div class="inventory-list-card__head">
        <strong>${escapeHtml(item.nombre || 'Insumo')}</strong>
        <span class="inventory-list-card__status ${item.en_uso ? 'is-active' : 'is-inactive'}">${item.en_uso ? 'Activo' : 'Inactivo'}</span>
      </div>
      <p>${unitCost > 0 ? `${currency(unitCost)} / ${escapeHtml(formatInventoryUnit(packageUnit))}` : 'Sin costo unitario'}</p>
      <div class="inventory-list-card__stock">
        <span>Stock</span>
        <strong>${escapeHtml(String(stock))} ${escapeHtml(formatInventoryUnit(getInventoryBaseUnit(packageUnit)))}</strong>
      </div>
    </button>
  `
}

function renderAdvancedSettingsModule() {
  const contact = getPublicContact()
  const initialSnapshot = createAdvancedSettingsSnapshot(state.settings)
  const categoryRows = ADVANCED_MENU_CATEGORIES.map((category) => {
    const key = getCategoryFieldKey(category)
    const enabled = isMenuCategoryEnabled(category)
    return `
      <article class="settings-toggle-row">
        <div>
          <h3>${escapeHtml(category)}</h3>
          <p>${enabled ? 'Visible para clientes' : 'Oculta en vista cliente'}</p>
        </div>
        <label class="settings-switch" aria-label="Mostrar ${escapeHtml(category)} en menu publico">
          <input type="checkbox" name="category_enabled_${key}" ${enabled ? 'checked' : ''} />
          <span class="settings-switch__track"><span class="settings-switch__thumb"></span></span>
        </label>
      </article>
    `
  }).join('')

  const scheduleRows = WEEK_DAYS.map((day) => {
    const schedule = getPublicScheduleDay(day.key)
    return `
      <article class="settings-day-row ${schedule.closed ? 'is-closed' : ''}">
        <div class="settings-day-row__name">${day.label}</div>
        <label class="settings-switch" aria-label="${day.label} cerrado">
          <input type="checkbox" name="day_closed_${day.key}" ${schedule.closed ? 'checked' : ''} />
          <span class="settings-switch__track"><span class="settings-switch__thumb"></span></span>
          <span class="settings-switch__label">${schedule.closed ? 'Cerrado' : 'Abierto'}</span>
        </label>
        <label><span>Apertura</span><input type="time" name="day_open_${day.key}" value="${escapeHtml(schedule.open)}" ${schedule.closed ? 'disabled' : ''} /></label>
        <label><span>Cierre</span><input type="time" name="day_close_${day.key}" value="${escapeHtml(schedule.close)}" ${schedule.closed ? 'disabled' : ''} /></label>
      </article>
    `
  }).join('')

  return `
    <section class="module-grid">
      <article class="card module-card">
        <header class="settings-head">
          <h2>Configuracion avanzada</h2>
          <p>Controla categorias del menu, datos de contacto y horarios visibles para clientes.</p>
        </header>
        <form class="form-grid settings-grid" data-form="advanced-settings" data-initial-snapshot="${escapeHtml(initialSnapshot)}">
          <section class="settings-block">
            <h3>Interruptores de menu</h3>
            <div class="settings-toggle-list">${categoryRows}</div>
          </section>

          <section class="settings-block">
            <h3>Datos de contacto</h3>
            <div class="settings-contact-grid">
              <label><span>Telefono</span><input name="contact_telefono" type="tel" value="${escapeHtml(contact.telefono)}" placeholder="+52 33 0000 0000" /></label>
              <label><span>WhatsApp</span><input name="contact_whatsapp" type="text" value="${escapeHtml(contact.whatsapp)}" placeholder="https://wa.me/..." /></label>
              <label class="wide"><span>Direccion</span><input name="contact_direccion" type="text" value="${escapeHtml(contact.direccion)}" placeholder="Calle, colonia, codigo postal" /></label>
              <label><span>Instagram</span><input name="contact_instagram" type="url" value="${escapeHtml(contact.instagram)}" placeholder="https://instagram.com/..." /></label>
              <label><span>Facebook</span><input name="contact_facebook" type="url" value="${escapeHtml(contact.facebook)}" placeholder="https://facebook.com/..." /></label>
              <label><span>TikTok</span><input name="contact_tiktok" type="url" value="${escapeHtml(contact.tiktok)}" placeholder="https://tiktok.com/@..." /></label>
            </div>
          </section>

          <section class="settings-block">
            <h3>Gestion de horarios</h3>
            <div class="settings-hours-list">${scheduleRows}</div>
          </section>

          <div class="actions wide">
            <button class="button button--cta" type="submit" data-advanced-settings-submit disabled aria-disabled="true">Guardar configuracion</button>
          </div>
        </form>
      </article>
    </section>
  `
}

function renderIngredientCreateModal() {
  return `
    <button class="menu-edit-modal__overlay" type="button" data-action="close-ingredient-create-modal" aria-label="Cerrar nuevo ingrediente"></button>
    <section class="menu-edit-modal" role="dialog" aria-modal="true" aria-label="Agregar ingrediente">
      <header class="menu-edit-modal__head">
        <h3>Nuevo ingrediente</h3>
        <button class="button button--ghost" type="button" data-action="close-ingredient-create-modal">Cerrar</button>
      </header>
      <form class="form-grid" data-form="inventario">
        <label><span>Ingrediente</span><input name="nombre" required /></label>
        <label><span>Stock actual</span><input name="stock" type="number" min="0" step="1" value="0" /></label>
        <label><span>Stock minimo</span><input name="stockMinimo" type="number" min="0" step="1" value="0" /></label>
        <label><span>Precio por paquete/volumen</span><input name="precioPaquete" type="number" min="0" step="0.01" required /></label>
        <label><span>Cantidad del paquete</span><input name="cantidadPaquete" type="number" min="0" step="0.01" required /></label>
        <label><span>Unidad del paquete</span>
          <select name="unidadPaquete" required>
            ${INVENTORY_UNIT_OPTIONS.map((option) => `<option value="${option.value}">${option.label}</option>`).join('')}
          </select>
        </label>
        <input type="hidden" name="en_uso" value="true" data-new-ingredient-usage />
        <label>
          <span>Estado</span>
          <button class="status-toggle is-active" type="button" data-action="toggle-ingredient-create-usage" data-value="true" aria-pressed="true">
            <span class="status-toggle__dot" aria-hidden="true"></span>
            <span data-new-ingredient-usage-label>En uso</span>
          </button>
        </label>
        <div class="actions wide"><button class="button" type="submit">Agregar ingrediente</button></div>
      </form>
    </section>
  `
}

function renderInventarioRow(item) {
  const stock = Number(item.stock || 0)
  const stockMinimo = Number(item.stockMinimo || 0)
  const packageUnit = normalizeInventoryUnit(item.unidadPaquete || item.unidadBase || item.unidad || 'pza')
  const baseUnit = getInventoryBaseUnit(packageUnit)
  const unitCost = Number(item.costoUnitarioBase || getIngredientUnitCost(item) || 0)

  return `
    <article class="inventory-row ${item.en_uso ? '' : 'warn'} ${stock <= stockMinimo || stock <= 0 ? 'is-low' : ''}">
      <div class="inventory-row__header">
        <div>
          <h3>${escapeHtml(item.nombre)}</h3>
          <p>${item.en_uso ? 'Activo' : 'No asignado a platillo activo'}</p>
        </div>
        <span class="inventory-row__cost">${unitCost > 0 ? `${currency(unitCost)} / ${escapeHtml(baseUnit)}` : 'Sin costo unitario'}</span>
      </div>
      <div class="inventory-row__grid">
        <label><span>Stock actual</span><input data-stock-input="${item.id}" type="number" min="0" step="1" value="${stock}" /></label>
        <label><span>Stock minimo</span><input data-stock-min="${item.id}" type="number" min="0" step="1" value="${stockMinimo}" /></label>
        <label><span>Precio por paquete</span><input data-price-package="${item.id}" type="number" min="0" step="0.01" value="${Number(item.precioPaquete || 0)}" /></label>
        <label><span>Cantidad del paquete</span><input data-package-qty="${item.id}" type="number" min="0" step="0.01" value="${Number(item.cantidadPaquete || 0)}" /></label>
        <label><span>Unidad del paquete</span>
          <select data-package-unit="${item.id}">
            ${INVENTORY_UNIT_OPTIONS.map((option) => `<option value="${option.value}" ${packageUnit === option.value ? 'selected' : ''}>${option.label}</option>`).join('')}
          </select>
        </label>
      </div>
      <button
        class="status-toggle ${item.en_uso ? 'is-active' : ''}"
        type="button"
        data-action="toggle-stock-usage"
        data-usage-toggle="${item.id}"
        data-value="${item.en_uso ? 'true' : 'false'}"
        aria-pressed="${item.en_uso ? 'true' : 'false'}"
      >
        <span class="status-toggle__dot" aria-hidden="true"></span>
        <span class="status-toggle__text">${item.en_uso ? 'En uso' : 'Sin uso'}</span>
      </button>
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
  const serviceType = ORDER_SERVICE_TYPES.includes(state.orderDraft.serviceType) ? state.orderDraft.serviceType : 'mesa'
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
    <form class="form-grid form-grid--order new-order-form order-create-layout new-order-layout" data-form="pedido">
          <section class="order-create-main new-order-panel card">
            <div class="order-top-controls">
              <label class="service-field"><span>Tipo de servicio</span>
                <select class="mesa-select" data-order-service>
                  <option value="mesa" ${serviceType === 'mesa' ? 'selected' : ''}>Servicio en mesa</option>
                  <option value="domicilio" ${serviceType === 'domicilio' ? 'selected' : ''}>Para llevar (A domicilio)</option>
                  <option value="recoger" ${serviceType === 'recoger' ? 'selected' : ''}>Para recoger</option>
                </select>
              </label>
              <label class="order-mode-toggle">
                <span class="order-mode-toggle__label">Platillo personalizado</span>
                <input type="checkbox" data-order-custom-toggle ${state.orderDraft.customMode ? 'checked' : ''} />
                <span class="order-mode-toggle__switch" aria-hidden="true"></span>
              </label>
            </div>

            ${
              serviceType === 'mesa'
                ? `
                  <label class="mesa-field"><span>Mesa</span>
                    <select name="mesa" class="mesa-select" data-order-table required>
                      <option value="">Selecciona</option>
                      ${Array.from(
                        { length: 10 },
                        (_, index) => `<option value="${index + 1}" ${String(index + 1) === String(state.orderDraft.mesa || '') ? 'selected' : ''}>${index + 1}</option>`,
                      ).join('')}
                    </select>
                  </label>
                `
                : ''
            }

            ${
              serviceType === 'domicilio'
                ? `
                  <section class="service-details-grid">
                    <label><span>Calle</span><input type="text" data-order-service-field data-group="delivery" data-field="calle" value="${escapeHtml(state.orderDraft.delivery.calle)}" /></label>
                    <label><span>Numero de casa</span><input type="text" data-order-service-field data-group="delivery" data-field="numeroCasa" value="${escapeHtml(state.orderDraft.delivery.numeroCasa)}" /></label>
                    <label class="wide"><span>Entre calles</span><input type="text" data-order-service-field data-group="delivery" data-field="entreCalles" value="${escapeHtml(state.orderDraft.delivery.entreCalles)}" /></label>
                    <label><span>Hora de entrega</span><input type="time" data-order-service-field data-group="delivery" data-field="horaEntrega" value="${escapeHtml(state.orderDraft.delivery.horaEntrega)}" /></label>
                    <label><span>Telefono</span><input type="tel" data-order-service-field data-group="delivery" data-field="telefono" value="${escapeHtml(state.orderDraft.delivery.telefono)}" /></label>
                    <label class="wide"><span>Nombre del cliente</span><input type="text" data-order-service-field data-group="delivery" data-field="nombreCliente" value="${escapeHtml(state.orderDraft.delivery.nombreCliente)}" /></label>
                  </section>
                `
                : ''
            }

            ${
              serviceType === 'recoger'
                ? `
                  <section class="service-details-grid">
                    <label><span>Nombre</span><input type="text" data-order-service-field data-group="pickup" data-field="nombre" value="${escapeHtml(state.orderDraft.pickup.nombre)}" /></label>
                    <label><span>Apellido</span><input type="text" data-order-service-field data-group="pickup" data-field="apellido" value="${escapeHtml(state.orderDraft.pickup.apellido)}" /></label>
                    <label><span>Numero de telefono</span><input type="tel" data-order-service-field data-group="pickup" data-field="telefono" value="${escapeHtml(state.orderDraft.pickup.telefono)}" /></label>
                    <label><span>Hora para recoger</span><input type="time" data-order-service-field data-group="pickup" data-field="horaRecoger" value="${escapeHtml(state.orderDraft.pickup.horaRecoger)}" /></label>
                  </section>
                `
                : ''
            }

            <div class="order-search-block ${state.orderDraft.customMode ? 'is-hidden' : ''}">
              <span>Buscador de platillos</span>
              <input data-order-search type="search" placeholder="Busca por nombre, categoria o descripcion" value="${escapeHtml(state.orderDraft.query)}" />
              <div class="order-search-scroll">
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