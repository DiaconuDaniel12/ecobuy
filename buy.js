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

// Solana libs (ESM, with fallback) – same pattern as support.js
const WEB3_URL = "https://cdn.jsdelivr.net/npm/@solana/web3.js@1.91.4/+esm?v=2";
const WEB3_FALLBACK = "https://esm.sh/@solana/web3.js@1.91.4?target=es2020&v=2";
const SPL_URL = "https://cdn.jsdelivr.net/npm/@solana/spl-token@0.3.11/+esm?v=2";
const SPL_FALLBACK = "https://esm.sh/@solana/spl-token@0.3.11?target=es2020&v=2";

// Network config (switch to devnet if needed)
const NETWORK = "mainnet-beta";
const USDC_MINT =
  NETWORK === "mainnet-beta"
    ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    : "BXXkv6z8ykpGqxpnj6oJ4j5LZb5uMY15qbt7MUH3Y2bU";
const RPC_URL =
  NETWORK === "mainnet-beta"
    ? "https://api.mainnet-beta.solana.com"
    : "https://api.devnet.solana.com";
const TREASURY = "84QqigQqzLsyXMpuhaKKwhaY91D48MGhvBLQGWAZtbGd";
const USDC_DECIMALS = 6;
const MIN_USDC = 1;
const MAX_USDC = 10;
const ECO_PER_USDC = 50000;
const EXPLORER_BASE =
  NETWORK === "mainnet-beta"
    ? "https://solscan.io/tx/"
    : "https://solscan.io/tx/?cluster=devnet";

const firebaseConfig = {
  apiKey: "AIzaSyChsncNZ5qeqAosV4_QncIkoTyf6mmPz9o",
  authDomain: "ecosimsitebase.firebaseapp.com",
  projectId: "ecosimsitebase",
  storageBucket: "ecosimsitebase.firebasestorage.app",
  messagingSenderId: "918833539734",
  appId: "1:918833539734:web:cdc25a7a6ece864ffcb0b7",
  measurementId: "G-1QBL56VSW6"
};

// UI elements
const els = {
  walletPill: document.getElementById("walletPill"),
  walletMini: document.getElementById("walletMini"),
  totalBought: document.getElementById("totalBought"),
  points: document.getElementById("points"),
  usdcBalance: document.getElementById("usdcBalance"),
  lastTx: document.getElementById("lastTx"),
  connStatus: document.getElementById("connStatus"),
  result: document.getElementById("result"),
  connectBtn: document.getElementById("connectBtn"),
  payBtn: document.getElementById("payBtn"),
  copyBtn: document.getElementById("copyBtn"),
  amountInput: document.getElementById("amount"),
  feeEstimate: document.getElementById("feeEstimate"),
  ecoEstimate: document.getElementById("ecoEstimate"),
  treasury: document.getElementById("treasuryAddress")
};

// Firebase init
const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
const firestore = getFirestore(firebaseApp);

// State
let web3 = null;
let spl = null;
let connection = null;
let provider = null;
let wallet = null;
let currentUsdcBalance = null;
let currentUsdcAta = null;
let lastSignature = null;

// Helpers
const shorten = (addr) =>
  addr ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : "-";

const setMessage = (msg, color = "text-cyan-200") => {
  if (!els.result) return;
  els.result.className = `text-xs ${color}`;
  els.result.textContent = msg;
};

const getEcoAmount = () => {
  const amt = Number(els.amountInput?.value);
  if (!amt || amt <= 0) return 0;
  return Math.round(amt * ECO_PER_USDC);
};

const updateEcoEstimate = () => {
  if (!els.ecoEstimate) return;
  const ecoAmount = getEcoAmount();
  els.ecoEstimate.textContent = ecoAmount
    ? `You receive: ${ecoAmount.toLocaleString()} ECO`
    : "You receive: - ECO";
};

const updateStatusUI = () => {
  const connected = !!wallet;
  const amt = Number(els.amountInput?.value);
  const amountInvalid =
    !amt || amt < MIN_USDC || amt > MAX_USDC || Number.isNaN(amt) || !Number.isFinite(amt);

  if (els.walletPill)
    els.walletPill.textContent = connected
      ? `Connected: ${shorten(wallet?.toString?.() || wallet)}`
      : "Not connected";
  if (els.walletMini)
    els.walletMini.textContent = connected ? wallet?.toString?.() || wallet : "-";
  if (els.connStatus)
    els.connStatus.textContent = connected ? "Connected ✅" : "Not connected";
  if (els.usdcBalance)
    els.usdcBalance.textContent =
      currentUsdcBalance === null
        ? "-"
        : `${currentUsdcBalance.toLocaleString()} USDC`;
  if (els.lastTx)
    els.lastTx.textContent = lastSignature ? lastSignature : "-";

  const disableBuy =
    !connected || currentUsdcBalance === null || currentUsdcAta === null || amountInvalid;
  if (els.payBtn) {
    els.payBtn.disabled = disableBuy;
    els.payBtn.title = disableBuy
      ? `Connect wallet, load balance, amount ${MIN_USDC}-${MAX_USDC} USDC`
      : "";
  }
};

// Firestore helpers
async function ensureUserDocument(walletAddress) {
  const ref = doc(firestore, "users", walletAddress);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await setDoc(ref, { lastSeenAt: serverTimestamp() }, { merge: true });
    return;
  }
  await setDoc(ref, {
    wallet: walletAddress,
    points: 0,
    totalBoughtEco: 0,
    purchaseCount: 0,
    lastPurchaseSig: "",
    createdAt: serverTimestamp(),
    lastSeenAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

async function loadUserStats(walletAddress) {
  const ref = doc(firestore, "users", walletAddress);
  const snap = await GetDocSafe(ref);
  if (!snap) return;
  const data = snap.data();
  if (els.totalBought) els.totalBought.textContent = (data.totalBoughtEco ?? 0).toLocaleString();
  if (els.points) els.points.textContent = (data.points ?? 0).toLocaleString();
  if (data.lastPurchaseSig) {
    lastSignature = data.lastPurchaseSig;
    if (els.lastTx) els.lastTx.textContent = lastSignature;
  }
}

// Safe wrapper around getDoc (avoid crash if missing firestore)
async function GetDocSafe(ref) {
  try {
    const snap = await getDoc(ref);
    return snap.exists() ? snap : null;
  } catch (e) {
    console.error("getDoc failed", e);
    return null;
  }
}

async function recordPurchase(walletAddress, ecoAmount, signature, amountUSDC) {
  const userRef = doc(firestore, "users", walletAddress);
  await updateDoc(userRef, {
    totalBoughtEco: increment(ecoAmount),
    purchaseCount: increment(1),
    lastPurchaseSig: signature,
    updatedAt: serverTimestamp()
  });
  await setDoc(doc(firestore, "purchases", signature), {
    wallet: walletAddress,
    amountUSDC,
    ecoAmount,
    signature,
    network: NETWORK,
    createdAt: serverTimestamp()
  });
}

// Solana helpers
async function loadModule(primary, fallback) {
  try {
    return await import(primary);
  } catch (err) {
    console.warn("Primary import failed, trying fallback:", err);
    return await import(fallback);
  }
}

function getProvider() {
  if ("solana" in window) {
    const p = window.solana;
    if (p?.isPhantom) return p;
  }
  return null;
}

async function ensureAta(owner, mint, payer) {
  const { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } = spl;
  const ata = await getAssociatedTokenAddress(mint, owner, false);
  let info;
  try {
    info = await connection.getAccountInfo(ata);
  } catch (err) {
    const msg = err?.message || "";
    if (
      msg.includes("403") ||
      msg.toLowerCase().includes("forbidden") ||
      msg.toLowerCase().includes("failed to get info about account")
    ) {
      throw new Error("Make sure you have enough USDC and SOL for fees.");
    }
    throw err;
  }
  const ix = info
    ? null
    : createAssociatedTokenAccountInstruction(payer, ata, owner, mint);
  return { ata, ix, exists: !!info };
}

async function fetchUsdcBalance() {
  if (!wallet || !connection) return;
  try {
    const { PublicKey } = web3;
    const owner = new PublicKey(wallet);
    const mint = new PublicKey(USDC_MINT);
    const resp = await connection.getParsedTokenAccountsByOwner(owner, { mint });
    let balance = 0;
    currentUsdcAta = null;
    if (resp.value && resp.value.length > 0) {
      const acct = resp.value[0];
      balance =
        acct.account.data.parsed.info.tokenAmount.uiAmount || 0;
      currentUsdcAta = acct.pubkey;
    }
    currentUsdcBalance = balance;
    updateStatusUI();
  } catch (err) {
    console.error("Balance fetch failed", err);
    currentUsdcBalance = null;
    currentUsdcAta = null;
    setMessage("Could not read USDC balance (RPC limit).", "text-amber-300");
    updateStatusUI();
  }
}

async function connectPhantom() {
  provider = getProvider();
  if (!provider) {
    setMessage("Install Phantom to continue", "text-amber-300");
    return;
  }
  try {
    const res = await (provider.connect
      ? provider.connect({ onlyIfTrusted: false })
      : provider.request({ method: "connect" }));
    wallet = (res?.publicKey || provider.publicKey).toString();
    await ensureUserDocument(wallet);
    await loadUserStats(wallet);
    await fetchUsdcBalance();
    updateStatusUI();
    setMessage("Wallet connected", "text-cyan-200");
  } catch (err) {
    console.error("Phantom connect error", err);
    setMessage("Connect request was cancelled.", "text-amber-300");
  }
}

async function transferUsdc(amount) {
  const { PublicKey, Transaction } = web3;
  const {
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    createTransferCheckedInstruction
  } = spl;

  const owner = new PublicKey(wallet);
  const mint = new PublicKey(USDC_MINT);
  const treasury = new PublicKey(TREASURY);

  const fromAta = new PublicKey(currentUsdcAta);
  const toAta = await getAssociatedTokenAddress(mint, treasury, false);
  let toInfo = await connection.getAccountInfo(toAta);

  const tx = new Transaction();
  if (!toInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(owner, toAta, treasury, mint)
    );
  }

  const amountBase = Math.round(amount * 10 ** USDC_DECIMALS);
  tx.add(
    createTransferCheckedInstruction(
      fromAta,
      mint,
      toAta,
      owner,
      amountBase,
      USDC_DECIMALS
    )
  );

  tx.feePayer = owner;
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;

  let signature = "";
  if (provider.signAndSendTransaction) {
    const res = await provider.signAndSendTransaction(tx);
    signature = res.signature || res;
  } else if (provider.signTransaction) {
    const signed = await provider.signTransaction(tx);
    signature = await connection.sendRawTransaction(signed.serialize());
  } else {
    throw new Error("Wallet cannot sign and send transactions.");
  }

  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  return signature;
}

async function onBuy() {
  if (!wallet) {
    setMessage("Connect wallet first", "text-amber-300");
    return;
  }
  if (currentUsdcBalance === null || currentUsdcAta === null) {
    setMessage(
      "Cannot read USDC balance. Reconnect wallet and try again.",
      "text-amber-300"
    );
    return;
  }
  const amt = Number(els.amountInput?.value);
  if (!amt || Number.isNaN(amt) || !Number.isFinite(amt)) {
    setMessage("Enter a valid amount", "text-amber-300");
    return;
  }
  if (amt < MIN_USDC || amt > MAX_USDC) {
    setMessage(`Amount must be between ${MIN_USDC} and ${MAX_USDC} USDC.`, "text-amber-300");
    return;
  }
  if (amt > currentUsdcBalance) {
    setMessage("Not enough USDC. Top up your wallet.", "text-amber-300");
    return;
  }

  const ecoAmount = getEcoAmount();
  try {
    setMessage("Sending transaction...", "text-cyan-200");
    els.payBtn.disabled = true;

    const sig = await transferUsdc(amt);
    lastSignature = sig;
    if (els.lastTx) els.lastTx.textContent = sig;

    await recordPurchase(wallet, ecoAmount, sig, amt);
    await loadUserStats(wallet);
    await fetchUsdcBalance();

    const link = `${EXPLORER_BASE}${sig}`;
    setMessage(
      `Purchase confirmed. ${amt} USDC (~${ecoAmount} ECO).`,
      "text-cyan-200"
    );
    if (els.result) {
      els.result.innerHTML = `Signature: <a href="${link}" target="_blank" rel="noreferrer">${sig}</a>`;
    }
  } catch (err) {
    console.error(err);
    setMessage(`Could not complete purchase: ${err.message || err}`, "text-rose-300");
  } finally {
    els.payBtn.disabled = false;
  }
}

// Copy treasury
function copyPresale() {
  navigator.clipboard.writeText(TREASURY).then(() => {
    setMessage("Presale wallet copied", "text-cyan-200");
  });
}

// Init
async function start() {
  web3 = await loadModule(WEB3_URL, WEB3_FALLBACK);
  spl = await loadModule(SPL_URL, SPL_FALLBACK);
  connection = new web3.Connection(RPC_URL, "confirmed");
  if (els.treasury) els.treasury.textContent = TREASURY;
  if (els.feeEstimate) els.feeEstimate.textContent = "Est. network fee: tiny SOL (for transactions)";
  updateEcoEstimate();
  updateStatusUI();

  els.amountInput?.addEventListener("input", () => {
    updateEcoEstimate();
    updateStatusUI();
  });

  if (els.connectBtn) els.connectBtn.addEventListener("click", connectPhantom);
  if (els.payBtn) els.payBtn.addEventListener("click", onBuy);
  if (els.copyBtn) els.copyBtn.addEventListener("click", copyPresale);
}

start().catch((e) => {
  console.error("Init failed", e);
  setMessage("Could not load Solana modules.", "text-rose-300");
});
