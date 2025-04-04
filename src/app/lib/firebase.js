import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyAI0rTrsmQH6TNVGAKVNM8i9w8-IMhdTZg",
  authDomain: "testing-firebase-3430e.firebaseapp.com",
  projectId: "testing-firebase-3430e",
  storageBucket: "testing-firebase-3430e.appspot.com",
  messagingSenderId: "109196759373",
  appId: "1:109196759373:web:168896058ce7d2aff72704"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export { auth, db, storage };