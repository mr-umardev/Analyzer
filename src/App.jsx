import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bar,
  Line,
  Pie,
} from 'react-chartjs-2'
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js'
import { jsPDF } from 'jspdf'
import './App.css'
import { decryptJson, deriveVaultKeyCandidates, encryptJson } from './crypto'
import {
  buildMonthlySeries,
  buildTimelineSeries,
  buildYearlySeries,
  companyDurationLabel,
  companyEarningsBreakdown,
  companyTotalEarnings,
  computeMetrics,
  currency,
  toIsoNow,
} from './finance'
import {
  exportEncryptedBackupFile,
  importEncryptedBackupFile,
  loadEncryptedSnapshot,
  saveEncryptedSnapshot,
} from './storage'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Tooltip,
  Legend,
)

const LEGACY_VAULT_PIN = String(
  import.meta.env.VITE_VAULT_PIN ||
  import.meta.env.VITE_PASSWORD ||
  import.meta.env.PASSWORD ||
  '5920188349',
)
  .replace(/\D/g, '')
  .slice(0, 10)
const VAULT_PIN_HASH = String(import.meta.env.VITE_VAULT_PIN_HASH || '').trim().toLowerCase()
const LOCK_AFTER_INACTIVITY_MS = 3 * 60 * 1000
const SESSION_TIMEOUT_MS = 20 * 60 * 1000
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MS = 10 * 60 * 1000
const MAX_BACKUP_FILE_BYTES = 2 * 1024 * 1024
const FAILED_ATTEMPTS_KEY = 'vault-failed-attempts'
const LOCKOUT_UNTIL_KEY = 'vault-lockout-until'
const THEME_KEY = 'vault-theme'
const LIQUID_THEME_KEY = 'vault-liquid-theme'
const LAST_QUOTE_INDEX_KEY = 'vault-last-quote-index'

const THEMES = [
  { id: 'dark-gold', label: 'Dark Gold' },
  { id: 'light-ivory', label: 'Light Ivory' },
  { id: 'emerald-night', label: 'Emerald Night' },
  { id: 'arctic-frost', label: 'Arctic Frost' },
  { id: 'ocean-deep', label: 'Ocean Deep' },
  { id: 'ruby-ink', label: 'Ruby Ink' },
  { id: 'sunset-copper', label: 'Sunset Copper' },
  { id: 'forest-ledger', label: 'Forest Ledger' },
  { id: 'midnight-indigo', label: 'Midnight Indigo' },
  { id: 'graphite-silver', label: 'Graphite Silver' },
  { id: 'desert-sand', label: 'Desert Sand' },
  { id: 'neon-cyan', label: 'Neon Cyan' },
]

const INSPIRATION_QUOTES = [
  'Small disciplined steps compound into extraordinary financial freedom.',
  'Wealth grows when intention meets consistency.',
  'Every informed decision today secures your tomorrow.',
  'Master your cash flow and you master your future.',
  'Great fortunes are built by patient habits, not lucky moments.',
  'Clarity in numbers creates confidence in life.',
  'Your financial vision deserves daily action.',
  'Security, growth, and discipline are the true premium assets.',
  'Track carefully, decide wisely, and let compounding do the rest.',
  'Progress in finance is rarely loud, but always powerful.',
]

const LIQUID_THEMES = [
  { id: 'ivory-ink', label: 'Ivory Ink' },
  { id: 'ice-ink', label: 'Ice Ink' },
  { id: 'mint-ink', label: 'Mint Ink' },
  { id: 'rose-ink', label: 'Rose Ink' },
  { id: 'sunset-ink', label: 'Sunset Ink' },
  { id: 'graphite-ink', label: 'Graphite Ink' },
  { id: 'obsidian-ink', label: 'Obsidian Ink' },
  { id: 'midnight-ink', label: 'Midnight Ink' },
  { id: 'deep-ocean-ink', label: 'Deep Ocean Ink' },
  { id: 'ember-ink', label: 'Ember Ink' },
]

const HOME_VIEW_MODES = [
  { id: 'both', label: 'Both Data and Visualization' },
  { id: 'metrics-only', label: 'Metrics Only' },
  { id: 'visualization-only', label: 'Visualization Only' },
]

function defaultState() {
  return {
    mainBalance: 0,
    transactions: [],
    companies: [],
    updatedAt: toIsoNow(),
  }
}

function sanitizeNote(note) {
  return String(note || '').trim().slice(0, 120)
}

function parseAmount(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  if (parsed <= 0 || parsed > 1000000000000) return null
  return Math.round(parsed * 100) / 100
}

function parseDateInput(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return null
  return value
}

function greetingByHour(hour) {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  if (hour < 21) return 'Good evening'
  return 'Good night'
}

function fixedTimeEqual(left, right) {
  const a = String(left || '')
  const b = String(right || '')
  const maxLength = Math.max(a.length, b.length)
  let mismatch = a.length === b.length ? 0 : 1

  for (let i = 0; i < maxLength; i += 1) {
    const codeA = i < a.length ? a.charCodeAt(i) : 0
    const codeB = i < b.length ? b.charCodeAt(i) : 0
    mismatch |= codeA ^ codeB
  }

  return mismatch === 0
}

function normalizePin(value) {
  return String(value || '')
    .replace(/\D/g, '')
    .slice(0, 10)
}

async function sha256Hex(value) {
  const encoded = new TextEncoder().encode(String(value || ''))
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  const bytes = new Uint8Array(digest)
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function matchesVaultPin(pin) {
  const normalized = normalizePin(pin)
  if (VAULT_PIN_HASH) {
    const digest = await sha256Hex(normalized)
    return fixedTimeEqual(digest, VAULT_PIN_HASH)
  }
  return fixedTimeEqual(normalized, LEGACY_VAULT_PIN)
}

function nextQuoteIndex(previousIndex) {
  if (INSPIRATION_QUOTES.length <= 1) return 0

  let index = Math.floor(Math.random() * INSPIRATION_QUOTES.length)
  if (index === previousIndex) {
    index = (index + 1) % INSPIRATION_QUOTES.length
  }
  return index
}

function getRotatingQuote() {
  let previousIndex = -1
  const stored = Number(localStorage.getItem(LAST_QUOTE_INDEX_KEY))
  if (Number.isInteger(stored) && stored >= 0 && stored < INSPIRATION_QUOTES.length) {
    previousIndex = stored
  }

  const index = nextQuoteIndex(previousIndex)
  localStorage.setItem(LAST_QUOTE_INDEX_KEY, String(index))
  return INSPIRATION_QUOTES[index]
}

function readSessionNumber(key) {
  const raw = sessionStorage.getItem(key)
  if (!raw) return 0
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

function isReasonableIsoDate(value) {
  if (typeof value !== 'string') return false
  const date = new Date(value)
  return !Number.isNaN(date.valueOf())
}

function sanitizeRestoredState(restored) {
  const base = defaultState()
  if (!restored || typeof restored !== 'object') {
    return base
  }

  const safeTransactions = Array.isArray(restored.transactions)
    ? restored.transactions.slice(0, 20000).filter((tx) => tx && typeof tx === 'object').map((tx) => ({
        id: typeof tx.id === 'string' ? tx.id : crypto.randomUUID(),
        kind: typeof tx.kind === 'string' ? tx.kind : 'transfers',
        direction: tx.direction === 'subtract' ? 'subtract' : 'add',
        amount: Number.isFinite(Number(tx.amount)) ? Math.abs(Number(tx.amount)) : 0,
        note: sanitizeNote(tx.note),
        previousBalance: Number.isFinite(Number(tx.previousBalance)) ? Number(tx.previousBalance) : 0,
        resultingBalance: Number.isFinite(Number(tx.resultingBalance)) ? Number(tx.resultingBalance) : 0,
        timestamp: isReasonableIsoDate(tx.timestamp) ? tx.timestamp : toIsoNow(),
      }))
    : []

  const safeCompanies = Array.isArray(restored.companies)
    ? restored.companies.slice(0, 5000).filter((company) => company && typeof company === 'object').map((company) => ({
        id: typeof company.id === 'string' ? company.id : crypto.randomUUID(),
        companyName: String(company.companyName || '').trim().slice(0, 80),
        role: String(company.role || '').trim().slice(0, 80),
        joiningDate: isReasonableIsoDate(company.joiningDate) ? company.joiningDate : toIsoNow(),
        leavingDate: company.leavingDate && isReasonableIsoDate(company.leavingDate) ? company.leavingDate : '',
        monthlySalary: Number.isFinite(Number(company.monthlySalary)) ? Math.max(0, Number(company.monthlySalary)) : 0,
        promotions: Number.isFinite(Number(company.promotions)) ? Math.max(0, Math.floor(Number(company.promotions))) : 0,
        newMonthlySalary: Number.isFinite(Number(company.newMonthlySalary)) ? Math.max(0, Number(company.newMonthlySalary)) : 0,
        promotedMonths: Number.isFinite(Number(company.promotedMonths)) ? Math.max(0, Math.floor(Number(company.promotedMonths))) : 0,
        bonuses: Number.isFinite(Number(company.bonuses)) ? Math.max(0, Number(company.bonuses)) : 0,
      }))
    : []

  return {
    mainBalance: Number.isFinite(Number(restored.mainBalance)) ? Number(restored.mainBalance) : 0,
    transactions: safeTransactions,
    companies: safeCompanies,
    updatedAt: isReasonableIsoDate(restored.updatedAt) ? restored.updatedAt : toIsoNow(),
  }
}

function isValidEncryptedBackup(backup) {
  if (!backup || typeof backup !== 'object') return false
  if (backup.format !== 'svb-backup-v1') return false
  if (!backup.payload || typeof backup.payload !== 'object') return false
  if (backup.payload.version !== 1) return false
  if (typeof backup.payload.iv !== 'string' || typeof backup.payload.data !== 'string') {
    return false
  }
  return backup.payload.data.length <= 12 * 1024 * 1024
}

function App() {
  const [phase, setPhase] = useState('locked')
  const [screen, setScreen] = useState('home')
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState('')
  const [failedAttempts, setFailedAttempts] = useState(() => readSessionNumber(FAILED_ATTEMPTS_KEY))
  const [lockoutUntil, setLockoutUntil] = useState(() => readSessionNumber(LOCKOUT_UNTIL_KEY))
  const [clockMs, setClockMs] = useState(Date.now())
  const [themeId, setThemeId] = useState(() => {
    const stored = localStorage.getItem(THEME_KEY)
    return THEMES.some((theme) => theme.id === stored) ? stored : 'dark-gold'
  })
  const [liquidThemeId, setLiquidThemeId] = useState(() => {
    const stored = localStorage.getItem(LIQUID_THEME_KEY)
    return LIQUID_THEMES.some((theme) => theme.id === stored) ? stored : 'ivory-ink'
  })
  const [loginGreeting, setLoginGreeting] = useState(() => ({
    salutation: greetingByHour(new Date().getHours()),
    quote: getRotatingQuote(),
  }))
  const [vaultKey, setVaultKey] = useState(null)
  const [state, setState] = useState(defaultState)
  const [loadingState, setLoadingState] = useState(false)
  const [formError, setFormError] = useState('')
  const [companyError, setCompanyError] = useState('')
  const [dialRotationDeg, setDialRotationDeg] = useState(0)
  const [dialPulsing, setDialPulsing] = useState(false)
  const [homeViewMode, setHomeViewMode] = useState('both')
  const [pdfExporting, setPdfExporting] = useState(false)

  const [adjustmentForm, setAdjustmentForm] = useState({
    kind: 'income',
    direction: 'add',
    amount: '',
    note: '',
  })

  const [setBalanceAmount, setSetBalanceAmount] = useState('')
  const [companyForm, setCompanyForm] = useState({
    companyName: '',
    role: '',
    joiningDate: '',
    leavingDate: '',
    monthlySalary: '',
    promotions: '',
    newMonthlySalary: '',
    promotedMonths: '',
    bonuses: '',
  })

  const [editingCompanyId, setEditingCompanyId] = useState(null)
  const [editTx, setEditTx] = useState(null)

  const inactivityRef = useRef(null)
  const sessionRef = useRef(null)
  const persistRef = useRef(null)
  const stateRef = useRef(state)
  const vaultKeyRef = useRef(vaultKey)
  const balanceSectionRef = useRef(null)
  const companySectionRef = useRef(null)
  const balanceChartRef = useRef(null)
  const flowChartRef = useRef(null)
  const savingsChartRef = useRef(null)
  const monthlyChartRef = useRef(null)
  const yearlyChartRef = useRef(null)
  const distributionChartRef = useRef(null)
  const companyGrowthChartRef = useRef(null)

  const metrics = useMemo(() => computeMetrics(state), [state])
  const timelineSeries = useMemo(
    () => buildTimelineSeries(state.transactions),
    [state.transactions],
  )
  const monthlySeries = useMemo(
    () => buildMonthlySeries(state.transactions),
    [state.transactions],
  )
  const yearlySeries = useMemo(
    () => buildYearlySeries(state.transactions),
    [state.transactions],
  )

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    vaultKeyRef.current = vaultKey
  }, [vaultKey])

  async function flushSave() {
    const key = vaultKeyRef.current
    const currentState = stateRef.current
    if (!key) return
    clearTimeout(persistRef.current)
    const payload = await encryptJson(currentState, key)
    await saveEncryptedSnapshot(payload)
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeId)
    localStorage.setItem(THEME_KEY, themeId)
  }, [themeId])

  useEffect(() => {
    localStorage.setItem(LIQUID_THEME_KEY, liquidThemeId)
  }, [liquidThemeId])

  useEffect(() => {
    if (!dialPulsing) {
      return undefined
    }
    const id = setTimeout(() => setDialPulsing(false), 180)
    return () => clearTimeout(id)
  }, [dialPulsing])

  async function lockSession(message = 'Session locked. Enter PIN to continue.') {
    await flushSave()
    setPhase('locked')
    setScreen('home')
    setPinInput('')
    setPinError(message)
    setVaultKey(null)
  }

  useEffect(() => {
    sessionStorage.setItem(FAILED_ATTEMPTS_KEY, String(failedAttempts))
  }, [failedAttempts])

  useEffect(() => {
    sessionStorage.setItem(LOCKOUT_UNTIL_KEY, String(lockoutUntil))
  }, [lockoutUntil])

  useEffect(() => {
    if (lockoutUntil <= Date.now()) {
      return undefined
    }
    const id = setInterval(() => setClockMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [lockoutUntil])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && phase === 'unlocked') {
        lockSession('Session hidden. Vault locked.')
      }
    }

    const onWindowBlur = () => {
      if (phase === 'unlocked') {
        lockSession('Window focus lost. Vault locked.')
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('blur', onWindowBlur)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [phase])

  useEffect(() => {
    const onBeforeUnload = () => {
      flushSave()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  useEffect(() => {
    try {
      if (window.top !== window.self) {
        lockSession('Embedded frame blocked for security.')
      }
    } catch {
      lockSession('Cross-frame access blocked for security.')
    }
  }, [])

  useEffect(() => {
    if (!vaultKey || phase !== 'unlocked') {
      return undefined
    }

    clearTimeout(persistRef.current)
    persistRef.current = setTimeout(async () => {
      const payload = await encryptJson(state, vaultKey)
      await saveEncryptedSnapshot(payload)
    }, 250)

    return () => clearTimeout(persistRef.current)
  }, [phase, state, vaultKey])

  useEffect(() => {
    if (phase !== 'unlocked') {
      return undefined
    }

    const lockNow = () => lockSession()

    const resetInactivity = () => {
      clearTimeout(inactivityRef.current)
      inactivityRef.current = setTimeout(lockNow, LOCK_AFTER_INACTIVITY_MS)
    }

    const activityEvents = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']
    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, resetInactivity)
    })

    resetInactivity()
    clearTimeout(sessionRef.current)
    sessionRef.current = setTimeout(lockNow, SESSION_TIMEOUT_MS)

    return () => {
      clearTimeout(inactivityRef.current)
      clearTimeout(sessionRef.current)
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, resetInactivity)
      })
    }
  }, [phase])

  async function unlockVault() {
    setPinError('')
    const enteredPin = normalizePin(pinInput)

    const now = Date.now()
    if (lockoutUntil > now) {
      setPinError(`Too many failed attempts. Try again at ${new Date(lockoutUntil).toLocaleTimeString()}.`)
      return
    }

    if (!window.isSecureContext) {
      setPinError('Secure context required. Use HTTPS or localhost only.')
      return
    }

    if (!/^\d{10}$/.test(enteredPin)) {
      setPinError('PIN must be exactly 10 digits.')
      return
    }

    const isPinValid = await matchesVaultPin(enteredPin)
    if (!isPinValid) {
      const nextAttempts = failedAttempts + 1
      setFailedAttempts(nextAttempts)
      if (nextAttempts >= MAX_FAILED_ATTEMPTS) {
        const nextLockout = Date.now() + LOCKOUT_MS
        setLockoutUntil(nextLockout)
        setPinError(`Vault locked for 10 minutes after repeated failures. Unlock at ${new Date(nextLockout).toLocaleTimeString()}.`)
      } else {
        setPinError(`Access denied. ${MAX_FAILED_ATTEMPTS - nextAttempts} attempt(s) remaining.`)
      }
      setPinInput('')
      return
    }

    setLoadingState(true)

    try {
      const keyCandidates = await deriveVaultKeyCandidates(enteredPin)
      const encryptedSnapshot = await loadEncryptedSnapshot()

      if (encryptedSnapshot) {
        let restored = null
        let unlockedKey = null

        for (const candidateKey of keyCandidates) {
          try {
            restored = await decryptJson(encryptedSnapshot, candidateKey)
            unlockedKey = candidateKey
            break
          } catch {
            // Try next key candidate.
          }
        }

        if (!restored || !unlockedKey) {
          throw new Error('Unable to decrypt snapshot with known key settings')
        }

        setState(sanitizeRestoredState(restored))
        setVaultKey(unlockedKey)
      } else {
        setState(defaultState())
        setVaultKey(keyCandidates[0])
      }

      setFailedAttempts(0)
      setLockoutUntil(0)

      const hour = new Date().getHours()
      setLoginGreeting({
        salutation: greetingByHour(hour),
        quote: getRotatingQuote(),
      })

      setPhase('opening')
      setTimeout(() => {
        setScreen('home')
        setPhase('unlocked')
      }, 1600)
    } catch {
      setPinError('Unable to unlock vault. Backup may be corrupted.')
    } finally {
      setPinInput('')
      setLoadingState(false)
    }
  }

  function createTransaction({ kind, direction, amount, note }) {
    setState((prev) => {
      const previousBalance = Number(prev.mainBalance || 0)
      const resultingBalance =
        direction === 'add'
          ? previousBalance + amount
          : previousBalance - amount

      return {
        ...prev,
        mainBalance: Math.round(resultingBalance * 100) / 100,
        transactions: [
          {
            id: crypto.randomUUID(),
            kind,
            direction,
            amount,
            note: sanitizeNote(note),
            previousBalance: Math.round(previousBalance * 100) / 100,
            resultingBalance: Math.round(resultingBalance * 100) / 100,
            timestamp: toIsoNow(),
          },
          ...prev.transactions,
        ],
        updatedAt: toIsoNow(),
      }
    })
  }

  function submitAdjustment(event) {
    event.preventDefault()
    setFormError('')

    const amount = parseAmount(adjustmentForm.amount)
    if (amount === null) {
      setFormError('Amount must be a valid number greater than 0.')
      return
    }

    createTransaction({
      kind: adjustmentForm.kind,
      direction: adjustmentForm.direction,
      amount,
      note: adjustmentForm.note,
    })

    setAdjustmentForm((prev) => ({
      ...prev,
      amount: '',
      note: '',
    }))
  }

  function submitSetBalance(event) {
    event.preventDefault()
    setFormError('')

    const amount = parseAmount(setBalanceAmount)
    if (amount === null) {
      setFormError('Set balance requires a valid amount greater than 0.')
      return
    }

    setState((prev) => {
      const previous = Number(prev.mainBalance || 0)
      return {
        ...prev,
        mainBalance: amount,
        transactions: [
          {
            id: crypto.randomUUID(),
            kind: 'transfers',
            direction: amount >= previous ? 'add' : 'subtract',
            amount: Math.abs(amount - previous),
            note: 'Manual balance set',
            previousBalance: previous,
            resultingBalance: amount,
            timestamp: toIsoNow(),
          },
          ...prev.transactions,
        ],
        updatedAt: toIsoNow(),
      }
    })

    setSetBalanceAmount('')
  }

  function resetBalance() {
    setState((prev) => {
      const previous = Number(prev.mainBalance || 0)
      return {
        ...prev,
        mainBalance: 0,
        transactions: [
          {
            id: crypto.randomUUID(),
            kind: 'transfers',
            direction: previous >= 0 ? 'subtract' : 'add',
            amount: Math.abs(previous),
            note: 'Balance reset to zero',
            previousBalance: previous,
            resultingBalance: 0,
            timestamp: toIsoNow(),
          },
          ...prev.transactions,
        ],
        updatedAt: toIsoNow(),
      }
    })
  }

  function pdfCurrency(value) {
    const num = Number(value || 0)
    const abs = Math.abs(num)
    const [intPart, decPart] = abs.toFixed(2).split('.')
    let formatted = intPart
    if (intPart.length > 3) {
      const last3 = intPart.slice(-3)
      const rest = intPart.slice(0, -3)
      const groups = []
      for (let i = rest.length; i > 0; i -= 2) {
        groups.unshift(rest.slice(Math.max(0, i - 2), i))
      }
      formatted = groups.join(',') + ',' + last3
    }
    return `${num < 0 ? '-' : ''}Rs. ${formatted}.${decPart}`
  }

  function recalcTxBalances(transactions) {
    if (transactions.length === 0) return []
    const chrono = [...transactions].reverse()
    const start = Number(chrono[0].previousBalance || 0)
    let bal = start
    const result = chrono.map((tx) => {
      const prev = bal
      const amt = Number(tx.amount || 0)
      bal = tx.direction === 'add' ? prev + amt : prev - amt
      return {
        ...tx,
        previousBalance: Math.round(prev * 100) / 100,
        resultingBalance: Math.round(bal * 100) / 100,
      }
    })
    return result.reverse()
  }

  function deleteCompany(id) {
    setState((prev) => ({
      ...prev,
      companies: prev.companies.filter((c) => c.id !== id),
      updatedAt: toIsoNow(),
    }))
    if (editingCompanyId === id) {
      setEditingCompanyId(null)
      setCompanyForm({ companyName: '', role: '', joiningDate: '', leavingDate: '', monthlySalary: '', promotions: '', newMonthlySalary: '', promotedMonths: '', bonuses: '' })
    }
  }

  function startEditCompany(company) {
    setEditingCompanyId(company.id)
    setCompanyForm({
      companyName: company.companyName,
      role: company.role,
      joiningDate: company.joiningDate,
      leavingDate: company.leavingDate || '',
      monthlySalary: String(company.monthlySalary),
      promotions: String(company.promotions || ''),
      newMonthlySalary: company.newMonthlySalary ? String(company.newMonthlySalary) : '',
      promotedMonths: company.promotedMonths ? String(company.promotedMonths) : '',
      bonuses: company.bonuses ? String(company.bonuses) : '',
    })
    companySectionRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  function cancelEditCompany() {
    setEditingCompanyId(null)
    setCompanyForm({ companyName: '', role: '', joiningDate: '', leavingDate: '', monthlySalary: '', promotions: '', newMonthlySalary: '', promotedMonths: '', bonuses: '' })
    setCompanyError('')
  }

  function deleteTx(id) {
    setState((prev) => {
      const chrono = [...prev.transactions].reverse()
      const start = chrono.length > 0 ? Number(chrono[0].previousBalance || 0) : 0
      const filtered = chrono.filter((tx) => tx.id !== id)
      let bal = start
      const recalculated = filtered.map((tx) => {
        const p = bal
        const amt = Number(tx.amount || 0)
        bal = tx.direction === 'add' ? p + amt : p - amt
        return { ...tx, previousBalance: Math.round(p * 100) / 100, resultingBalance: Math.round(bal * 100) / 100 }
      })
      return {
        ...prev,
        transactions: recalculated.reverse(),
        mainBalance: recalculated.length > 0 ? recalculated[recalculated.length - 1].resultingBalance : start,
        updatedAt: toIsoNow(),
      }
    })
    if (editTx?.id === id) setEditTx(null)
  }

  function startEditTx(tx) {
    setEditTx({ id: tx.id, kind: tx.kind, direction: tx.direction, amount: String(tx.amount), note: tx.note || '' })
  }

  function saveEditTx(event) {
    event.preventDefault()
    setFormError('')
    const amount = parseAmount(editTx.amount)
    if (amount === null) {
      setFormError('Amount must be a valid number greater than 0.')
      return
    }
    setState((prev) => {
      const chrono = [...prev.transactions].reverse()
      const start = chrono.length > 0 ? Number(chrono[0].previousBalance || 0) : 0
      const updated = chrono.map((tx) =>
        tx.id === editTx.id
          ? { ...tx, kind: editTx.kind, direction: editTx.direction, amount, note: sanitizeNote(editTx.note) }
          : tx,
      )
      let bal = start
      const recalculated = updated.map((tx) => {
        const p = bal
        const amt = Number(tx.amount || 0)
        bal = tx.direction === 'add' ? p + amt : p - amt
        return { ...tx, previousBalance: Math.round(p * 100) / 100, resultingBalance: Math.round(bal * 100) / 100 }
      })
      return {
        ...prev,
        transactions: recalculated.reverse(),
        mainBalance: recalculated.length > 0 ? recalculated[recalculated.length - 1].resultingBalance : start,
        updatedAt: toIsoNow(),
      }
    })
    setEditTx(null)
  }

  function submitCompany(event) {
    event.preventDefault()
    setCompanyError('')

    const monthlySalary = parseAmount(companyForm.monthlySalary)
    const promotions = Number(companyForm.promotions || 0)
    const newMonthlySalary = companyForm.newMonthlySalary
      ? parseAmount(companyForm.newMonthlySalary)
      : 0
    const promotedMonths = Number(companyForm.promotedMonths || 0)
    const bonuses = parseAmount(companyForm.bonuses || 0) ?? 0

    if (!companyForm.companyName.trim() || !companyForm.role.trim()) {
      setCompanyError('Company name and role are required.')
      return
    }

    const joiningDate = parseDateInput(companyForm.joiningDate)
    if (!joiningDate) {
      setCompanyError('Joining date is required.')
      return
    }

    const leavingDate = companyForm.leavingDate ? parseDateInput(companyForm.leavingDate) : ''
    if (companyForm.leavingDate && !leavingDate) {
      setCompanyError('Leaving date is invalid.')
      return
    }

    if (monthlySalary === null) {
      setCompanyError('Monthly salary must be a valid positive amount.')
      return
    }

    if (!Number.isInteger(promotions) || promotions < 0) {
      setCompanyError('Promotions must be 0 or a positive whole number.')
      return
    }

    if (promotions > 0 && newMonthlySalary === null) {
      setCompanyError('New monthly salary must be valid when promotions are provided.')
      return
    }

    if (!Number.isInteger(promotedMonths) || promotedMonths < 0) {
      setCompanyError('Months at new salary must be a whole number.')
      return
    }

    const companyData = {
      companyName: companyForm.companyName.trim().slice(0, 80),
      role: companyForm.role.trim().slice(0, 80),
      joiningDate,
      leavingDate,
      monthlySalary,
      promotions,
      newMonthlySalary,
      promotedMonths,
      bonuses,
    }

    if (editingCompanyId) {
      setState((prev) => ({
        ...prev,
        companies: prev.companies.map((c) =>
          c.id === editingCompanyId ? { ...c, ...companyData } : c,
        ),
        updatedAt: toIsoNow(),
      }))
      setEditingCompanyId(null)
    } else {
      setState((prev) => ({
        ...prev,
        companies: [{ id: crypto.randomUUID(), ...companyData }, ...prev.companies],
        updatedAt: toIsoNow(),
      }))
    }

    setCompanyForm({
      companyName: '',
      role: '',
      joiningDate: '',
      leavingDate: '',
      monthlySalary: '',
      promotions: '',
      newMonthlySalary: '',
      promotedMonths: '',
      bonuses: '',
    })
  }

  async function exportBackup() {
    try {
      const backup = await exportEncryptedBackupFile()
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `svb-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setFormError('No encrypted data exists to export yet.')
    }
  }

  async function readChartSnapshot(chartRef) {
    const chart = chartRef.current
    if (!chart || typeof chart.toBase64Image !== 'function' || typeof chart.resize !== 'function') {
      return null
    }

    const sourceWidth = Number(chart.width || chart.canvas?.width || 0)
    const sourceHeight = Number(chart.height || chart.canvas?.height || 0)
    if (!sourceWidth || !sourceHeight) {
      return null
    }

    const exportWidth = Math.max(1200, sourceWidth)
    const exportHeight = Math.max(700, Math.round(exportWidth * (sourceHeight / sourceWidth)))

    chart.resize(exportWidth, exportHeight)
    chart.update('none')
    await new Promise((resolve) => requestAnimationFrame(resolve))

    const image = chart.toBase64Image('image/png', 1)

    chart.resize(sourceWidth, sourceHeight)
    chart.update('none')

    return {
      image,
      width: exportWidth,
      height: exportHeight,
    }
  }

  async function readPublicImageDataUrl(path) {
    const response = await fetch(path)
    if (!response.ok) {
      throw new Error('Unable to load image')
    }
    const blob = await response.blob()
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('Unable to decode image'))
      reader.readAsDataURL(blob)
    })
  }

  async function exportPdfReport() {
    setFormError('')
    setPdfExporting(true)

    try {
      const doc = new jsPDF({ unit: 'pt', format: 'a4' })
      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const margin = 36
      const footerReservedHeight = 66
      const contentWidth = pageWidth - margin * 2
      const bannerHeight = 76
      let y = margin + bannerHeight + 18
      let footerImageData = null

      try {
        footerImageData = await readPublicImageDataUrl('/BCE.png')
      } catch {
        footerImageData = null
      }

      const paintPageFrame = () => {
        doc.setFillColor(10, 10, 10)
        doc.rect(0, 0, pageWidth, pageHeight, 'F')

        doc.setFillColor(17, 24, 39)
        doc.rect(0, 0, pageWidth, bannerHeight, 'F')

        doc.setTextColor(255, 255, 255)
        doc.setFontSize(24)
        doc.text('The Vault', margin, margin + 28)

        doc.setTextColor(194, 203, 214)
        doc.setFontSize(11)
        doc.text('Encrypted Personal Finance Intelligence Report', margin, margin + 46)

        // Dual premium separators below the banner.
        doc.setDrawColor(212, 175, 55)
        doc.setLineWidth(2)
        doc.line(margin, bannerHeight + 10, pageWidth - margin, bannerHeight + 10)
        doc.setLineWidth(4)
        doc.line(margin, bannerHeight + 17, pageWidth - margin, bannerHeight + 17)

        doc.setDrawColor(58, 66, 86)
        doc.setLineWidth(1)
        doc.line(margin, pageHeight - footerReservedHeight, pageWidth - margin, pageHeight - footerReservedHeight)

        if (footerImageData) {
        // --- COMPACT DIMENSIONS ---
        const footerWidth = 60  // Reduced width for a sleeker look
        const footerHeight = 40 // Slimmer breadth to fit elegantly in the corner
        
        // --- RIGHT ALIGNMENT ---
        // Aligns the right edge of the image perfectly with the right margin (pageWidth - margin)
        const footerX = pageWidth - margin - footerWidth
        
        // --- VERTICAL CENTERING ---
        // (66pt footer area - 12pt image height = 54pt leftover space / 2 = 27pt top padding)
        const footerY = pageHeight - footerReservedHeight + 27
        
        doc.addImage(footerImageData, 'PNG', footerX, footerY, footerWidth, footerHeight, undefined, 'FAST')
      }
      }


      const drawSectionHeading = (text) => {
        doc.setTextColor(244, 246, 248)
        doc.setFontSize(14)
        doc.text(text, margin, y)
        doc.setDrawColor(212, 175, 55)
        doc.setLineWidth(1.6)
        doc.line(margin, y + 6, margin + 170, y + 6)
        y += 16
      }

      paintPageFrame()

      const ensureSpace = (requiredHeight) => {
        if (y + requiredHeight <= pageHeight - margin - footerReservedHeight) return
        doc.addPage()
        paintPageFrame()
        y = margin + bannerHeight + 18
      }

      doc.setTextColor(194, 203, 214)
      doc.setFontSize(10)
      doc.text(`Generated: ${new Date().toLocaleString()}`, margin, y)
      y += 18

      drawSectionHeading('Key Metrics')

      const metricRows = [
        ['Current Balance', pdfCurrency(metrics.currentBalance)],
        ['Lifetime Earnings', pdfCurrency(metrics.lifetimeEarnings)],
        ['Career Earnings', pdfCurrency(metrics.companyEarnings)],
        ['Total Income', pdfCurrency(metrics.totalIncome)],
        ['Total Expenses', pdfCurrency(metrics.totalExpenses)],
        ['Total Savings', pdfCurrency(metrics.totalSavings)],
        ['Net Worth', pdfCurrency(metrics.netWorth)],
        ['Financial Growth', `${metrics.financialGrowth.toFixed(2)}%`],
      ]

      const metricBoxGap = 10
      const metricBoxWidth = (contentWidth - metricBoxGap) / 2
      const metricBoxHeight = 48
      for (let i = 0; i < metricRows.length; i += 2) {
        ensureSpace(metricBoxHeight + 10)

        const rowItems = [metricRows[i], metricRows[i + 1]].filter(Boolean)
        rowItems.forEach(([label, value], columnIndex) => {
          const x = margin + columnIndex * (metricBoxWidth + metricBoxGap)

          doc.setDrawColor(58, 66, 86)
          doc.setFillColor(21, 27, 39)
          doc.roundedRect(x, y, metricBoxWidth, metricBoxHeight, 7, 7, 'FD')

          doc.setTextColor(156, 163, 175)
          doc.setFontSize(9)
          doc.text(label, x + 10, y + 16)

          doc.setTextColor(212, 175, 55)
          doc.setFontSize(12)
          doc.text(value, x + 10, y + 34)
        })

        y += metricBoxHeight + 10
      }

      const chartBlocks = [
        ['Balance Changes Over Time', balanceChartRef],
        ['Additions vs Deductions', flowChartRef],
        ['Savings Growth', savingsChartRef],
        ['Monthly Reports', monthlyChartRef],
        ['Yearly Reports', yearlyChartRef],
        ['Financial Distribution', distributionChartRef],
        ['Company Earnings Growth', companyGrowthChartRef],
      ]

      const preparedCharts = []
      for (const [title, chartRef] of chartBlocks) {
        const snapshot = await readChartSnapshot(chartRef)
        if (!snapshot) {
          continue
        }
        preparedCharts.push({ title, snapshot })
      }

      y += 4

      let hasChart = preparedCharts.length > 0
      const panelHeight = 312
      if (hasChart) {
        // Keep heading and at least one diagram on the same page.
        ensureSpace(28 + panelHeight + 12)
        drawSectionHeading('Visualizations')
      }

      for (const { title, snapshot } of preparedCharts) {

        const { image, width: sourceWidth, height: sourceHeight } = snapshot
        ensureSpace(panelHeight + 12)

        doc.setDrawColor(58, 66, 86)
        doc.setFillColor(21, 27, 39)
        doc.roundedRect(margin, y, contentWidth, panelHeight, 10, 10, 'FD')

        doc.setTextColor(255, 255, 255)
        doc.setFontSize(12)
        doc.text(title, margin + 12, y + 20)
        doc.setDrawColor(212, 175, 55)
        doc.setLineWidth(1.3)
        doc.line(margin + 12, y + 26, margin + 210, y + 26)

        doc.setDrawColor(46, 52, 66)
        doc.setFillColor(12, 15, 22)
        doc.roundedRect(margin + 10, y + 30, contentWidth - 20, panelHeight - 40, 8, 8, 'FD')

        const maxChartWidth = contentWidth - 36
        const maxChartHeight = panelHeight - 56
        const scale = Math.min(maxChartWidth / sourceWidth, maxChartHeight / sourceHeight)
        const chartWidth = sourceWidth * scale
        const chartHeight = sourceHeight * scale
        const chartX = margin + (contentWidth - chartWidth) / 2
        const chartY = y + 36 + (maxChartHeight - chartHeight) / 2

        doc.addImage(image, 'PNG', chartX, chartY, chartWidth, chartHeight, undefined, 'FAST')
        y += panelHeight + 12
      }

      if (!hasChart) {
        ensureSpace(40)
        doc.setTextColor(194, 203, 214)
        doc.setFontSize(10)
        doc.text('No visible charts in the current view. Open Analyzer or switch homepage view to include visualizations.', margin, y)
      }

      const reportDate = new Date().toISOString().slice(0, 10)
      doc.save(`vault-financial-report-${reportDate}.pdf`)
    } catch {
      setFormError('PDF export failed. Please try again.')
    } finally {
      setPdfExporting(false)
    }
  }

  async function importBackup(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (file.size > MAX_BACKUP_FILE_BYTES) {
      setFormError('Backup rejected: file size exceeds secure import limit.')
      return
    }

    try {
      const text = await file.text()
      const backup = JSON.parse(text)
      if (!isValidEncryptedBackup(backup)) {
        throw new Error('Invalid backup structure')
      }
      await importEncryptedBackupFile(backup)

      const payload = await loadEncryptedSnapshot()
      let restored = null
      const keyCandidates = vaultKey ? [vaultKey] : []

      for (const candidateKey of keyCandidates) {
        try {
          restored = await decryptJson(payload, candidateKey)
          break
        } catch {
          // If key is wrong for this backup, fall through to generic error.
        }
      }

      if (!restored) {
        throw new Error('Unable to decrypt imported backup with current session key')
      }

      setState(sanitizeRestoredState(restored))
      setFormError('Backup imported successfully.')
    } catch {
      setFormError('Backup import failed. Ensure it matches this vault PIN.')
    }
  }

  function jumpToSection(sectionRef) {
    sectionRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }

  function appendPinDigit(digit) {
    if (loadingState || phase === 'opening' || isPinLockedOut) return
    setPinInput((prev) => {
      const next = normalizePin(`${prev}${digit}`)
      if (next.length > prev.length) {
        setDialRotationDeg((current) => current + 28)
        setDialPulsing(true)
      }
      return next
    })
  }

  function removeLastPinDigit() {
    if (loadingState || phase === 'opening' || isPinLockedOut) return
    setPinInput((prev) => {
      if (!prev.length) return prev
      setDialRotationDeg((current) => current - 20)
      setDialPulsing(true)
      return prev.slice(0, -1)
    })
  }

  function clearPinInput() {
    if (loadingState || phase === 'opening' || isPinLockedOut) return
    setDialRotationDeg(0)
    setDialPulsing(true)
    setPinInput('')
  }

  function handlePinTyping(event) {
    if (loadingState || phase === 'opening' || isPinLockedOut) return
    const next = normalizePin(event.target.value)
    const delta = next.length - pinInput.length

    if (delta > 0) {
      setDialRotationDeg((current) => current + 22 * delta)
      setDialPulsing(true)
    } else if (delta < 0) {
      setDialRotationDeg((current) => current - 18 * Math.abs(delta))
      setDialPulsing(true)
    }

    setPinInput(next)
  }

  const pieData = {
    labels: ['Income', 'Expenses', 'Savings', 'Investments', 'Transfers'],
    datasets: [
      {
        data: [
          Math.abs(metrics.totals.income),
          Math.abs(metrics.totals.expenses),
          Math.abs(metrics.totals.savings),
          Math.abs(metrics.totals.investments),
          Math.abs(metrics.totals.transfers),
        ],
        backgroundColor: ['#d4af37', '#7f1d1d', '#0f766e', '#3b82f6', '#64748b'],
      },
    ],
  }

  const companyGrowth = [...state.companies]
    .sort((a, b) => new Date(a.joiningDate) - new Date(b.joiningDate))
    .reduce(
      (acc, company) => {
        const total = companyTotalEarnings(company)
        const previous = acc.values[acc.values.length - 1] || 0
        acc.labels.push(company.companyName)
        acc.values.push(previous + total)
        return acc
      },
      { labels: [], values: [] },
    )

  const profitLossAmount = Number(metrics.currentBalance || 0)
  const profitLossLabel = profitLossAmount >= 0 ? 'Profit' : 'Loss'
  const saveStatusLabel = state.updatedAt
    ? new Date(state.updatedAt).toLocaleString()
    : 'No local updates yet'
  const lockoutRemainingMs = Math.max(0, lockoutUntil - clockMs)
  const isPinLockedOut = lockoutRemainingMs > 0
  const lockoutCountdownLabel = isPinLockedOut
    ? `${Math.ceil(lockoutRemainingMs / 1000)}s`
    : ''
  const maskedPin = pinInput.replace(/\d/g, '•')
  const dialDigits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
  const showMetricsData = homeViewMode !== 'visualization-only'
  const showVisualizations = homeViewMode !== 'metrics-only'

  return (
    <div className="app-shell">
      {(phase === 'locked' || phase === 'opening') && (
        <section className={`vault-screen ${phase === 'opening' ? 'opening' : ''}`} data-liquid-theme={liquidThemeId}>
          <div className="vault-door" aria-live="polite">
            <div className="vault-bolts">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="vault-wheel" />
            <div className="vault-center">The Vault</div>
          </div>

          <form
            className="pin-panel glass"
            onSubmit={(event) => {
              event.preventDefault()
              if (phase === 'locked') {
                unlockVault()
              }
            }}
          >
            <h1>The Vault</h1>
            <p>Enter vault PIN to access your local encrypted financial records.</p>
            <div className="liquid-theme-row">
              <label htmlFor="liquid-theme-select">Liquid Color</label>
              <select
                id="liquid-theme-select"
                value={liquidThemeId}
                onChange={(event) => setLiquidThemeId(event.target.value)}
                disabled={loadingState || phase === 'opening'}
              >
                {LIQUID_THEMES.map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {theme.label}
                  </option>
                ))}
              </select>
            </div>
            <blockquote className="lock-quote" aria-label="Inspirational quote">
              <span className="lock-quote-text">{loginGreeting.quote}</span>
              <cite className="lock-quote-source">The Vault Notes</cite>
            </blockquote>
            <div className="pin-entry-row">
              <label htmlFor="vault-pin-input">Vault PIN</label>
              <input
                id="vault-pin-input"
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={10}
                value={pinInput}
                onChange={handlePinTyping}
                disabled={loadingState || phase === 'opening' || isPinLockedOut}
                placeholder="Type 10-digit PIN"
              />
            </div>
            <div className="pin-display" aria-label="10 digit vault pin display">
              {maskedPin || '••••••••••'}
            </div>
            <div
              className={`safe-dial ${dialPulsing ? 'pulsing' : ''}`}
              role="group"
              aria-label="Safe dial keypad"
              style={{ transform: `rotate(${dialRotationDeg}deg)` }}
            >
              {dialDigits.map((digit, index) => {
                const angle = index * 36 - 90
                return (
                  <button
                    key={digit}
                    type="button"
                    className="dial-key"
                    style={{ transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-120px) rotate(${-angle}deg)` }}
                    onClick={() => appendPinDigit(digit)}
                    disabled={loadingState || phase === 'opening' || isPinLockedOut}
                    aria-label={`Enter digit ${digit}`}
                  >
                    {digit}
                  </button>
                )
              })}
              <div className="dial-center">PIN</div>
            </div>
            <div className="pin-actions">
              <button
                type="button"
                className="secondary"
                onClick={removeLastPinDigit}
                disabled={loadingState || phase === 'opening' || isPinLockedOut || pinInput.length === 0}
              >
                Backspace
              </button>
              <button
                type="button"
                className="secondary"
                onClick={clearPinInput}
                disabled={loadingState || phase === 'opening' || isPinLockedOut || pinInput.length === 0}
              >
                Clear
              </button>
            </div>
            <button
              className="unlock-btn"
              type="submit"
              disabled={loadingState || phase === 'opening' || isPinLockedOut}
            >
              {loadingState ? 'Decrypting...' : isPinLockedOut ? `Locked (${lockoutCountdownLabel})` : 'Unlock Vault'}
            </button>
            {pinError && <div className="error-text">{pinError}</div>}
          </form>
        </section>
      )}

      {phase === 'unlocked' && screen === 'home' && (
        <section className="post-login-home" aria-label="Authenticated homepage">
          <div className="home-bg-orb orb-1" aria-hidden="true" />
          <div className="home-bg-orb orb-2" aria-hidden="true" />
          <div className="home-bg-grid" aria-hidden="true" />

          <div className="post-login-shell glass reveal">
            <header className="post-login-head">
              <div className="home-badge">Private Session Active</div>
              <h2>The Vault</h2>
              <p>
                Your encrypted local vault is unlocked. Navigate into the analyzer when ready, or
                review your protected financial snapshot here.
              </p>
              <div className="welcome-quote">
                <strong>{loginGreeting.salutation}.</strong>
                <span>{loginGreeting.quote}</span>
              </div>
              <div className="trust-chips">
                <span>Local only</span>
                <span>Encrypted storage</span>
                <span>Auto-lock enabled</span>
              </div>
              <div className="theme-row">
                <label htmlFor="theme-select-home">Theme</label>
                <select
                  id="theme-select-home"
                  value={themeId}
                  onChange={(event) => setThemeId(event.target.value)}
                >
                  {THEMES.map((theme) => (
                    <option key={theme.id} value={theme.id}>
                      {theme.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="home-view-row">
                <label htmlFor="home-view-mode">Homepage View</label>
                <select
                  id="home-view-mode"
                  value={homeViewMode}
                  onChange={(event) => setHomeViewMode(event.target.value)}
                >
                  {HOME_VIEW_MODES.map((mode) => (
                    <option key={mode.id} value={mode.id}>
                      {mode.label}
                    </option>
                  ))}
                </select>
              </div>
            </header>

            <div className="post-login-grid">
              <div className="post-login-cards">
                <article className="post-card">
                  <span>Current Balance</span>
                  <strong>{currency(metrics.currentBalance)}</strong>
                </article>
                <article className="post-card">
                  <span>Lifetime Earnings</span>
                  <strong>{currency(metrics.lifetimeEarnings)}</strong>
                </article>
                <article className="post-card">
                  <span>Career Earnings</span>
                  <strong>{currency(metrics.companyEarnings)}</strong>
                </article>
                <article className="post-card">
                  <span>{profitLossLabel}</span>
                  <strong>{currency(Math.abs(profitLossAmount))}</strong>
                </article>
              </div>

              <aside className="home-cta-card">
                <h3>Financial Analyzer</h3>
                <p>
                  Open your complete dashboard to manage account balance, track career earnings,
                  and review reports.
                </p>
                <div className="saved-chip">Auto-saved locally: {saveStatusLabel}</div>
                <div className="post-login-actions">
                  <button
                    type="button"
                    className="open-analyzer-btn"
                    onClick={() => setScreen('analyzer')}
                  >
                    View Analyzer
                  </button>
                  <button type="button" onClick={exportPdfReport} disabled={pdfExporting}>
                    {pdfExporting ? 'Preparing PDF...' : 'Download PDF Report'}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => lockSession('Vault locked manually.')}
                  >
                    Lock Vault
                  </button>
                </div>
              </aside>
            </div>

            <section className="vault-signature" aria-label="Unique vault signature">
              <div className="signature-ring">
                <div className="signature-core">SV</div>
              </div>
              <div className="signature-content">
                <h3>Vault Signature</h3>
                <p>
                  A kinetic identity layer inspired by mechanical vault precision and
                  chronometer rhythm.
                </p>
                <div className="signature-metrics">
                  <span>Net Worth: {currency(metrics.netWorth)}</span>
                  <span>Growth: {metrics.financialGrowth.toFixed(2)}%</span>
                </div>
              </div>
            </section>

            <section className="home-readonly-grid">
              {showMetricsData && (
                <article className="panel glass">
                  <h4>Read-Only Financial Metrics</h4>
                  <div className="metrics-grid compact-metrics">
                    <article className="metric-card glass">
                      <span>Total Income</span>
                      <strong>{currency(metrics.totalIncome)}</strong>
                    </article>
                    <article className="metric-card glass">
                      <span>Total Expenses</span>
                      <strong>{currency(metrics.totalExpenses)}</strong>
                    </article>
                    <article className="metric-card glass">
                      <span>Total Savings</span>
                      <strong>{currency(metrics.totalSavings)}</strong>
                    </article>
                    <article className="metric-card glass">
                      <span>Net Worth</span>
                      <strong>{currency(metrics.netWorth)}</strong>
                    </article>
                    <article className="metric-card glass">
                      <span>Financial Growth</span>
                      <strong>{metrics.financialGrowth.toFixed(2)}%</strong>
                    </article>
                    <article className="metric-card glass">
                      <span>Result</span>
                      <strong>{profitLossLabel}</strong>
                    </article>
                  </div>
                </article>
              )}

              {showVisualizations && (
                <article className="panel glass">
                  <h4>Balance and Flow Trends</h4>
                  <Line
                    ref={balanceChartRef}
                    data={{
                      labels: timelineSeries.labels,
                      datasets: [
                        {
                          label: 'Balance',
                          data: timelineSeries.balanceLine,
                          borderColor: '#d4af37',
                          backgroundColor: 'rgba(212,175,55,0.2)',
                          fill: true,
                        },
                        {
                          label: 'Additions',
                          data: timelineSeries.additionsLine,
                          borderColor: '#16a34a',
                        },
                        {
                          label: 'Deductions',
                          data: timelineSeries.deductionsLine,
                          borderColor: '#dc2626',
                        },
                      ],
                    }}
                  />
                </article>
              )}

              {showVisualizations && (
                <article className="panel glass">
                  <h4>Monthly Snapshot (Read-Only)</h4>
                  <Bar
                    ref={monthlyChartRef}
                    data={{
                      labels: monthlySeries.labels,
                      datasets: [
                        {
                          label: 'Income',
                          data: monthlySeries.income,
                          backgroundColor: '#d4af37',
                        },
                        {
                          label: 'Expenses',
                          data: monthlySeries.expenses,
                          backgroundColor: '#7f1d1d',
                        },
                        {
                          label: 'Savings',
                          data: monthlySeries.savings,
                          backgroundColor: '#0f766e',
                        },
                      ],
                    }}
                  />
                </article>
              )}

              {showVisualizations && (
                <article className="panel glass">
                  <h4>Distribution and Yearly Report</h4>
                  <div className="readonly-split">
                    <Pie ref={distributionChartRef} data={pieData} />
                    <Bar
                      ref={yearlyChartRef}
                      data={{
                        labels: yearlySeries.labels,
                        datasets: [
                          {
                            label: 'Yearly Net Flow',
                            data: yearlySeries.net,
                            backgroundColor: '#64748b',
                          },
                        ],
                      }}
                    />
                  </div>
                </article>
              )}

              {showMetricsData && (
                <article className="panel glass home-wide">
                  <h4>Company Roles and Earnings (Read-Only)</h4>
                  <div className="companies-table-wrap">
                    <table className="companies-table">
                      <thead>
                        <tr>
                          <th>Company</th>
                          <th>Role</th>
                          <th>Duration</th>
                          <th>Promotions</th>
                          <th>Monthly Salary</th>
                          <th>New Salary</th>
                          <th>Earnings by Salary</th>
                          <th>Bonuses</th>
                          <th>Total Earnings</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.companies.slice(0, 8).map((company) => {
                          const breakdown = companyEarningsBreakdown(company)
                          return (
                            <tr key={`home-${company.id}`}>
                              <td>{company.companyName}</td>
                              <td>{company.role}</td>
                              <td>{companyDurationLabel(company)}</td>
                              <td>{breakdown.promotions}</td>
                              <td>{currency(company.monthlySalary)}</td>
                              <td>{company.newMonthlySalary ? currency(company.newMonthlySalary) : '-'}</td>
                              <td>
                                {currency(breakdown.baseEarnings)} / {currency(breakdown.promotedEarnings)}
                              </td>
                              <td>{currency(company.bonuses)}</td>
                              <td>{currency(companyTotalEarnings(company))}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </article>
              )}

              {showMetricsData && (
                <article className="panel glass home-wide">
                  <h4>Recent Transactions (Read-Only)</h4>
                  <div className="history-table-wrap">
                    <table className="history-table">
                      <thead>
                        <tr>
                          <th>Timestamp</th>
                          <th>Type</th>
                          <th>Action</th>
                          <th>Amount</th>
                          <th>Note</th>
                          <th>Resulting Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.transactions.slice(0, 8).map((tx) => (
                          <tr key={`home-${tx.id}`}>
                            <td>{new Date(tx.timestamp).toLocaleString()}</td>
                            <td>{tx.kind}</td>
                            <td>{tx.direction}</td>
                            <td>{currency(tx.amount)}</td>
                            <td>{tx.note || '-'}</td>
                            <td>{currency(tx.resultingBalance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              )}
            </section>
          </div>
        </section>
      )}

      {phase === 'unlocked' && screen === 'analyzer' && (
        <div className="dashboard">
          <section className="home-hero glass reveal" aria-label="Homepage navigation">
            <div className="home-hero-copy">
              <h2>The Vault Command Center</h2>
              <p>
                Use quick selection cards to jump directly to your balance controls or add a new
                company entry.
              </p>
            </div>
            <div className="home-hero-actions">
              <button
                type="button"
                className="selector-card"
                onClick={() => jumpToSection(balanceSectionRef)}
              >
                <span>Main Account Balance</span>
                <strong>Set, Add, Subtract, and Reset</strong>
              </button>
              <button
                type="button"
                className="selector-card"
                onClick={() => jumpToSection(companySectionRef)}
              >
                <span>Company Adding Section</span>
                <strong>Create unlimited career records</strong>
              </button>
            </div>
          </section>

          <header ref={balanceSectionRef} className="header glass reveal delay-1">
            <div>
              <h2>Main Account Balance</h2>
              <h3>{currency(metrics.currentBalance)}</h3>
            </div>
            <div className="header-actions">
              <select
                aria-label="theme selector"
                value={themeId}
                onChange={(event) => setThemeId(event.target.value)}
              >
                {THEMES.map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {theme.label}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => setScreen('home')}>
                Home
              </button>
              <button type="button" onClick={exportPdfReport} disabled={pdfExporting}>
                {pdfExporting ? 'Preparing PDF...' : 'Download PDF Report'}
              </button>
              <button type="button" onClick={exportBackup}>
                Export Encrypted Backup
              </button>
              <label className="import-label" htmlFor="import-backup">
                Import Backup
              </label>
              <input
                id="import-backup"
                type="file"
                accept="application/json"
                onChange={importBackup}
              />
            </div>
          </header>

          <section className="metrics-grid reveal delay-2">
            <article className="metric-card glass">
              <span>Current Balance</span>
              <strong>{currency(metrics.currentBalance)}</strong>
            </article>
            <article className="metric-card glass">
              <span>Lifetime Earnings</span>
              <strong>{currency(metrics.lifetimeEarnings)}</strong>
            </article>
            <article className="metric-card glass">
              <span>Total Income</span>
              <strong>{currency(metrics.totalIncome)}</strong>
            </article>
            <article className="metric-card glass">
              <span>Total Expenses</span>
              <strong>{currency(metrics.totalExpenses)}</strong>
            </article>
            <article className="metric-card glass">
              <span>Total Savings</span>
              <strong>{currency(metrics.totalSavings)}</strong>
            </article>
            <article className="metric-card glass">
              <span>Net Worth</span>
              <strong>{currency(metrics.netWorth)}</strong>
            </article>
            <article className="metric-card glass">
              <span>Financial Growth</span>
              <strong>{metrics.financialGrowth.toFixed(2)}%</strong>
            </article>
            <article className="metric-card glass">
              <span>Career Earnings</span>
              <strong>{currency(metrics.companyEarnings)}</strong>
            </article>
          </section>

          <section className="operations-grid reveal delay-3">
            <form className="panel glass" onSubmit={submitAdjustment}>
              <h4>Balance Adjustment</h4>
              <div className="form-row">
                <label>Section</label>
                <select
                  value={adjustmentForm.kind}
                  onChange={(event) =>
                    setAdjustmentForm((prev) => ({
                      ...prev,
                      kind: event.target.value,
                    }))
                  }
                >
                  <option value="income">Income</option>
                  <option value="expenses">Expenses</option>
                  <option value="savings">Savings</option>
                  <option value="investments">Investments</option>
                  <option value="transfers">Transfers</option>
                </select>
              </div>
              <div className="form-row">
                <label>Action</label>
                <select
                  value={adjustmentForm.direction}
                  onChange={(event) =>
                    setAdjustmentForm((prev) => ({
                      ...prev,
                      direction: event.target.value,
                    }))
                  }
                >
                  <option value="add">Add</option>
                  <option value="subtract">Subtract</option>
                </select>
              </div>
              <div className="form-row">
                <label>Amount</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={adjustmentForm.amount}
                  onChange={(event) =>
                    setAdjustmentForm((prev) => ({
                      ...prev,
                      amount: event.target.value,
                    }))
                  }
                  required
                />
              </div>
              <div className="form-row">
                <label>Note</label>
                <input
                  type="text"
                  maxLength={120}
                  value={adjustmentForm.note}
                  onChange={(event) =>
                    setAdjustmentForm((prev) => ({
                      ...prev,
                      note: event.target.value,
                    }))
                  }
                  placeholder="Reason for adjustment"
                />
              </div>
              <button type="submit">Apply</button>
            </form>

            <form className="panel glass" onSubmit={submitSetBalance}>
              <h4>Main Balance Controls</h4>
              <div className="form-row">
                <label>Set Exact Balance</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={setBalanceAmount}
                  onChange={(event) => setSetBalanceAmount(event.target.value)}
                  required
                />
              </div>
              <button type="submit">Set Balance</button>
              <button className="secondary" type="button" onClick={resetBalance}>
                Reset to Zero
              </button>
            </form>
          </section>

          <section ref={companySectionRef} className="panel glass reveal delay-4">
            <h4>Company Career Tracker</h4>
            <form className="company-form" onSubmit={submitCompany}>
              <input
                type="text"
                value={companyForm.companyName}
                onChange={(event) =>
                  setCompanyForm((prev) => ({ ...prev, companyName: event.target.value }))
                }
                placeholder="Company name"
                maxLength={80}
                required
              />
              <input
                type="text"
                value={companyForm.role}
                onChange={(event) =>
                  setCompanyForm((prev) => ({ ...prev, role: event.target.value }))
                }
                placeholder="Role"
                maxLength={80}
                required
              />
              <input
                type="date"
                value={companyForm.joiningDate}
                onChange={(event) =>
                  setCompanyForm((prev) => ({ ...prev, joiningDate: event.target.value }))
                }
                required
              />
              <input
                type="date"
                value={companyForm.leavingDate}
                onChange={(event) =>
                  setCompanyForm((prev) => ({ ...prev, leavingDate: event.target.value }))
                }
              />
              <input
                type="number"
                min="0"
                step="0.01"
                value={companyForm.monthlySalary}
                onChange={(event) =>
                  setCompanyForm((prev) => ({ ...prev, monthlySalary: event.target.value }))
                }
                placeholder="Monthly salary"
                required
              />
              <input
                type="number"
                min="0"
                step="1"
                value={companyForm.promotions}
                onChange={(event) =>
                  setCompanyForm((prev) => ({ ...prev, promotions: event.target.value }))
                }
                placeholder="Promotions"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                value={companyForm.newMonthlySalary}
                onChange={(event) =>
                  setCompanyForm((prev) => ({ ...prev, newMonthlySalary: event.target.value }))
                }
                placeholder="New monthly salary"
              />
              <input
                type="number"
                min="0"
                step="1"
                value={companyForm.promotedMonths}
                onChange={(event) =>
                  setCompanyForm((prev) => ({ ...prev, promotedMonths: event.target.value }))
                }
                placeholder="Months at new salary"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                value={companyForm.bonuses}
                onChange={(event) =>
                  setCompanyForm((prev) => ({ ...prev, bonuses: event.target.value }))
                }
                placeholder="Bonuses"
              />
              <div className="form-actions">
                <button type="submit">{editingCompanyId ? 'Update Company' : 'Add Company'}</button>
                {editingCompanyId && (
                  <button type="button" className="secondary" onClick={cancelEditCompany}>
                    Cancel Edit
                  </button>
                )}
              </div>
              {companyError && <div className="error-text">{companyError}</div>}
            </form>

            <div className="companies-table-wrap">
              <table className="companies-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Role</th>
                    <th>Duration</th>
                    <th>Promotions</th>
                    <th>Monthly Salary</th>
                    <th>New Salary</th>
                    <th>Bonuses</th>
                    <th>Total Earnings</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {state.companies.map((company) => (
                    <tr key={company.id} className={editingCompanyId === company.id ? 'editing-row' : ''}>
                      <td>{company.companyName}</td>
                      <td>{company.role}</td>
                      <td>{companyDurationLabel(company)}</td>
                      <td>{company.promotions || 0}</td>
                      <td>{currency(company.monthlySalary)}</td>
                      <td>{company.newMonthlySalary ? currency(company.newMonthlySalary) : '-'}</td>
                      <td>{currency(company.bonuses)}</td>
                      <td>{currency(companyTotalEarnings(company))}</td>
                      <td className="action-cell">
                        <button
                          type="button"
                          className="btn-edit"
                          onClick={() => startEditCompany(company)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn-delete"
                          onClick={() => deleteCompany(company.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="companies-table-wrap progression-wrap">
              <table className="companies-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Role</th>
                    <th>Years</th>
                    <th>Promotions</th>
                    <th>Base Earnings</th>
                    <th>Promoted Earnings</th>
                    <th>Total Earnings</th>
                  </tr>
                </thead>
                <tbody>
                  {state.companies.map((company) => {
                    const breakdown = companyEarningsBreakdown(company)
                    return (
                      <tr key={`progression-${company.id}`}>
                        <td>{company.companyName}</td>
                        <td>{company.role}</td>
                        <td>{companyDurationLabel(company)}</td>
                        <td>{breakdown.promotions}</td>
                        <td>{currency(breakdown.baseEarnings)}</td>
                        <td>
                          {breakdown.promotedMonths > 0
                            ? `${currency(breakdown.promotedEarnings)} (${breakdown.promotedMonths} mo @ ${currency(breakdown.newSalary)})`
                            : '-'}
                        </td>
                        <td>{currency(breakdown.total)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="charts-grid reveal delay-5">
            <article className="panel glass">
              <h4>Balance Changes Over Time</h4>
              <Line
                ref={balanceChartRef}
                data={{
                  labels: timelineSeries.labels,
                  datasets: [
                    {
                      label: 'Balance',
                      data: timelineSeries.balanceLine,
                      borderColor: '#d4af37',
                      backgroundColor: 'rgba(212,175,55,0.2)',
                      fill: true,
                    },
                  ],
                }}
              />
            </article>

            <article className="panel glass">
              <h4>Additions vs Deductions</h4>
              <Line
                ref={flowChartRef}
                data={{
                  labels: timelineSeries.labels,
                  datasets: [
                    {
                      label: 'Additions',
                      data: timelineSeries.additionsLine,
                      borderColor: '#16a34a',
                    },
                    {
                      label: 'Deductions',
                      data: timelineSeries.deductionsLine,
                      borderColor: '#dc2626',
                    },
                  ],
                }}
              />
            </article>

            <article className="panel glass">
              <h4>Savings Growth</h4>
              <Line
                ref={savingsChartRef}
                data={{
                  labels: timelineSeries.labels,
                  datasets: [
                    {
                      label: 'Savings',
                      data: timelineSeries.savingsGrowthLine,
                      borderColor: '#0f766e',
                    },
                  ],
                }}
              />
            </article>

            <article className="panel glass">
              <h4>Monthly Reports</h4>
              <Bar
                ref={monthlyChartRef}
                data={{
                  labels: monthlySeries.labels,
                  datasets: [
                    {
                      label: 'Income',
                      data: monthlySeries.income,
                      backgroundColor: '#d4af37',
                    },
                    {
                      label: 'Expenses',
                      data: monthlySeries.expenses,
                      backgroundColor: '#7f1d1d',
                    },
                    {
                      label: 'Savings',
                      data: monthlySeries.savings,
                      backgroundColor: '#0f766e',
                    },
                  ],
                }}
              />
            </article>

            <article className="panel glass">
              <h4>Yearly Reports</h4>
              <Bar
                ref={yearlyChartRef}
                data={{
                  labels: yearlySeries.labels,
                  datasets: [
                    {
                      label: 'Yearly Net Flow',
                      data: yearlySeries.net,
                      backgroundColor: '#64748b',
                    },
                  ],
                }}
              />
            </article>

            <article className="panel glass">
              <h4>Financial Distribution</h4>
              <Pie ref={distributionChartRef} data={pieData} />
            </article>

            <article className="panel glass full-span">
              <h4>Company Earnings Growth</h4>
              <Line
                ref={companyGrowthChartRef}
                data={{
                  labels: companyGrowth.labels,
                  datasets: [
                    {
                      label: 'Career Earnings',
                      data: companyGrowth.values,
                      borderColor: '#b0b7c3',
                      backgroundColor: 'rgba(176,183,195,0.2)',
                      fill: true,
                    },
                  ],
                }}
              />
            </article>
          </section>

          <section className="panel glass reveal delay-6">
            <h4>Transaction History</h4>
            <div className="history-table-wrap">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Type</th>
                    <th>Action</th>
                    <th>Amount</th>
                    <th>Note</th>
                    <th>Previous Balance</th>
                    <th>Resulting Balance</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {state.transactions.map((tx) =>
                    editTx?.id === tx.id ? (
                      <tr key={tx.id} className="editing-row">
                        <td>{new Date(tx.timestamp).toLocaleString()}</td>
                        <td>
                          <select
                            value={editTx.kind}
                            onChange={(e) => setEditTx((p) => ({ ...p, kind: e.target.value }))}
                          >
                            <option value="income">Income</option>
                            <option value="expenses">Expenses</option>
                            <option value="savings">Savings</option>
                            <option value="investments">Investments</option>
                            <option value="transfers">Transfers</option>
                          </select>
                        </td>
                        <td>
                          <select
                            value={editTx.direction}
                            onChange={(e) => setEditTx((p) => ({ ...p, direction: e.target.value }))}
                          >
                            <option value="add">Add</option>
                            <option value="subtract">Subtract</option>
                          </select>
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={editTx.amount}
                            onChange={(e) => setEditTx((p) => ({ ...p, amount: e.target.value }))}
                            style={{ width: '100px' }}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            maxLength={120}
                            value={editTx.note}
                            onChange={(e) => setEditTx((p) => ({ ...p, note: e.target.value }))}
                            style={{ width: '140px' }}
                          />
                        </td>
                        <td>{currency(tx.previousBalance)}</td>
                        <td>{currency(tx.resultingBalance)}</td>
                        <td className="action-cell">
                          <button type="button" className="btn-edit" onClick={saveEditTx}>
                            Save
                          </button>
                          <button type="button" className="secondary" onClick={() => setEditTx(null)}>
                            Cancel
                          </button>
                        </td>
                      </tr>
                    ) : (
                      <tr key={tx.id}>
                        <td>{new Date(tx.timestamp).toLocaleString()}</td>
                        <td>{tx.kind}</td>
                        <td>{tx.direction}</td>
                        <td>{currency(tx.amount)}</td>
                        <td>{tx.note || '-'}</td>
                        <td>{currency(tx.previousBalance)}</td>
                        <td>{currency(tx.resultingBalance)}</td>
                        <td className="action-cell">
                          <button
                            type="button"
                            className="btn-edit"
                            onClick={() => startEditTx(tx)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn-delete"
                            onClick={() => deleteTx(tx.id)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {formError && <div className="error-text inline">{formError}</div>}
        </div>
      )}
    </div>
  )
}

export default App
