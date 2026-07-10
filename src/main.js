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
const PRIVATE_ROUTES = new Set(['edicion'])
const EDITOR_TABS = ['pedidos', 'catalogo', 'insumos', 'caja']
const PEDIDO_VIEWS = ['new', 'active', 'history']
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
  editorTab: 'pedidos',
  pedidoView: 'new',
  isBooting: true,
  user: null,
  accessProfile: null,
  accessEntries: [],
  menu: [],
  pedidos: [],
  inventario: [],
  notices: [],
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
    enforceRouteAccess(true)
    syncAdminStreams()
    render()
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

  if (window.location.pathname !== targetPath || window.location.hash) {
    window.history.replaceState(null, '', targetPath)
  }

  state.route = route
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

    if (action === 'set-editor-tab') {
      const nextTab = actionNode.dataset.tab
      if (EDITOR_TABS.includes(nextTab)) {
        state.editorTab = nextTab
        render()
      }
      return
    }

    if (action === 'set-pedido-view') {
      const nextView = actionNode.dataset.view
      if (PEDIDO_VIEWS.includes(nextView)) {
        state.pedidoView = nextView
        render()
      }
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

    if (action === 'go-menu') {
      setRoute('menu')
      render()
      return
    }

    if (action === 'login') {
      await handleLogin()
      return
    }

    if (action === 'logout') {
      await signOut(auth)
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

  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-menu-pick]')) {
      updatePedidoTotal()
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

  const mesa = formData.get('mesa')?.toString().trim()
  const selectedIds = formData.getAll('platillos')
  const platillos = getVisibleMenuItems().filter((item) => selectedIds.includes(item.id))
  const total = platillos.reduce((sum, item) => sum + Number(item.precio || 0), 0)

  if (!mesa || platillos.length === 0) {
    pushNotice('Captura mesa y selecciona al menos un platillo.')
    render()
    return
  }

  await addDoc(collection(db, 'pedidos'), {
    mesa,
    platillos: platillos.map((item) => ({
      id: item.id,
      nombre: item.nombre,
      precio: Number(item.precio || 0),
      categoria: item.categoria,
    })),
    total,
    estado: 'Pendiente',
    cerrado: false,
    creadoEn: serverTimestamp(),
    actualizadoEn: serverTimestamp(),
  })
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
  return state.pedidos.filter((pedido) => pedido.cerrado).slice(0, 8)
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
  const selectedIds = [...document.querySelectorAll('[data-menu-pick]:checked')].map((item) => item.value)
  const total = getVisibleMenuItems()
    .filter((item) => selectedIds.includes(item.id))
    .reduce((sum, item) => sum + Number(item.precio || 0), 0)
  totalNode.textContent = currency(total)
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
    <div class="shell">
      ${renderNavbar()}
      <main class="content">
        ${renderConfigBanner()}
        ${renderRouteView()}
      </main>
    </div>
    ${renderAlerts()}
  `

  updatePedidoTotal()
}

function renderNavbar() {
  return `
    <header class="topbar">
      <a class="brand" href="/dashboard">
        <span class="brand__title">Desvelados</span>
      </a>
      <nav class="nav-links" aria-label="Navegacion principal">
        <a class="nav-link ${state.route === 'dashboard' ? 'is-active' : ''}" href="/dashboard">Inicio</a>
        <a class="nav-link ${state.route === 'menu' ? 'is-active' : ''}" href="/menu">Menu</a>
        ${isAuthorizedUser() ? `<a class="nav-link ${state.route === 'edicion' ? 'is-active' : ''}" href="/edicion">Edicion</a>` : ''}
      </nav>
      ${renderNavAuthArea() ? `<div class="topbar-auth">${renderNavAuthArea()}</div>` : ''}
    </header>
  `
}

function renderNavAuthArea() {
  if (!state.user) {
    return ''
  }

  if (!isAuthorizedUser()) {
    return `
      <span class="pending-pill">Acceso en revision</span>
      <button class="button button--ghost" type="button" data-action="logout">Cerrar Sesion</button>
    `
  }

  return `
    <span class="user-pill">${isBootstrapAdmin() ? 'Administrador' : 'Editor'}</span>
    <button class="button button--ghost" type="button" data-action="logout">Cerrar Sesion</button>
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
  const currentTab = EDITOR_TABS.includes(state.editorTab) ? state.editorTab : 'pedidos'

  return `
    <section class="admin-layout editor-shell">
      <aside class="card sidebar editor-sidebar">
        <p class="eyebrow">Panel de control</p>
        <h2>Edicion</h2>
        <nav class="sidebar-links editor-tabs" aria-label="Herramientas de edicion">
          <button class="sidebar-link editor-tab ${currentTab === 'pedidos' ? 'is-active' : ''}" type="button" data-action="set-editor-tab" data-tab="pedidos">Pedidos y Comandas</button>
          <button class="sidebar-link editor-tab ${currentTab === 'catalogo' ? 'is-active' : ''}" type="button" data-action="set-editor-tab" data-tab="catalogo">Catalogo</button>
          <button class="sidebar-link editor-tab ${currentTab === 'insumos' ? 'is-active' : ''}" type="button" data-action="set-editor-tab" data-tab="insumos">Insumos</button>
          <button class="sidebar-link editor-tab ${currentTab === 'caja' ? 'is-active' : ''}" type="button" data-action="set-editor-tab" data-tab="caja">Caja</button>
        </nav>
      </aside>
      <section class="admin-main">
        ${renderAdminKpis()}
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
  const menuItems = getVisibleMenuItems()
  const currentView = PEDIDO_VIEWS.includes(state.pedidoView) ? state.pedidoView : 'new'

  let viewContent = renderPedidoCreateView(menuItems)
  if (currentView === 'active') {
    viewContent = renderPedidoActiveView()
  }
  if (currentView === 'history') {
    viewContent = renderPedidoHistoryView()
  }

  return `
    <section class="module-grid order-workspace">
      <nav class="order-subnav" aria-label="Submenu de comandas">
        <button class="order-subnav__tab ${currentView === 'new' ? 'is-active' : ''}" type="button" data-action="set-pedido-view" data-view="new">Nueva Orden</button>
        <button class="order-subnav__tab ${currentView === 'active' ? 'is-active' : ''}" type="button" data-action="set-pedido-view" data-view="active">Cocina (Activos)</button>
        <button class="order-subnav__tab ${currentView === 'history' ? 'is-active' : ''}" type="button" data-action="set-pedido-view" data-view="history">Historial (Cerrados)</button>
      </nav>
      ${viewContent}
    </section>
  `
}

function renderPedidoCreateView(menuItems) {
  return `
    <article class="card module-card">
      <h2>Nueva Orden</h2>
      <form class="form-grid form-grid--order" data-form="pedido">
        <div class="order-create-layout">
          <section class="order-create-main">
            <label><span>Mesa</span><input name="mesa" placeholder="Ej. 4" required /></label>
            <div>
              <span>Platillos</span>
              <div class="pick-grid">
                ${
                  menuItems.length > 0
                    ? menuItems
                        .map(
                          (item) => `
                            <label class="pick-item">
                              <input type="checkbox" name="platillos" value="${item.id}" data-menu-pick />
                              <span>${escapeHtml(item.nombre)}</span>
                              <strong>${currency(item.precio)}</strong>
                            </label>
                          `,
                        )
                        .join('')
                    : '<article class="card empty">No hay platillos activos para comandas.</article>'
                }
              </div>
            </div>
          </section>
          <aside class="order-ticket card">
            <p class="eyebrow">Resumen</p>
            <h3>Ticket rapido</h3>
            <div class="total-box"><span>Total estimado</span><strong data-order-total>${currency(0)}</strong></div>
            <button class="button" type="submit">Crear pedido</button>
          </aside>
        </div>
      </form>
    </article>
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
        ${(pedido.platillos || []).map((item) => `<li>${escapeHtml(item.nombre)} · ${currency(item.precio)}</li>`).join('')}
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