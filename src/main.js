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
const EDITOR_TABS = ['resumen', 'pedidos', 'catalogo', 'insumos', 'configuracion', 'accesos']
const ADMIN_ONLY_EDITOR_TABS = new Set(['accesos'])
const EDITOR_TAB_LABELS = {
  resumen: 'Resumen',
  pedidos: 'Pedidos',
  catalogo: 'Catalogo',
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
  pedidos: [],
  inventario: [],
  notices: [],
  mobileSidebarOpen: false,
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
  ingredientCreateModalOpen: false,
  editingMenuId: null,
}

const noticeTimers = new Map()
let loadingCourtesyTimer = null
let loadingFadeTimer = null
const loadingReadiness = {
  authReady: false,
  menuReady: false,
  settingsReady: false,
}

const subscriptions = {
  accessEntries: null,
  accessProfile: null,
  inventario: null,
  menu: null,
  settings: null,
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
      const ingredientId = actionNode.dataset.id
      const stockInput = document.querySelector(`[data-stock-input="${ingredientId}"]`)
      const usageToggle = document.querySelector(`[data-usage-toggle="${ingredientId}"]`)
      if (!ingredientId || !stockInput || !usageToggle) {
        return
      }

      await updateDoc(doc(db, 'inventario', ingredientId), {
        stock: Number(stockInput.value || 0),
        en_uso: usageToggle.dataset.value === 'true',
        actualizadoEn: serverTimestamp(),
      })
      return
    }

    if (action === 'open-ingredient-create-modal') {
      state.ingredientCreateModalOpen = true
      render()
      return
    }

    if (action === 'close-ingredient-create-modal') {
      state.ingredientCreateModalOpen = false
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
      activeLabel.textContent = nextValue ? 'Visible en menu publico' : 'Oculto del menu publico'
      actionNode.dataset.value = nextValue ? 'true' : 'false'
      actionNode.classList.toggle('is-active', nextValue)
      actionNode.setAttribute('aria-pressed', nextValue ? 'true' : 'false')
      return
    }

    if (action === 'edit-menu-item') {
      state.editingMenuId = actionNode.dataset.id || null
      render()
      return
    }

    if (action === 'open-menu-create-modal') {
      state.menuCreateModalOpen = true
      render()
      return
    }

    if (action === 'close-menu-create-modal') {
      state.menuCreateModalOpen = false
      render()
      return
    }

    if (action === 'close-menu-modal') {
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
  const enUso = String(formData.get('en_uso') || 'true') === 'true'

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
    tomadoEn: serverTimestamp(),
    creadoEn: serverTimestamp(),
    actualizadoEn: serverTimestamp(),
  })

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
        ${renderRouteView()}
      </main>
    </div>
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
  const selectedCategory = enabledCategories.includes(state.menuCategory) ? state.menuCategory : enabledCategories[0]

  if (enabledCategories.length === 0) {
    return '<section class="card empty">El menu no esta disponible por el momento.</section>'
  }

  return `
    <nav class="menu-category-tabs" aria-label="Categorias del menu">
      ${enabledCategories.map(
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
  return `
    <button class="menu-edit-modal__overlay" type="button" data-action="close-menu-create-modal" aria-label="Cerrar nuevo platillo"></button>
    <section class="menu-edit-modal" role="dialog" aria-modal="true" aria-label="Agregar platillo">
      <header class="menu-edit-modal__head">
        <h3>Agregar platillo</h3>
        <button class="button button--ghost" type="button" data-action="close-menu-create-modal">Cerrar</button>
      </header>
      <form class="form-grid" data-form="menu-item-create">
        <label><span>Nombre</span><input name="nombre" required /></label>
        <label><span>Precio</span><input name="precio" type="number" min="0" step="0.01" required /></label>
        <label class="wide"><span>Descripcion</span><textarea name="descripcion" required></textarea></label>
        <label><span>Categoria</span>
          <select name="categoria" required>
            <option value="">Selecciona categoria</option>
            ${MENU_CATEGORIES.map((category) => `<option value="${category}">${category}</option>`).join('')}
          </select>
        </label>
        <label class="wide"><span>Ingredientes (separados por comas)</span><input name="ingredientes" /></label>
        <input type="hidden" name="activo" value="true" data-menu-create-active />
        <label class="wide">
          <span>Estado</span>
          <button class="status-toggle is-active" type="button" data-action="toggle-menu-create-active" data-value="true" aria-pressed="true">
            <span class="status-toggle__dot" aria-hidden="true"></span>
            <span data-menu-create-active-label>Visible en menu publico</span>
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
  return `
    <button class="menu-edit-modal__overlay" type="button" data-action="close-menu-modal" aria-label="Cerrar detalles de platillo"></button>
    <section class="menu-edit-modal" role="dialog" aria-modal="true" aria-label="Editar platillo">
      <header class="menu-edit-modal__head">
        <h3>Editar platillo</h3>
        <button class="button button--ghost" type="button" data-action="close-menu-modal">Cerrar</button>
      </header>
      <form class="form-grid" data-form="menu-item-edit">
        <label><span>Nombre</span><input name="nombre" value="${escapeHtml(item.nombre || '')}" required /></label>
        <label><span>Precio</span><input name="precio" type="number" min="0" step="0.01" value="${escapeHtml(item.precio || '')}" required /></label>
        <label class="wide"><span>Descripcion</span><textarea name="descripcion" required>${escapeHtml(item.descripcion || '')}</textarea></label>
        <label><span>Categoria</span>
          <select name="categoria" required>
            <option value="">Selecciona categoria</option>
            ${MENU_CATEGORIES.map((category) => `<option value="${category}" ${item.categoria === category ? 'selected' : ''}>${category}</option>`).join('')}
          </select>
        </label>
        <label class="wide"><span>Ingredientes (separados por comas)</span><input name="ingredientes" value="${escapeHtml((item.ingredientes || []).join(', '))}" /></label>
        <input type="hidden" name="activo" value="${item.activo !== false ? 'true' : 'false'}" data-menu-edit-active />
        <label class="wide">
          <span>Estado</span>
          <button class="status-toggle ${item.activo !== false ? 'is-active' : ''}" type="button" data-action="toggle-menu-edit-active" data-value="${item.activo !== false ? 'true' : 'false'}" aria-pressed="${item.activo !== false ? 'true' : 'false'}">
            <span class="status-toggle__dot" aria-hidden="true"></span>
            <span data-menu-edit-active-label>${item.activo !== false ? 'Visible en menu publico' : 'Oculto del menu publico'}</span>
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
  return `
    <section class="module-grid">
      <article class="card module-card">
        <header class="catalog-module-head">
          <h2>Control de Insumos</h2>
          <button class="catalog-add-button" type="button" data-action="open-ingredient-create-modal" aria-label="Agregar ingrediente" title="Agregar ingrediente">+</button>
        </header>
        <div class="stack">
          ${
            state.inventario.length > 0
              ? state.inventario.map((item) => renderInventarioRow(item)).join('')
              : '<article class="card empty">Sin insumos registrados.</article>'
          }
        </div>
      </article>
      ${state.ingredientCreateModalOpen ? renderIngredientCreateModal() : ''}
    </section>
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
        <label><span>Stock actual</span><input name="stock" type="number" min="0" step="1" /></label>
        <label><span>Unidad</span><input name="unidad" placeholder="pzas, kg, lts" /></label>
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
  return `
    <article class="inventory-row ${item.en_uso ? '' : 'warn'}">
      <div>
        <h3>${escapeHtml(item.nombre)}</h3>
        <p>${item.en_uso ? 'Activo' : 'No asignado a platillo activo'}</p>
      </div>
      <label><span>Stock</span><input data-stock-input="${item.id}" type="number" value="${Number(item.stock || 0)}" /></label>
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