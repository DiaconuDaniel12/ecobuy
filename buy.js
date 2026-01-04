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
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const RPC_URL = "https://api.mainnet-beta.solana.com";
const ECO_PER_USDC = 50000;

const treasuryAddressEl = document.getElementById("treasuryAddress");
const walletPill = document.getElementById("walletPill");
const walletMini = document.getElementById("walletMini");
const totalBoughtEl = document.getElementById("totalBought");
const pointsEl = document.getElementById("points");
const usdcBalanceEl = document.getElementById("usdcBalance");
const connStatusEl = document.getElementById("connStatus");
const resultEl = document.getElementById("result");
const connectBtn = document.getElementById("connectBtn");
const payBtn = document.getElementById("payBtn");
const copyBtn = document.getElementById("copyBtn");
const amountInput = document.getElementById("amount");
const feeEstimateEl = document.getElementById("feeEstimate");
const ecoEstimateEl = document.getElementById("ecoEstimate");

let firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
const firestore = getFirestore(firebaseApp);

let currentWallet = null;
let currentUsdcBalance = null;

const shorten = (addr) =>
  addr ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : "-";

const formatNumber = (val) =>
  typeof val === "number" ? val.toLocaleString() : "0";

const setMessage = (msg, color = "text-cyan-200") => {
  resultEl.className = `text-xs ${color}`;
  resultEl.textContent = msg;
};

const getEcoAmount = () => {
  const amt = Number(amountInput.value);
  if (!amt || amt <= 0) return 0;
  return Math.round(amt * ECO_PER_USDC);
};

const updateEcoEstimate = () => {
  const ecoAmount = getEcoAmount();
  ecoEstimateEl.textContent = ecoAmount
    ? `You receive: ${ecoAmount.toLocaleString()} ECO`
    : "You receive: - ECO";
};

const updateStatusUI = () => {
  const connected = !!currentWallet;
  walletPill.textContent = connected
    ? `Connected: ${shorten(currentWallet)}`
    : "Not connected";
  walletMini.textContent = connected ? currentWallet : "-";
  connStatusEl.textContent = connected ? "Connected ✅" : "Not connected";
  usdcBalanceEl.textContent =
    currentUsdcBalance === null
      ? "-"
      : `${currentUsdcBalance.toLocaleString()} USDC`;
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
  if (snap.exists()) return;
  await setDoc(ref, {
    wallet: walletAddress,
    points: 0,
    totalBoughtEco: 0,
    purchaseCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

async function loadUserStats(walletAddress) {
  const ref = doc(firestore, "users", walletAddress);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data();
  totalBoughtEl.textContent = formatNumber(data.totalBoughtEco ?? 0);
  pointsEl.textContent = formatNumber(data.points ?? 0);
}

async function fetchUsdcBalance() {
  if (!currentWallet || !window.solanaWeb3) return;
  try {
    const { Connection, PublicKey } = window.solanaWeb3;
    const connection = new Connection(RPC_URL, "confirmed");
    const owner = new PublicKey(currentWallet);
    const mint = new PublicKey(USDC_MINT);
    const resp = await connection.getParsedTokenAccountsByOwner(owner, {
      mint
    });
    let balance = 0;
    if (resp.value && resp.value.length > 0) {
      balance =
        resp.value[0].account.data.parsed.info.tokenAmount.uiAmount || 0;
    }
    currentUsdcBalance = balance;
    updateStatusUI();
  } catch (err) {
    console.error("Balance fetch failed", err);
    currentUsdcBalance = null;
    updateStatusUI();
    setMessage("Could not read USDC balance (RPC limit).", "text-amber-300");
  }
}

async function recordPurchase(walletAddress, ecoAmount) {
  const ref = doc(firestore, "users", walletAddress);
  await updateDoc(ref, {
    totalBoughtEco: increment(ecoAmount),
    purchaseCount: increment(1),
    updatedAt: serverTimestamp()
  });
  // TODO: In production, verify on-chain tx server-side before writing.
}

async function connectPhantom() {
  if (!window?.solana?.isPhantom) {
    setMessage("Install Phantom to continue", "text-amber-300");
    return;
  }
  try {
    const res = await window.solana.connect();
    currentWallet = res.publicKey.toString();
    await ensureUserDocument(currentWallet);
    await loadUserStats(currentWallet);
    await fetchUsdcBalance();
    updateStatusUI();
    setMessage("Wallet connected", "text-cyan-200");
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
      const base = Number(amountInput.value) || 1;
      const next = +(base * (pct / 100)).toFixed(0);
      amountInput.value = next || 1;
      updateEcoEstimate();
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
  const ecoAmount = getEcoAmount();
  if (!ecoAmount) {
    setMessage("Amount too small", "text-amber-300");
    return;
  }
  if (currentUsdcBalance !== null && amt > currentUsdcBalance) {
    setMessage("Not enough USDC. Top up your wallet.", "text-amber-300");
    return;
  }
  try {
    await recordPurchase(currentWallet, ecoAmount);
    await loadUserStats(currentWallet);
    await fetchUsdcBalance();
    setMessage(
      `Recorded purchase. ${amt} USDC (~${ecoAmount} ECO).`,
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
  feeEstimateEl.textContent = "Est. network fee: tiny SOL (for transactions)";
  updateStatusUI();
  connectBtn.addEventListener("click", () => connectPhantom());
  payBtn.addEventListener("click", () => onBuy());
  copyBtn.addEventListener("click", () => copyPresale());
  amountInput.addEventListener("input", updateEcoEstimate);
  setupPercentButtons();
  updateEcoEstimate();
}

init();
