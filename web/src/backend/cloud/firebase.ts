// Cloud mode only: the Firebase client (App, Auth, Firestore, App Check). Imported solely from
// ./index.ts, which backend/index.ts loads with a dynamic import under a statically-known
// `VITE_BACKEND === "cloud"` branch — so no other build contains Firebase.
//
// Config comes from VITE_FIREBASE_* (public by design: access is enforced by Auth, App Check
// and firebase/firestore.rules). VITE_USE_EMULATORS=true points everything at the local
// emulators (`npm run emulators -w firebase-config`) and uses an App Check debug token.

import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  initializeAuth,
  type Auth,
} from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from "firebase/app-check";

export const USE_EMULATORS = import.meta.env.VITE_USE_EMULATORS === "true";

export interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  firestore: Firestore;
  /** A fresh-enough App Check token for the API's X-Firebase-AppCheck header. */
  getAppCheckToken(): Promise<string>;
}

function firebaseConfig() {
  const env = import.meta.env;
  if (USE_EMULATORS) {
    // The emulators accept any API key; the project id must match the one they run with.
    return {
      apiKey: env.VITE_FIREBASE_API_KEY || "demo-api-key",
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "localhost",
      projectId: env.VITE_EMULATOR_PROJECT_ID || "demo-recipe",
      appId: env.VITE_FIREBASE_APP_ID || "1:000000000000:web:0000000000000000000000",
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "000000000000",
    };
  }
  const missing = (
    ["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_APP_ID"] as const
  ).filter((k) => !env[k]);
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`Cloud mode is missing Firebase config: ${missing.join(", ")} (see web/.env.cloud.example).`);
  }
  return {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  };
}

export function initFirebase(): FirebaseServices {
  const app = initializeApp(firebaseConfig());

  const auth = initializeAuth(app, {
    persistence: browserLocalPersistence,
    popupRedirectResolver: browserPopupRedirectResolver,
  });
  const firestore = getFirestore(app);

  if (USE_EMULATORS) {
    const host = window.location.hostname || "localhost";
    const authPort = import.meta.env.VITE_AUTH_EMULATOR_PORT || "9099";
    const firestorePort = Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT || "8085");
    connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
    connectFirestoreEmulator(firestore, host, firestorePort);
  }

  let appCheck: AppCheck | null = null;
  const siteKey = import.meta.env.VITE_APPCHECK_SITE_KEY;
  if (USE_EMULATORS) {
    // No App Check against the emulators: there's no emulator for it, and its debug-token
    // exchange would call the real service for a demo project and fail. The local API runs
    // with REQUIRE_APP_CHECK=false (only allowed when it talks to the emulators).
  } else if (siteKey) {
    try {
      appCheck = initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("App Check failed to start", err);
    }
  } else {
    // eslint-disable-next-line no-console
    console.error("Cloud mode is missing VITE_APPCHECK_SITE_KEY — API requests will be rejected.");
  }

  async function getAppCheckToken(): Promise<string> {
    if (!appCheck) {
      if (USE_EMULATORS) return "emulator";
      throw new Error("We couldn't verify this browser. Reload the page and try again.");
    }
    try {
      return (await getToken(appCheck, false)).token;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("App Check token failed", err);
      throw new Error("We couldn't verify this browser. Reload the page and try again.");
    }
  }

  return { app, auth, firestore, getAppCheckToken };
}
