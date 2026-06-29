import Dexie from 'dexie'

const db = new Dexie('VaultPrivateLedger')
db.version(1).stores({
  keyValue: '&key',
})

const SNAPSHOT_KEY = 'encrypted-finance-snapshot'

export async function saveEncryptedSnapshot(payload) {
  await db.keyValue.put({
    key: SNAPSHOT_KEY,
    payload,
    updatedAt: new Date().toISOString(),
  })
}

export async function loadEncryptedSnapshot() {
  const record = await db.keyValue.get(SNAPSHOT_KEY)
  return record?.payload ?? null
}

export async function exportEncryptedBackupFile() {
  const record = await db.keyValue.get(SNAPSHOT_KEY)
  if (!record?.payload) {
    throw new Error('No saved data available')
  }

  return {
    format: 'svb-backup-v1',
    exportedAt: new Date().toISOString(),
    payload: record.payload,
  }
}

export async function importEncryptedBackupFile(backup) {
  if (!backup || backup.format !== 'svb-backup-v1' || !backup.payload) {
    throw new Error('Invalid backup file')
  }

  await saveEncryptedSnapshot(backup.payload)
}
