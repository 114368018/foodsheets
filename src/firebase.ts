import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const requiredFirebaseEnvMap = {
  VITE_FIREBASE_API_KEY: firebaseConfig.apiKey,
  VITE_FIREBASE_PROJECT_ID: firebaseConfig.projectId,
  VITE_FIREBASE_APP_ID: firebaseConfig.appId,
} as const

export const missingFirebaseEnvKeys = Object.entries(requiredFirebaseEnvMap)
  .filter(([, value]) => !value)
  .map(([key]) => key)

const hasRequiredFirebaseConfig = Boolean(
  missingFirebaseEnvKeys.length === 0,
)

const app = hasRequiredFirebaseConfig ? initializeApp(firebaseConfig) : null

export const db = app ? getFirestore(app) : null
export const storage = app ? getStorage(app) : null
export const isFirebaseConfigured = hasRequiredFirebaseConfig
export const isFirebaseStorageConfigured = Boolean(hasRequiredFirebaseConfig && firebaseConfig.storageBucket)
export const firebaseProjectDocId = import.meta.env.VITE_FIREBASE_PROJECT_DOC_ID || 'default'
