function roundCurrency(value) {
  return Math.round(Number(value || 0) * 100) / 100
}

export function currency(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(value || 0))
}

export function toIsoNow() {
  return new Date().toISOString()
}

export function monthKeyFromIso(isoDate) {
  const date = new Date(isoDate)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function yearKeyFromIso(isoDate) {
  return String(new Date(isoDate).getUTCFullYear())
}

export function companyTotalMonths(company) {
  const start = new Date(company.joiningDate)
  const end = company.leavingDate ? new Date(company.leavingDate) : new Date()

  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || end < start) {
    return 0
  }

  return Math.max(
    1,
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      (end.getUTCMonth() - start.getUTCMonth()) +
      (end.getUTCDate() >= start.getUTCDate() ? 1 : 0),
  )
}

export function companyEarningsBreakdown(company) {
  const baseSalary = Number(company.monthlySalary || 0)
  const bonuses = Number(company.bonuses || 0)
  const promotions = Math.max(0, Math.floor(Number(company.promotions || 0)))
  const newSalary = Number(company.newMonthlySalary || 0)
  const totalMonths = companyTotalMonths(company)
  const promotedMonthsInput = Math.max(0, Math.floor(Number(company.promotedMonths || 0)))
  const promotedMonths = Math.min(promotedMonthsInput, totalMonths)
  const baseMonths = Math.max(0, totalMonths - promotedMonths)

  const usedPromotedSalary = promotions > 0 && newSalary > 0 ? newSalary : 0
  const baseEarnings = roundCurrency(baseMonths * baseSalary)
  const promotedEarnings = roundCurrency(promotedMonths * usedPromotedSalary)
  const total = roundCurrency(baseEarnings + promotedEarnings + bonuses)

  return {
    baseMonths,
    promotedMonths,
    baseSalary,
    newSalary: usedPromotedSalary,
    promotions,
    bonuses: roundCurrency(bonuses),
    baseEarnings,
    promotedEarnings,
    total,
  }
}

export function companyTotalEarnings(company) {
  const breakdown = companyEarningsBreakdown(company)

  return breakdown.total
}

export function companyDurationLabel(company) {
  const start = new Date(company.joiningDate)
  const end = company.leavingDate ? new Date(company.leavingDate) : new Date()

  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || end < start) {
    return 'Invalid dates'
  }

  const totalMonths =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth())
  const years = Math.floor(totalMonths / 12)
  const months = totalMonths % 12

  if (years === 0) {
    return `${months} month${months === 1 ? '' : 's'}`
  }

  if (months === 0) {
    return `${years} year${years === 1 ? '' : 's'}`
  }

  return `${years} year${years === 1 ? '' : 's'} ${months} month${months === 1 ? '' : 's'}`
}

export function computeMetrics(state) {
  const transactions = state.transactions || []

  const totals = {
    income: 0,
    expenses: 0,
    savings: 0,
    investments: 0,
    transfers: 0,
    additions: 0,
    deductions: 0,
  }

  for (const tx of transactions) {
    const amount = Number(tx.amount || 0)
    const signed = tx.direction === 'subtract' ? -amount : amount

    if (tx.direction === 'subtract') {
      totals.deductions += amount
    } else {
      totals.additions += amount
    }

    if (tx.kind === 'income') totals.income += signed
    if (tx.kind === 'expenses') totals.expenses += -signed
    if (tx.kind === 'savings') totals.savings += signed
    if (tx.kind === 'investments') totals.investments += signed
    if (tx.kind === 'transfers') totals.transfers += signed
  }

  const firstBalance =
    transactions.length > 0 ? Number(transactions[0].previousBalance || 0) : 0
  const currentBalance = Number(state.mainBalance || 0)
  const financialGrowth =
    firstBalance === 0
      ? currentBalance === 0
        ? 0
        : 100
      : ((currentBalance - firstBalance) / Math.abs(firstBalance)) * 100

  const companyEarnings = (state.companies || []).reduce(
    (sum, company) => sum + companyTotalEarnings(company),
    0,
  )

  const totalIncome = roundCurrency(Math.max(0, totals.income))
  const totalExpenses = roundCurrency(Math.max(0, totals.expenses))
  const totalSavings = roundCurrency(totals.savings)
  const netWorth = roundCurrency(currentBalance + Math.max(0, totals.investments))
  const lifetimeEarnings = roundCurrency(totalIncome + companyEarnings)

  return {
    currentBalance: roundCurrency(currentBalance),
    lifetimeEarnings,
    totalIncome,
    totalExpenses,
    totalSavings,
    netWorth,
    financialGrowth: roundCurrency(financialGrowth),
    companyEarnings: roundCurrency(companyEarnings),
    totals,
  }
}

export function buildTimelineSeries(transactions) {
  let runningSavings = 0
  const labels = []
  const balanceLine = []
  const additionsLine = []
  const deductionsLine = []
  const savingsGrowthLine = []

  for (const tx of transactions) {
    const label = new Date(tx.timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })

    labels.push(label)
    balanceLine.push(Number(tx.resultingBalance || 0))
    additionsLine.push(tx.direction === 'add' ? Number(tx.amount || 0) : 0)
    deductionsLine.push(tx.direction === 'subtract' ? Number(tx.amount || 0) : 0)

    if (tx.kind === 'savings') {
      runningSavings += tx.direction === 'add' ? Number(tx.amount || 0) : -Number(tx.amount || 0)
    }

    savingsGrowthLine.push(roundCurrency(runningSavings))
  }

  return {
    labels,
    balanceLine,
    additionsLine,
    deductionsLine,
    savingsGrowthLine,
  }
}

export function buildMonthlySeries(transactions) {
  const map = new Map()

  for (const tx of transactions) {
    const key = monthKeyFromIso(tx.timestamp)
    if (!map.has(key)) {
      map.set(key, {
        income: 0,
        expenses: 0,
        savings: 0,
      })
    }

    const row = map.get(key)
    const amount = Number(tx.amount || 0)

    if (tx.kind === 'income') {
      row.income += tx.direction === 'add' ? amount : -amount
    }

    if (tx.kind === 'expenses') {
      row.expenses += tx.direction === 'subtract' ? amount : -amount
    }

    if (tx.kind === 'savings') {
      row.savings += tx.direction === 'add' ? amount : -amount
    }
  }

  const labels = [...map.keys()].sort()
  const income = labels.map((label) => roundCurrency(map.get(label).income))
  const expenses = labels.map((label) => roundCurrency(map.get(label).expenses))
  const savings = labels.map((label) => roundCurrency(map.get(label).savings))

  return {
    labels,
    income,
    expenses,
    savings,
  }
}

export function buildYearlySeries(transactions) {
  const map = new Map()

  for (const tx of transactions) {
    const key = yearKeyFromIso(tx.timestamp)
    if (!map.has(key)) {
      map.set(key, {
        net: 0,
      })
    }

    const row = map.get(key)
    const amount = Number(tx.amount || 0)
    row.net += tx.direction === 'add' ? amount : -amount
  }

  const labels = [...map.keys()].sort()
  const net = labels.map((label) => roundCurrency(map.get(label).net))

  return {
    labels,
    net,
  }
}
