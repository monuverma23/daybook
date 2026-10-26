import { useEffect, useMemo, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { getFirebaseServices } from "./firebase";

type Category =
  | "Food & drink"
  | "Transport"
  | "Shopping"
  | "Bills"
  | "Health"
  | "Entertainment"
  | "Other";

type Expense = {
  id: string;
  title: string;
  amount: number;
  category: Category;
  date: string;
};

const CATEGORIES: Category[] = [
  "Food & drink",
  "Transport",
  "Shopping",
  "Bills",
  "Health",
  "Entertainment",
  "Other",
];

const CATEGORY_ICONS: Record<Category, string> = {
  "Food & drink": "☕",
  Transport: "↗",
  Shopping: "▧",
  Bills: "⌂",
  Health: "＋",
  Entertainment: "♫",
  Other: "···",
};

const STORAGE_KEY = "daybook-expenses";
const CURRENCY = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

function isCategory(value: unknown): value is Category {
  return CATEGORIES.some((category) => category === value);
}

function localDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readLegacyExpenses(): Expense[] {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return [];

  const parsed: unknown = JSON.parse(stored);
  if (!Array.isArray(parsed)) {
    throw new Error("Saved expense data is not in the expected format.");
  }

  const isExpense = (item: unknown): item is Expense =>
    typeof item === "object" &&
    item !== null &&
    "id" in item &&
    typeof item.id === "string" &&
    "title" in item &&
    typeof item.title === "string" &&
    "amount" in item &&
    typeof item.amount === "number" &&
    Number.isFinite(item.amount) &&
    "date" in item &&
    typeof item.date === "string" &&
    "category" in item &&
    isCategory(item.category);

  if (!parsed.every(isExpense)) {
    throw new Error("One or more saved expenses are not in the expected format.");
  }
  return parsed;
}

function userExpensesCollection(db: Firestore, userId: string) {
  return collection(db, "users", userId, "expenses");
}

async function importLegacyExpenses(db: Firestore, userId: string): Promise<void> {
  const migrationKey = `daybook-migrated-${userId}`;
  if (window.localStorage.getItem(migrationKey) === "true") return;

  const legacyExpenses = readLegacyExpenses();
  if (legacyExpenses.length) {
    for (let start = 0; start < legacyExpenses.length; start += 450) {
      const batch = writeBatch(db);
      legacyExpenses.slice(start, start + 450).forEach((expense) => {
        const { id, title, amount, category, date } = expense;
        batch.set(doc(db, "users", userId, "expenses", id), {
          title,
          amount,
          category,
          date,
        });
      });
      await batch.commit();
    }
  }

  window.localStorage.setItem(migrationKey, "true");
  window.localStorage.removeItem(STORAGE_KEY);
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
  }).format(new Date(`${date}T00:00:00`));
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [firebaseError, setFirebaseError] = useState("");
  const [error, setError] = useState("");
  const [db, setDb] = useState<Firestore | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<Category>("Food & drink");
  const [date, setDate] = useState(localDateString());
  const [filter, setFilter] = useState("This month");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    let stopExpenseListener: (() => void) | undefined;

    try {
      const services = getFirebaseServices();
      setDb(services.db);
      const stopAuthListener = onAuthStateChanged(
        services.auth,
        async (currentUser) => {
          setAuthLoading(false);
          stopExpenseListener?.();
          stopExpenseListener = undefined;
          setUser(currentUser);
          setExpenses([]);
          setError("");

          if (!currentUser) {
            setDataLoading(false);
            return;
          }

          setDataLoading(true);
          try {
            await importLegacyExpenses(services.db, currentUser.uid);
            if (!active) return;
            stopExpenseListener = onSnapshot(
              userExpensesCollection(services.db, currentUser.uid),
              (snapshot) => {
                if (!active) return;
                const loadedExpenses = snapshot.docs.flatMap((expenseDoc) => {
                  const data = expenseDoc.data();
                  if (
                    typeof data.title !== "string" ||
                    typeof data.amount !== "number" ||
                    !Number.isFinite(data.amount) ||
                    !isCategory(data.category) ||
                    typeof data.date !== "string"
                  ) {
                    return [];
                  }
                  return [{
                    id: expenseDoc.id,
                    title: data.title,
                    amount: data.amount,
                    category: data.category,
                    date: data.date,
                  }];
                });
                setExpenses(loadedExpenses);
                setError(
                  loadedExpenses.length === snapshot.size
                    ? ""
                    : "Some saved expenses have invalid data and couldn't be displayed.",
                );
                setDataLoading(false);
              },
              (listenerError) => {
                console.error("Could not sync expenses.", listenerError);
                if (!active) return;
                setError("Your expenses couldn't be loaded. Check your connection and Firebase setup, then try again.");
                setDataLoading(false);
              },
            );
          } catch (loadError) {
            console.error("Could not load or import expenses.", loadError);
            if (!active) return;
            setError(
              loadError instanceof Error
                ? `Your expenses couldn't be loaded: ${loadError.message}`
                : "Your expenses couldn't be loaded. Please try again.",
            );
            setDataLoading(false);
          }
        },
        (authError) => {
          console.error("Could not check sign-in status.", authError);
          if (!active) return;
          setError("We couldn't check your sign-in status. Please refresh and try again.");
          setAuthLoading(false);
        },
      );

      return () => {
        active = false;
        stopAuthListener();
        stopExpenseListener?.();
      };
    } catch (setupError) {
      console.error("Firebase setup is incomplete.", setupError);
      setFirebaseError(
        setupError instanceof Error
          ? setupError.message
          : "Firebase is not configured. Follow the setup steps in README.md.",
      );
      setAuthLoading(false);
      return () => {
        active = false;
        stopExpenseListener?.();
      };
    }
  }, []);

  useEffect(() => {
    if (user) setAuthLoading(false);
  }, [user]);

  const today = localDateString();
  const monthPrefix = today.slice(0, 7);
  const visibleExpenses = useMemo(
    () =>
      [...expenses]
        .filter((expense) => {
          if (filter === "Today") return expense.date === today;
          if (filter === "This month") return expense.date.startsWith(monthPrefix);
          return true;
        })
        .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
    [expenses, filter, monthPrefix, today],
  );
  const todayExpenses = expenses.filter((expense) => expense.date === today);
  const monthlyExpenses = expenses.filter((expense) => expense.date.startsWith(monthPrefix));
  const todayTotal = todayExpenses.reduce((total, expense) => total + expense.amount, 0);
  const monthTotal = monthlyExpenses.reduce((total, expense) => total + expense.amount, 0);
  const averageDaily = monthTotal / Math.max(new Date().getDate(), 1);

  async function handleSignIn() {
    setError("");
    try {
      const { auth } = getFirebaseServices();
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (signInError) {
      console.error("Google sign-in failed.", signInError);
      setError(
        signInError instanceof Error
          ? `Google sign-in failed: ${signInError.message}`
          : "Google sign-in failed. Please try again.",
      );
    }
  }

  async function handleSignOut() {
    setError("");
    try {
      const { auth } = getFirebaseServices();
      await signOut(auth);
    } catch (signOutError) {
      console.error("Sign-out failed.", signOutError);
      setError("We couldn't sign you out. Please try again.");
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedAmount = Number(amount);
    if (!db || !user || !title.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0 || !date) return;

    const expense: Expense = {
      id: globalThis.crypto.randomUUID(),
      title: title.trim(),
      amount: parsedAmount,
      category,
      date,
    };

    setSaving(true);
    setError("");
    try {
      const { id, ...expenseData } = expense;
      const expenseRef = doc(db, "users", user.uid, "expenses", id);
      await setDoc(expenseRef, expenseData);
      setTitle("");
      setAmount("");
      setDate(today);
    } catch (saveError) {
      console.error("Could not save expense.", saveError);
      setError("Your expense couldn't be saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteExpense(id: string) {
    if (!db || !user) return;
    setError("");
    try {
      await deleteDoc(doc(db, "users", user.uid, "expenses", id));
    } catch (deleteError) {
      console.error("Could not delete expense.", deleteError);
      setError("That expense couldn't be deleted. Please try again.");
    }
  }

  if (authLoading) {
    return <main className="auth-page"><div className="auth-card"><span className="brand-mark">d.</span><p>Connecting to Daybook…</p></div></main>;
  }

  if (!user) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <a className="brand auth-brand" href="/" aria-label="Daybook home"><span className="brand-mark">d.</span><span>daybook</span></a>
          <p className="eyebrow">YOUR PERSONAL FINANCE JOURNAL</p>
          <h1>Welcome back.</h1>
          <p className="auth-copy">Sign in to pick up where you left off. Your expenses will be available wherever you sign in.</p>
          {firebaseError && <p className="setup-notice" role="status">{firebaseError}</p>}
          {error && <p className="storage-error" role="alert">{error}</p>}
          <button className="google-button" type="button" onClick={handleSignIn} disabled={Boolean(firebaseError)}>
            <svg aria-hidden="true" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94a11.05 11.05 0 0 1-4.8 7.24l7.73 5.99c4.51-4.17 7.11-10.31 7.11-17.7Z"/><path fill="#FBBC05" d="M10.53 28.59a14.4 14.4 0 0 1 0-9.18l-7.98-6.19a23.9 23.9 0 0 0 0 21.56l7.98-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.73-5.99c-2.14 1.44-4.89 2.29-8.17 2.29-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/></svg>
            Continue with Google
          </button>
          <p className="auth-footnote">Private by design. Only you can access your expenses.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Daybook home"><span className="brand-mark">d.</span><span>daybook</span></a>
        <div className="account-menu">
          {user.photoURL && <img className="account-avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />}
          <span className="account-name">{user.displayName || user.email}</span>
          <button className="sign-out-button" type="button" onClick={handleSignOut}>Sign out</button>
        </div>
      </header>

      <section className="welcome">
        <div>
          <p className="eyebrow">YOUR PERSONAL FINANCE JOURNAL</p>
          <h1>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}{user.displayName ? `, ${user.displayName.split(" ")[0]}` : ""}.</h1>
          <p className="welcome-copy">A little awareness goes a long way. Keep track of where today takes you.</p>
        </div>
        <div className="date-chip"><span>◷</span> {new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</div>
      </section>

      <section className="summary-grid" aria-label="Expense summary">
        <article className="summary-card today-card">
          <div className="summary-top"><span className="summary-label">Spent today</span><span className="summary-icon mint">↗</span></div>
          <p className="summary-value">{CURRENCY.format(todayTotal)}</p>
          <p className="summary-caption">{todayExpenses.length} expenses logged today</p>
        </article>
        <article className="summary-card month-card">
          <div className="summary-top"><span className="summary-label">This month</span><span className="summary-icon lavender">▥</span></div>
          <p className="summary-value">{CURRENCY.format(monthTotal)}</p>
          <p className="summary-caption">Across {monthlyExpenses.length} expenses</p>
        </article>
        <article className="summary-card average-card">
          <div className="summary-top"><span className="summary-label">Daily average</span><span className="summary-icon peach">⌁</span></div>
          <p className="summary-value">{CURRENCY.format(averageDaily)}</p>
          <p className="summary-caption">Based on this month so far</p>
        </article>
      </section>

      {error && <p className="storage-error page-error" role="alert">{error}</p>}
      <div className="content-grid">
        <section className="panel expense-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">YOUR ACTIVITY</p><h2>Recent expenses</h2></div>
            <select className="filter-select" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter expenses">
              <option>This month</option><option>Today</option><option>All time</option>
            </select>
          </div>

          {dataLoading ? (
            <div className="empty-state"><p>Loading your expenses…</p></div>
          ) : visibleExpenses.length > 0 ? (
            <ul className="expense-list">
              {visibleExpenses.map((expense) => (
                <li className="expense-row" key={expense.id}>
                  <span className={`category-icon category-${CATEGORIES.indexOf(expense.category)}`}>{CATEGORY_ICONS[expense.category]}</span>
                  <div className="expense-details">
                    <span className="expense-title">{expense.title}</span>
                    <span className="expense-meta">{expense.category} <span className="meta-dot">·</span> {formatDate(expense.date)}</span>
                  </div>
                  <span className="expense-amount">−{CURRENCY.format(expense.amount)}</span>
                  <button className="delete-button" type="button" onClick={() => deleteExpense(expense.id)} aria-label={`Delete ${expense.title}`}>×</button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">
              <span className="empty-illustration">✳</span>
              <h3>No expenses here yet</h3>
              <p>Add your first expense to start seeing your spending patterns.</p>
            </div>
          )}
        </section>

        <aside className="panel form-panel">
          <div className="panel-heading form-heading">
            <div><p className="eyebrow">NEW ENTRY</p><h2>Add an expense</h2></div>
            <span className="form-plus">＋</span>
          </div>
          <form onSubmit={handleSubmit}>
            <label className="field-label" htmlFor="expense-title">What did you spend on?</label>
            <input id="expense-title" type="text" placeholder="e.g. Lunch with friends" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} required />
            <div className="form-row">
              <div className="form-field">
                <label className="field-label" htmlFor="expense-amount">Amount</label>
                <div className="amount-input"><span>₹</span><input id="expense-amount" type="number" placeholder="0.00" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></div>
              </div>
              <div className="form-field">
                <label className="field-label" htmlFor="expense-date">Date</label>
                <input id="expense-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} max={today} required />
              </div>
            </div>
            <label className="field-label" htmlFor="expense-category">Category</label>
            <select id="expense-category" value={category} onChange={(event) => setCategory(event.target.value as Category)}>
              {CATEGORIES.map((item) => <option key={item}>{item}</option>)}
            </select>
            <button className="submit-button" type="submit" disabled={saving || dataLoading}>{saving ? "Saving…" : <>Add expense <span>→</span></>}</button>
          </form>
          <p className="local-note"><span>◈</span> Synced privately to your account</p>
        </aside>
      </div>

      <footer className="footer">
        <span>Made for mindful spending.</span>
        <span>Daybook <span className="footer-dot">·</span> Your data stays private to your account</span>
      </footer>
    </main>
  );
}

export default App;
