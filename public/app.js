import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// State
let subscriptions = [];
let currentUser = null;

// Optimistic Auth: Check for last known user
const lastUid = localStorage.getItem('last_uid');
if (lastUid) {
    currentUser = { uid: lastUid };
    // Load data immediately using the cached UID
    loadSubscriptions();
}


// DOM Elements
const subListContainer = document.getElementById('sub-list-container');
const totalAmountEl = document.getElementById('total-amount');
const subCountEl = document.getElementById('sub-count');
const addSubBtn = document.getElementById('add-sub-btn');
const modalOverlay = document.getElementById('modal-overlay');
const closeModalBtn = document.getElementById('close-modal');
const cancelBtn = document.getElementById('cancel-btn');
const addSubForm = document.getElementById('add-sub-form');
const emptyState = document.getElementById('empty-state');
const subNameInput = document.getElementById('sub-name');
const suggestionsContainer = document.getElementById('suggestions-container');

// Auth DOM Elements
const loginBtn = document.getElementById('login-btn');
const userInfo = document.getElementById('user-info');
const userName = document.getElementById('user-name');
const userAvatar = document.getElementById('user-avatar');
const logoutBtn = document.getElementById('logout-btn');

// Settings Modal DOM Elements
const settingsBtn = document.getElementById('settings-btn');
const settingsModalOverlay = document.getElementById('settings-modal-overlay');
const closeSettingsBtn = document.getElementById('close-settings');
const catalogList = document.getElementById('catalog-list');
const resetBtn = document.getElementById('reset-btn');

// Encryption Helpers
// Encryption Helpers
function encryptData(data) {
    if (!currentUser) return data;
    return CryptoJS.AES.encrypt(JSON.stringify(data), currentUser.uid).toString();
}

function decryptData(ciphertext) {
    if (!currentUser) return ciphertext;
    try {
        const bytes = CryptoJS.AES.decrypt(ciphertext, currentUser.uid);
        return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
    } catch (e) {
        console.error("Decryption failed", e);
        return null;
    }
}

// Functions
async function loadSubscriptions() {
    if (currentUser) {
        // 1. Cache-First: Load immediately from local storage
        const cacheKey = `subscriptions_${currentUser.uid}`;
        const cachedData = localStorage.getItem(cacheKey);
        if (cachedData) {
            subscriptions = JSON.parse(cachedData);
            render(); // Instant render
        }

        // 2. Network-Second: Fetch from Firestore
        try {
            const querySnapshot = await getDocs(collection(db, "users", currentUser.uid, "subscriptions"));
            const freshSubscriptions = [];

            querySnapshot.forEach((doc) => {
                const data = doc.data();
                if (data.ciphertext) {
                    const decrypted = decryptData(data.ciphertext);
                    if (decrypted) freshSubscriptions.push(decrypted);
                } else {
                    freshSubscriptions.push(data);
                }
            });

            // 3. Update Cache & UI
            subscriptions = freshSubscriptions;
            localStorage.setItem(cacheKey, JSON.stringify(subscriptions));
            render();

        } catch (error) {
            console.error("Error fetching subscriptions:", error);
            // If offline, we just stay with the cached data
        }
    } else {
        // Load from LocalStorage (Guest Mode)
        subscriptions = JSON.parse(localStorage.getItem('subscriptions')) || [];
        render();
    }
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        ${message}
    `;
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 300);
    }, 3000);
}

async function saveSubscription(sub) {
    if (currentUser) {
        // 1. Optimistic Update: Update local state & cache immediately
        subscriptions.push(sub);
        const cacheKey = `subscriptions_${currentUser.uid}`;
        localStorage.setItem(cacheKey, JSON.stringify(subscriptions));
        render(); // Instant feedback

        // 2. Background Sync: Encrypt & Save to Firestore
        try {
            const encrypted = {
                id: sub.id,
                ciphertext: encryptData(sub),
                updatedAt: new Date().toISOString()
            };

            await setDoc(doc(db, "users", currentUser.uid, "subscriptions", sub.id), encrypted);
            showToast('Saved to Cloud');
        } catch (error) {
            console.error("Error saving to cloud:", error);
            showToast('Saved Locally (Sync Pending)');
            // In a real app, we'd add to a sync queue here
        }
    } else {
        // Save to LocalStorage
        subscriptions.push(sub);
        localStorage.setItem('subscriptions', JSON.stringify(subscriptions));
        showToast('Saved Locally');
        render();
    }
}

function calculateTotalMonthly() {
    return subscriptions.reduce((total, sub) => {
        let monthlyCost = parseFloat(sub.amount);
        if (sub.frequency === 'yearly') {
            monthlyCost = monthlyCost / 12;
        }
        return total + monthlyCost;
    }, 0);
}

function formatCurrency(amount) {
    return amount.toFixed(2);
}

function render() {
    // Update Summary
    const total = calculateTotalMonthly();
    totalAmountEl.textContent = formatCurrency(total);
    subCountEl.textContent = subscriptions.length;

    // Update List
    subListContainer.innerHTML = '';

    // Sort by monthly cost (descending)
    const sortedSubs = [...subscriptions].sort((a, b) => {
        const costA = a.frequency === 'yearly' ? parseFloat(a.amount) / 12 : parseFloat(a.amount);
        const costB = b.frequency === 'yearly' ? parseFloat(b.amount) / 12 : parseFloat(b.amount);
        return costB - costA;
    });

    if (sortedSubs.length === 0) {
        subListContainer.appendChild(emptyState);
        emptyState.style.display = 'block';
    } else {
        sortedSubs.forEach((sub, index) => {
            const el = document.createElement('a');
            el.className = 'sub-item';
            el.href = `detail.html?id=${sub.id}`;

            const suffix = sub.frequency === 'monthly' ? '/mo' : '/yr';
            let monthlyEquivalent = '';

            if (sub.frequency === 'yearly') {
                const monthlyCost = parseFloat(sub.amount) / 12;
                monthlyEquivalent = `<div style="font-size: 12px; color: var(--text-secondary); text-align: right; margin-top: 2px;">($${monthlyCost.toFixed(2)}/mo)</div>`;
            }

            el.innerHTML = `
                <div class="sub-info">
                    <span class="sub-name">${sub.name}</span>
                    <span class="sub-cycle">${sub.frequency}</span>
                </div>
                <div class="sub-cost-wrapper" style="display: flex; flex-direction: column; align-items: flex-end;">
                    <div class="sub-cost">$${formatCurrency(parseFloat(sub.amount))}<span style="font-size: 0.8em; color: var(--text-secondary); font-weight: 400;">${suffix}</span></div>
                    ${monthlyEquivalent}
                </div>
            `;
            subListContainer.appendChild(el);
        });
    }
}

function toggleModal(show) {
    if (show) {
        modalOverlay.classList.remove('hidden');
        subNameInput.focus();
    } else {
        modalOverlay.classList.add('hidden');
        addSubForm.reset();
        hideSuggestions();
    }
}

async function addSubscription(e) {
    e.preventDefault();

    const name = subNameInput.value.trim();
    const amount = document.getElementById('sub-amount').value;
    const frequency = document.getElementById('sub-frequency').value;
    const renewalDate = document.getElementById('sub-renewal').value;
    const submitBtn = addSubForm.querySelector('button[type="submit"]');

    // Check for duplicates
    const exists = subscriptions.some(sub => sub.name.toLowerCase() === name.toLowerCase());
    if (exists) {
        // Show error feedback on button
        const originalText = submitBtn.textContent;
        const originalColor = submitBtn.style.background;

        submitBtn.textContent = 'Already Exists!';
        submitBtn.style.background = 'var(--danger-color)';

        setTimeout(() => {
            submitBtn.textContent = originalText;
            submitBtn.style.background = originalColor;
        }, 2000);
        return;
    }

    const newSub = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        name,
        amount,
        frequency,
        renewalDate,
        dateAdded: new Date().toISOString()
    };

    await saveSubscription(newSub);
    toggleModal(false);
}

// Auth Logic
loginBtn.addEventListener('click', async () => {
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Login failed", error);
        alert("Login failed: " + error.message);
    }
});

logoutBtn.addEventListener('click', async () => {
    try {
        await signOut(auth);
        localStorage.removeItem('last_uid'); // Clear optimistic auth
        window.location.reload(); // Reload to clear state
    } catch (error) {
        console.error("Logout failed", error);
    }
});

onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Save UID for next time
        localStorage.setItem('last_uid', user.uid);

        currentUser = user;
        loginBtn.classList.add('hidden');
        userInfo.classList.remove('hidden');
        userInfo.style.display = 'flex';
        userName.textContent = user.displayName;
        userAvatar.src = user.photoURL;

        // Check for migration
        const localSubs = JSON.parse(localStorage.getItem('subscriptions')) || [];
        if (localSubs.length > 0) {
            if (confirm(`We found ${localSubs.length} local subscriptions. Do you want to upload them to your account?`)) {
                const batch = writeBatch(db);
                localSubs.forEach(sub => {
                    // Encrypt during migration
                    const encrypted = {
                        id: sub.id,
                        ciphertext: CryptoJS.AES.encrypt(JSON.stringify(sub), user.uid).toString(),
                        updatedAt: new Date().toISOString()
                    };
                    const docRef = doc(db, "users", user.uid, "subscriptions", sub.id);
                    batch.set(docRef, encrypted);
                });
                await batch.commit();
                localStorage.removeItem('subscriptions');
                alert("Subscriptions uploaded successfully!");
            }
        }

        // Re-run load to ensure we have fresh data (and to trigger network fetch)
        await loadSubscriptions();

    } else {
        // Only clear if we were previously logged in (or optimistically logged in)
        if (currentUser) {
            localStorage.removeItem('last_uid');
            currentUser = null;
            loginBtn.classList.remove('hidden');
            userInfo.classList.add('hidden');
            userInfo.style.display = 'none';
            loadSubscriptions();
        }
    }
});

// Autocomplete Logic
function showSuggestions(query) {
    if (!query) {
        hideSuggestions();
        return;
    }

    const matches = SERVICE_CATALOG.filter(service =>
        service.name.toLowerCase().includes(query.toLowerCase())
    );

    if (matches.length === 0) {
        hideSuggestions();
        return;
    }

    suggestionsContainer.innerHTML = '';
    matches.forEach(service => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        div.innerHTML = `
            <span class="suggestion-name">${service.name}</span>
            <span class="suggestion-price">$${service.price}/${service.frequency === 'monthly' ? 'mo' : 'yr'}</span>
        `;
        div.addEventListener('click', () => selectService(service));
        suggestionsContainer.appendChild(div);
    });

    suggestionsContainer.classList.remove('hidden');
}

function hideSuggestions() {
    suggestionsContainer.classList.add('hidden');
    suggestionsContainer.innerHTML = '';
}

function selectService(service) {
    subNameInput.value = service.name;
    document.getElementById('sub-amount').value = service.price;
    document.getElementById('sub-frequency').value = service.frequency;
    hideSuggestions();
}

// Event Listeners
addSubBtn.addEventListener('click', () => toggleModal(true));
closeModalBtn.addEventListener('click', () => toggleModal(false));
cancelBtn.addEventListener('click', () => toggleModal(false));
modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) toggleModal(false);
});
addSubForm.addEventListener('submit', addSubscription);

subNameInput.addEventListener('input', (e) => {
    showSuggestions(e.target.value);
});

// Close suggestions when clicking outside
document.addEventListener('click', (e) => {
    if (!suggestionsContainer.contains(e.target) && e.target !== subNameInput) {
        hideSuggestions();
    }
});

// Settings Modal Logic
function toggleSettingsModal(show) {
    if (show) {
        renderCatalog();
        settingsModalOverlay.classList.remove('hidden');
    } else {
        settingsModalOverlay.classList.add('hidden');
    }
}

function renderCatalog() {
    catalogList.innerHTML = '';
    SERVICE_CATALOG.forEach(service => {
        const div = document.createElement('div');
        div.className = 'catalog-item';
        div.innerHTML = `
            <span class="catalog-name">${service.name}</span>
            <span class="catalog-details">$${service.price} / ${service.frequency}</span>
        `;
        catalogList.appendChild(div);
    });
}

settingsBtn.addEventListener('click', () => toggleSettingsModal(true));
closeSettingsBtn.addEventListener('click', () => toggleSettingsModal(false));
settingsModalOverlay.addEventListener('click', (e) => {
    if (e.target === settingsModalOverlay) {
        toggleSettingsModal(false);
    }
});

// Reset functionality within settings modal
let resetTimeout;

resetBtn.addEventListener('click', async () => {
    if (resetBtn.textContent.includes('Confirm')) {
        if (currentUser) {
            // Delete all from Firestore
            const batch = writeBatch(db);
            subscriptions.forEach(sub => {
                const docRef = doc(db, "users", currentUser.uid, "subscriptions", sub.id);
                batch.delete(docRef);
            });
            await batch.commit();
            localStorage.removeItem(`subscriptions_${currentUser.uid}`);
        } else {
            localStorage.removeItem('subscriptions');
        }

        subscriptions = [];
        render();
        resetBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Reset All Subscriptions
        `;
        clearTimeout(resetTimeout);
        showToast('All subscriptions deleted');
        toggleSettingsModal(false);
    } else {
        resetBtn.textContent = 'Click Again to Confirm';
        resetBtn.style.background = 'var(--danger-color)';
        resetBtn.style.color = 'white';

        resetTimeout = setTimeout(() => {
            resetBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Reset All Subscriptions
            `;
            resetBtn.style.background = 'transparent';
            resetBtn.style.color = 'var(--danger-color)';
        }, 3000);
    }
});
