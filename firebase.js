// firebase.js — Firebase 초기화 (Realtime Database + Storage)
const firebaseConfig = {
  apiKey: "AIzaSyCpdbHoEWYo8Fpeo8v_g0a4lTuNCroqpxg",
  authDomain: "crm-etc.firebaseapp.com",
  databaseURL: "https://crm-etc-default-rtdb.firebaseio.com",
  projectId: "crm-etc",
  storageBucket: "crm-etc.firebasestorage.app",
  messagingSenderId: "457936051514",
  appId: "1:457936051514:web:8668e13bdaf84a6f2bc403",
  measurementId: "G-27JQG0V610"
};
firebase.initializeApp(firebaseConfig);
const database = firebase.database();
const storage = firebase.storage();
