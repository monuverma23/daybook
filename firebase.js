// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCeSSpuFq6Jtdc7hHPNdWR_gbJh6hsUOKQ",
  authDomain: "college-sports-fest.firebaseapp.com",
  projectId: "college-sports-fest",
  storageBucket: "college-sports-fest.firebasestorage.app",
  messagingSenderId: "487306148373",
  appId: "1:487306148373:web:ca5e06ba0226821e3dac1c",
  measurementId: "G-KDDQBY09NJ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);