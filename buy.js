import {
  initializeApp,
  getApps,
  getApp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  increment
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyChsncNZ5qeqAosV4_QncIkoTyf6mmPz9o",
  authDomain: "ecosimsitebase.firebaseapp.com",
  projectId: "ecosimsitebase",
  storageBucket: "ecosimsitebase.firebasestorage.app",
  messagingSenderId: "918833539734",
  appId: "1:918833539734:web:cdc25a7a6ece864ffcb0b7",
  measurementId: "G-1QBL56VSW6"
};

const PRESALE_WALLET = "84QqigQqzLsyXMpuhaKKwhaY91D48MGhvBLQGWAZtbGd";

const treasuryAddressEl = document.getElementById("treasuryAddress");
const walletPill = document.getElementById("walletPill");
const walletMini = document.getElementById("walletMini");
const totalBoughtEl = document.getElementById("totalBought");
const pointsEl = document.getElementById("points");
const connStatusEl = document.getElementById("connStatus");
const resultEl = document.getElementById("result");
const connectBtn = document.getElementById("connectBtn");
const payBtn = document.getElementById("payBtn");
const copyBtn = document.getElementById("copyBtn");
const amountInput = document.getElementById("amount");
const feeEstimateEl = document.getElementById("feeEstimate");

let firebaseApp;
if (!getApps().length) {
  firebaseApp = initializeApp(firebaseConfig);
} else {
  firebaseApp = getApp();
}
const firestore = getFirestore(firebaseApp);

let currentWallet = null;

const formatNumber = (val) => {
  if (typeof val !== "number") return "0";
  return val.toLocaleString();
};

const setMessage = (msg, color = "text-cyan-200") => {
  resultEl.className = `text-xs ${color}`;
  resultEl.textContent = msg;
};

const shorten = (addr) => (addr ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : "-");

const updateStatusUI = () => {
  const connected = !!currentWallet;
  walletPill.textContent = connected
    ? `Connected: ${shorten(currentWallet)}`
    : "Not connected";
  walletMini.textContent = connected ? currentWallet : "-";
  connStatusEl.textContent = connected ? "Connected ✅" : "Not connected";
  payBtn.disabled = !connected;
  if (!connected) {
    payBtn.title = "Connect wallet first";
  } else {
    payBtn.removeAttribute("title");
  }
};

async function ensureUserDocument(walletAddress) {
  const ref = doc(firestore, "users", walletAddress);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    console.log("User exists");
    return;
  }
  await setDoc(ref, {
    wallet: walletAddress,
    points: 0,
    totalBoughtEco: 0,
    purchaseCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  console.log("User created");
}

async function loadUserStats(walletAddress) {
  const ref = doc(firestore, "users", walletAddress);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data();
  totalBoughtEl.textContent = formatNumber(data.totalBoughtEco ?? 0);
  pointsEl.textContent = formatNumber(data.points ?? 0);
}

async function recordPurchase(walletAddress, ecoAmount) {
  const ref = doc(firestore, "users", walletAddress);
  await updateDoc(ref, {
    totalBoughtEco: increment(ecoAmount),
    purchaseCount: increment(1),
    updatedAt: serverTimestamp()
  });
  // TODO: In production, verify the on-chain transaction server-side before writing.
}

async function connectPhantom() {
  if (!window?.solana?.isPhantom) {
    setMessage("Install Phantom to continue", "text-amber-300");
    return;
  }
  try {
    const res = await window.solana.connect();
    currentWallet = res.publicKey.toString();
    updateStatusUI();
    setMessage("Wallet connected", "text-cyan-200");
    await ensureUserDocument(currentWallet);
    await loadUserStats(currentWallet);
  } catch (err) {
    console.error(err);
    setMessage("Connect request was cancelled", "text-amber-300");
  }
}

function setupPercentButtons() {
  const pctButtons = document.querySelectorAll("[data-pct]");
  pctButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const pct = Number(btn.dataset.pct);
      const base = Number(amountInput.value) || 0.1;
      const next = +(base * (pct / 100)).toFixed(2);
      amountInput.value = next || 0.1;
    });
  });
}

async function onBuy() {
  if (!currentWallet) {
    setMessage("Connect wallet first", "text-amber-300");
    return;
  }
  const amt = Number(amountInput.value);
  if (!amt || amt <= 0) {
    setMessage("Enter a valid amount", "text-amber-300");
    return;
  }
  try {
    const ecoAmount = Math.round(amt * 500000);
    await recordPurchase(currentWallet, ecoAmount);
    await loadUserStats(currentWallet);
    setMessage(
      `Recorded purchase (demo). ${amt} SOL (~${ecoAmount} ECO). TODO: verify on-chain.`,
      "text-cyan-200"
    );
  } catch (err) {
    console.error(err);
    setMessage("Could not record purchase", "text-rose-300");
  }
}

function copyPresale() {
  navigator.clipboard.writeText(PRESALE_WALLET).then(() => {
    setMessage("Presale wallet copied", "text-cyan-200");
  });
}

function init() {
  treasuryAddressEl.textContent = PRESALE_WALLET;
  feeEstimateEl.textContent = "Est. network fee: ~0.000005 SOL";
  updateStatusUI();
  connectBtn.addEventListener("click", () => connectPhantom());
  payBtn.addEventListener("click", () => onBuy());
  copyBtn.addEventListener("click", () => copyPresale());
  setupPercentButtons();
}

init();
