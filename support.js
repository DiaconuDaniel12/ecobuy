// support.js - Phantom + USDC contribution (static)
// Use jsDelivr +esm (sends proper CORS) with esm.sh as fallback
// cache-bust query to avoid stale CDN responses
const WEB3_URL = "https://cdn.jsdelivr.net/npm/@solana/web3.js@1.91.4/+esm?v=2";
const WEB3_FALLBACK = "https://esm.sh/@solana/web3.js@1.91.4?target=es2020&v=2";
const SPL_URL = "https://cdn.jsdelivr.net/npm/@solana/spl-token@0.3.11/+esm?v=2";
const SPL_FALLBACK = "https://esm.sh/@solana/spl-token@0.3.11?target=es2020&v=2";

import {
  getApp,
  getApps,
  initializeApp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  getDocs,
  collection,
  query,
  where,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyChsncNZ5qeqAosV4_QncIkoTyf6mmPz9o",
  authDomain: "ecosimsitebase.firebaseapp.com",
  projectId: "ecosimsitebase",
  storageBucket: "ecosimsitebase.firebasestorage.app",
  messagingSenderId: "918833539734",
  appId: "1:918833539734:web:cdc25a7a6ece864ffcb0b7",
  measurementId: "G-1QBL56VSW6",
};

const RPC_URL = "https://api.mainnet-beta.solana.com";
const USDC_DECIMALS = 6;
const MIN_USDC = 10;
const MAX_USDC = 5000;
const ECO_PER_USDC = 200; // indicative
const EST_FEE_SOL = 0.000005; // ~5k lamports typical transfer fee
const EXPLORER_BASE = "https://solscan.io/tx/";

const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
const firestore = getFirestore(firebaseApp);

async function ensureUserDocument(walletAddress) {
  const ref = doc(firestore, "users", walletAddress);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    console.log("User exists");
    // refresh lastSeenAt without touching points/hasPurchased
    await setDoc(ref, { lastSeenAt: serverTimestamp() }, { merge: true });
    return;
  }
  await setDoc(ref, {
    wallet: walletAddress,
    points: 0,
    hasPurchased: false,
    airdropStatus: "pending",
    createdAt: serverTimestamp(),
    lastSeenAt: serverTimestamp(),
  });
  console.log("User created");
}

// Simple airdrop helper (run from console when needed)
// Filters by hasPurchased (default true) and airdropStatus (default "pending")
// Marks matched users as "sent"
async function runAirdrop({ onlyPurchased = true, status = "pending" } = {}) {
  const filters = [];
  if (onlyPurchased) filters.push(where("hasPurchased", "==", true));
  if (status) filters.push(where("airdropStatus", "==", status));

  const q = filters.length
    ? query(collection(firestore, "users"), ...filters)
    : query(collection(firestore, "users"));

  const snap = await getDocs(q);
  console.log(`Airdrop scan: ${snap.size} users matched`);

  for (const docSnap of snap.docs) {
    try {
      await updateDoc(docSnap.ref, { airdropStatus: "sent" });
      console.log(`Airdrop marked sent: ${docSnap.id}`);
    } catch (err) {
      console.error(`Airdrop update failed for ${docSnap.id}`, err);
    }
  }
}

const els = {
  status: document.getElementById("status"),
  connectBtn: document.getElementById("connectBtn"),
  amountInput: document.getElementById("amount"),
  receive: document.getElementById("receive"),
  fee: document.getElementById("feeEstimate"),
  payBtn: document.getElementById("payBtn"),
  result: document.getElementById("result"),
  treasury: document.getElementById("treasuryAddress"),
};

function setStatus(msg, isError = false) {
  if (!els.status) return;
  els.status.textContent = msg;
  els.status.style.color = isError ? "#f88" : "var(--muted)";
}

function getProvider() {
  if ("solana" in window) {
    const p = window.solana;
    if (p?.isPhantom) return p;
  }
  return null;
}

function updateReceive() {
  if (!els.receive || !els.amountInput) return;
  const val = parseFloat(els.amountInput.value || "0");
  if (isNaN(val) || val <= 0) {
    els.receive.textContent = "0 ECO";
    return;
  }
  const eco = val * ECO_PER_USDC;
  els.receive.textContent = `${eco.toLocaleString()} ECO`;
}

function updateFee() {
  if (els.fee) {
    els.fee.textContent = `Est. network fee: ≈ ${EST_FEE_SOL} SOL (varies)`;
  }
}

async function loadModule(primary, fallback) {
  try {
    return await import(primary);
  } catch (err) {
    console.warn("Primary import failed, trying fallback:", err);
    return await import(fallback);
  }
}

async function start() {
  const web3 = await loadModule(WEB3_URL, WEB3_FALLBACK);
  const spl = await loadModule(SPL_URL, SPL_FALLBACK);

  const { Connection, PublicKey, Transaction } = web3;
  const { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createTransferCheckedInstruction } = spl;

  const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const TREASURY = new PublicKey("84QqigQqzLsyXMpuhaKKwhaY91D48MGhvBLQGWAZtbGd");

  const connection = new Connection(RPC_URL, "confirmed");
  let provider = null;
  let wallet = null;

  async function ensureAta(owner, mint, payer) {
    const ata = await getAssociatedTokenAddress(mint, owner, false);
    let info;
    try {
      info = await connection.getAccountInfo(ata);
    } catch (err) {
      // Friendly message for RPC blocks/rate limits
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
    const ix = info ? null : createAssociatedTokenAccountInstruction(payer, ata, owner, mint);
    return { ata, ix, exists: !!info };
  }

  function attachHandlers() {
    if (els.connectBtn) {
      els.connectBtn.addEventListener("click", async () => {
        provider = getProvider();
        if (!provider) {
          setStatus("Phantom nu este detectat. Instalează Phantom.", true);
          if (els.result) {
            els.result.innerHTML = `<a href="https://phantom.app" target="_blank" rel="noreferrer">Instalează Phantom</a>`;
          }
          return;
        }
        try {
          setStatus("Așteaptă aprobarea în Phantom...");
          const res = await (provider.connect
            ? provider.connect({ onlyIfTrusted: false })
            : provider.request({ method: "connect" }));
          wallet = res?.publicKey || provider.publicKey;
          if (!wallet) throw new Error("Nu am primit wallet din Phantom.");
          setStatus(`Conectat: ${wallet.toString()}`);
          await ensureUserDocument(wallet.toString());
          if (els.result) els.result.textContent = "";
        } catch (e) {
          console.error("Phantom connect error:", e);
          setStatus("Conectarea a eșuat sau a fost anulată.", true);
        }
      });
    }

    els.amountInput?.addEventListener("input", updateReceive);

    if (els.payBtn) {
      els.payBtn.addEventListener("click", async () => {
        if (!provider || !wallet) {
          setStatus("Conectează Phantom mai întâi.", true);
          return;
        }
        const val = parseFloat(els.amountInput?.value || "0");
        if (isNaN(val) || val < MIN_USDC) {
          setStatus(`Suma minimă este ${MIN_USDC} USDC.`, true);
          return;
        }
        if (val > MAX_USDC) {
          setStatus(`Suma maximă este ${MAX_USDC} USDC.`, true);
          return;
        }
        const amountRaw = Math.round(val * 10 ** USDC_DECIMALS);
        if (amountRaw <= 0) {
          setStatus("Suma este invalidă.", true);
          return;
        }

        setStatus("Construiesc tranzacția...");
        if (els.result) els.result.textContent = "";
        els.payBtn.disabled = true;

        try {
          const payer = wallet;
          const { ata: fromAta, exists: fromExists } = await ensureAta(payer, USDC_MINT, payer);
          if (!fromExists) {
            throw new Error("Nu ai USDC în wallet (ATA lipsește).");
          }
          const { ata: toAta, ix: createToAta } = await ensureAta(TREASURY, USDC_MINT, payer);

          const tx = new Transaction();
          if (createToAta) tx.add(createToAta);

          tx.add(
            createTransferCheckedInstruction(fromAta, USDC_MINT, toAta, payer, amountRaw, USDC_DECIMALS)
          );

          tx.feePayer = payer;
          const { blockhash } = await connection.getLatestBlockhash("confirmed");
          tx.recentBlockhash = blockhash;

          setStatus("Confirmă în Phantom...");
          let signature = "";
          if (provider.signAndSendTransaction) {
            const res = await provider.signAndSendTransaction(tx);
            signature = res.signature || res;
          } else if (provider.signTransaction) {
            const signed = await provider.signTransaction(tx);
            signature = await connection.sendRawTransaction(signed.serialize());
          } else {
            throw new Error("Wallet-ul nu poate semna și trimite tranzacția.");
          }

          await connection.confirmTransaction(signature, "confirmed");
          setStatus("Plată trimisă. Mulțumim!");
          const link = `${EXPLORER_BASE}${signature}`;
          if (els.result) {
            els.result.innerHTML = `Signature: <a href="${link}" target="_blank" rel="noreferrer">${signature}</a>`;
          }
        } catch (err) {
          console.error(err);
          // If RPC blocked, err.message is already user-friendly; otherwise show generic
          setStatus(`Eroare: ${err.message || err}`, true);
        } finally {
          els.payBtn.disabled = false;
        }
      });
    }
  }

  function init() {
    if (els.treasury) els.treasury.textContent = TREASURY.toString();
    updateReceive();
    updateFee();
    attachHandlers();
  }

  init();
}

start().catch((e) => {
  console.error("Failed to load Solana modules", e);
  setStatus("Nu pot încărca modulele Solana/SPL.", true);
});
