import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAf7ouTkWc1cmWNI79Q4Nd7o_u6aqecAb0",
  authDomain: "okmarine-tankrental.firebaseapp.com",
  projectId: "okmarine-tankrental",
  storageBucket: "okmarine-tankrental.firebasestorage.app",
  messagingSenderId: "235534581046",
  appId: "1:235534581046:web:41383ba6c66bf0c502c797",
  measurementId: "G-NTBK5SL2RG"
};

// Initialize Firebase (Singleton pattern to prevent re-initialization in Next.js development mode)
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
