import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Bell,
  CalendarDays,
  ChartNoAxesColumn,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  Edit3,
  FolderTree,
  HandCoins,
  Home,
  Landmark,
  LogOut,
  Eye,
  EyeOff,
  MoreHorizontal,
  Plus,
  Receipt,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Star,
  Tag,
  Trash2,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  X
} from "lucide-react";
import { addOptions } from "./data/mockData";
import { api, getAuthToken, setAuthToken } from "./api/client";

const toneStyles = {
  primary: "bg-violetSoft text-primary",
  emerald: "bg-emeraldSoft text-emerald",
  coral: "bg-coralSoft text-coral",
  income: "bg-incomeSoft text-income",
  amber: "bg-amberSoft text-amber"
};

const stateStyles = {
  spent: "bg-coralSoft text-coral border-coral/10",
  income: "bg-incomeSoft text-income border-income/10",
  receive: "bg-emeraldSoft text-emerald border-emerald/10",
  pay: "bg-coralSoft text-coral border-coral/10",
  borrowed: "bg-amberSoft text-amber border-amber/10",
  owed: "bg-teal-50 text-teal-700 border-teal-100",
  partial: "bg-amberSoft text-amber border-amber/10",
  settled: "bg-emeraldSoft text-emerald border-emerald/10",
  overdue: "bg-coralSoft text-coral border-coral/10",
  neutral: "bg-paper text-muted border-muted/10"
};

function formatTone(tone) {
  return toneStyles[tone] ?? toneStyles.primary;
}

const navigationItems = [
  { id: "home", label: "Home", icon: Home },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "people", label: "People", icon: Users },
  { id: "settlements", label: "Settlements", icon: HandCoins },
  { id: "accounts", label: "Accounts", icon: CreditCard, manager: true },
  { id: "categories", label: "Categories", icon: FolderTree, manager: true },
  { id: "tags", label: "Tags", icon: Tag, manager: true },
  { id: "budgets", label: "Budgets", icon: ChartNoAxesColumn, manager: true },
  { id: "recurring", label: "Recurring", icon: CalendarDays, manager: true },
  { id: "backup", label: "Backup", icon: Send, manager: true }
];

const coreNavigationIds = ["home", "activity", "people", "settlements"];
const profileNavigationItems = navigationItems.filter((item) => item.manager);

function currentPath() {
  return window.location.pathname || "/home";
}

function pushPath(path) {
  const next = new URL(path, window.location.origin);
  if (`${window.location.pathname}${window.location.search}` !== `${next.pathname}${next.search}`) {
    window.history.pushState({}, "", path);
  }
}

const themePresets = {
  indigo: { label: "Indigo", primary: "76 47 145", soft: "238 232 255" },
  blue: { label: "Blue", primary: "47 125 225", soft: "229 240 255" },
  emerald: { label: "Emerald", primary: "17 156 120", soft: "227 247 239" },
  teal: { label: "Teal", primary: "13 148 136", soft: "204 251 241" },
  rose: { label: "Red/Rose", primary: "225 29 72", soft: "255 228 230" },
  amber: { label: "Amber", primary: "217 119 6", soft: "255 243 211" },
  purple: { label: "Purple", primary: "126 34 206", soft: "243 232 255" }
};

const DEFAULT_THEME = "indigo";
const THEME_CACHE_KEY = "expense_tracker_theme";
const AUTH_USER_CACHE_KEY = "expense_tracker_user";
const AUTH_LOGOUT_KEY = "expense_tracker_logged_out";

function cacheAuthUser(user) {
  const safeUser = user ? {
    name: user.name,
    initials: user.initials,
    avatarColor: user.avatarColor,
    preferences: user.preferences
  } : null;
  if (safeUser) localStorage.setItem(AUTH_USER_CACHE_KEY, JSON.stringify(safeUser));
  else localStorage.removeItem(AUTH_USER_CACHE_KEY);
}

function readCachedAuthUser() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_USER_CACHE_KEY) || "null");
  } catch {
    return null;
  }
}

function resolveTheme(theme) {
  return themePresets[theme] ? theme : DEFAULT_THEME;
}

function applyTheme(theme = DEFAULT_THEME, { cache = true } = {}) {
  const resolvedTheme = resolveTheme(theme);
  const preset = themePresets[resolvedTheme];
  document.documentElement.style.setProperty("--color-primary", preset.primary);
  document.documentElement.style.setProperty("--color-primary-soft", preset.soft);
  if (cache) localStorage.setItem(THEME_CACHE_KEY, resolvedTheme);
  return resolvedTheme;
}

function savedUserTheme(user) {
  return user?.preferences?.theme && themePresets[user.preferences.theme] ? user.preferences.theme : DEFAULT_THEME;
}

function greetingForNow(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 21) return "Good evening";
  return "Good night";
}

function greetingWithName(user) {
  const firstName = user?.name?.split(" ")?.[0];
  return firstName ? `${greetingForNow()}, ${firstName}` : greetingForNow();
}

function App() {
  const [path, setPath] = useState(currentPath());
  const [routeVersion, setRouteVersion] = useState(0);
  const initialAuthMode = currentPath() === "/signup" ? "signup" : "login";
  const [authMode, setAuthMode] = useState(initialAuthMode);
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const initialTab = ["activity", "people", "settlements"].includes(currentPath().slice(1)) ? currentPath().slice(1) : "home";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [activeManager, setActiveManager] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [selectedObligation, setSelectedObligation] = useState(null);
  const [obligationReturnPath, setObligationReturnPath] = useState("/home");
  const [transactionVersion, setTransactionVersion] = useState(0);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [toasts, setToasts] = useState([]);
  const toastTimers = useRef({});
  const authExpiredHandled = useRef(false);

  const dismissToast = (id) => {
    if (toastTimers.current[id]) {
      clearTimeout(toastTimers.current[id]);
      delete toastTimers.current[id];
    }
    setToasts((items) => items.filter((toast) => toast.id !== id));
  };

  const showToast = ({ title, message, tone = "success", key }) => {
    const id = key || `${Date.now()}-${Math.random()}`;
    if (toastTimers.current[id]) clearTimeout(toastTimers.current[id]);
    setToasts((items) => [
      { id, title, message, tone },
      ...items.filter((toast) => toast.id !== id)
    ].slice(0, 3));
    toastTimers.current[id] = setTimeout(() => dismissToast(id), 4200);
  };

  useEffect(() => {
    return () => {
      Object.values(toastTimers.current).forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setPath(currentPath());
      setRouteVersion((version) => version + 1);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const refreshFinancialData = () => setTransactionVersion((version) => version + 1);
    window.addEventListener("expense-financial-change", refreshFinancialData);
    return () => window.removeEventListener("expense-financial-change", refreshFinancialData);
  }, []);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => {
      setOnline(false);
      showToast({
        key: "offline",
        tone: "error",
        title: "You are offline.",
        message: "Financial changes will not be saved until connection returns."
      });
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    const onAuthExpired = () => {
      if (authExpiredHandled.current) return;
      authExpiredHandled.current = true;
      setAuthToken(null);
      cacheAuthUser(null);
      setAuthUser(null);
      setAuthMode("login");
      setActiveManager(null);
      setSelectedPerson(null);
      pushPath("/login");
      setPath("/login");
      showToast({
        key: "session-expired",
        tone: "error",
        title: "Session expired. Please login again."
      });
    };
    window.addEventListener("expense-auth-expired", onAuthExpired);
    return () => window.removeEventListener("expense-auth-expired", onAuthExpired);
  }, []);

  useLayoutEffect(() => {
    if (!getAuthToken()) {
      applyTheme(localStorage.getItem(THEME_CACHE_KEY) || DEFAULT_THEME);
    }
  }, []);

  useEffect(() => {
    if (authUser) return undefined;
    if (localStorage.getItem(AUTH_LOGOUT_KEY) === "true") {
      setAuthToken(null);
      cacheAuthUser(null);
      setAuthLoading(false);
      return undefined;
    }
    if (authExpiredHandled.current) {
      setAuthLoading(false);
      return undefined;
    }
    if (!online) {
      setAuthLoading(false);
      return undefined;
    }
    let alive = true;
    setAuthLoading(true);
    const hadAccessToken = Boolean(getAuthToken());
    (hadAccessToken ? api.me() : api.restoreSession().then(() => api.me()))
      .then((user) => {
        if (!alive) return;
        applyTheme(savedUserTheme(user));
        cacheAuthUser(user);
        setAuthUser(user);
      })
      .catch((err) => {
        if (!alive) return;
        if (err.status === 401) {
          setAuthToken(null);
          cacheAuthUser(null);
          applyTheme(localStorage.getItem(THEME_CACHE_KEY) || DEFAULT_THEME);
        } else if (err.kind === "network") {
          const cachedUser = readCachedAuthUser();
          if (cachedUser) setAuthUser(cachedUser);
        }
        if (hadAccessToken && err.status === 401 && !authExpiredHandled.current) {
          pushPath("/login");
          setPath("/login");
          authExpiredHandled.current = true;
          showToast({
            key: "session-expired",
            tone: "error",
            title: "Session expired. Please login again."
          });
        }
      })
      .finally(() => { if (alive) setAuthLoading(false); });
    return () => { alive = false; };
  }, [online, authUser]);

  const handleAuthSuccess = ({ user, token }, mode) => {
    authExpiredHandled.current = false;
    localStorage.removeItem(AUTH_LOGOUT_KEY);
    setAuthToken(token);
    cacheAuthUser(user);
    applyTheme(savedUserTheme(user));
    setAuthUser(user);
    setActiveTab("home");
    setActiveManager(null);
    setSelectedPerson(null);
    pushPath("/home");
    setPath("/home");
    const firstName = user?.name?.split(" ")[0] || "there";
    if (mode === "signup") {
      showToast({
        key: "signup-success",
        title: "Account created successfully 🎉",
        message: `Welcome, ${firstName}`
      });
      return;
    }
    showToast({
      key: "login-success",
      title: `Welcome back, ${firstName} 👋`,
      message: "Login successful"
    });
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (err) {
      // Local logout still clears the session if the token is already invalid.
    }
    localStorage.setItem(AUTH_LOGOUT_KEY, "true");
    authExpiredHandled.current = true;
    setAuthToken(null);
    cacheAuthUser(null);
    setAuthUser(null);
    setAuthMode("login");
    pushPath("/login");
    setPath("/login");
    showToast({
      key: "logout-success",
      title: "You have been logged out successfully."
    });
  };

  const handleThemeChange = async (theme) => {
    applyTheme(theme);
    try {
      await api.updatePreferences({ theme });
      const confirmedUser = await api.me();
      setAuthUser(confirmedUser);
      cacheAuthUser(confirmedUser);
      applyTheme(savedUserTheme(confirmedUser));
    } catch (err) {
      // Keep the local preview; the next successful profile fetch restores backend truth if needed.
    }
  };

  useEffect(() => {
    if (!authUser) return;
    const obligationId = path.match(/^\/obligations\/([^/]+)/)?.[1];
    if (obligationId) {
      let alive = true;
      api.obligation(obligationId).then((data) => { if (alive) { setSelectedObligation(data); setSelectedPerson(null); } }).catch(() => { if (alive) setSelectedObligation(null); });
      return () => { alive = false; };
    }
    setSelectedObligation(null);
    const next = path.slice(1);
    if (next === "insights") {
      pushPath("/home");
      setPath("/home");
      return;
    }
    if (["home", "activity", "people", "settlements"].includes(next)) {
      setSelectedPerson(null);
      setActiveManager(null);
      setActiveTab(next);
    }
  }, [path, authUser]);

  useEffect(() => {
    if (!authUser || transactionVersion === 0) return undefined;
    const obligationId = path.match(/^\/obligations\/([^/]+)/)?.[1];
    if (!obligationId) return undefined;
    let alive = true;
    api.obligation(obligationId)
      .then((data) => { if (alive) setSelectedObligation(data); })
      .catch(() => { if (alive) setSelectedObligation(null); });
    return () => { alive = false; };
  }, [path, authUser, transactionVersion]);

  if (authLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper px-5 text-charcoal">
        <div className="rounded-3xl bg-cream p-6 text-center shadow-card">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary text-white">
            <Wallet size={24} />
          </div>
          <p className="mt-4 text-sm font-bold text-muted">Loading your money desk...</p>
        </div>
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
      </div>
    );
  }

  if (!authUser) {
    if (path !== "/login" && path !== "/signup") {
      pushPath("/login");
      setTimeout(() => setPath("/login"), 0);
    }
    return (
      <>
      <AuthScreen
        mode={path === "/signup" ? "signup" : "login"}
        onModeChange={(nextMode) => {
          setAuthMode(nextMode);
          const nextPath = nextMode === "signup" ? "/signup" : "/login";
          pushPath(nextPath);
          setPath(nextPath);
        }}
        onSuccess={handleAuthSuccess}
        onError={(message) => showToast({ key: `auth-error-${message}`, tone: "error", title: message })}
      />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  if (path === "/login" || path === "/signup" || path === "/") {
    pushPath("/home");
    setTimeout(() => setPath("/home"), 0);
  }

  const screen = selectedObligation
    ? "obligation-detail"
    : selectedPerson
    ? "person-detail"
    : activeManager
      ? activeManager
    : activeTab === "home"
      ? "home"
      : activeTab;

  const handleNavigate = (item) => {
    setSelectedPerson(null);
    if (item.manager) {
      setActiveManager(item.id);
      setActiveTab("home");
      pushPath("/home");
      setPath("/home");
      return;
    }
    setActiveManager(null);
    setActiveTab(item.id);
    pushPath(item.id === "home" ? "/home" : `/${item.id}`);
    setPath(item.id === "home" ? "/home" : `/${item.id}`);
  };

  const pageTitle = selectedObligation
    ? "Payment Details"
    : selectedPerson
    ? selectedPerson.name
    : navigationItems.find((item) => item.id === screen)?.label || "Dashboard";

  return (
    <div className="app-shell min-h-screen text-charcoal md:grid md:grid-cols-[5.5rem_minmax(0,1fr)] xl:grid-cols-[13.5rem_minmax(0,1fr)]">
      <ResponsiveSidebar activeTab={activeTab} activeManager={activeManager} onNavigate={handleNavigate} onAdd={() => setSheetOpen(true)} />
      <div className="min-w-0 md:min-h-screen">
        <DesktopTopHeader title={pageTitle} user={authUser} onAdd={() => setSheetOpen(true)} onLogout={handleLogout} onThemeChange={handleThemeChange} onNavigate={handleNavigate} locationKey={`${path}:${screen}`} refreshKey={transactionVersion} />
        {!online && <OfflineBanner />}
        <main className={`mx-auto min-h-screen w-full bg-paper shadow-[0_0_60px_rgba(55,42,82,0.08)] md:max-w-none md:bg-transparent md:px-5 md:pt-3 md:shadow-none lg:px-6 xl:max-w-[1560px] xl:px-8 ${screen === "obligation-detail" ? "pb-0 md:pb-10" : "pb-28 md:pb-10"}`}>
        {screen === "home" && <HomeDashboard refreshKey={transactionVersion} user={authUser} onLogout={handleLogout} onThemeChange={handleThemeChange} onNavigate={handleNavigate} locationKey={`${path}:${screen}`} onSelectPerson={setSelectedPerson} onOpenObligation={(id) => { setObligationReturnPath("/home"); pushPath(`/obligations/${id}`); setPath(`/obligations/${id}`); }} onNavigateToSettlements={(view = "all", source = "", period = {}) => {
          const params = new URLSearchParams({ ...(view && view !== "all" ? { view } : {}), ...(source ? { source } : {}), ...period });
          const queryString = params.toString();
          const nextPath = `/settlements${queryString ? `?${queryString}` : ""}`;
          setSelectedPerson(null);
          setActiveManager(null);
          setActiveTab("settlements");
          pushPath(nextPath);
          setPath("/settlements");
        }} onNavigateToActivity={(filters) => {
          const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== ""));
          const queryString = query.toString();
          const nextPath = `/activity${queryString ? `?${queryString}` : ""}`;
          pushPath(nextPath);
          setActiveManager(null);
          setSelectedPerson(null);
          setActiveTab("activity");
          setPath("/activity");
          setRouteVersion((version) => version + 1);
        }} />}
        {screen === "activity" && <ActivityScreen key={routeVersion} refreshKey={transactionVersion} showToast={showToast} onSelectPerson={setSelectedPerson} onOpenSettlements={(view = "all", source = "") => {
          const params = new URLSearchParams({ ...(view && view !== "all" ? { view } : {}), ...(source ? { source } : {}) });
          const queryString = params.toString();
          const nextPath = `/settlements${queryString ? `?${queryString}` : ""}`;
          setActiveManager(null);
          setSelectedPerson(null);
          setActiveTab("settlements");
          pushPath(nextPath);
          setPath("/settlements");
        }} />}
        {screen === "people" && <PeopleScreen refreshKey={transactionVersion} onSelectPerson={setSelectedPerson} />}
        {screen === "settlements" && <SettlementCenter refreshKey={transactionVersion} onSettled={() => setTransactionVersion((version) => version + 1)} onOpenObligation={(id) => { setObligationReturnPath("/settlements"); pushPath(`/obligations/${id}`); setPath(`/obligations/${id}`); }} />}
        {screen === "person-detail" && (
          <PersonDetail person={selectedPerson} refreshKey={transactionVersion} onBack={() => setSelectedPerson(null)} onFinancialChange={() => setTransactionVersion((version) => version + 1)} />
        )}
        {screen === "obligation-detail" && <ObligationDetail data={selectedObligation} onBack={() => { setSelectedObligation(null); pushPath(obligationReturnPath); setPath(obligationReturnPath); }} onFinancialChange={() => setTransactionVersion((version) => version + 1)} />}
        {screen === "accounts" && <AccountsScreen refreshKey={transactionVersion} onBack={() => setActiveManager(null)} />}
        {screen === "categories" && <CategoriesScreen onBack={() => setActiveManager(null)} />}
        {screen === "tags" && <TagsScreen onBack={() => setActiveManager(null)} />}
        {screen === "budgets" && <BudgetsScreen onBack={() => setActiveManager(null)} />}
        {screen === "recurring" && <RecurringScreen onBack={() => setActiveManager(null)} />}
        {screen === "backup" && <BackupScreen onBack={() => setActiveManager(null)} />}
        </main>
      </div>

      <BottomNav
        activeTab={activeTab}
        onChange={(tab) => {
          setSelectedPerson(null);
          setActiveManager(null);
          setActiveTab(tab);
          const nextPath = tab === "home" ? "/home" : `/${tab}`;
          pushPath(nextPath);
          setPath(nextPath);
        }}
        onAdd={() => setSheetOpen(true)}
      />
      <AddTransactionSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onCreated={() => setTransactionVersion((value) => value + 1)}
      />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function ScreenShell({ children, className = "" }) {
  return <section className={`px-5 pt-5 md:px-0 md:pt-0 ${className}`}>{children}</section>;
}

function OfflineBanner() {
  return (
    <div className="mx-5 rounded-3xl bg-coralSoft px-4 py-3 text-sm font-bold text-coral shadow-card md:mx-6 lg:mx-8 xl:mx-10">
      You are offline. Financial writes are disabled until the connection returns.
    </div>
  );
}

function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length) return null;

  return (
    <div className="fixed right-4 top-4 z-[70] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-3 sm:right-6">
      {toasts.map((toast) => (
        <article
          key={toast.id}
          className={`rounded-3xl bg-cream p-4 shadow-soft ring-1 ${toast.tone === "error" ? "ring-coral/15" : "ring-emerald/15"}`}
        >
          <div className="flex items-start gap-3">
            <span className={`mt-1 size-2.5 shrink-0 rounded-full ${toast.tone === "error" ? "bg-coral" : "bg-emerald"}`} />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-charcoal">{toast.title}</h3>
              {toast.message && <p className="mt-1 text-sm font-semibold text-muted">{toast.message}</p>}
            </div>
            <button onClick={() => onDismiss(toast.id)} className="grid size-8 shrink-0 place-items-center rounded-2xl bg-paper text-muted">
              <X size={16} />
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function AuthScreen({ mode, onModeChange, onSuccess, onError }) {
  const isSignup = mode === "signup";
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: ""
  });
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setFieldErrors({});

    const validation = validateAuthForm(form, isSignup);
    if (Object.keys(validation).length) {
      setFieldErrors(validation);
      return;
    }

    setSubmitting(true);
    try {
      const payload = isSignup
        ? { name: form.name, email: form.email, password: form.password }
        : { email: form.email, password: form.password };
      const result = isSignup ? await api.signup(payload) : await api.login(payload);
      onSuccess(result, isSignup ? "signup" : "login");
    } catch (err) {
      const nextFieldErrors = {};
      if (Array.isArray(err.details)) {
        err.details.forEach((item) => {
          if (item.field) nextFieldErrors[item.field] = item.message;
        });
      }
      setFieldErrors(nextFieldErrors);
      const message = Object.keys(nextFieldErrors).length
        ? normalizeAuthMessage(Object.values(nextFieldErrors)[0])
        : friendlyAuthError(err);
      setError(Object.keys(nextFieldErrors).length ? "" : message);
      onError?.(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="grid min-h-screen bg-paper px-5 py-8 text-charcoal md:grid-cols-[minmax(0,0.9fr)_minmax(24rem,30rem)] md:items-center md:gap-8 md:px-10 xl:px-20">
      <section className="hidden md:block">
        <div className="max-w-xl">
          <div className="flex items-center gap-3">
            <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary text-white shadow-card">
              <Wallet size={26} />
            </div>
            <div>
              <p className="text-2xl font-bold leading-tight">Expense</p>
              <p className="mt-1 text-sm font-semibold text-muted">Money desk</p>
            </div>
          </div>
          <h1 className="mt-6 text-5xl font-bold tracking-tight">Personal money, privately tracked.</h1>
          <p className="mt-4 max-w-lg text-base font-semibold leading-7 text-muted">
            Sign in to keep accounts, people, tags, categories, and transactions separated for your own finance workspace.
          </p>
        </div>
      </section>

      <section className="mx-auto flex w-full max-w-md flex-col justify-center">
        <div className="mb-6 flex flex-col items-center pt-2 text-center md:hidden">
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary text-white shadow-card">
            <Wallet size={24} />
          </div>
          <h1 className="mt-3 text-2xl font-bold leading-tight">Expense</h1>
          <p className="mt-1 text-sm font-semibold text-muted">Money desk</p>
        </div>

        <form onSubmit={submit} className="rounded-3xl bg-cream p-5 shadow-soft md:p-6">
          <h2 className="text-2xl font-bold">{isSignup ? "Create account" : "Welcome back"}</h2>
          <p className="mt-1 text-sm font-semibold text-muted">
            {isSignup ? "Start a private finance workspace." : "Login to your private finance workspace."}
          </p>

          <div className="mt-6 space-y-4">
            {isSignup && (
              <FormInput label="Full name" value={form.name} error={fieldErrors.name} onChange={(value) => setForm({ ...form, name: value })} />
            )}
            <FormInput label="Email" type="email" value={form.email} error={fieldErrors.email} onChange={(value) => setForm({ ...form, email: value })} />
            <PasswordInput
              label="Password"
              value={form.password}
              error={fieldErrors.password}
              show={showPassword}
              onToggle={() => setShowPassword((value) => !value)}
              onChange={(value) => setForm({ ...form, password: value })}
            />
            {isSignup && (
              <PasswordInput
                label="Confirm password"
                value={form.confirmPassword}
                error={fieldErrors.confirmPassword}
                show={showPassword}
                onToggle={() => setShowPassword((value) => !value)}
                onChange={(value) => setForm({ ...form, confirmPassword: value })}
              />
            )}
          </div>

          {error && <p className="mt-4 rounded-2xl bg-coralSoft p-3 text-sm font-bold text-coral">{error}</p>}

          <button disabled={submitting} className="mt-5 flex w-full items-center justify-center gap-2 rounded-3xl bg-primary px-4 py-4 text-sm font-bold text-white disabled:opacity-60">
            {submitting && <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
            {submitting ? "Please wait..." : isSignup ? "Signup" : "Login"}
          </button>

          <button
            type="button"
            onClick={() => {
              setError("");
              onModeChange(isSignup ? "login" : "signup");
            }}
            className="mt-4 w-full text-sm font-bold text-primary"
          >
            {isSignup ? "Already have an account? Login" : "New here? Create an account"}
          </button>
        </form>
      </section>
    </main>
  );
}

function validateAuthForm(form, isSignup) {
  const errors = {};
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (isSignup && !form.name.trim()) errors.name = "Full name is required.";
  if (!form.email.trim()) errors.email = "Email is required.";
  else if (!emailPattern.test(form.email)) errors.email = "Please enter a valid email.";
  if (!form.password) errors.password = "Password is required.";
  else if (isSignup && form.password.length < 8) errors.password = "Password must be at least 8 characters.";
  else if (isSignup && (!/[A-Za-z]/.test(form.password) || !/\d/.test(form.password))) {
    errors.password = "Use at least one letter and one number.";
  }
  if (isSignup && form.confirmPassword !== form.password) errors.confirmPassword = "Passwords do not match.";
  return errors;
}

function friendlyAuthError(err) {
  if (err.kind === "network") return "Unable to connect to server. Please try again.";
  if (err.status === 401) return "Incorrect password.";
  if (err.status === 404) return "No account found with this email.";
  if (err.status === 409) return "An account already exists with this email.";
  if (err.status >= 500) return "Something went wrong. Please retry.";
  return normalizeAuthMessage(err.message || "Something went wrong. Please retry.");
}

function normalizeAuthMessage(message) {
  if (!message) return "Something went wrong. Please retry.";
  if (message.includes("Unable to connect")) return "Unable to connect to server. Please try again.";
  if (message.includes("Incorrect password")) return "Incorrect password.";
  if (message.includes("No account found")) return "No account found with this email.";
  if (message.includes("already exists")) return "An account already exists with this email.";
  if (message.includes("Invalid or expired") || message.includes("Authentication required")) {
    return "Session expired. Please login again.";
  }
  return message;
}

function PasswordInput({ label, value, show, onToggle, onChange, error }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-muted">{label}</span>
      <div className="flex items-center rounded-3xl bg-paper px-4 py-1 ring-1 ring-transparent transition focus-within:ring-primary/30">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 border-0 bg-transparent py-3 text-sm font-bold text-charcoal outline-none"
        />
        <button type="button" onClick={onToggle} className="grid size-9 place-items-center rounded-2xl text-muted">
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {error && <span className="mt-2 block text-xs font-bold text-coral">{error}</span>}
    </label>
  );
}

function useDismissablePopup({ open, onClose, refs, closeKey }) {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (open) onCloseRef.current();
  }, [closeKey]);

  useEffect(() => {
    if (!open) return undefined;

    const isInside = (target) => refs.some((ref) => ref.current && ref.current.contains(target));
    const handlePointerDown = (event) => {
      if (!isInside(event.target)) onCloseRef.current();
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onCloseRef.current();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);
}

function PremiumHeader({ user, onLogout, onThemeChange, onNavigate, locationKey, refreshKey = 0 }) {
  const [open, setOpen] = useState(false);
  const profileRef = useRef(null);

  useDismissablePopup({ open, onClose: () => setOpen(false), refs: [profileRef], closeKey: locationKey });

  return (
    <div className="flex items-center justify-between md:hidden">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-charcoal">Home Dashboard</h1>
        <p className="mt-0.5 text-xs font-medium text-muted">Your money overview at a glance</p>
      </div>
      <div className="flex items-center gap-3">
        <NotificationBell locationKey={locationKey} refreshKey={refreshKey} />
        <ThemeAction onThemeChange={onThemeChange} locationKey={locationKey} />
        <div ref={profileRef} className="relative">
          <button
            onClick={() => setOpen((value) => !value)}
            className="app-header-action grid size-11 place-items-center rounded-2xl bg-primary text-sm font-bold text-white shadow-card"
          >
            {user?.initials || "U"}
          </button>
          {open && <ProfileMenu user={user} onLogout={() => { setOpen(false); onLogout(); }} onNavigate={(item) => { setOpen(false); onNavigate(item); }} align="right" />}
        </div>
      </div>
    </div>
  );
}

function ResponsiveSidebar({ activeTab, activeManager, onNavigate, onAdd }) {
  return (
    <aside className="app-sidebar hidden border-r border-[#ECE5D9] bg-cream/80 shadow-[10px_0_40px_rgba(67,54,94,0.06)] backdrop-blur md:sticky md:top-0 md:flex md:h-screen md:flex-col md:items-center md:px-3 md:py-4 xl:items-stretch xl:px-4">
      <div className="mb-7 flex items-center justify-center gap-3 xl:justify-start">
        <div className="grid size-12 place-items-center rounded-2xl bg-primary text-white shadow-card">
          <Wallet size={23} />
        </div>
        <div className="hidden xl:block">
          <h1 className="text-lg font-bold tracking-tight">Expense</h1>
          <p className="text-xs font-semibold text-muted">Money desk</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-2">
        {navigationItems.filter((item) => coreNavigationIds.includes(item.id)).map((item) => {
          const active = activeTab === item.id && !activeManager;
          return (
            <SidebarItem key={item.id} item={item} active={active} onClick={() => onNavigate(item)} />
          );
        })}
      </nav>

      <button
        onClick={onAdd}
        className="mt-5 grid size-12 place-items-center rounded-2xl bg-primary text-white shadow-soft xl:flex xl:h-12 xl:w-full xl:gap-2 xl:px-4 xl:text-sm xl:font-bold"
        aria-label="Add transaction"
      >
        <Plus size={22} />
        <span className="hidden xl:inline">Add Transaction</span>
      </button>
    </aside>
  );
}

function SidebarItem({ item, active, onClick }) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      className={`flex h-12 items-center justify-center rounded-2xl text-sm font-bold transition xl:justify-start xl:gap-3 xl:px-4 ${
        active ? "bg-primary text-white shadow-card" : "text-muted hover:bg-paper hover:text-primary"
      }`}
      title={item.label}
    >
      <Icon size={21} />
      <span className="hidden xl:inline">{item.label}</span>
    </button>
  );
}

function DesktopTopHeader({ title, user, onAdd, onLogout, onThemeChange, onNavigate, locationKey, refreshKey = 0 }) {
  const month = new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const [open, setOpen] = useState(false);
  const profileRef = useRef(null);

  useDismissablePopup({ open, onClose: () => setOpen(false), refs: [profileRef], closeKey: locationKey });

  return (
    <header className="app-desktop-header hidden items-center justify-between px-5 py-4 md:flex lg:px-6 xl:px-8">
      <div>
        {title !== "Home" && <button className="flex items-center gap-2 rounded-full bg-cream px-4 py-2 text-sm font-bold text-primary shadow-card">
          <CalendarDays size={17} />
          {month}
        </button>}
        <h1 className="mt-1 text-3xl font-bold tracking-tight xl:text-4xl">{title === "Home" ? "Home Dashboard" : title}</h1>
        {title === "Home" && <p className="mt-0.5 text-xs font-medium text-muted">Your money overview at a glance</p>}
        {title === "Activity" && <p className="mt-1 text-sm font-semibold text-muted">Clean financial history</p>}
        {title === "Settlements" && <p className="mt-0.5 text-xs font-medium text-muted">Track what you need to pay and receive</p>}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onAdd}
          className="hidden items-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white shadow-card lg:flex"
        >
          <Plus size={18} />
          Add Transaction
        </button>
        <NotificationBell locationKey={locationKey} refreshKey={refreshKey} />
        <ThemeAction onThemeChange={onThemeChange} locationKey={locationKey} />
        <div ref={profileRef} className="relative">
          <button
            onClick={() => setOpen((value) => !value)}
            className="app-header-action grid size-11 place-items-center rounded-2xl bg-primary text-sm font-bold text-white shadow-card"
          >
            {user?.initials || "U"}
          </button>
          {open && <ProfileMenu user={user} onLogout={() => { setOpen(false); onLogout(); }} onNavigate={(item) => { setOpen(false); onNavigate(item); }} align="right" />}
        </div>
      </div>
    </header>
  );
}

function ProfileMenu({ user, onLogout, onNavigate, align = "right" }) {
  return (
    <div className={`absolute top-14 z-50 w-72 max-w-[calc(100vw-2rem)] rounded-3xl bg-cream p-3 shadow-soft ${align === "right" ? "right-0" : "left-0"}`}>
      <div className="px-2 py-2">
        <p className="truncate text-sm font-bold">{user?.name}</p>
        <p className="truncate text-xs font-semibold text-muted">{user?.email}</p>
      </div>
      <div className="mt-2 space-y-1">
        {profileNavigationItems.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} type="button" onClick={() => onNavigate(item)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-bold text-charcoal hover:bg-paper">
              <Icon size={17} className="text-primary" />
              {item.label}
            </button>
          );
        })}
      </div>
      <button onClick={onLogout} className="mt-2 flex w-full items-center gap-2 rounded-2xl bg-coralSoft px-3 py-3 text-sm font-bold text-coral">
        <LogOut size={17} />
        Logout
      </button>
    </div>
  );
}

function ThemeAction({ onThemeChange, locationKey }) {
  const [open, setOpen] = useState(false);
  const themeRef = useRef(null);
  useDismissablePopup({ open, onClose: () => setOpen(false), refs: [themeRef], closeKey: locationKey });
  return (
    <div ref={themeRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="app-header-action grid size-11 place-items-center rounded-2xl bg-cream text-primary shadow-card"
        aria-label="Theme"
      >
        <Sparkles size={19} />
      </button>
      {open && <ThemePicker onSelect={onThemeChange} />}
    </div>
  );
}

function ThemePicker({ onSelect, inline = false }) {
  return (
    <div className={inline ? "" : "absolute right-0 top-14 z-50 w-56 rounded-3xl bg-cream p-3 shadow-soft"}>
      {!inline && <p className="px-2 pb-2 text-xs font-bold uppercase tracking-wide text-muted">Theme</p>}
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(themePresets).map(([key, preset]) => (
          <button
            key={key}
            onClick={() => onSelect(key)}
            className="flex items-center gap-2 rounded-2xl bg-paper px-3 py-2 text-left text-xs font-bold text-charcoal"
          >
            <span className="size-4 rounded-full" style={{ backgroundColor: `rgb(${preset.primary})` }} />
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function NotificationBell({ locationKey, refreshKey = 0 }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [draftFilter, setDraftFilter] = useState("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [settlementAccounts, setSettlementAccounts] = useState({});
  const [data, setData] = useState({ notifications: [], unreadCount: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pushState, setPushState] = useState("");
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const ref = useRef(null);
  const filterButtonRef = useRef(null);
  const accounts = useResource("accounts", {}, open ? 1 : 0);

  useDismissablePopup({ open, onClose: () => setOpen(false), refs: [ref], closeKey: locationKey });

  const load = async (nextFilter = filter) => {
    setLoading(true);
    setError("");
    try {
      setData(await api.notifications({ filter: nextFilter === "all" ? "" : nextFilter }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load("all");
    const refresh = () => { if (document.visibilityState === "visible") load("all"); };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, []);

  useEffect(() => {
    if (open) load(filter);
  }, [open, filter]);

  useEffect(() => {
    load(open ? filter : "all");
  }, [refreshKey]);

  useEffect(() => {
    if (!open) return;
    api.pushStatus().then((status) => setPushEnabled(status.activeDevices > 0)).catch(() => {});
  }, [open]);

  const filters = [
    { id: "all", label: "All" },
    { id: "due_today_pay", label: "Payments Due Today" },
    { id: "due_today_receive", label: "Expected Today" },
    { id: "upcoming_pay", label: "Upcoming Payments" },
    { id: "upcoming_receive", label: "Upcoming Receivables" },
    { id: "overdue_pay", label: "Overdue Payments" },
    { id: "overdue_receive", label: "Overdue Receivables" },
    { id: "to_receive", label: "To Receive" },
    { id: "to_pay", label: "To Pay" }
  ];
  const activeFilter = filters.find((item) => item.id === filter);

  const enablePush = async () => {
    setPushBusy(true);
    setPushState("");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Push notifications are not supported by this browser.");
      if (typeof Notification === "undefined") throw new Error("Push notifications are not supported by this browser.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notifications are blocked in your browser settings. In-app reminders will still be available.");
      const config = await api.pushConfig();
      if (!config.publicKey) throw new Error("Push notifications are not configured yet. In-app reminders will still be available.");
      const registration = await navigator.serviceWorker.register("/sw.js");
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(config.publicKey) });
      await api.savePushSubscription(subscription.toJSON());
      setPushEnabled(true);
      setPushState("Push notifications are enabled on this device.");
    } catch (err) {
      setPushState(err.message || "Unable to enable push notifications.");
    } finally { setPushBusy(false); }
  };

  const disablePush = async () => {
    setPushBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await api.removePushSubscription(subscription.toJSON());
        await subscription.unsubscribe();
      }
      setPushEnabled(false);
      setPushState("Push notifications are off on this device. In-app reminders remain available.");
    } catch (err) { setPushState(err.message || "Unable to turn off push notifications."); }
    finally { setPushBusy(false); }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        className="app-header-action relative grid size-11 place-items-center rounded-2xl bg-cream text-primary shadow-card"
        aria-label="Notifications"
      >
        <Bell size={20} />
        {data.unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-coral px-1.5 text-[10px] font-bold text-white">
            {data.unreadCount > 99 ? "99+" : data.unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-14 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-3xl bg-cream p-3 shadow-soft">
          <div className="flex items-center justify-between gap-3 px-1">
            <div>
              <h3 className="text-sm font-bold">Notifications</h3>
              <p className="text-xs font-semibold text-muted">{data.unreadCount} unread</p>
            </div>
            <button
              onClick={async () => {
                await api.markAllNotificationsRead();
                await load(filter);
              }}
              className="rounded-full bg-violetSoft px-3 py-1.5 text-xs font-bold text-primary"
            >
              Mark all read
            </button>
          </div>
          <div className="mt-3">
            <FilterButton refProp={filterButtonRef} active={filterOpen} count={filter === "all" ? 0 : 1} onClick={() => { setDraftFilter(filter); setFilterOpen((current) => !current); }}>
              <SlidersHorizontal size={16} /> Filter
            </FilterButton>
          </div>
          <ActiveFilterChips
            chips={filter === "all" ? [] : [{ key: "notificationFilter", label: activeFilter?.label || "Notifications" }]}
            onRemove={() => { setFilter("all"); setDraftFilter("all"); }}
            onClear={() => { setFilter("all"); setDraftFilter("all"); }}
          />
          <CompactPopover
            open={filterOpen}
            title="Notification Filters"
            triggerRef={filterButtonRef}
            onClose={() => setFilterOpen(false)}
            footer={<FilterActions onReset={() => setDraftFilter("all")} onApply={() => { setFilter(draftFilter); setFilterOpen(false); }} />}
          >
            <div className="grid grid-cols-2 gap-2">
              {filters.map((item) => <button key={item.id} type="button" onClick={() => setDraftFilter(item.id)} className={`rounded-2xl px-3 py-3 text-left text-xs font-bold ${draftFilter === item.id ? "bg-primary text-white" : "bg-paper text-charcoal"}`}>{item.label}</button>)}
            </div>
          </CompactPopover>
          <div className="mt-3 rounded-2xl bg-violetSoft p-3">
            <p className="text-xs font-bold text-charcoal">Get payment and receivable reminders even when the app is closed.</p>
            <p className="mt-1 text-[11px] font-semibold text-muted">Push status: {pushEnabled ? "Enabled" : typeof Notification !== "undefined" && Notification.permission === "denied" ? "Blocked" : "Not configured"}</p>
            <button onClick={pushEnabled ? disablePush : enablePush} disabled={pushBusy} className="mt-2 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
              {pushBusy ? "Setting up..." : pushEnabled ? "Turn Off Push Notifications" : "Enable Notifications"}
            </button>
            {pushState && <p className="mt-2 text-xs font-semibold text-muted">{pushState}</p>}
          </div>
          <div className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
            <ResourceState loading={loading} error={error} empty={!data.notifications.length} onRetry={() => load(filter)} />
            {data.notifications.map((item) => (
              <article key={item._id} className={`rounded-2xl p-3 ${item.status === "UNREAD" ? "bg-paper" : "bg-paper/60"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-bold">{item.title}</h4>
                    <p className="mt-1 text-xs font-semibold text-muted">{item.message}</p>
                  </div>
                  {item.status === "UNREAD" && <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" />}
                </div>
                {item.transaction && item.direction !== "NONE" && (
                  <select
                    value={settlementAccounts[item._id] || ""}
                    onChange={(event) => setSettlementAccounts((current) => ({ ...current, [item._id]: event.target.value }))}
                    className="mt-3 w-full rounded-xl bg-cream px-3 py-2 text-xs font-semibold text-charcoal"
                    aria-label="Account for settlement"
                  >
                    <option value="">Select account for settlement</option>
                    {accounts.items.map((account) => <option key={account._id} value={account._id}>{account.name}</option>)}
                  </select>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={async () => {
                      await api.markNotificationRead(item._id);
                      if (item.obligation?._id) {
                        window.history.pushState({}, "", `/obligations/${item.obligation._id}`);
                        window.dispatchEvent(new PopStateEvent("popstate"));
                        setOpen(false);
                      }
                      await load(filter);
                    }}
                    className="rounded-full bg-violetSoft px-3 py-1.5 text-xs font-bold text-primary"
                  >
                    View
                  </button>
                  <button
                    onClick={async () => {
                      await api.completeNotification(item._id, { account: settlementAccounts[item._id] });
                      window.dispatchEvent(new CustomEvent("expense-financial-change"));
                      await load(filter);
                    }}
                    disabled={Boolean(item.transaction && item.direction !== "NONE" && !settlementAccounts[item._id])}
                    className="rounded-full bg-emeraldSoft px-3 py-1.5 text-xs font-bold text-emerald disabled:opacity-50"
                  >
                    {item.direction === "RECEIVE" ? "Received" : item.direction === "PAY" ? "Mark Paid" : "Done"}
                  </button>
                  <button
                    onClick={async () => {
                      await api.archiveNotification(item._id);
                      await load(filter);
                    }}
                    className="rounded-full bg-coralSoft px-3 py-1.5 text-xs font-bold text-coral"
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ObligationDetail({ data, onBack, onFinancialChange }) {
  const [payOpen, setPayOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const obligation = data?.obligation;
  if (!obligation) return <ScreenShell><ResourceState loading={!data} error={data ? "Payment record not found." : ""} empty={false} onRetry={() => window.location.reload()} /></ScreenShell>;
  const personName = obligation.person?.name || "Someone";
  const payable = obligation.direction === "PAYABLE";
  const remaining = Number(obligation.remainingAmount || 0);
  const settled = remaining <= 0 || obligation.status === "SETTLED";
  const sourceType = obligation.sourceType || obligation.sourceTransaction?.type;
  const loanLike = sourceType === "BORROW" || sourceType === "LEND";
  const sourceTitle = sourceType === "BORROW" ? `Loan from ${personName}`
    : sourceType === "LEND" ? `Loan to ${personName}`
      : sourceType === "PAID_FOR_SOMEONE" ? `Paid for ${personName}`
        : sourceType === "PAID_BY_SOMEONE" ? `${personName} paid for you`
          : sourceType === "SPLIT_SHARE" ? `Split expense with ${personName}` : obligationDescription(obligation);
  const timelineEvents = sortObligationEvents(data);
  const statusText = settled ? "Settled" : obligation.status === "CANCELLED" ? "Cancelled" : obligation.status === "OVERDUE" ? "Overdue" : Number(obligation.settledAmount || 0) > 0 ? (payable ? "Partially Paid" : "Partially Received") : "Pending";
  const createdDate = obligation.sourceTransaction?.transactionDate || obligation.createdAt;
  const createdTime = obligation.sourceTransaction?.transactionTime;
  const reference = transactionReference(obligation.sourceTransaction || { _id: obligation.sourceTransactionId, type: sourceType, transactionDate: createdDate });
  const showAction = remaining > 0 && obligation.status !== "CANCELLED";
  return (
    <ScreenShell className="obligation-detail-content mx-auto max-w-[920px]">
      <header className="mb-5 flex items-center gap-3">
        <button type="button" aria-label="Go back" onClick={onBack} className="grid size-11 shrink-0 place-items-center rounded-full bg-cream text-charcoal shadow-card hover:bg-paper"><ChevronLeft size={21} /></button>
        <h1 className="text-xl font-bold text-charcoal">{sourceType === "BORROW" || sourceType === "LEND" ? "Loan Details" : "Payment Details"}</h1>
      </header>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-5">
          <section className="rounded-3xl border border-amber/10 bg-gradient-to-br from-cream to-amberSoft/40 p-5 shadow-card sm:p-6">
            <div className="mx-auto max-w-md text-center">
              <span className="mx-auto grid size-11 place-items-center rounded-2xl bg-amberSoft text-amber"><HandCoins size={21} /></span>
              <h2 className="mt-3 text-lg font-bold text-charcoal">{sourceTitle}</h2>
              <p className={`mt-4 text-4xl font-extrabold tracking-tight ${payable && !settled ? "text-coral" : "text-emerald"}`}>{formatCurrency(remaining)}</p>
              <p className="mt-1 text-sm font-semibold text-muted">{settled ? "Remaining" : payable ? "Remaining to Pay" : "Remaining to Receive"}</p>
              <span className={`mt-3 inline-flex min-h-8 items-center rounded-full px-3 py-1 text-xs font-bold ${settled ? "bg-emeraldSoft text-emerald" : obligation.status === "OVERDUE" ? "bg-coralSoft text-coral" : Number(obligation.settledAmount || 0) > 0 ? "bg-amberSoft text-amber" : "bg-paper text-muted"}`}>{settled ? "✓ Fully Settled" : statusText}</span>
              <div className="mt-5 grid grid-cols-2 divide-x divide-charcoal/10 rounded-2xl bg-white/65 py-3">
                <div><p className="text-[11px] font-semibold text-muted">Original Amount</p><p className="mt-1 text-sm font-bold text-charcoal">{formatCurrency(obligation.originalAmount)}</p></div>
                <div><p className="text-[11px] font-semibold text-muted">{payable ? "Paid So Far" : "Received So Far"}</p><p className="mt-1 text-sm font-bold text-emerald">{formatCurrency(obligation.settledAmount)}</p></div>
              </div>
              <div className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs font-semibold text-muted">
                <span>{payable ? "Loan Date" : "Created"}: {new Date(createdDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                <span>{obligation.dueDate ? `${payable ? "Due" : "Expected"}: ${new Date(obligation.dueDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : "No due date"}</span>
              </div>
            </div>
            {showAction && <button type="button" onClick={() => setPayOpen(true)} className="mt-4 hidden min-h-12 w-full items-center justify-center rounded-2xl bg-primary px-5 text-sm font-bold text-white shadow-card hover:opacity-90 md:flex lg:hidden">{payable ? "Pay" : "Receive"} {formatCurrency(remaining)}</button>}
          </section>
          <section className="rounded-3xl bg-cream p-5 shadow-card sm:p-6">
            <h3 className="text-base font-bold text-charcoal">{payable ? "Payment History" : "Receipt History"}</h3>
            <div className="mt-5">
              {timelineEvents.map((event, index) => {
                const allocation = (data.allocations || []).find((item) => String(item._id) === String(event.allocation));
                const settlement = allocation?.settlement || event.settlement;
                const created = event.eventType === "CREATED";
                const reversed = event.eventType === "SETTLEMENT_REVERSED";
                const allocationReversed = settlement?.status === "CANCELLED";
                const accountName = settlement?.account?.name || obligation.sourceTransaction?.account?.name || "Account unavailable";
                const eventDate = created ? obligation.sourceTransaction?.transactionDate || event.createdAt : settlement?.settlementDate || event.createdAt;
                const eventTime = created ? obligation.sourceTransaction?.transactionTime : settlement?.settlementTime;
                const dateLabel = new Date(eventDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
                const label = created ? obligationEntryLabel(obligation) : reversed ? "Payment Reversed" : payable ? sourceType === "BORROW" ? "Loan Repayment" : "Payment Made" : sourceType === "LEND" ? "Loan Received Back" : "Payment Received";
                const amount = Number(event.amount ?? allocation?.amount ?? obligation.originalAmount ?? 0);
                const description = created
                  ? sourceType === "BORROW" ? `${formatCurrency(amount)} received from ${personName} · Into ${accountName}`
                    : sourceType === "LEND" ? `${formatCurrency(amount)} given to ${personName} · From ${accountName}`
                      : sourceType === "PAID_BY_SOMEONE" ? `${personName} paid ${formatCurrency(amount)} for you`
                        : `${formatCurrency(amount)} paid for ${personName} · From ${accountName}`
                  : reversed ? `${formatCurrency(amount)} reversed · ${accountName}`
                    : payable ? `${formatCurrency(amount)} paid to ${personName} · From ${accountName}`
                      : `${formatCurrency(amount)} received from ${personName} · Into ${accountName}`;
                const marker = reversed || allocationReversed ? "bg-muted" : created ? "bg-amber" : event.statusAfter === "SETTLED" ? "bg-emerald" : payable ? "bg-coral" : "bg-emerald";
                return <article key={event._id} className="relative flex gap-3 pb-6 last:pb-0">
                  {index < timelineEvents.length - 1 && <span className="absolute bottom-0 left-[10px] top-6 w-px bg-charcoal/10" />}
                  <span className={`relative z-10 mt-1 grid size-[22px] shrink-0 place-items-center rounded-full ring-4 ring-cream ${marker}`}><span className="size-1.5 rounded-full bg-white" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-muted">{dateLabel} · {eventTime ? formatTimeValue(eventTime) : new Date(eventDate).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</p>
                    <p className="mt-1 text-sm font-bold text-charcoal">{label}{allocationReversed ? " · Reversed" : ""}</p>
                    <p className="mt-1 text-sm leading-5 text-charcoal/80">{description}</p>
                    {created && <p className="mt-1 text-xs font-semibold text-muted">{payable ? "Amount to repay" : "Amount to receive"}: {formatCurrency(obligation.originalAmount)}</p>}
                    {!created && event.remainingAfter != null && <p className="mt-1 text-xs font-bold text-muted">Remaining after payment: {formatCurrency(event.remainingAfter)}</p>}
                    {event.statusBefore !== "SETTLED" && event.statusAfter === "SETTLED" && <span className="mt-2 inline-flex rounded-full bg-emeraldSoft px-2.5 py-1 text-[11px] font-bold text-emerald">Settled</span>}
                  </div>
                </article>;
              })}
              {!timelineEvents.length && <p className="text-sm font-semibold text-muted">No payment history yet.</p>}
            </div>
          </section>
          <section className="overflow-hidden rounded-3xl bg-cream shadow-card">
            <button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)} className="flex min-h-14 w-full items-center justify-between px-5 text-left text-sm font-bold text-charcoal sm:px-6">
              Transaction Details <ChevronRight size={18} className={`transition-transform ${detailsOpen ? "rotate-90" : ""}`} />
            </button>
            {detailsOpen && <div className="grid gap-x-6 border-t border-charcoal/5 px-5 py-4 sm:grid-cols-2 sm:px-6">
              <ReceiptRow label="Person" value={personName} />
              <ReceiptRow label="Type" value={obligationSystemLabel(obligation)} />
              <ReceiptRow label={sourceType === "BORROW" || sourceType === "PAID_BY_SOMEONE" ? "Received Into" : "Account"} value={obligation.sourceTransaction?.account?.name || "Account unavailable"} />
              <ReceiptRow label={loanLike ? "Loan Date" : "Transaction Date"} value={`${new Date(createdDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}${createdTime ? ` · ${formatTimeValue(createdTime)}` : ""}`} />
              <ReceiptRow label="Category" value={obligation.sourceTransaction?.category?.name || "No category"} />
              <ReceiptRow label="Note" value={obligation.sourceTransaction?.note?.trim() || "No note"} />
              <ReceiptRow label="Reference" value={reference} />
              <ReceiptRow label={payable ? "Due Date" : "Expected Date"} value={obligation.dueDate ? new Date(obligation.dueDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "No due date"} />
            </div>}
          </section>
        </div>
        <aside className="hidden rounded-3xl bg-cream p-5 shadow-card lg:block">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Current Status</p>
          <p className="mt-2 text-lg font-bold text-charcoal">{statusText}</p>
          <p className="mt-5 text-xs font-semibold text-muted">{payable ? "Remaining to pay" : "Remaining to receive"}</p>
          <p className="mt-1 text-2xl font-extrabold text-coral">{formatCurrency(remaining)}</p>
          <p className="mt-4 text-xs font-semibold text-muted">Person</p>
          <p className="mt-1 text-sm font-bold text-charcoal">{personName}</p>
          {showAction && <button type="button" onClick={() => setPayOpen(true)} className="mt-5 min-h-12 w-full rounded-2xl bg-primary px-4 text-sm font-bold text-white">{payable ? "Pay" : "Receive"} {formatCurrency(remaining)}</button>}
        </aside>
      </div>
      {showAction && <div className="mobile-obligation-cta fixed inset-x-0 z-30 border-t border-charcoal/5 bg-paper/95 p-3 backdrop-blur md:hidden">
        <button type="button" onClick={() => setPayOpen(true)} className="mx-auto flex min-h-12 w-full max-w-[560px] items-center justify-center rounded-2xl bg-primary px-5 text-sm font-bold text-white shadow-card">{payable ? "Pay Remaining" : "Receive Remaining"} {formatCurrency(remaining)}</button>
      </div>}
      <SettleSheet open={payOpen} obligations={[obligation]} initialObligationId={obligation._id} title={`${payable ? "Pay" : "Receive from"} ${personName}`} exactObligation exactDescription={sourceTitle} onClose={() => setPayOpen(false)} onSettled={async () => { setPayOpen(false); await onFinancialChange?.(); }} />
    </ScreenShell>
  );
}
function decodeVapidKey(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function HomeDashboard({ refreshKey, user, onLogout, onThemeChange, onNavigate, locationKey, onSelectPerson, onNavigateToActivity, onNavigateToSettlements, onOpenObligation }) {
  const [period, setPeriod] = useState(readDashboardPeriod);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const accounts = useResource("accounts", {}, refreshKey);
  const obligations = useResource("obligations", {}, refreshKey);
  const activityParams = useMemo(() => period.allTime
    ? { sort: "newest", limit: 100 }
    : period.startDate || period.endDate
      ? { ...(period.startDate ? { startDate: period.startDate } : {}), ...(period.endDate ? { endDate: period.endDate } : {}), sort: "newest", limit: 100 }
      : { month: period.month, year: period.year, sort: "newest", limit: 100 }, [period]);
  const activity = useResource("activity", activityParams, refreshKey);
  useLayoutEffect(() => {
    if (window.location.pathname !== "/home") return;
    const params = new URLSearchParams();
    if (!period.allTime) {
      if (period.startDate || period.endDate) {
        if (period.startDate) params.set("startDate", period.startDate);
        if (period.endDate) params.set("endDate", period.endDate);
      } else {
        params.set("month", period.month);
        params.set("year", period.year);
      }
    }
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [period]);
  const periodFilters = useMemo(() => period.allTime
    ? { allTime: "true" }
    : period.startDate || period.endDate
    ? { startDate: period.startDate, endDate: period.endDate }
    : { month: period.month, year: period.year }, [period]);
  const openActivity = (type = "", includePeriod = true, extra = {}) => {
    onNavigateToActivity({ ...(type ? { type } : {}), ...(includePeriod ? periodFilters : {}), ...extra, sort: "newest" });
  };
  const openSettlements = (view, source = "", includePeriod = false, extra = {}) => {
    onNavigateToSettlements(view, source, { ...(includePeriod ? periodFilters : {}), ...extra });
  };
  const summary = useTransactionSummary(period, refreshKey);
  const reports = useTransactionReports(period, refreshKey);
  const categoryItems = reports.loading ? [] : reports.data?.charts?.categorySpending || [];
  const categoryMax = Math.max(...categoryItems.map((item) => Number(item.total || 0)), 1);
  const spendBars = categoryItems.map((item) => ({
    label: item.name,
    value: Math.round((Number(item.total || 0) / categoryMax) * 100),
    color: item.color || "coral"
  }));
  const selectedPeriodLabel = period.allTime
    ? "All Time"
    : period.startDate || period.endDate
    ? `${period.startDate ? formatShortDate(period.startDate) : "Beginning"} - ${period.endDate ? formatShortDate(period.endDate) : "Today"}`
    : new Date(Number(period.year), Number(period.month) - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const dashboard = summary.data || {
    availableMoney: 0,
    incomeThisMonth: 0,
    personalExpense: 0,
    expenseThisMonth: 0,
    totalToReceive: 0,
    totalToPay: 0,
    lentOutstanding: 0,
    paidForSomeoneOutstanding: 0,
    borrowedOutstanding: 0,
    someonePaidForMeOutstanding: 0,
    receivedBack: 0,
    paidBack: 0,
    payableToday: 0,
    payableUpcoming: 0,
    payableOverdue: 0,
    receivableToday: 0,
    receivableUpcoming: 0,
    receivableOverdue: 0,
    settledAllTime: 0,
    partialSettlementCount: 0,
    peopleOutstanding: []
  };
  const maxFlow = Math.max(Number(dashboard.incomeThisMonth || 0), Number(dashboard.expenseThisMonth || 0), 1);
  const cashFlowBars = [
    { label: "Income", value: Math.round((Number(dashboard.incomeThisMonth || 0) / maxFlow) * 100), color: "bg-income" },
    { label: "Expense", value: Math.round((Number(dashboard.expenseThisMonth || 0) / maxFlow) * 100), color: "bg-coral" }
  ];
  const partialCount = dashboard.partialSettlementCount || 0;
  const usableAccounts = accounts.items.filter((account) => account.isActive !== false && ["CASH", "BANK", "WALLET"].includes(String(account.type || "").toUpperCase()));
  const currentBalance = usableAccounts.reduce((total, account) => total + Number(account.currentBalance || 0), 0);
  const recentEvents = activity.items.slice(0, 6);
  const uniquePeopleCount = (sourceTypes) => new Set(obligations.items
    .filter((item) => sourceTypes.includes(item.sourceType) && item.direction === "RECEIVABLE" && Number(item.remainingAmount || 0) > 0 && item.person?._id)
    .map((item) => String(item.person._id))).size;
  const nextDue = (direction) => obligations.items
    .filter((item) => item.direction === direction && Number(item.remainingAmount || 0) > 0 && !["SETTLED", "CANCELLED"].includes(item.status) && item.dueDate && new Date(item.dueDate).setHours(0, 0, 0, 0) > new Date().setHours(0, 0, 0, 0))
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)).slice(0, 4);
  const payableDue = nextDue("PAYABLE");
  const receivableDue = nextDue("RECEIVABLE");
  const openRecentEvent = async (event) => {
    const transaction = event.rootTransaction || event.transaction;
    if (transaction?._id && event.eventType !== "SETTLEMENT_ALLOCATED" && event.eventType !== "SETTLEMENT_REVERSED") {
      try {
        const detail = await api.get("transactions", transaction._id);
        setSelectedTransaction(detail.transaction || detail);
      } catch {
        setSelectedEvent(event);
      }
      return;
    }
    setSelectedEvent(event);
  };

  if ((summary.loading && !summary.data) || accounts.loading || obligations.loading || activity.loading) {
    return <HomeSkeleton user={user} onLogout={onLogout} onThemeChange={onThemeChange} onNavigate={onNavigate} />;
  }
  if (summary.error && !summary.data) {
    return <ScreenShell><ResourceState loading={false} error={summary.error} empty={false} onRetry={summary.refresh} /></ScreenShell>;
  }

  return (
    <ScreenShell className="space-y-3 md:grid md:grid-cols-2 md:gap-3 md:space-y-0 xl:grid-cols-12 xl:gap-4">
      <div className="md:col-span-2 xl:col-span-12 md:hidden">
        <PremiumHeader user={user} onLogout={onLogout} onThemeChange={onThemeChange} onNavigate={onNavigate} locationKey={locationKey} refreshKey={refreshKey} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 md:col-span-2 xl:col-span-12">
        <p className="text-xs font-medium text-muted">Activity for {selectedPeriodLabel}</p>
        <DashboardPeriodFilter period={period} onApply={setPeriod} />
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:col-span-2 xl:col-span-12 xl:grid-cols-5">
        <DashboardSummaryCard title="Current Balance" amount={formatCurrency(currentBalance)} caption="Cash, bank & wallet" icon={Wallet} tone="primary" className="col-span-2 xl:col-span-1" onClick={() => onNavigate(navigationItems.find((item) => item.id === "accounts"))} />
        <DashboardSummaryCard title="Income This Month" amount={formatCurrency(dashboard.incomeThisMonth)} caption={selectedPeriodLabel} icon={TrendingUp} tone="income" onClick={() => openActivity("INCOME")} />
        <DashboardSummaryCard title="Personal Expense" amount={formatCurrency(dashboard.personalExpense)} caption={selectedPeriodLabel} icon={TrendingDown} tone="coral" onClick={() => openActivity("EXPENSE")} />
        <DashboardSummaryCard title="Total To Receive" amount={formatCurrency(dashboard.totalToReceive)} caption={`Across ${(dashboard.peopleOutstanding || []).filter((item) => item.direction === "RECEIVABLE" && Number(item.amount || 0) > 0).length} people`} icon={ArrowDownLeft} tone="emerald" onClick={() => openSettlements("to-receive")} />
        <DashboardSummaryCard title="Total To Pay" amount={formatCurrency(dashboard.totalToPay)} caption={`Across ${(dashboard.peopleOutstanding || []).filter((item) => item.direction === "PAYABLE" && Number(item.amount || 0) > 0).length} people`} icon={ArrowUpRight} tone="coral" onClick={() => openSettlements("to-pay")} />
      </div>

      <MoneyWithPeople dashboard={dashboard} obligations={obligations.items} onSelect={(view, source) => openSettlements(view, source)} onViewAll={() => openSettlements("all")} className="md:col-span-2 xl:col-span-6" />

      <section className="rounded-2xl border border-[#E5EAF0] bg-white p-3.5 shadow-[0_2px_8px_rgba(35,52,77,0.04)] md:col-span-2 xl:col-span-6">
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-bold">Upcoming Due</h2><p className="mt-0.5 text-[11px] text-muted">Payments and receipts due soon</p></div><button type="button" onClick={() => openSettlements("upcoming")} className="shrink-0 text-xs font-bold text-primary">View All →</button></div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2"><UpcomingDuePanel title="To Pay Due Soon" items={payableDue} direction="PAYABLE" loading={obligations.loading} onOpen={onOpenObligation} /><UpcomingDuePanel title="To Receive Due Soon" items={receivableDue} direction="RECEIVABLE" loading={obligations.loading} onOpen={onOpenObligation} /></div>
      </section>

      <RecentTransactionsSection events={recentEvents} loading={activity.loading} onViewAll={() => onNavigateToActivity({ ...(periodFilters || {}), sort: "newest" })} onOpen={openRecentEvent} className="md:col-span-2 xl:col-span-7" />

      <PaymentsReceivablesSection dashboard={dashboard} partialCount={partialCount} settledTotal={dashboard.settledAllTime} onSelect={openSettlements} onViewAll={() => openSettlements("all")} className="md:col-span-2 xl:col-span-5" />

      <section className="rounded-[1.25rem] bg-cream p-4 shadow-card md:col-span-2 xl:col-span-7">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">Cash Flow</h2>
            <p className="mt-1 text-xs font-semibold text-muted">Income vs Expense · {selectedPeriodLabel}</p>
          </div>
          <div className="flex gap-3 text-[10px] font-bold text-muted"><span><i className="mr-1 inline-block size-2 rounded-full bg-income" />Income</span><span><i className="mr-1 inline-block size-2 rounded-full bg-coral" />Expense</span></div>
        </div>
        <div className="mt-4 grid gap-3">
          {cashFlowBars.map((item) => (
            <div key={item.label} className="grid grid-cols-[4.5rem_1fr] items-center gap-3">
              <span className="text-xs font-semibold text-muted">{item.label}</span>
              <div className="h-3 overflow-hidden rounded-full bg-paper">
                <div className={`h-full rounded-full ${item.color}`} style={{ width: `${item.value}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[1.25rem] bg-cream p-4 shadow-card md:col-span-2 xl:col-span-5">
        <SectionTitle title="Spending Categories" />
        <ResourceState loading={reports.loading} error={reports.error} empty={!spendBars.length} onRetry={reports.refresh} emptyMessage="No personal expenses in this period." />
        <div className="mt-3 space-y-3">
          {spendBars.map((item) => (
            <div key={item.label} className="grid grid-cols-[4.5rem_1fr_2.25rem] items-center gap-3">
              <span className="truncate text-xs font-bold text-charcoal">{item.label}</span>
              <div className="h-2.5 overflow-hidden rounded-full bg-paper"><div className={`h-full rounded-full ${item.color}`} style={{ width: `${item.value}%` }} /></div>
              <span className="text-right text-[10px] font-bold text-muted">{item.value}%</span>
            </div>
          ))}
        </div>
      </section>

      <section className="md:col-span-2 xl:col-span-12">
        <h2 className="mb-3 text-base font-bold">People Summary</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <OutstandingPeoplePanel title="You Have to Pay" direction="PAYABLE" items={dashboard.peopleOutstanding} onSelectPerson={onSelectPerson} />
          <OutstandingPeoplePanel title="You Have to Receive" direction="RECEIVABLE" items={dashboard.peopleOutstanding} onSelectPerson={onSelectPerson} />
        </div>
      </section>

      {(selectedEvent || selectedTransaction) && (selectedTransaction
        ? <TransactionDetailSheet transaction={selectedTransaction} onClose={() => setSelectedTransaction(null)} onSelectPerson={(person) => { setSelectedTransaction(null); onSelectPerson(person); }} onOpenSettlements={(view, source) => { setSelectedTransaction(null); openSettlements(view, source); }} />
        : <ActivityEventDetail event={selectedEvent} onClose={() => setSelectedEvent(null)} onOpenSource={(event) => { const transaction = event.rootTransaction || event.transaction; if (transaction?._id) { setSelectedEvent(null); api.get("transactions", transaction._id).then((detail) => setSelectedTransaction(detail.transaction || detail)).catch(() => {}); } }} />)}

    </ScreenShell>
  );
}

function readDashboardPeriod() {
  const now = new Date();
  const params = new URLSearchParams(window.location.search);
  const startDate = params.get("startDate") || "";
  const endDate = params.get("endDate") || "";
  if (params.get("allTime") === "true") return { month: "", year: "", startDate: "", endDate: "", allTime: true };
  return startDate || endDate
    ? { month: "", year: "", startDate, endDate, allTime: false }
    : {
      month: params.get("month") || String(now.getMonth() + 1),
      year: params.get("year") || String(now.getFullYear()),
      startDate: "",
      endDate: "",
      allTime: false
    };
}

function DashboardSummaryCard({ title, amount, caption, icon: Icon, tone, className = "", onClick }) {
  return (
    <button type="button" onClick={onClick} className={`min-w-0 rounded-2xl border border-[#E4EAF0] p-3 text-left shadow-[0_2px_8px_rgba(35,52,77,0.04)] transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${tone === "income" ? "bg-[#F0FAF5]" : tone === "coral" ? "bg-[#FFF4F3]" : tone === "emerald" ? "bg-[#F1FAF8]" : "bg-[#F2F7FC]"} ${className}`}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={`grid size-9 shrink-0 place-items-center rounded-full ${formatTone(tone)}`}><Icon size={17} /></span>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold text-muted">{title}</p>
          <p className="mt-0.5 truncate text-lg font-bold leading-5 tracking-tight text-charcoal">{amount}</p>
          <p className="mt-0.5 truncate text-[10px] font-medium text-muted">{caption}</p>
        </div>
      </div>
    </button>
  );
}

function summarizeObligations(items) {
  const open = items.filter((item) => Number(item.remainingAmount || 0) > 0 && !["SETTLED", "CANCELLED"].includes(item.status));
  return {
    toPay: open.filter((item) => item.direction === "PAYABLE").reduce((sum, item) => sum + Number(item.remainingAmount || 0), 0),
    toReceive: open.filter((item) => item.direction === "RECEIVABLE").reduce((sum, item) => sum + Number(item.remainingAmount || 0), 0),
    toPayCount: open.filter((item) => item.direction === "PAYABLE").length,
    toReceiveCount: open.filter((item) => item.direction === "RECEIVABLE").length,
    openCount: open.length,
    partial: open.filter((item) => item.settlementState === "PARTIAL" || Number(item.settledAmount || 0) > 0).length,
    overdue: open.filter((item) => item.dateState === "OVERDUE").length
  };
}

function sourceTypeLabel(type) {
  return ({ BORROW: "Loan", LEND: "Loan", PAID_FOR_SOMEONE: "Paid for someone", PAID_BY_SOMEONE: "Paid by someone", SPLIT_SHARE: "Split expense" })[type] || "Payment record";
}

function obligationDescription(item) {
  return item?.sourceTransaction?.note?.trim() || sourceTypeLabel(item?.sourceType);
}

function personObligationHeading(item, personName) {
  if (item?.sourceTransaction?.note?.trim()) return item.sourceTransaction.note.trim();
  return ({
    BORROW: `Loan from ${personName}`,
    LEND: `Lent to ${personName}`,
    PAID_FOR_SOMEONE: `Paid for ${personName}`,
    PAID_BY_SOMEONE: `${personName} paid for me`,
    SPLIT_SHARE: `Split expense with ${personName}`
  })[item?.sourceType] || "Payment record";
}

function obligationSystemLabel(item) {
  return ({
    BORROW: "Loan Taken",
    LEND: "Lent Money",
    PAID_FOR_SOMEONE: "Paid for Someone",
    PAID_BY_SOMEONE: "Someone Paid for Me",
    SPLIT_SHARE: "Paid for Someone"
  })[item?.sourceType] || "Payment";
}

function obligationStatusLabel(item) {
  const remaining = Number(item?.remainingAmount || 0);
  if (item?.status === "CANCELLED") return "Cancelled";
  if (item?.status === "SETTLED" || remaining <= 0) return "Settled";
  const partial = Number(item?.settledAmount || 0) > 0 || item?.status === "PARTIALLY_SETTLED";
  const detail = item?.direction === "PAYABLE" ? "Partially Paid" : "Partially Received";
  if (item?.status === "OVERDUE") return partial ? `Overdue · ${detail}` : "Overdue";
  return partial ? detail : "Pending";
}

function obligationStatusTone(item) {
  if (item?.status === "CANCELLED") return "bg-paper text-muted";
  if (item?.status === "SETTLED" || Number(item?.remainingAmount || 0) <= 0) return "bg-emeraldSoft text-emerald";
  if (item?.status === "OVERDUE") return "bg-coralSoft text-coral";
  if (Number(item?.settledAmount || 0) > 0) return "bg-amberSoft text-amber";
  return item?.direction === "PAYABLE" ? "bg-coralSoft text-coral" : "bg-emeraldSoft text-emerald";
}

function itemDateLabel(item) {
  const created = new Date(item.createdAt);
  const createdLabel = created.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return `${createdLabel} · ${item.dueDate ? `${item.direction === "PAYABLE" ? "Due" : "Expected"} ${formatShortDate(item.dueDate)}` : "No due date"}`;
}

function obligationEntryLabel(item) {
  return ({
    BORROW: "Loan Taken",
    LEND: "Lent Money",
    PAID_FOR_SOMEONE: "Paid for Someone",
    PAID_BY_SOMEONE: "Someone Paid for Me",
    SPLIT_SHARE: "Paid for Someone"
  })[item?.sourceType] || "Payment Record Created";
}

function buildObligationTimeline(item) {
  const allocations = new Map((item.settlements || []).map((allocation) => [String(allocation._id), allocation]));
  const events = [...(item.events || [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const dateText = (date, time) => {
    const parsed = new Date(date);
    const dateLabel = parsed.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    const timeLabel = time ? formatTimeValue(time) : parsed.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
    return `${dateLabel} · ${timeLabel}`;
  };
  const dateValue = (date, time) => {
    const parsed = new Date(date);
    if (time) {
      const [hour, minute] = String(time).split(":").map(Number);
      parsed.setHours(hour || 0, minute || 0, 0, 0);
    }
    return parsed.getTime();
  };
  const source = item.sourceTransaction || {};
  const entries = events.map((event) => {
    const allocation = event.allocation ? allocations.get(String(event.allocation)) : null;
    const settlement = allocation?.settlement;
    if (event.eventType === "CREATED") {
      const sourceDate = source.transactionDate || event.createdAt;
      return {
        id: event._id,
        label: obligationEntryLabel(item),
        icon: item.sourceType === "BORROW" ? ArrowDownLeft : item.sourceType === "LEND" ? ArrowUpRight : HandCoins,
        tone: item.sourceType === "BORROW" ? "bg-amberSoft text-amber" : item.direction === "PAYABLE" ? "bg-coralSoft text-coral" : "bg-emeraldSoft text-emerald",
        date: dateText(sourceDate, source.transactionTime),
        sortDate: dateValue(sourceDate, source.transactionTime),
        amount: event.amount ?? item.originalAmount,
        description: `${item.direction === "PAYABLE" ? "Original amount to pay" : "Original amount to receive"}${source.account?.name ? ` · ${source.account.name}` : ""}`,
        remaining: item.originalAmount
      };
    }
    if (event.eventType === "SETTLEMENT_ALLOCATED" || event.eventType === "SETTLEMENT_REVERSED") {
      const reversed = event.eventType === "SETTLEMENT_REVERSED";
      const label = reversed ? "Payment Reversed" : item.direction === "PAYABLE"
        ? item.sourceType === "BORROW" ? "Loan Repayment" : "Payment Made"
        : item.sourceType === "LEND" ? "Loan Received Back" : "Payment Received";
      const accountName = settlement?.account?.name || "Account unavailable";
      return {
        id: event._id,
        label,
        icon: reversed ? X : CheckCircle2,
        tone: reversed ? "bg-paper text-muted" : item.direction === "PAYABLE" ? "bg-coralSoft text-coral" : "bg-emeraldSoft text-emerald",
        date: dateText(settlement?.settlementDate || event.createdAt, settlement?.settlementTime),
        sortDate: dateValue(settlement?.settlementDate || event.createdAt, settlement?.settlementTime),
        amount: event.amount ?? allocation?.amount,
        description: `${reversed ? "Reversed" : item.direction === "PAYABLE" ? "Paid from" : "Received in"} ${accountName}${!reversed && settlement?.status === "CANCELLED" ? " · later reversed" : ""}`,
        remaining: event.remainingAfter,
        statusChanged: event.statusBefore !== "SETTLED" && event.statusAfter === "SETTLED"
      };
    }
    return {
      id: event._id,
      label: event.statusAfter === "OVERDUE" ? "Overdue" : "Status Updated",
      icon: event.statusAfter === "OVERDUE" ? CalendarDays : CheckCircle2,
      tone: event.statusAfter === "OVERDUE" ? "bg-coralSoft text-coral" : "bg-paper text-muted",
      date: dateText(event.createdAt),
      sortDate: dateValue(event.createdAt),
      description: `${String(event.statusBefore || "").replaceAll("_", " ")} → ${String(event.statusAfter || "").replaceAll("_", " ")}`,
      remaining: event.remainingAfter
    };
  });
  return entries.sort((a, b) => a.sortDate - b.sortDate);
}

function sortObligationEvents(data) {
  const allocations = new Map((data?.allocations || []).map((allocation) => [String(allocation._id), allocation]));
  const dateValue = (event) => {
    if (event.eventType === "CREATED") return new Date(data?.obligation?.sourceTransaction?.transactionDate || event.createdAt).getTime();
    const settlement = event.allocation ? allocations.get(String(event.allocation))?.settlement : event.settlement;
    const date = new Date(settlement?.settlementDate || event.createdAt);
    if (settlement?.settlementTime) {
      const [hour, minute] = String(settlement.settlementTime).split(":").map(Number);
      date.setHours(hour || 0, minute || 0, 0, 0);
    }
    return date.getTime();
  };
  return [...(data?.events || [])].sort((a, b) => dateValue(a) - dateValue(b));
}

function SettlementTrackingCard({ summary, onClick }) {
  return (
    <button onClick={onClick} className="w-full rounded-3xl bg-cream p-4 text-left shadow-card transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-charcoal">Payment Tracking</p>
          <p className="mt-1 text-xs font-semibold text-muted">Manage payments, receipts, and history</p>
        </div>
        <span className="grid size-10 place-items-center rounded-2xl bg-violetSoft text-primary"><HandCoins size={20} /></span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <span className="rounded-2xl bg-coralSoft p-3"><span className="block text-[10px] font-bold uppercase text-coral">To Pay</span><b className="mt-1 block text-sm text-charcoal">{formatCurrency(summary.toPay)}</b></span>
        <span className="rounded-2xl bg-emeraldSoft p-3"><span className="block text-[10px] font-bold uppercase text-emerald">To Receive</span><b className="mt-1 block text-sm text-charcoal">{formatCurrency(summary.toReceive)}</b></span>
        <span className="rounded-2xl bg-amberSoft p-3"><span className="block text-[10px] font-bold uppercase text-amber">Partial</span><b className="mt-1 block text-sm text-charcoal">{summary.partial}</b></span>
        <span className="rounded-2xl bg-paper p-3"><span className="block text-[10px] font-bold uppercase text-muted">Overdue</span><b className="mt-1 block text-sm text-charcoal">{summary.overdue}</b></span>
      </div>
    </button>
  );
}

function DashboardPeriodFilter({ period, onApply }) {
  const now = new Date();
  const defaultPeriod = { month: String(now.getMonth() + 1), year: String(now.getFullYear()), startDate: "", endDate: "", allTime: false };
  const [draft, setDraft] = useState(period);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  useEffect(() => setDraft(period), [period]);
  const chips = [
    !period.allTime &&
    period.startDate && { key: "startDate", label: `From ${formatShortDate(period.startDate)}` },
    !period.allTime &&
    period.endDate && { key: "endDate", label: `To ${formatShortDate(period.endDate)}` },
    !period.allTime && !period.startDate && !period.endDate && period.month !== defaultPeriod.month && { key: "month", label: monthOptions.find((item) => item.value === period.month)?.label || "Month" },
    !period.allTime && !period.startDate && !period.endDate && period.year !== defaultPeriod.year && period.year && { key: "year", label: period.year }
  ].filter(Boolean);
  const allTimePeriod = { month: "", year: "", startDate: "", endDate: "", allTime: true };
  const reset = () => setDraft(allTimePeriod);
  const removeChip = (chip) => {
    const next = chip.key === "startDate" || chip.key === "endDate"
      ? { ...period, [chip.key]: "" }
      : defaultPeriod;
    if (!next.startDate && !next.endDate) {
      next.month = defaultPeriod.month;
      next.year = defaultPeriod.year;
    }
    onApply(next);
    setDraft(next);
  };
  return (
    <div className="relative space-y-2">
      <FilterButton refProp={triggerRef} active={open} count={chips.length} onClick={() => { setDraft(period); setOpen((current) => !current); }}>
        <SlidersHorizontal size={16} /> Filter
      </FilterButton>
      <ActiveFilterChips chips={chips} onRemove={removeChip} onClear={() => { onApply(allTimePeriod); setDraft(allTimePeriod); }} />
      <CompactPopover open={open} title="Date Filters" triggerRef={triggerRef} onClose={() => setOpen(false)} footer={<FilterActions onReset={reset} onApply={() => { onApply(draft); setOpen(false); }} />}>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setDraft(defaultPeriod)} className="rounded-2xl bg-paper px-3 py-2 text-sm font-bold text-charcoal">This Month</button>
          <button type="button" onClick={() => setDraft(allTimePeriod)} className="rounded-2xl bg-paper px-3 py-2 text-sm font-bold text-charcoal">All Time</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[["today", "Today"], ["this_week", "This Week"], ["last_month", "Last Month"]].map(([periodKey, label]) => (
            <button key={periodKey} type="button" onClick={() => {
              const range = activityPeriodRange(periodKey);
              setDraft({ ...allTimePeriod, allTime: false, ...range });
            }} className="rounded-2xl bg-paper px-3 py-2 text-sm font-bold text-charcoal">{label}</button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FilterSelect label="Month" value={draft.month} onChange={(value) => setDraft({ ...draft, allTime: false, month: value || defaultPeriod.month, startDate: "", endDate: "" })} options={monthOptions} />
          <FilterSelect label="Year" value={draft.year} onChange={(value) => setDraft({ ...draft, allTime: false, year: value || defaultPeriod.year, startDate: "", endDate: "" })} options={yearFilterOptions().filter((item) => item.value)} />
          <FormInput label="From Date" type="date" value={draft.startDate || ""} onChange={(value) => setDraft({ ...draft, allTime: false, month: "", year: "", startDate: value })} />
          <FormInput label="To Date" type="date" value={draft.endDate || ""} onChange={(value) => setDraft({ ...draft, allTime: false, month: "", year: "", endDate: value })} />
        </div>
      </CompactPopover>
    </div>
  );
}

function AccountBalanceList({ accounts, total, onSelect }) {
  return (
    <section className="rounded-[1.15rem] bg-cream p-4 shadow-card">
      <div className="flex items-center justify-between border-b border-[#E9E2D8] pb-3">
        <h2 className="text-sm font-bold">Account balances</h2>
        <span className="text-xs font-semibold text-muted">Current</span>
      </div>
      <ResourceState loading={accounts.loading} error={accounts.error} empty={!accounts.items.length} onRetry={accounts.refresh} />
      <div className="divide-y divide-[#E9E2D8]">
        {accounts.items.map((account) => (
          <button key={account._id} type="button" onClick={() => onSelect(account)} className="flex min-h-12 w-full items-center justify-between gap-3 py-2 text-left">
            <span className="truncate text-sm font-semibold">{account.name}</span>
            <span className="shrink-0 text-sm font-bold">{formatCurrency(account.currentBalance)}</span>
          </button>
        ))}
        {!accounts.loading && !accounts.error && accounts.items.length > 0 && (
          <div className="flex justify-between gap-3 pt-3 text-sm font-bold"><span>Total</span><span>{formatCurrency(total)}</span></div>
        )}
      </div>
    </section>
  );
}

function MoneyWithPeople({ dashboard, obligations = [], onSelect, onViewAll, className = "" }) {
  const peopleCount = (sources) => new Set(obligations
    .filter((item) => sources.includes(item.sourceType) && Number(item.remainingAmount || 0) > 0 && item.person?._id)
    .map((item) => String(item.person._id))).size;
  const items = [
    { label: "Lent Outstanding", value: dashboard.lentOutstanding, count: peopleCount(["LEND"]), view: "to-receive", source: "LEND", tone: "emerald", icon: ArrowUpRight },
    { label: "Paid for Someone", value: dashboard.paidForSomeoneOutstanding, count: peopleCount(["PAID_FOR_SOMEONE", "SPLIT_SHARE"]), view: "to-receive", source: "PAID_FOR_SOMEONE_AND_SPLIT", tone: "primary", icon: HandCoins },
    { label: "Borrowed", value: dashboard.borrowedOutstanding, count: peopleCount(["BORROW"]), view: "to-pay", source: "BORROW", tone: "amber", icon: ArrowDownLeft },
    { label: "Someone Paid for Me", value: dashboard.someonePaidForMeOutstanding, count: peopleCount(["PAID_BY_SOMEONE"]), view: "to-pay", source: "PAID_BY_SOMEONE", tone: "coral", icon: Receipt }
  ];
  return (
    <section className={`money-with-people-section w-full rounded-2xl border border-[#E5EAF0] bg-white shadow-[0_2px_8px_rgba(35,52,77,0.04)] ${className}`}>
      <div className="money-with-people-header flex flex-wrap items-start justify-between gap-x-3 gap-y-2"><div className="min-w-0"><h2 className="text-base font-bold sm:text-lg">Money with People</h2><p className="mt-0.5 text-xs text-muted">Your settlements overview</p></div><button type="button" onClick={onViewAll} className="shrink-0 text-xs font-bold text-primary">View All →</button></div>
      <div className="money-with-people-grid mt-3 grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-4">
        {items.map((item) => (
          <button key={item.label} type="button" onClick={() => onSelect(item.view, item.source)} className={`money-with-people-card min-w-0 rounded-xl border border-white/80 p-3 text-left transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary lg:p-3 xl:p-3.5 ${item.tone === "amber" ? "bg-[#FFF8E8]" : item.tone === "coral" ? "bg-[#FFF2F0]" : item.tone === "primary" ? "bg-[#F5F2FF]" : "bg-[#EFF9F5]"}`}>
            <span className={`grid size-8 place-items-center rounded-full sm:size-9 ${formatTone(item.tone)}`}><item.icon size={16} /></span>
            <p className="mt-2 min-h-[2.5em] max-w-[15ch] text-[13px] font-semibold leading-[1.25] text-muted">{item.label}</p>
            <p className="mt-1 truncate text-base font-bold text-charcoal sm:text-[17px]">{formatCurrency(item.value || 0)}</p>
            <p className="mt-1 text-xs font-medium text-muted">{item.count} {item.count === 1 ? "person" : "people"}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function UpcomingDuePanel({ title, items, direction, loading, onOpen }) {
  const payable = direction === "PAYABLE";
  return <div className={`min-w-0 rounded-xl ${payable ? "bg-[#FFF8F6]" : "bg-[#F3FAF7]"}`}>
    <div className={`flex items-center justify-between rounded-t-xl px-2.5 py-2 ${payable ? "bg-[#FFF0ED]" : "bg-[#EAF7F0]"}`}><h3 className="truncate text-[10px] font-bold">{title}</h3><span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold text-muted">{items.length}</span></div>
    <div className="divide-y divide-charcoal/5 px-2.5">
      {loading && <div className="py-3 text-[11px] text-muted">Loading records…</div>}
      {!loading && !items.length && <p className="py-3 text-[11px] text-muted">No upcoming {payable ? "payments" : "receivables"}.</p>}
      {!loading && items.map((item) => <button key={item._id} type="button" onClick={() => onOpen(item._id)} className="flex w-full min-w-0 items-center gap-2 py-2 text-left">
        <span className={`grid size-7 shrink-0 place-items-center rounded-full text-[9px] font-bold ${payable ? "bg-coralSoft text-coral" : "bg-emeraldSoft text-emerald"}`}>{String(item.person?.name || "?").split(/\s+/).map((word) => word[0]).slice(0, 2).join("").toUpperCase()}</span>
        <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-bold">{item.person?.name || "Unknown person"}</span><span className="block truncate text-[10px] text-muted">{obligationDescription(item)}</span></span>
        <span className="shrink-0 text-right"><span className={`block text-[11px] font-bold ${payable ? "text-coral" : "text-emerald"}`}>{formatCurrency(item.remainingAmount)}</span><span className="block text-[9px] text-muted">{formatShortDate(item.dueDate)}</span></span>
      </button>)}
    </div>
  </div>;
}

function RecentTransactionsSection({ events, loading, onViewAll, onOpen, className = "" }) {
  const rawType = (event) => event.metadata?.transactionType || event.obligation?.sourceType || "";
  const typeLabel = (event) => {
    const kind = rawType(event);
    return ({ EXPENSE: "Expense", INCOME: "Income", BORROW: "Borrow", LEND: "Lend", TRANSFER: "Transfer", PAID_FOR_SOMEONE: "Paid for Someone", PAID_BY_SOMEONE: "Someone Paid for Me" })[kind] || (event.eventType?.startsWith("SETTLEMENT") ? "Settlement" : activityEventLabel(event));
  };
  const amountText = (event) => `${event.direction === "IN" ? "+" : event.direction === "OUT" ? "−" : ""}${formatCurrency(event.amount)}`;
  const semanticTone = (event) => event.eventType?.startsWith("SETTLEMENT") ? "purple" : rawType(event) === "TRANSFER" ? "blue" : rawType(event) === "BORROW" ? "amber" : rawType(event) === "LEND" ? "teal" : event.direction === "IN" ? "green" : event.direction === "OUT" ? "red" : "blue";
  const amountTone = (event) => ({ purple: "text-primary", blue: "text-blue-700", amber: "text-amber", teal: "text-teal-700", green: "text-emerald", red: "text-coral" })[semanticTone(event)];
  const pillTone = (event) => ({ purple: "bg-violetSoft text-primary", blue: "bg-blue-50 text-blue-700", amber: "bg-amberSoft text-amber", teal: "bg-teal-50 text-teal-700", green: "bg-emeraldSoft text-emerald", red: "bg-coralSoft text-coral" })[semanticTone(event)];
  const renderEvent = (event) => <button key={event._id} type="button" onClick={() => onOpen(event)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b border-[#E8EDF2] px-3 py-2.5 text-left last:border-0 hover:bg-paper/70 md:grid-cols-[minmax(0,1.3fr)_6.5rem_6rem_5.5rem_6.5rem]">
    <span className="min-w-0"><span className="block truncate text-xs font-bold">{activityEventTitle(event)}</span><span className="block truncate text-[10px] text-muted md:hidden">{typeLabel(event)} · {formatShortDate(event.occurredAt)}</span><span className="hidden truncate text-[10px] text-muted md:block">{activityEventSubtitle(event)}</span></span>
    <span className={`text-right text-xs font-bold ${amountTone(event)}`}>{amountText(event)}</span>
    <span className="hidden truncate text-[10px] text-muted md:block">{event.account?.name || "—"}</span><span className="hidden text-[10px] text-muted md:block">{formatShortDate(event.occurredAt)}</span>
    <span className={`hidden w-fit rounded-full px-2 py-1 text-[9px] font-bold md:inline-block ${pillTone(event)}`}>{typeLabel(event)}</span>
  </button>;
  return <section className={`overflow-hidden rounded-2xl border border-[#E5EAF0] bg-white shadow-[0_2px_8px_rgba(35,52,77,0.04)] ${className}`}>
    <div className="flex items-start justify-between gap-3 p-3.5"><div><h2 className="text-sm font-bold">Recent Transactions</h2><p className="mt-0.5 text-[11px] text-muted">Your latest activity across all accounts</p></div><button type="button" onClick={onViewAll} className="shrink-0 text-xs font-bold text-primary">View All →</button></div>
    <div className="hidden grid-cols-[minmax(0,1.3fr)_6.5rem_6rem_5.5rem_6.5rem] gap-3 border-y border-[#E8EDF2] bg-[#F8FAFC] px-3 py-2 text-[9px] font-bold uppercase tracking-wide text-muted md:grid"><span>Description</span><span className="text-right">Amount</span><span>Account</span><span>Date</span><span>Type</span></div>
    {loading && <div className="px-3 py-4 text-xs text-muted">Loading recent activity…</div>}
    {!loading && !events.length && <div className="px-3 py-4 text-xs text-muted">No recent transactions.</div>}
    {!loading && events.map(renderEvent)}
  </section>;
}

function PaymentsReceivablesSection({ dashboard, partialCount, settledTotal, onSelect, onViewAll, className = "" }) {
  const metrics = [
    { label: "To Pay Today", value: dashboard.payableToday, tone: "amber", view: "to-pay", direction: "PAYABLE", dateState: "TODAY" },
    { label: "To Receive Today", value: dashboard.receivableToday, tone: "income", view: "to-receive", direction: "RECEIVABLE", dateState: "TODAY" },
    { label: "Upcoming Payments", value: dashboard.payableUpcoming, tone: "coral", view: "upcoming-payments", direction: "PAYABLE", dateState: "UPCOMING" },
    { label: "Upcoming Receivables", value: dashboard.receivableUpcoming, tone: "emerald", view: "upcoming-receivables", direction: "RECEIVABLE", dateState: "UPCOMING" },
    { label: "Overdue Payments", value: dashboard.payableOverdue, tone: "coral", view: "overdue-payments", direction: "PAYABLE", dateState: "OVERDUE" },
    { label: "Overdue Receivables", value: dashboard.receivableOverdue, tone: "amber", view: "overdue-receivables", direction: "RECEIVABLE", dateState: "OVERDUE" },
    { label: "Partial Settlements", value: partialCount, tone: "primary", view: "partial", status: "PARTIAL" }
  ];
  return <section className={`rounded-2xl border border-[#E5EAF0] bg-white p-3.5 shadow-[0_2px_8px_rgba(35,52,77,0.04)] ${className}`}>
    <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-bold">Payments &amp; Receivables</h2><p className="mt-0.5 text-[11px] text-muted">Track pending and completed payments</p></div><button type="button" onClick={onViewAll} className="shrink-0 text-right text-[10px] font-bold text-primary">View Payment Tracking →</button></div>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{metrics.map((metric) => <DashboardMetricButton key={metric.label} label={metric.label} value={metric.label === "Partial Settlements" ? String(metric.value || 0) : formatCurrency(metric.value || 0)} tone={metric.tone} onClick={() => onSelect(metric.view, "", false, { ...(metric.direction ? { direction: metric.direction } : {}), ...(metric.dateState ? { dateState: metric.dateState } : {}), ...(metric.status ? { status: metric.status } : {}) })} />)}</div>
    <button type="button" onClick={() => onSelect("settled", "", false, { allTime: "true" })} className="mt-2 flex w-full items-center justify-between gap-3 rounded-xl bg-[#F3F0FF] px-3 py-2 text-left"><span className="text-[11px] font-semibold text-muted">Settled In All Time</span><span className="text-sm font-bold text-charcoal">{formatCurrency(settledTotal || 0)}</span></button>
  </section>;
}

function DashboardMetricButton({ label, value, tone, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`min-w-0 rounded-2xl p-3 text-left shadow-card ${formatTone(tone)}`}>
      <p className="text-[11px] font-bold leading-4 opacity-80">{label}</p>
      <p className="mt-1 truncate text-base font-bold text-charcoal">{value}</p>
    </button>
  );
}

function OutstandingPeoplePanel({ title, direction, items = [], onSelectPerson }) {
  const rows = items
    .filter((item) => item.direction === direction && Number(item.amount || 0) > 0)
    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
  const payable = direction === "PAYABLE";
  const itemLabel = payable ? "open payment" : "open receivable";
  const emptyMessage = payable ? "You have no outstanding payments." : "No money is currently owed to you.";
  return (
    <section className="rounded-[1.15rem] bg-cream p-4 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold">{title}</h3>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${payable ? "bg-coralSoft text-coral" : "bg-emeraldSoft text-emerald"}`}>
          {payable ? "To Pay" : "To Receive"}
        </span>
      </div>
      {!rows.length && <p className="mt-3 text-xs font-semibold text-muted">{emptyMessage}</p>}
      {rows.length > 0 && (
        <div className="mt-3 divide-y divide-[#E9E2D8]">
          {rows.map((row) => (
            <button
              key={`${row.person._id}-${row.direction}`}
              type="button"
              onClick={() => onSelectPerson?.(row.person)}
              className="w-full py-3 text-left first:pt-0 last:pb-0"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{row.person.name || "Unknown person"}</span>
                  <span className="mt-0.5 block text-[10px] font-semibold text-muted">{row.count} {itemLabel}{row.count === 1 ? "" : "s"}</span>
                </span>
                <span className={`shrink-0 text-sm font-bold ${payable ? "text-coral" : "text-emerald"}`}>{formatCurrency(row.amount)}</span>
              </div>
              <PeopleBreakdownChips obligations={row.breakdown || []} direction={direction} />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {personDueLabels(row.breakdown || []).map((label) => (
                  <span key={label} className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${label === "Overdue" ? "bg-coralSoft text-coral" : label === "Due Today" ? "bg-amberSoft text-amber" : "bg-paper text-muted"}`}>
                    {label}
                  </span>
                ))}
                <span className="rounded-full bg-paper px-2 py-0.5 text-[10px] font-bold text-primary">
                  View Details
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function PeopleBreakdownChips({ obligations = [], direction }) {
  const grouped = obligations
    .filter((item) => Number(item.remainingAmount || 0) > 0)
    .reduce((map, item) => {
      const label = peopleBreakdownLabel(item.sourceType, direction);
      map.set(label, Number(map.get(label) || 0) + Number(item.remainingAmount || 0));
      return map;
    }, new Map());
  const chips = [...grouped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!chips.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.map(([label, amount]) => (
        <span key={label} className="rounded-full bg-paper px-2 py-1 text-[10px] font-bold text-muted">
          {label} {formatCurrency(amount)}
        </span>
      ))}
    </div>
  );
}

function peopleBreakdownLabel(sourceType, direction) {
  return ({
    BORROW: "Loan",
    LEND: "Lent",
    PAID_FOR_SOMEONE: "Paid for Someone",
    PAID_BY_SOMEONE: "Paid for Me",
    SPLIT_SHARE: "Split Expense"
  })[sourceType] || (direction === "PAYABLE" ? "Payable" : "Receivable");
}

function personDueLabels(obligations = []) {
  const labels = new Set();
  obligations.forEach((item) => {
    if (!item.dueDate || Number(item.remainingAmount || 0) <= 0) return;
    if (item.dateState === "OVERDUE") labels.add("Overdue");
    else if (item.dateState === "TODAY") labels.add("Due Today");
    else if (item.dateState === "UPCOMING") labels.add("Upcoming");
  });
  return ["Overdue", "Due Today", "Upcoming"].filter((label) => labels.has(label));
}

function SkeletonBlock({ className = "" }) {
  return <div className={`animate-pulse rounded-2xl bg-[#ECE5D9] ${className}`} />;
}

function SkeletonCard({ className = "" }) {
  return (
    <div className={`rounded-[1.25rem] bg-cream p-4 shadow-card ${className}`}>
      <SkeletonBlock className="h-3 w-24" />
      <SkeletonBlock className="mt-3 h-7 w-32" />
      <SkeletonBlock className="mt-3 h-3 w-20" />
    </div>
  );
}

function HomeSkeleton({ user, onLogout, onThemeChange, onNavigate }) {
  return (
    <>
      <ScreenShell className="space-y-4 md:hidden">
        <PremiumHeader user={user} onLogout={onLogout} onThemeChange={onThemeChange} onNavigate={onNavigate} locationKey="home-skeleton" />
        <div className="grid grid-cols-2 gap-2.5">
          <SkeletonCard className="col-span-2 h-24" />
          <SkeletonCard className="h-24" /><SkeletonCard className="h-24" /><SkeletonCard className="h-24" /><SkeletonCard className="h-24" />
        </div>
        <SkeletonCard className="h-48" />
        <SkeletonCard className="h-56" />
        <SkeletonCard className="h-64" />
        <SkeletonCard className="h-56" />
        <div className="space-y-3">
          <SkeletonBlock className="h-4 w-32" />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      </ScreenShell>
      <ScreenShell className="hidden md:grid md:grid-cols-2 md:gap-3 xl:grid-cols-12 xl:gap-4">
        <SkeletonCard className="h-24 md:col-span-2 xl:col-span-12" />
        <div className="grid grid-cols-2 gap-2.5 md:col-span-2 xl:col-span-12 xl:grid-cols-5">
          <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
        <SkeletonCard className="h-48 md:col-span-2 xl:col-span-6" />
        <SkeletonCard className="h-48 md:col-span-2 xl:col-span-6" />
        <SkeletonCard className="h-64 md:col-span-2 xl:col-span-7" />
        <SkeletonCard className="h-64 md:col-span-2 xl:col-span-5" />
      </ScreenShell>
    </>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 rounded-3xl bg-cream p-4 shadow-card">
      <SkeletonBlock className="size-11 shrink-0" />
      <div className="min-w-0 flex-1">
        <SkeletonBlock className="h-4 w-3/4" />
        <SkeletonBlock className="mt-2 h-3 w-1/2" />
      </div>
      <SkeletonBlock className="h-4 w-16" />
    </div>
  );
}

function DesktopTransactionRow({ transaction }) {
  const meta = transactionMeta(transaction);
  const Icon = meta.icon;

  return (
    <article className="grid grid-cols-[minmax(0,1.4fr)_8rem_7rem] items-center gap-4 border-b border-[#E8E0D5] px-4 py-3 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        <span className={`grid size-10 shrink-0 place-items-center rounded-2xl ${stateStyles[meta.state]}`}>
          <Icon size={18} />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold">{meta.title}</h3>
          <p className="truncate text-xs font-semibold text-muted">{meta.subtitle}</p>
        </div>
      </div>
      <p className="text-sm font-semibold text-muted">{formatDateTime(transaction)}</p>
      <p className={`text-right text-sm font-bold ${meta.amountClass}`}>{meta.amount}</p>
    </article>
  );
}

function SectionTitle({ title, action, onAction }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      {action && <button type="button" onClick={onAction} className="text-sm font-bold text-primary">{action}</button>}
    </div>
  );
}

function useResource(resource, params = {}, refreshKey = 0) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const paramsKey = JSON.stringify(params);

  const load = async () => {
    setLoading(true);
      setError("");
    try {
      const data = await api.list(resource, params);
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [resource, refreshKey, paramsKey]);

  const save = async (payload, id) => {
    if (id) {
      await api.update(resource, id, payload);
    } else {
      await api.create(resource, payload);
    }
    await load();
  };

  const remove = async (id) => {
    await api.remove(resource, id);
    await load();
  };

  return { items, loading, error, save, remove, refresh: load };
}

function useTransactionSummary(params = {}, refreshKey = 0) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    setData(null);
    api
      .summary(params)
      .then((summary) => {
        if (alive) setData(summary);
      })
      .catch((err) => {
        if (alive) setError(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey, paramsKey]);

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api.summary(params));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return { data, error, loading, refresh };
}

function useTransactionReports(params = {}, refreshKey = 0) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const paramsKey = JSON.stringify(params);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api.reports(params));
    } catch (err) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    api
      .reports(params)
      .then((reports) => {
        if (alive) setData(reports);
      })
      .catch((err) => {
        if (alive) {
          setError(err.message);
          setData(null);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [paramsKey, refreshKey]);

  return { data, error, loading, refresh: load };
}

const defaultActivityFilters = {
  q: "",
  period: "",
  startDate: "",
  endDate: "",
  month: "",
  year: "",
  type: "",
  account: "",
  person: "",
  category: "",
  tag: "",
  status: "",
  balanceStatus: "",
  dashboardFilter: "",
  direction: "",
  due: "",
  sort: "newest"
};

function activityFiltersFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const filters = { ...defaultActivityFilters };
  Object.keys(filters).forEach((key) => {
    if (params.has(key)) filters[key] = params.get(key);
  });
  if (params.get("status") === "ACTIVE") filters.status = "";
  if (filters.startDate || filters.endDate) filters.period = "custom";
  return filters;
}

const periodOptions = [
  { value: "", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This Week" },
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "custom", label: "Custom Range" }
];

const transactionTypeOptions = [
  { value: "", label: "All Types" },
  { value: "INCOME", label: "Income" },
  { value: "EXPENSE", label: "Personal Expense" },
  { value: "BORROW", label: "Loan Taken" },
  { value: "LEND", label: "Lent Money" },
  { value: "PAID_FOR_SOMEONE", label: "Paid for Someone" },
  { value: "PAID_BY_SOMEONE", label: "Someone Paid for Me" },
  { value: "REPAYMENT_RECEIVED", label: "Payment Received" },
  { value: "REPAYMENT_PAID", label: "Payment Made" },
  { value: "TRANSFER", label: "Transfer" },
  { value: "SPLIT_EXPENSE", label: "Split Expense" }
];

const sortOptions = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "amount_high", label: "Amount High to Low" },
  { value: "amount_low", label: "Amount Low to High" }
];

const monthOptions = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1),
  label: new Date(2026, index, 1).toLocaleDateString("en-IN", { month: "long" })
}));

function downloadBlobFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function ExportButtons({ query, showToast, title = "Report" }) {
  const [exporting, setExporting] = useState("");

  const runExport = async (format) => {
    if (exporting) return;
    setExporting(format);
    showToast?.({
      key: `export-${format}-start`,
      title: `Preparing ${format === "pdf" ? "PDF" : "Excel"}...`,
      message: `${title} download is being generated.`
    });
    try {
      const { blob, filename } = await api.exportReport(format === "pdf" ? "pdf" : "xlsx", query);
      downloadBlobFile(blob, filename);
      showToast?.({
        key: `export-${format}-success`,
        title: "Report downloaded successfully."
      });
    } catch (err) {
      showToast?.({
        key: `export-${format}-error`,
        tone: "error",
        title: err.message || "Report export failed.",
        message: "Please retry."
      });
    } finally {
      setExporting("");
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={Boolean(exporting)}
        onClick={() => runExport("pdf")}
        className="rounded-full bg-violetSoft px-4 py-2 text-xs font-bold text-primary disabled:opacity-60"
      >
        {exporting === "pdf" ? "Preparing PDF..." : "Download PDF"}
      </button>
      <button
        type="button"
        disabled={Boolean(exporting)}
        onClick={() => runExport("xlsx")}
        className="rounded-full bg-emeraldSoft px-4 py-2 text-xs font-bold text-emerald disabled:opacity-60"
      >
        {exporting === "xlsx" ? "Preparing Excel..." : "Download Excel"}
      </button>
    </div>
  );
}

function useDismissablePopover(open, refs, onClose) {
  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      const inside = refs.some((ref) => ref.current?.contains(event.target));
      if (!inside) onClose();
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown, { passive: true });
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, refs, onClose]);
}

function CompactPopover({ open, title, triggerRef, onClose, children, footer }) {
  const panelRef = useRef(null);
  const refs = useMemo(() => [panelRef, triggerRef].filter(Boolean), [triggerRef]);
  useDismissablePopover(open, refs, onClose);

  if (!open) return null;

  return (
    <section
      ref={panelRef}
      className="fixed inset-x-0 bottom-0 z-50 max-h-[82vh] overflow-y-auto rounded-t-[2rem] bg-cream p-4 shadow-soft md:absolute md:bottom-auto md:right-0 md:top-12 md:inset-x-auto md:w-[28rem] md:rounded-3xl"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-base font-bold">{title}</h3>
        <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-2xl bg-paper text-muted">
          <X size={18} />
        </button>
      </div>
      <div className="space-y-4">{children}</div>
      {footer && <div className="sticky bottom-0 -mx-4 -mb-4 mt-4 flex gap-3 bg-cream p-4">{footer}</div>}
    </section>
  );
}

function FilterActions({ onReset, onApply }) {
  return (
    <>
      <button type="button" onClick={onReset} className="flex-1 rounded-2xl bg-paper px-4 py-3 text-sm font-bold text-muted">
        Reset All
      </button>
      <button type="button" onClick={onApply} className="flex-1 rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white">
        Apply Filters
      </button>
    </>
  );
}

function FilterButton({ refProp, active, count, children, onClick }) {
  return (
    <button
      ref={refProp}
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold shadow-card ${active ? "bg-primary text-white" : "bg-cream text-charcoal"}`}
    >
      {children}
      {count > 0 && <span>({count})</span>}
    </button>
  );
}

function ActiveFilterChips({ chips, onRemove, onClear }) {
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onRemove(chip)}
          className="rounded-full bg-violetSoft px-3 py-1.5 text-xs font-bold text-primary"
        >
          {chip.label} ×
        </button>
      ))}
      <button type="button" onClick={onClear} className="rounded-full bg-coralSoft px-3 py-1.5 text-xs font-bold text-coral">
        Clear All
      </button>
    </div>
  );
}

function FilterSection({ title, children }) {
  return (
    <div>
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{title}</p>
      {children}
    </div>
  );
}

function ActivityScreen({ refreshKey, showToast, onSelectPerson, onOpenSettlements }) {
  const [filters, setFilters] = useState(activityFiltersFromUrl);
  const [draftFilters, setDraftFilters] = useState(activityFiltersFromUrl);
  const [openPopup, setOpenPopup] = useState("");
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [selectedSettlement, setSelectedSettlement] = useState(null);
  const filterButtonRef = useRef(null);
  const sortButtonRef = useRef(null);
  const query = useMemo(() => buildTransactionQuery(filters), [filters]);
  const activityQuery = useMemo(() => buildActivityEventQuery(filters), [filters]);
  const activityResource = useResource("activity", activityQuery, refreshKey);
  const transactionResource = useResource("transactions", query, refreshKey);
  const settlementResource = useResource("obligations/history", settlementActivityQuery(filters), refreshKey);
  const accounts = useResource("accounts");
  const people = useResource("people");
  const categoryResource = useResource("categories");
  const tagResource = useResource("tags");
  const showSettlementEvents = !filters.type || ["REPAYMENT_RECEIVED", "REPAYMENT_PAID"].includes(filters.type);
  const useActivityEvents = true;
  const grouped = useActivityEvents ? groupActivityItems(activityResource.items.map((event) => ({
    kind: "activity-event",
    id: event._id,
    date: event.occurredAt,
    event
  }))) : groupActivityItems([
    ...transactionResource.items.map((transaction) => ({ kind: "transaction", id: transaction._id, date: transaction.transactionDate, time: transaction.transactionTime, transaction })),
    ...(showSettlementEvents ? settlementResource.items.map((settlement) => ({ kind: "settlement", id: settlement._id, date: settlement.settlementDate, time: settlement.settlementTime, settlement })) : [])
  ]);
  const chips = activeFilterChips(filters, {
    account: accounts.items,
    person: people.items,
    category: categoryResource.items,
    tag: tagResource.items
  });
  const filterCount = chips.filter((chip) => chip.key !== "sort").length;

  useEffect(() => {
    if (window.location.pathname !== "/activity") return;
    const urlQuery = buildActivityEventQuery(filters);
    if (urlQuery.sort === "newest") delete urlQuery.sort;
    const queryString = new URLSearchParams(urlQuery).toString();
    window.history.replaceState({}, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}`);
  }, [filters]);

  const updateFilter = (key, value) => {
    setFilters((current) => normalizeFilterPatch(current, key, value));
  };
  const updateDraftFilter = (key, value) => {
    setDraftFilters((current) => normalizeFilterPatch(current, key, value));
  };
  const openFilters = () => {
    setDraftFilters(filters);
    setOpenPopup((current) => (current === "filter" ? "" : "filter"));
  };
  const clearAllFilters = () => {
    setFilters(defaultActivityFilters);
    setDraftFilters(defaultActivityFilters);
  };
  const openTransactionDetail = async (transaction) => {
    if (!transaction?._id) {
      showToast?.({ tone: "error", title: "Source transaction is not available." });
      return;
    }
    setSelectedTransaction(transaction);
    try {
      const detail = await api.get("transactions", transaction._id);
      setSelectedTransaction(detail.transaction || detail);
    } catch (err) {
      showToast?.({ tone: "error", title: err.message || "Could not load transaction details." });
    }
  };
  const removeActivityChip = (chip) => {
    if (chip.key === "direction" || chip.key === "due") {
      setFilters((current) => ({ ...current, direction: "", due: "" }));
      setDraftFilters((current) => ({ ...current, direction: "", due: "" }));
      return;
    }
    updateFilter(chip.key, chip.reset ?? "");
  };

  return (
    <ScreenShell className="space-y-5">
      <PageHeader className="md:hidden" icon={Activity} title="Activity" subtitle="Clean financial history" />
      <section className="relative space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <FilterButton refProp={filterButtonRef} active={openPopup === "filter"} count={filterCount} onClick={openFilters}>
              <SlidersHorizontal size={16} />
              Filter
            </FilterButton>
            <FilterButton
              refProp={sortButtonRef}
              active={openPopup === "sort"}
              count={filters.sort !== "newest" ? 1 : 0}
              onClick={() => setOpenPopup((current) => (current === "sort" ? "" : "sort"))}
            >
              Sort
            </FilterButton>
          </div>
          <span className="rounded-full bg-cream px-3 py-2 text-xs font-bold text-muted shadow-card">
            {(useActivityEvents ? activityResource.items.length : transactionResource.items.length + (showSettlementEvents ? settlementResource.items.length : 0))} result{(useActivityEvents ? activityResource.items.length : transactionResource.items.length + (showSettlementEvents ? settlementResource.items.length : 0)) === 1 ? "" : "s"}
          </span>
        </div>
        <ActiveFilterChips
          chips={chips}
          onRemove={removeActivityChip}
          onClear={clearAllFilters}
        />
        <CompactPopover
          open={openPopup === "filter"}
          title="Filters"
          triggerRef={filterButtonRef}
          onClose={() => setOpenPopup("")}
          footer={
            <FilterActions
              onReset={() => setDraftFilters(defaultActivityFilters)}
              onApply={() => {
                setFilters(draftFilters);
                setOpenPopup("");
              }}
            />
          }
        >
          <div className="flex items-center gap-3 rounded-2xl bg-paper px-4 py-3">
            <Search size={18} className="text-muted" />
            <input className="w-full bg-transparent text-sm font-semibold outline-none placeholder:text-muted" placeholder="Search transactions..." value={draftFilters.q} onChange={(event) => updateDraftFilter("q", event.target.value)} />
          </div>
          <FilterSection title="Date">
            <div className="grid grid-cols-2 gap-2">
              {periodOptions.map((option) => (
                <button
                  key={option.value || "all-dates"}
                  type="button"
                  onClick={() => updateDraftFilter("period", option.value)}
                  className={`rounded-2xl px-3 py-2 text-sm font-bold ${draftFilters.period === option.value ? "bg-primary text-white" : "bg-paper text-charcoal"}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {draftFilters.period === "custom" && (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <FormInput label="Start Date" type="date" value={draftFilters.startDate} onChange={(value) => updateDraftFilter("startDate", value)} />
                <FormInput label="End Date" type="date" value={draftFilters.endDate} onChange={(value) => updateDraftFilter("endDate", value)} />
              </div>
            )}
          </FilterSection>
          <div className="grid gap-3 md:grid-cols-2">
            <FilterSelect label="Month" value={draftFilters.month} onChange={(value) => updateDraftFilter("month", value)} options={[{ value: "", label: "Any Month" }, ...monthOptions]} />
            <FilterSelect label="Year" value={draftFilters.year} onChange={(value) => updateDraftFilter("year", value)} options={yearFilterOptions()} />
            <FilterSelect label="Type" value={draftFilters.type} onChange={(value) => updateDraftFilter("type", value)} options={transactionTypeOptions} />
            <FilterSelect label="Account" value={draftFilters.account} onChange={(value) => updateDraftFilter("account", value)} options={resourceOptions(accounts.items, "All Accounts")} />
            <FilterSelect label="Person" value={draftFilters.person} onChange={(value) => updateDraftFilter("person", value)} options={resourceOptions(people.items, "All People")} />
            <FilterSelect label="Category" value={draftFilters.category} onChange={(value) => updateDraftFilter("category", value)} options={resourceOptions(categoryResource.items, "All Categories")} />
            <FilterSelect label="Tag" value={draftFilters.tag} onChange={(value) => updateDraftFilter("tag", value)} options={resourceOptions(tagResource.items, "All Tags")} />
            <FilterSelect
              label="State / Status"
                value={draftFilters.balanceStatus}
                onChange={(value) => updateDraftFilter("balanceStatus", value)}
              options={[
                { value: "", label: "Any State" },
                { value: "pending", label: "Pending" },
                { value: "partial", label: "Partial" },
                { value: "settled", label: "Settled" },
                { value: "overdue", label: "Overdue" }
              ]}
            />
            <FilterSelect
              label="Record Status"
              value={draftFilters.status}
              onChange={(value) => updateDraftFilter("status", value)}
              options={[
                { value: "", label: "Any Status" },
                { value: "ACTIVE", label: "Active" },
                { value: "CANCELLED", label: "Cancelled" }
              ]}
            />
          </div>
        </CompactPopover>
        <CompactPopover open={openPopup === "sort"} title="Sort" triggerRef={sortButtonRef} onClose={() => setOpenPopup("")}>
          <div className="space-y-2">
            {sortOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  updateFilter("sort", option.value);
                  setOpenPopup("");
                }}
                className={`w-full rounded-2xl px-4 py-3 text-left text-sm font-bold ${filters.sort === option.value ? "bg-primary text-white" : "bg-paper text-charcoal"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </CompactPopover>
      </section>
      <section className="rounded-3xl bg-cream p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">Filtered Export</h2>
            <p className="mt-1 text-sm font-semibold text-muted">Downloads use the active transaction filters.</p>
          </div>
          <ExportButtons query={query} showToast={showToast} title="Transactions" />
        </div>
      </section>
      <div className="space-y-5">
        <ResourceState
          loading={useActivityEvents ? activityResource.loading : transactionResource.loading}
          error={useActivityEvents ? activityResource.error : transactionResource.error}
          empty={useActivityEvents ? !activityResource.items.length : !transactionResource.items.length && (!showSettlementEvents || !settlementResource.items.length)}
          onRetry={useActivityEvents ? activityResource.refresh : transactionResource.refresh}
          emptyMessage="No transactions match these filters."
        />
        {!(useActivityEvents ? activityResource.loading : transactionResource.loading) && activityGroupEntries(grouped).map(([group, groupItems]) => (
          <section key={group} className="space-y-3">
            <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-muted">{group}</h2>
            {groupItems.map((item) => (
              item.kind === "activity-event"
                ? <ActivityEventCard key={`activity-${item.id}`} event={item.event} onOpen={() => setSelectedSettlement({ activityEvent: item.event })} onOpenSource={() => openTransactionDetail(item.event.rootTransaction || item.event.transaction)} />
                : item.kind === "settlement"
                ? <SettlementTimelineCard key={`settlement-${item.id}`} settlement={item.settlement} onOpen={() => setSelectedSettlement(item.settlement)} />
                : <TimelineCard key={`transaction-${item.id}`} transaction={item.transaction} dashboardFilter={filters.dashboardFilter} direction={filters.direction} due={filters.due} onOpen={() => openTransactionDetail(item.transaction)} />
            ))}
          </section>
        ))}
      </div>
      <TransactionDetailSheet
        transaction={selectedTransaction}
        onClose={() => setSelectedTransaction(null)}
        onSelectPerson={(person) => {
          setSelectedTransaction(null);
          onSelectPerson?.(person);
        }}
        onOpenSettlements={(view, source) => {
          setSelectedTransaction(null);
          onOpenSettlements?.(view, source);
        }}
      />
      <SettlementActivityDetail
        settlement={selectedSettlement}
        onClose={() => setSelectedSettlement(null)}
        onOpenSource={(transaction) => {
          setSelectedSettlement(null);
          openTransactionDetail(transaction);
        }}
      />
    </ScreenShell>
  );
}

function SettlementHistoryCard({ settlement, onSelectPerson }) {
  const direction = ["PAYMENT", "PAID_BY_ME"].includes(settlement.direction) ? "paid" : "received";
  const sourceTypes = new Set((settlement.allocations || []).map((allocation) => allocation.obligation?.sourceType));
  const settlementLabel = settlement.status === "CANCELLED" ? "Payment Reversed"
    : direction === "paid" && sourceTypes.size === 1 && sourceTypes.has("BORROW") ? "Loan Repayment"
      : direction === "received" && sourceTypes.size === 1 && sourceTypes.has("LEND") ? "Loan Received Back"
        : direction === "paid" ? "Payment Made" : "Payment Received";
  const settlementTone = settlement.status === "CANCELLED" ? "bg-paper text-muted" : direction === "paid" ? "bg-coralSoft text-coral" : "bg-emeraldSoft text-emerald";
  return (
    <article className="rounded-3xl bg-cream p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <button onClick={() => settlement.person && onSelectPerson?.(settlement.person)} className="text-left text-sm font-bold text-primary">
            {settlement.person?.name || "Settlement"}
          </button>
          <p className="mt-1 text-xs font-semibold text-muted">{direction === "paid" ? "Paid to" : "Received from"} {settlement.person?.name || "person"} · {settlement.account?.name || "Account"} · {formatSettlementDateTime(settlement)}</p>
        </div>
        <div className="text-right">
          <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${settlementTone}`}>{settlementLabel}</span>
          <b className={`mt-2 block ${direction === "paid" ? "text-coral" : "text-emerald"}`}>{direction === "paid" ? "−" : "+"}{formatCurrency(settlement.totalAmount ?? settlement.amount)}</b>
        </div>
      </div>
      <div className="mt-3 space-y-1 border-t border-line pt-2">
        {settlement.allocations?.map((allocation) => {
          const reversed = allocation.eventType === "SETTLEMENT_REVERSED";
          const hasRemainingSnapshot = allocation.remainingAfter != null;
          const partial = hasRemainingSnapshot
            ? Number(allocation.remainingAfter) > 0
            : allocation.statusAfter === "PARTIALLY_SETTLED";
          const settled = hasRemainingSnapshot
            ? Number(allocation.remainingAfter) <= 0
            : allocation.statusAfter === "SETTLED";
          const stateLabel = reversed ? "Reversed"
            : partial ? direction === "paid" ? "Partial Payment" : "Partial Receipt"
              : settled ? "Settled" : "Payment";
          const stateTone = reversed ? "bg-paper text-muted"
            : partial ? "bg-amberSoft text-amber"
              : settled ? "bg-emeraldSoft text-emerald" : "bg-paper text-muted";
          return (
            <div key={allocation._id} className="flex justify-between gap-3 text-xs">
              <span className="min-w-0">
                <span className={`mr-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${stateTone}`}>
                  {stateLabel}
                </span>
                {allocation.obligation?.sourceTransaction?.note || obligationSystemLabel(allocation.obligation) || "Payment record"}
                {hasRemainingSnapshot && <span className="mt-1 block text-muted">Remaining {formatCurrency(allocation.remainingAfter)}</span>}
              </span>
              <span className="shrink-0 font-semibold">{formatCurrency(allocation.amount)}</span>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function TimelineCard({ transaction, dashboardFilter, direction, due, onOpen }) {
  const meta = transactionMeta(transaction);
  const Icon = meta.icon;
  const systemTag = transactionSystemTag(transaction, meta);
  const tagStyle = stateStyles[systemTag.state] || stateStyles.neutral;
  const outstandingView = ["to_receive", "to_pay", "lent_outstanding", "paid_for_someone_outstanding", "borrowed_outstanding", "someone_paid_for_me_outstanding"].includes(dashboardFilter) || Boolean(direction && due);
  const displayAmount = outstandingView && transaction.remainingAmount != null
    ? formatCurrency(transaction.remainingAmount)
    : meta.amount;
  return (
    <article onClick={onOpen} onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpen();
      }
    }} role="button" tabIndex={0} className="cursor-pointer rounded-3xl bg-cream p-4 shadow-card transition hover:-translate-y-0.5 hover:shadow-soft">
      <div className="flex items-center gap-3">
        <div className={`grid size-11 shrink-0 place-items-center rounded-full border ${stateStyles[meta.state]}`}>
          <Icon size={19} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate font-bold leading-tight">{meta.title}</h3>
              <p className="mt-1 truncate text-sm font-semibold text-muted">{activitySubtitle(transaction, meta)}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className={`text-base font-bold ${meta.amountClass}`}>{displayAmount}</p>
              <p className="mt-1 text-[11px] font-semibold text-muted">{formatActivityDateTime(transaction)}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${stateStyles[meta.state] || stateStyles.neutral}`}>
              {meta.label}
            </span>
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${tagStyle}`}>
              {systemTag.label}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}

function SettlementTimelineCard({ settlement, onOpen }) {
  const paid = ["PAYMENT", "PAID_BY_ME"].includes(settlement.direction);
  const Icon = paid ? ArrowUpRight : ArrowDownLeft;
  const amount = formatCurrency(settlement.totalAmount ?? settlement.amount);
  return (
    <article onClick={onOpen} onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpen();
      }
    }} role="button" tabIndex={0} className="cursor-pointer rounded-3xl bg-cream p-4 shadow-card transition hover:-translate-y-0.5 hover:shadow-soft">
      <div className="flex items-center gap-3">
        <div className={`grid size-11 shrink-0 place-items-center rounded-full border ${paid ? stateStyles.pay : stateStyles.receive}`}>
          <Icon size={19} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate font-bold leading-tight">{paid ? `Paid to ${settlement.person?.name || "person"}` : `Received from ${settlement.person?.name || "person"}`}</h3>
              <p className="mt-1 truncate text-sm font-semibold text-muted">{settlement.account?.name || "Account unavailable"}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className={`text-base font-bold ${paid ? "text-coral" : "text-emerald"}`}>{paid ? "-" : "+"}{amount}</p>
              <p className="mt-1 text-[11px] font-semibold text-muted">{formatSettlementDateTime(settlement)}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${paid ? stateStyles.pay : stateStyles.receive}`}>
              {paid ? "Repayment Paid" : "Receipt Received"}
            </span>
            <span className="rounded-full border px-2.5 py-1 text-[11px] font-bold bg-emeraldSoft text-emerald border-emerald/10">
              Linked
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}

function ActivityEventCard({ event, onOpen, onOpenSource }) {
  const outgoing = event.direction === "OUT";
  const incoming = event.direction === "IN";
  const amountClass = outgoing ? "text-coral" : incoming ? "text-emerald" : "text-primary";
  const title = activityEventTitle(event);
  const subtitle = activityEventSubtitle(event);
  const showSource = event.eventType === "SETTLEMENT_ALLOCATED" && (event.rootTransaction?._id || event.rootTransaction);
  const Icon = event.eventType === "SETTLEMENT_ALLOCATED" ? CheckCircle2
    : event.eventType === "SETTLEMENT_REVERSED" || event.eventType === "TRANSACTION_CANCELLED" ? X
      : event.metadata?.transactionType === "TRANSFER" ? Landmark
        : event.direction === "PAYABLE" ? ArrowUpRight
          : event.direction === "RECEIVABLE" ? ArrowDownLeft
            : Receipt;
  const tone = outgoing ? stateStyles.pay : incoming ? stateStyles.receive : event.direction === "PAYABLE" ? stateStyles.borrowed : event.direction === "RECEIVABLE" ? stateStyles.owed : stateStyles.neutral;
  return (
    <article onClick={onOpen} onKeyDown={(keyboardEvent) => {
      if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
        keyboardEvent.preventDefault();
        onOpen();
      }
    }} role="button" tabIndex={0} className="cursor-pointer rounded-3xl bg-cream p-4 shadow-card transition hover:-translate-y-0.5 hover:shadow-soft">
      <div className="flex items-center gap-3">
        <div className={`grid size-11 shrink-0 place-items-center rounded-full border ${tone}`}>
          <Icon size={19} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate font-bold leading-tight">{title}</h3>
              <p className="mt-1 truncate text-sm font-semibold text-muted">{subtitle}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className={`text-base font-bold ${amountClass}`}>{outgoing ? "-" : incoming ? "+" : ""}{formatCurrency(event.amount)}</p>
              <p className="mt-1 text-[11px] font-semibold text-muted">{formatEventDateTime(event.occurredAt)}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${tone}`}>{activityEventLabel(event)}</span>
            {event.remainingAfter != null && <span className="rounded-full border px-2.5 py-1 text-[11px] font-bold bg-paper text-muted border-muted/10">Remaining {formatCurrency(event.remainingAfter)}</span>}
            {showSource && (
              <button
                type="button"
                onClick={(clickEvent) => {
                  clickEvent.stopPropagation();
                  onOpenSource?.();
                }}
                className="rounded-full bg-violetSoft px-3 py-1 text-[11px] font-bold text-primary"
              >
                View Source
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function activityEventLabel(event) {
  if (event.eventType === "SETTLEMENT_ALLOCATED") return event.direction === "OUT" ? "Loan Repayment" : "Payment Received";
  if (event.eventType === "SETTLEMENT_REVERSED") return "Reversed";
  if (event.eventType === "TRANSACTION_CANCELLED") return "Cancelled";
  if (event.systemLabel && /notification/i.test(event.systemLabel)) return sourceTypeLabel(event.metadata?.sourceType || event.metadata?.transactionType);
  return event.systemLabel || sourceTypeLabel(event.metadata?.sourceType || event.metadata?.transactionType);
}

function activityEventTitle(event) {
  const personName = event.person?.name;
  if (event.eventType === "SETTLEMENT_ALLOCATED") {
    if (event.direction === "OUT") return `Paid ${formatCurrency(event.amount)} to ${personName || "person"}`;
    if (event.direction === "IN") return `${formatCurrency(event.amount)} received from ${personName || "person"}`;
  }
  if (event.metadata?.transactionType === "BORROW" && personName) return `Borrowed from ${personName}`;
  if (event.metadata?.transactionType === "LEND" && personName) return `Lent to ${personName}`;
  if (event.metadata?.transactionType === "PAID_FOR_SOMEONE" && personName) return `Paid for ${personName}`;
  if (event.metadata?.transactionType === "PAID_BY_SOMEONE" && personName) return `${personName} paid for me`;
  return event.title || event.systemLabel;
}

function activityEventSubtitle(event) {
  if (event.eventType === "SETTLEMENT_ALLOCATED" && event.rootTransaction) {
    const source = paymentSourcePhrase(event);
    const original = event.originalAmount ?? event.rootTransaction?.originalAmount ?? event.rootTransaction?.amount;
    const date = event.rootTransaction?.transactionDate ? formatShortDate(event.rootTransaction.transactionDate) : "original date";
    const accountText = event.account?.name ? `${event.direction === "IN" ? "Into" : "From"}: ${event.account.name}` : "";
    return [accountText, `Against: ${source} ${formatCurrency(original)} · ${date}`].filter(Boolean).join(" · ");
  }
  if (event.metadata?.transactionType === "TRANSFER" && event.rootTransaction?.destinationAccount?.name) {
    return `To ${event.rootTransaction.destinationAccount.name}`;
  }
  return event.subtitle || event.person?.name || event.systemLabel;
}

function paymentSourcePhrase(event) {
  const personName = event.person?.name || "person";
  const sourceType = event.obligation?.sourceType || event.metadata?.sourceType || event.rootTransaction?.type;
  return ({
    BORROW: `Loan from ${personName}`,
    LEND: `Loan to ${personName}`,
    PAID_FOR_SOMEONE: `Paid for ${personName}`,
    PAID_BY_SOMEONE: `${personName} paid for me`,
    SPLIT_SHARE: `Split expense with ${personName}`
  })[sourceType] || sourceTypeLabel(sourceType);
}

function SettlementActivityDetail({ settlement, onClose, onOpenSource }) {
  if (!settlement) return null;
  if (settlement.activityEvent) return <ActivityEventDetail event={settlement.activityEvent} onClose={onClose} onOpenSource={onOpenSource} />;
  const paid = ["PAYMENT", "PAID_BY_ME"].includes(settlement.direction);
  const amount = formatCurrency(settlement.totalAmount ?? settlement.amount);
  return (
    <div className="fixed inset-0 z-[60] flex items-end bg-charcoal/25 px-0 md:items-center md:justify-center md:p-6" onClick={onClose}>
      <section className="max-h-[92vh] w-full overflow-y-auto rounded-t-[2rem] bg-paper p-5 shadow-soft md:max-w-2xl md:rounded-[2rem]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Payment Event</p>
            <h2 className="mt-1 text-xl font-bold">{paid ? `Paid to ${settlement.person?.name || "person"}` : `Received from ${settlement.person?.name || "person"}`}</h2>
            <p className={`mt-2 text-3xl font-bold ${paid ? "text-coral" : "text-emerald"}`}>{paid ? "-" : "+"}{amount}</p>
          </div>
          <button type="button" onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-2xl bg-cream text-muted shadow-card">
            <X size={18} />
          </button>
        </div>
        <ReceiptSection title="Payment Details">
          <ReceiptRow label="Type" value={paid ? "Repayment Paid" : "Receipt Received"} />
          <ReceiptRow label="Person" value={settlement.person?.name || "Unknown person"} />
          <ReceiptRow label="Account" value={settlement.account?.name || "Account unavailable"} />
          <ReceiptRow label="Date / Time" value={formatSettlementDateTime(settlement)} />
          <ReceiptRow label="Note" value={settlement.note || "No note"} />
        </ReceiptSection>
        <ReceiptSection title="Linked Payment Records">
          {settlement.allocations?.length ? settlement.allocations.map((allocation) => (
            <ReceiptRow
              key={allocation._id}
              label={allocation.obligation?.sourceTransaction?.note || sourceTypeLabel(allocation.obligation?.sourceType)}
              value={`${formatCurrency(allocation.amount)} · Remaining ${formatCurrency(allocation.remainingAfter ?? allocation.obligation?.remainingAmount)}`}
            />
          )) : <ReceiptRow label="Records" value="No linked payment details available" />}
        </ReceiptSection>
      </section>
    </div>
  );
}

function ActivityEventDetail({ event, onClose, onOpenSource }) {
  const outgoing = event.direction === "OUT";
  const incoming = event.direction === "IN";
  const isPaymentEvent = event.eventType === "SETTLEMENT_ALLOCATED";
  const sourceTransaction = event.rootTransaction || event.transaction;
  return (
    <div className="fixed inset-0 z-[60] flex items-end bg-charcoal/25 px-0 md:items-center md:justify-center md:p-6" onClick={onClose}>
      <section className="max-h-[92vh] w-full overflow-y-auto rounded-t-[2rem] bg-paper p-5 shadow-soft md:max-w-2xl md:rounded-[2rem]" onClick={(clickEvent) => clickEvent.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted">{activityEventLabel(event)}</p>
            <h2 className="mt-1 text-xl font-bold">{activityEventTitle(event)}</h2>
            <p className={`mt-2 text-3xl font-bold ${outgoing ? "text-coral" : incoming ? "text-emerald" : "text-primary"}`}>{outgoing ? "-" : incoming ? "+" : ""}{formatCurrency(event.amount)}</p>
          </div>
          <button type="button" onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-2xl bg-cream text-muted shadow-card">
            <X size={18} />
          </button>
        </div>
        <ReceiptSection title={isPaymentEvent && incoming ? "Receipt Details" : isPaymentEvent ? "Payment Details" : "Transaction Details"}>
          <ReceiptRow label="Reference" value={activityReference(event)} />
          <ReceiptRow label="Date / Time" value={formatEventDateTime(event.occurredAt)} />
          <ReceiptRow label="Person" value={event.person?.name || "Not applicable"} />
          <ReceiptRow label={incoming ? "Into" : outgoing ? "From" : "Account"} value={event.account?.name || "Not applicable"} />
          {event.note && <ReceiptRow label="Note" value={event.note} />}
        </ReceiptSection>
        {isPaymentEvent ? (
          <ReceiptSection title="Against">
            <ReceiptRow label="Source" value={`${paymentSourcePhrase(event)} ${formatCurrency(event.originalAmount ?? sourceTransaction?.amount)}`} />
            <ReceiptRow label="Source date" value={sourceTransaction?.transactionDate ? formatShortDate(sourceTransaction.transactionDate) : "Not available"} />
            <ReceiptRow label="Remaining" value={event.remainingAfter != null ? formatCurrency(event.remainingAfter) : "Not available"} />
            <ReceiptRow label="Status" value={friendlyPaymentStatus(event.statusAfter, event.obligation?.direction || event.direction)} />
            {sourceTransaction && (
              <div className="py-2.5">
                <button
                  type="button"
                  onClick={() => onOpenSource?.(sourceTransaction)}
                  className="rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white"
                >
                  View Source Transaction
                </button>
              </div>
            )}
          </ReceiptSection>
        ) : (
          <ReceiptSection title="Transaction History">
            <PaymentTimelineEntry
              tone={incoming ? "receive" : outgoing ? "pay" : "neutral"}
              title={activityEventLabel(event)}
              description={event.subtitle || activityEventTitle(event)}
              detail={event.account?.name || ""}
              amount={formatCurrency(event.amount)}
              date={event.occurredAt}
              status={friendlyPaymentStatus(event.statusAfter, event.direction)}
            />
          </ReceiptSection>
        )}
      </section>
    </div>
  );
}

function TransactionDetailSheet({ transaction, onClose, onSelectPerson, onOpenSettlements }) {
  if (!transaction) return null;
  const meta = transactionMeta(transaction);
  const Icon = meta.icon;
  const systemTag = transactionSystemTag(transaction, meta);
  const tagStyle = stateStyles[systemTag.state] || stateStyles.neutral;
  const obligation = obligationTransactionInfo(transaction);
  const linkedObligation = transaction.linkedObligation;
  const actions = transactionDetailActions(transaction, systemTag);
  const historyEntries = buildTransactionHistoryEntries(transaction, linkedObligation);
  const historyTitle = linkedObligation?.direction === "RECEIVABLE" ? "Receipt History" : linkedObligation?.direction === "PAYABLE" ? "Payment History" : "Transaction History";

  return (
    <div className="fixed inset-0 z-[60] flex items-end bg-charcoal/25 px-0 md:items-center md:justify-center md:p-6" onClick={onClose}>
      <section className="max-h-[92vh] w-full overflow-y-auto rounded-t-[2rem] bg-paper p-5 shadow-soft md:max-w-2xl md:rounded-[2rem]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className={`grid size-14 shrink-0 place-items-center rounded-full border ${stateStyles[meta.state]}`}>
              <Icon size={24} />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Transaction Detail</p>
              <h2 className="mt-1 text-xl font-bold leading-tight">{meta.title}</h2>
              <p className={`mt-2 text-3xl font-bold ${meta.amountClass}`}>{meta.amount}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-2xl bg-cream text-muted shadow-card">
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className={`rounded-full border px-3 py-1.5 text-xs font-bold ${stateStyles[meta.state] || stateStyles.neutral}`}>{meta.label}</span>
          <span className={`rounded-full border px-3 py-1.5 text-xs font-bold ${tagStyle}`}>{systemTag.label}</span>
        </div>

        <ReceiptSection title="Basic Details">
          <ReceiptRow label="Reference" value={transactionReference(transaction)} />
          <ReceiptRow label="Type" value={transactionLabel(transaction.type)} />
          <ReceiptRow label="Date" value={formatShortDate(transaction.transactionDate)} />
          <ReceiptRow label="Time" value={formatTimeValue(transaction.transactionTime) || "not set"} />
          <ReceiptRow label="Account" value={transaction.account?.name || "Account unavailable"} />
          {transaction.destinationAccount && <ReceiptRow label="To Account" value={transaction.destinationAccount.name} />}
          {transaction.person && (
            <ReceiptRow
              label="Person"
              value={transaction.person.name}
            />
          )}
          <ReceiptRow label="Category" value={transaction.category?.name || "Not added"} />
          <ReceiptRow label="Tags" value={transaction.tags?.length ? transaction.tags.map((tag) => tag.name).join(", ") : "Not added"} />
          <ReceiptRow label="Note" value={transaction.note || "No note"} />
        </ReceiptSection>

        <ReceiptSection title="Financial Effect">
          <ReceiptRow label="Main balance impact" value={meta.amount} valueClass={meta.amountClass} />
          <ReceiptRow label="To Pay impact" value={obligation?.payable ? formatCurrency(obligation.remaining) : formatCurrency(0)} valueClass={obligation?.payable && obligation.remaining > 0 ? "text-coral" : ""} />
          <ReceiptRow label="To Receive impact" value={obligation?.receivable ? formatCurrency(obligation.remaining) : formatCurrency(0)} valueClass={obligation?.receivable && obligation.remaining > 0 ? "text-emerald" : ""} />
          <ReceiptRow label="Original amount" value={formatCurrency(transaction.originalAmount ?? transaction.amount)} />
          <ReceiptRow label="Remaining amount" value={obligation ? formatCurrency(obligation.remaining) : formatCurrency(0)} />
        </ReceiptSection>

        {linkedObligation || obligation ? <ReceiptSection title="Payment Tracking">
          <ReceiptRow label="Payment tracking" value={linkedObligation || obligation ? "Linked" : "Not applicable"} />
          <ReceiptRow label="Payment history" value={linkedObligation?.events?.length ? `${linkedObligation.events.length} event${linkedObligation.events.length === 1 ? "" : "s"}` : obligation ? "Available in Settlements" : "Not applicable"} />
          <ReceiptRow label="Source transaction type" value={transactionLabel(transaction.type)} />
          {transaction.dueDate && <ReceiptRow label={obligation?.payable ? "Due date" : "Expected date"} value={formatShortDate(transaction.dueDate)} />}
        </ReceiptSection> : null}

        {historyEntries.length ? (
          <ReceiptSection title={historyTitle}>
            <div className="divide-y divide-[#E9E2D8]">
              {historyEntries.map((entry) => <PaymentTimelineEntry key={entry.id} {...entry} />)}
            </div>
          </ReceiptSection>
        ) : null}

        <div className="mt-5 rounded-3xl bg-cream p-4 shadow-card">
          <h3 className="text-sm font-bold">Action Area</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => onOpenSettlements?.(action.view, action.source)}
                className={`rounded-2xl px-4 py-3 text-sm font-bold ${action.tone}`}
              >
                {action.label}
              </button>
            ))}
            {!actions.length && <p className="text-sm font-semibold text-muted">No payment action for this transaction.</p>}
          </div>
        </div>
      </section>
    </div>
  );
}

function buildTransactionHistoryEntries(transaction, linkedObligation) {
  const entries = [sourceTransactionHistoryEntry(transaction, linkedObligation)].filter(Boolean);
  const paymentEvents = [...(linkedObligation?.events || [])]
    .filter((event) => ["SETTLEMENT_ALLOCATED", "SETTLEMENT_REVERSED"].includes(event.eventType))
    .sort((a, b) => new Date(obligationEventDate(a)).getTime() - new Date(obligationEventDate(b)).getTime())
    .map((event) => paymentHistoryEntry(event, transaction, linkedObligation));
  return [...entries, ...paymentEvents];
}

function sourceTransactionHistoryEntry(transaction, linkedObligation) {
  const personName = transaction.person?.name || "person";
  const accountName = transaction.account?.name || "Account unavailable";
  const amount = formatCurrency(transaction.originalAmount ?? transaction.amount);
  const date = transactionDateTime(transaction);
  if (transaction.type === "BORROW") {
    return {
      id: `source-${transaction._id}`,
      tone: "borrowed",
      title: `Loan taken from ${personName}`,
      description: `${amount} received in ${accountName}`,
      detail: `Amount to repay: ${formatCurrency(linkedObligation?.originalAmount ?? transaction.originalAmount ?? transaction.amount)}`,
      amount,
      date
    };
  }
  if (transaction.type === "LEND") {
    return {
      id: `source-${transaction._id}`,
      tone: "pay",
      title: `Loan given to ${personName}`,
      description: `${amount} paid from ${accountName}`,
      detail: `Amount to receive: ${formatCurrency(linkedObligation?.originalAmount ?? transaction.originalAmount ?? transaction.amount)}`,
      amount,
      date
    };
  }
  if (transaction.type === "PAID_FOR_SOMEONE") {
    return {
      id: `source-${transaction._id}`,
      tone: "pay",
      title: `Paid for ${personName}`,
      description: `${amount} paid from ${accountName}`,
      detail: `Amount to receive: ${formatCurrency(linkedObligation?.originalAmount ?? transaction.originalAmount ?? transaction.amount)}`,
      amount,
      date
    };
  }
  if (transaction.type === "PAID_BY_SOMEONE") {
    return {
      id: `source-${transaction._id}`,
      tone: "borrowed",
      title: `${personName} paid for me`,
      description: `${amount} paid by ${personName}`,
      detail: `Amount to repay: ${formatCurrency(linkedObligation?.originalAmount ?? transaction.originalAmount ?? transaction.amount)}`,
      amount,
      date
    };
  }
  if (transaction.type === "TRANSFER") {
    return {
      id: `source-${transaction._id}`,
      tone: "neutral",
      title: "Transfer",
      description: `${amount} moved from ${accountName}`,
      detail: transaction.destinationAccount?.name ? `To ${transaction.destinationAccount.name}` : "",
      amount,
      date
    };
  }
  return {
    id: `source-${transaction._id}`,
    tone: transaction.type === "INCOME" ? "receive" : transaction.type === "EXPENSE" ? "pay" : "neutral",
    title: transactionLabel(transaction.type),
    description: transaction.note || transaction.category?.name || transactionLabel(transaction.type),
    detail: accountName,
    amount,
    date,
    status: transaction.status === "CANCELLED" ? "Cancelled" : ""
  };
}

function paymentHistoryEntry(event, transaction, linkedObligation) {
  const payable = linkedObligation?.direction === "PAYABLE";
  const personName = transaction.person?.name || "person";
  const settlement = event.settlement || {};
  const accountName = settlement.account?.name || transaction.account?.name || "Account unavailable";
  const reversed = event.eventType === "SETTLEMENT_REVERSED" || settlement.status === "CANCELLED";
  const amount = formatCurrency(event.amount || 0);
  return {
    id: event._id,
    tone: reversed ? "neutral" : payable ? "pay" : "receive",
    title: reversed ? "Payment reversed" : payable ? `${amount} paid to ${personName}` : `${amount} received from ${personName}`,
    description: reversed ? `${amount} reversal recorded` : payable ? `Paid from ${accountName}` : `Received into ${accountName}`,
    detail: event.remainingAfter != null ? `Remaining: ${formatCurrency(event.remainingAfter)}` : "",
    amount,
    date: obligationEventDate(event),
    status: friendlyPaymentStatus(event.statusAfter, linkedObligation?.direction)
  };
}

function transactionDateTime(transaction) {
  const date = new Date(transaction.transactionDate || transaction.createdAt || Date.now());
  if (transaction.transactionTime) {
    const [hour, minute] = String(transaction.transactionTime).split(":").map(Number);
    date.setHours(hour || 0, minute || 0, 0, 0);
  }
  return date;
}

function obligationEventDate(event) {
  if (event.settlement?.settlementDate) {
    const date = new Date(event.settlement.settlementDate);
    if (event.settlement.settlementTime) {
      const [hour, minute] = String(event.settlement.settlementTime).split(":").map(Number);
      date.setHours(hour || 0, minute || 0, 0, 0);
    }
    return date;
  }
  return event.createdAt || new Date();
}

function ReceiptSection({ title, children }) {
  return (
    <section className="mt-5 rounded-3xl bg-cream p-4 shadow-card">
      <h3 className="text-sm font-bold">{title}</h3>
      <div className="mt-3 divide-y divide-[#E9E2D8]">{children}</div>
    </section>
  );
}

function ReceiptRow({ label, value, valueClass = "" }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <span className="shrink-0 font-semibold text-muted">{label}</span>
      <span className={`min-w-0 text-right font-bold ${valueClass}`}>{value}</span>
    </div>
  );
}

function PaymentTimelineEntry({ tone = "neutral", title, description, detail, amount, date, status }) {
  const toneClass = tone === "receive" ? "bg-emeraldSoft text-emerald"
    : tone === "pay" ? "bg-coralSoft text-coral"
      : tone === "borrowed" ? "bg-amberSoft text-amber"
        : "bg-paper text-muted";
  return (
    <div className="flex gap-3 py-3">
      <span className={`mt-1 size-3 shrink-0 rounded-full ${tone === "receive" ? "bg-emerald" : tone === "pay" ? "bg-coral" : tone === "borrowed" ? "bg-amber" : "bg-muted"}`} />
      <div className="min-w-0 flex-1 rounded-2xl bg-paper p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold text-muted">{formatEventDateTime(date)}</p>
            <h4 className="mt-1 text-sm font-bold text-charcoal">{title}</h4>
            {description && <p className="mt-1 text-sm font-semibold text-muted">{description}</p>}
            {detail && <p className="mt-1 text-xs font-bold text-muted">{detail}</p>}
          </div>
          {amount && <span className={`rounded-full px-3 py-1 text-xs font-bold ${toneClass}`}>{amount}</span>}
        </div>
        {status && <p className="mt-2 text-xs font-bold text-muted">Status: {status}</p>}
      </div>
    </div>
  );
}

function transactionEventLabel(event) {
  if (event.eventType === "CREATED") return "Record created";
  if (event.eventType === "SETTLEMENT_ALLOCATED") {
    const accountName = event.settlement?.account?.name;
    return accountName ? `Payment · ${accountName}` : "Payment";
  }
  if (event.eventType === "SETTLEMENT_REVERSED") return "Payment reversed";
  if (event.eventType === "CANCELLED") return "Cancelled";
  return "Status update";
}

function friendlyPaymentStatus(status, direction) {
  if (!status) return "";
  if (status === "SETTLED") return "Settled";
  if (status === "PARTIALLY_SETTLED" || status === "PARTIAL") return direction === "RECEIVABLE" || direction === "IN" ? "Partially Received" : "Partially Paid";
  if (status === "OVERDUE") return "Overdue";
  if (status === "CANCELLED") return "Cancelled";
  if (status === "PENDING") return "Pending";
  if (status === "ACTIVE") return "Recorded";
  return String(status).replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function compactDateKey(value) {
  const date = value ? new Date(value) : new Date();
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function friendlyRefSuffix(id) {
  const text = String(id || "");
  return (text.slice(-3) || "001").toUpperCase();
}

function transactionReference(transaction) {
  const type = transaction?.type || transaction?.metadata?.transactionType;
  const prefix = {
    BORROW: "LOAN",
    LEND: "LEND",
    PAID_FOR_SOMEONE: "PAY",
    PAID_BY_SOMEONE: "DUE",
    SPLIT_EXPENSE: "SPLIT",
    EXPENSE: "EXP",
    INCOME: "INC",
    TRANSFER: "TRF",
    BALANCE_ADJUSTMENT: "ADJ"
  }[type] || "TXN";
  return `${prefix}-${compactDateKey(transaction?.transactionDate || transaction?.occurredAt || transaction?.createdAt)}-${friendlyRefSuffix(transaction?._id || transaction?.id)}`;
}

function activityReference(event) {
  const prefix = event.eventType === "SETTLEMENT_ALLOCATED"
    ? event.direction === "IN" ? "REC" : "PAY"
    : event.eventType === "SETTLEMENT_REVERSED" ? "REV"
      : event.eventType === "TRANSACTION_CANCELLED" ? "CAN"
        : transactionReference({ type: event.metadata?.transactionType || event.metadata?.sourceType, transactionDate: event.occurredAt, _id: event._id }).split("-")[0];
  return `${prefix}-${compactDateKey(event.occurredAt)}-${friendlyRefSuffix(event.settlement?._id || event._id)}`;
}

function obligationTransactionInfo(transaction) {
  const payable = transaction.type === "BORROW" || transaction.type === "PAID_BY_SOMEONE";
  const receivable = transaction.type === "LEND" || transaction.type === "PAID_FOR_SOMEONE";
  if (!payable && !receivable) return null;
  const original = Number(transaction.originalAmount ?? transaction.amount ?? 0);
  const remaining = Number(transaction.remainingAmount ?? original);
  return { payable, receivable, original, remaining };
}

function transactionDetailActions(transaction, systemTag) {
  const obligation = obligationTransactionInfo(transaction);
  if (!obligation) return [];
  const source = transaction.type === "PAID_FOR_SOMEONE" ? "PAID_FOR_SOMEONE_AND_SPLIT" : transaction.type;
  const view = obligation.payable ? "to-pay" : "to-receive";
  const settleTone = obligation.payable ? "bg-coral text-white" : "bg-emerald text-white";
  const historyAction = { label: "View History", view: "settled", source, tone: "bg-paper text-primary" };

  if (systemTag.state === "settled" || obligation.remaining <= 0) {
    return [{ label: "Settled", view: "settled", source, tone: "bg-emeraldSoft text-emerald" }, historyAction];
  }
  if (systemTag.state === "partial") {
    return [
      { label: obligation.payable ? "Pay More" : "Receive More", view, source, tone: settleTone },
      historyAction
    ];
  }
  return [{ label: obligation.payable ? "Pay Now" : "Receive Now", view, source, tone: settleTone }];
}

function PeopleScreen({ refreshKey = 0, onSelectPerson }) {
  const peopleResource = useResource("people", {}, refreshKey);
  const [editing, setEditing] = useState(null);
  const [formOpen, setFormOpen] = useState(false);

  return (
    <ScreenShell className="space-y-5">
      <PageHeader icon={Users} title="People" subtitle="Shared money, kept simple" />
      <section className="rounded-3xl bg-cream p-5 shadow-card">
        <p className="text-sm font-semibold text-muted">Master contacts</p>
        <div className="mt-2 flex items-end justify-between">
          <h2 className="text-4xl font-bold tracking-tight text-primary">{peopleResource.items.length}</h2>
          <button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="rounded-full bg-primary px-4 py-2 text-xs font-bold text-white"
          >
            Add Person
          </button>
        </div>
      </section>

      <section>
        <SectionTitle title="People List" />
        <ResourceState loading={peopleResource.loading} error={peopleResource.error} empty={!peopleResource.items.length} onRetry={peopleResource.refresh} />
        <div className="mt-3 space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0 xl:grid-cols-3">
          {peopleResource.items.map((person) => (
            <PersonCard
              key={person._id}
              person={person}
              onClick={() => onSelectPerson(person)}
              onEdit={() => {
                setEditing(person);
                setFormOpen(true);
              }}
              onDelete={() => peopleResource.remove(person._id)}
            />
          ))}
        </div>
      </section>

      <PersonFormSheet
        open={formOpen}
        person={editing}
        onClose={() => setFormOpen(false)}
        onSave={async (payload) => {
          await peopleResource.save(payload, editing?._id);
          setFormOpen(false);
        }}
      />
    </ScreenShell>
  );
}

function PersonCard({ person, onClick, onEdit, onDelete }) {
  const positive = (person.rawBalance || 0) >= 0;
  return (
    <article className="flex w-full items-center gap-3 rounded-3xl bg-cream p-4 text-left shadow-card">
      <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <Avatar person={person} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-bold">{person.name}</h3>
          <p className="truncate text-sm font-semibold text-muted">{person.note || person.phone || person.email || "No note added"}</p>
        </div>
        {person.balance ? (
          <div className="text-right">
            <p className={`font-bold ${positive ? "text-emerald" : "text-coral"}`}>{person.balance}</p>
            <ChevronRight className="ml-auto mt-1 text-muted" size={18} />
          </div>
        ) : (
          <ChevronRight className="text-muted" size={18} />
        )}
      </button>
      {onEdit && (
        <button onClick={onEdit} className="grid size-9 place-items-center rounded-2xl bg-violetSoft text-primary">
          <Edit3 size={17} />
        </button>
      )}
      {onDelete && (
        <button onClick={onDelete} className="grid size-9 place-items-center rounded-2xl bg-coralSoft text-coral">
          <Trash2 size={17} />
        </button>
      )}
    </article>
  );
}

function PersonDetail({ person, refreshKey = 0, onBack, onFinancialChange }) {
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settleOpen, setSettleOpen] = useState(false);
  const [initialSettleObligationId, setInitialSettleObligationId] = useState("");
  const [settleObligations, setSettleObligations] = useState([]);
  const [settleTitle, setSettleTitle] = useState("Settle Up");
  const [settleExactObligation, setSettleExactObligation] = useState(false);
  const [settleAgainstLabel, setSettleAgainstLabel] = useState("");
  const [openObligationVersion, setOpenObligationVersion] = useState(0);
  const [detailObligationId, setDetailObligationId] = useState("");
  const [detailObligationData, setDetailObligationData] = useState(null);
  const defaultLedgerFilters = { ledgerType: "", balanceStatus: "", startDate: "", endDate: "", account: "", sort: "newest" };
  const [filters, setFilters] = useState(defaultLedgerFilters);
  const [draftFilters, setDraftFilters] = useState(defaultLedgerFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterButtonRef = useRef(null);
  const query = useMemo(() => buildPersonLedgerQuery(filters), [filters]);
  const accounts = useResource("accounts");
  const allObligations = useResource("obligations", { person: person._id }, `${refreshKey}:${openObligationVersion}`);

  const loadLedger = async () => {
    setLoading(true);
    setError("");
    try {
      setLedger(await api.personLedger(person._id, query));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLedger();
  }, [person._id, JSON.stringify(query), refreshKey]);

  useEffect(() => {
    if (!detailObligationId) return undefined;
    let alive = true;
    const ledgerItem = ledger?.obligations?.find((item) => item._id === detailObligationId);
    if (ledgerItem) {
      setDetailObligationData(ledgerItem);
    } else {
      api.obligation(detailObligationId)
        .then((data) => {
          if (alive && String(data.obligation?.person?._id || data.obligation?.person) === String(person._id)) {
            setDetailObligationData({ ...data.obligation, settlements: data.allocations || [], events: data.events || [] });
          }
        })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, [detailObligationId, ledger, person._id]);

  const summary = ledger?.summary || {
    totalToReceive: 0,
    totalToPay: 0,
    netBalance: 0,
    pendingAmount: 0,
    settledAmount: 0,
    overduePayableAmount: 0,
    overdueReceivableAmount: 0
  };
  const positive = summary.netBalance >= 0;
  const openObligations = allObligations.items.filter((item) => Number(item.remainingAmount || 0) > 0 && !["SETTLED", "CANCELLED"].includes(item.status));
  const detailObligation = ledger?.obligations?.find((item) => item._id === detailObligationId)
    || (String(detailObligationData?._id) === String(detailObligationId) ? detailObligationData : null);
  const openAmount = Number(summary.totalToPay || 0) + Number(summary.totalToReceive || 0);
  const applyMetricFilter = (kind) => {
    const next = { ...defaultLedgerFilters };
    if (kind === "receive") next.ledgerType = "to_receive";
    if (kind === "pay") next.ledgerType = "to_pay";
    if (kind === "pending") next.balanceStatus = "open";
    if (kind === "settled") { next.ledgerType = "history"; next.balanceStatus = "settled"; }
    if (kind === "overdue_pay") next.balanceStatus = "overdue_payable";
    if (kind === "overdue_receive") next.balanceStatus = "overdue_receivable";
    setFilters(next);
    setDraftFilters(next);
  };
  const openPersonTab = (tab) => {
    const next = { ...defaultLedgerFilters };
    if (tab === "to_pay") next.ledgerType = "to_pay";
    if (tab === "to_receive") next.ledgerType = "to_receive";
    if (tab === "settled") {
      next.ledgerType = "history";
      next.balanceStatus = "settled";
    }
    if (tab === "history") next.ledgerType = "history";
    setFilters(next);
    setDraftFilters(next);
  };
  const activePersonTab = filters.balanceStatus === "settled"
    ? "settled"
    : filters.ledgerType === "to_pay"
      ? "to_pay"
      : filters.ledgerType === "to_receive"
        ? "to_receive"
        : "history";
  const openSettlementSheet = (items, title, exactObligation) => {
    if (!items.length) return;
    setSettleObligations(items);
    setInitialSettleObligationId(exactObligation ? items[0]._id : "");
    setSettleTitle(title);
    setSettleExactObligation(exactObligation);
    setSettleAgainstLabel(exactObligation ? personObligationHeading(items[0], person.name) : "");
    setSettleOpen(true);
  };
  const openSettleUp = () => {
    if (openAmount <= 0 || !openObligations.length || allObligations.loading) return;
    openSettlementSheet(openObligations, "Settle Up", false);
  };
  const startDirectSettlement = (item) => {
    if (Number(item.remainingAmount || 0) <= 0 || ["SETTLED", "CANCELLED"].includes(item.status)) return;
    openSettlementSheet([item], item.direction === "PAYABLE" ? `Pay ${person.name}` : `Receive from ${person.name}`, true);
  };
  const ledgerTypeLabels = {
    to_receive: "To Receive", to_pay: "To Pay", loan: "Loan", borrowed: "Loan Taken", lent: "Lend",
    paid_for_someone: "Paid for Someone", someone_paid_for_me: "Someone Paid for Me", history: "History"
  };
  const balanceStatusLabels = {
    open: "Pending", pending: "Pending", partial: "Partial", settled: "Settled",
    overdue: "Overdue", overdue_payable: "Overdue to Pay", overdue_receivable: "Overdue to Receive"
  };
  const setLedgerFilter = (key, value) => {
    const next = { ...draftFilters, [key]: value };
    if (key === "ledgerType" && value) next.balanceStatus = "";
    if (key === "balanceStatus" && value === "overdue_payable") next.ledgerType = "to_pay";
    if (key === "balanceStatus" && value === "overdue_receivable") next.ledgerType = "to_receive";
    setDraftFilters(next);
  };

  return (
    <ScreenShell className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="grid size-11 place-items-center rounded-2xl bg-cream shadow-card">
          <ChevronLeft size={22} />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">{person.name}</h1>
          <p className="text-sm font-semibold text-muted">Personal ledger</p>
        </div>
      </div>
      <section className="rounded-3xl bg-cream p-5 text-center shadow-card">
        <Avatar person={person} large />
        <p className="mt-4 text-sm font-semibold text-muted">{positive ? "Net to receive" : "Net to pay"}</p>
        <h2 className={`mt-1 text-4xl font-bold tracking-tight ${positive ? "text-emerald" : "text-coral"}`}>
          {formatCurrency(Math.abs(summary.netBalance))}
        </h2>
        {!ledger && loading ? (
          <p className="mt-5 rounded-2xl bg-paper px-4 py-3 text-sm font-semibold text-muted">Loading open balances…</p>
        ) : !ledger ? (
          <p className="mt-5 rounded-2xl bg-paper px-4 py-3 text-sm font-semibold text-muted">Settlement status is unavailable.</p>
        ) : openAmount > 0 ? (
          <button
            type="button"
            onClick={openSettleUp}
            disabled={!openObligations.length || allObligations.loading}
            className="mt-5 inline-flex items-center justify-center gap-2 rounded-2xl bg-emeraldSoft px-5 py-3 text-sm font-bold text-emerald disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CheckCircle2 size={18} /> Settle Up
          </button>
        ) : (
          <p className="mt-5 rounded-2xl bg-paper px-4 py-3 text-sm font-semibold text-muted">Nothing to settle. All payments with this person are settled.</p>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <LedgerMetric label="To Receive" value={summary.totalToReceive} tone="emerald" active={filters.ledgerType === "to_receive" && !filters.balanceStatus} onClick={() => applyMetricFilter("receive")} />
        <LedgerMetric label="To Pay" value={summary.totalToPay} tone="coral" active={filters.ledgerType === "to_pay" && !filters.balanceStatus} onClick={() => applyMetricFilter("pay")} />
        <LedgerMetric label="Pending" value={summary.pendingAmount} tone="amber" active={filters.balanceStatus === "open"} onClick={() => applyMetricFilter("pending")} />
        <LedgerMetric label="Settled" value={summary.settledAmount} tone="income" active={filters.balanceStatus === "settled"} onClick={() => applyMetricFilter("settled")} />
        <LedgerMetric label="Overdue to Pay" value={summary.overduePayableAmount} tone="coral" active={filters.balanceStatus === "overdue_payable"} onClick={() => applyMetricFilter("overdue_pay")} />
        <LedgerMetric label="Overdue to Receive" value={summary.overdueReceivableAmount} tone="emerald" active={filters.balanceStatus === "overdue_receivable"} onClick={() => applyMetricFilter("overdue_receive")} />
      </div>

      <section className="rounded-3xl bg-cream p-3 shadow-card">
        <div className="grid grid-cols-4 gap-2">
          {[
            { id: "to_pay", label: "To Pay" },
            { id: "to_receive", label: "To Receive" },
            { id: "settled", label: "Settled" },
            { id: "history", label: "History" }
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => openPersonTab(item.id)}
              className={`rounded-2xl px-2 py-2.5 text-xs font-bold ${activePersonTab === item.id ? "bg-primary text-white" : "bg-paper text-muted"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className="relative space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FilterButton refProp={filterButtonRef} active={filterOpen} count={Object.entries(filters).filter(([key, value]) => value && !(key === "sort" && value === "newest")).length} onClick={() => { setDraftFilters(filters); setFilterOpen((open) => !open); }}>
            <SlidersHorizontal size={16} /> Filter
          </FilterButton>
          <span className="text-xs font-semibold text-muted">{(ledger?.obligations || []).length} result{(ledger?.obligations || []).length === 1 ? "" : "s"}</span>
        </div>
        <ActiveFilterChips
          chips={[
            filters.ledgerType && { key: "ledgerType", label: ledgerTypeLabels[filters.ledgerType] || filters.ledgerType },
            filters.balanceStatus && { key: "balanceStatus", label: balanceStatusLabels[filters.balanceStatus] || filters.balanceStatus },
            filters.startDate && { key: "startDate", label: `From ${formatShortDate(filters.startDate)}` },
            filters.endDate && { key: "endDate", label: `To ${formatShortDate(filters.endDate)}` },
            filters.account && { key: "account", label: accounts.items.find((item) => item._id === filters.account)?.name || "Account" },
            filters.sort !== "newest" && { key: "sort", label: sortOptions.find((item) => item.value === filters.sort)?.label || filters.sort }
          ].filter(Boolean)}
          onRemove={(chip) => { const next = { ...filters, [chip.key]: chip.key === "sort" ? "newest" : "" }; setFilters(next); setDraftFilters(next); }}
          onClear={() => { setFilters(defaultLedgerFilters); setDraftFilters(defaultLedgerFilters); }}
        />
        <CompactPopover
          open={filterOpen}
          title="Ledger Filters"
          triggerRef={filterButtonRef}
          onClose={() => setFilterOpen(false)}
          footer={<FilterActions onReset={() => setDraftFilters(defaultLedgerFilters)} onApply={() => { setFilters(draftFilters); setFilterOpen(false); }} />}
        >
          <FilterSelect label="Ledger" value={draftFilters.ledgerType} onChange={(value) => setLedgerFilter("ledgerType", value)} options={[{ value: "", label: "All" }, { value: "to_pay", label: "To Pay" }, { value: "to_receive", label: "To Receive" }, { value: "loan", label: "Loan" }, { value: "lent", label: "Lend" }, { value: "paid_for_someone", label: "Paid for Someone" }, { value: "someone_paid_for_me", label: "Someone Paid for Me" }, { value: "history", label: "History" }]} />
          <FilterSelect label="State" value={draftFilters.balanceStatus} onChange={(value) => setLedgerFilter("balanceStatus", value)} options={[{ value: "", label: "Any State" }, { value: "open", label: "Pending" }, { value: "partial", label: "Partial" }, { value: "settled", label: "Settled" }, { value: "overdue", label: "Overdue" }, { value: "overdue_payable", label: "Overdue to Pay" }, { value: "overdue_receivable", label: "Overdue to Receive" }]} />
          <FilterSelect label="Sort" value={draftFilters.sort} onChange={(value) => setDraftFilters({ ...draftFilters, sort: value })} options={sortOptions} />
          <FilterSelect label="Account" value={draftFilters.account} onChange={(value) => setDraftFilters({ ...draftFilters, account: value })} options={resourceOptions(accounts.items, "All Accounts")} />
          <FilterSection title="Person"><p className="rounded-2xl bg-paper px-4 py-3 text-sm font-semibold text-charcoal">{person.name}</p></FilterSection>
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Start Date" type="date" value={draftFilters.startDate} onChange={(value) => setDraftFilters({ ...draftFilters, startDate: value })} />
            <FormInput label="End Date" type="date" value={draftFilters.endDate} onChange={(value) => setDraftFilters({ ...draftFilters, endDate: value })} />
          </div>
        </CompactPopover>
      </section>

      <section>
        <SectionTitle title={filters.balanceStatus === "settled" ? "Settled Payments" : filters.ledgerType === "to_receive" ? "To Receive" : filters.ledgerType === "to_pay" ? "To Pay" : "Payment Details"} />
        {ledger?.obligations?.length ? (
          <div className="mt-3 space-y-3">
            {ledger.obligations.map((item) => (
              <article key={item._id} className="rounded-3xl bg-cream p-4 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-bold">{personObligationHeading(item, person.name)}</h3>
                    <p className="mt-1 text-xs font-semibold text-muted">{obligationSystemLabel(item)} · {item.direction === "PAYABLE" ? "To Pay" : "To Receive"}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${obligationStatusTone(item)}`}>{obligationStatusLabel(item)}</span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-paper p-3">
                  <div><p className="text-[10px] font-bold uppercase text-muted">Original</p><p className="mt-1 text-xs font-bold">{formatCurrency(item.originalAmount)}</p></div>
                  <div><p className="text-[10px] font-bold uppercase text-muted">{item.direction === "PAYABLE" ? "Paid" : "Received"}</p><p className="mt-1 text-xs font-bold">{formatCurrency(item.settledAmount)}</p></div>
                  <div><p className="text-[10px] font-bold uppercase text-muted">Remaining</p><p className="mt-1 text-xs font-bold">{formatCurrency(item.remainingAmount)}</p></div>
                </div>
                <p className="mt-3 text-xs font-semibold text-muted">
                  {item.dueDate ? `${item.direction === "PAYABLE" ? "Due" : "Expected"} ${formatShortDate(item.dueDate)}` : "No due date"}
                  {item.sourceTransaction?.account?.name ? ` · ${item.sourceTransaction.account.name}` : ""}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {Number(item.remainingAmount || 0) > 0 && !["SETTLED", "CANCELLED"].includes(item.status) && (
                    <button type="button" onClick={() => startDirectSettlement(item)} className="rounded-full bg-primary px-4 py-2 text-xs font-bold text-white">
                      {item.direction === "PAYABLE" ? "Pay Now" : "Receive"}
                    </button>
                  )}
                  <button type="button" onClick={() => { setDetailObligationId(item._id); setDetailObligationData(item); }} className="rounded-full bg-violetSoft px-4 py-2 text-xs font-bold text-primary">History</button>
                </div>
              </article>
            ))}
          </div>
        ) : <p className="mt-3 rounded-2xl bg-cream p-4 text-sm font-semibold text-muted">{filters.balanceStatus === "settled" ? "No settled payments for this filter." : "No payment records match these filters."}</p>}
      </section>

      {detailObligation && (
        <section className="rounded-3xl bg-cream p-5 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase text-muted">{detailObligation.direction === "PAYABLE" ? "You have to pay" : "You have to receive"}</p>
              <h2 className="mt-1 text-lg font-bold">{detailObligation.sourceTransaction?.note || detailObligation.sourceType.replaceAll("_", " ")}</h2>
            </div>
            <button onClick={() => { setDetailObligationId(""); setDetailObligationData(null); }} className="text-sm font-bold text-primary">Close</button>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
            <div><p className="text-xs text-muted">Original</p><b>{formatCurrency(detailObligation.originalAmount)}</b></div>
            <div><p className="text-xs text-muted">{detailObligation.direction === "PAYABLE" ? "Paid" : "Received"}</p><b>{formatCurrency(detailObligation.settledAmount)}</b></div>
            <div><p className="text-xs text-muted">Remaining</p><b>{formatCurrency(detailObligation.remainingAmount)}</b></div>
          </div>
          <p className="mt-3 text-xs font-semibold text-muted">{itemDateLabel(detailObligation)} · {obligationStatusLabel(detailObligation)}</p>
          <div className="mt-4 border-t border-line pt-3">
            <p className="text-sm font-bold">History</p>
            <div className="mt-3 space-y-3">
              {buildObligationTimeline(detailObligation).map((entry) => {
                const EntryIcon = entry.icon;
                return (
                  <div key={entry.id} className="flex gap-3">
                    <span className={`mt-1 grid size-8 shrink-0 place-items-center rounded-xl ${entry.tone}`}><EntryIcon size={16} /></span>
                    <div className="min-w-0 flex-1 rounded-2xl bg-paper p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${entry.tone}`}>{entry.label}</span>
                          <p className="mt-2 text-xs font-semibold text-muted">{entry.date}</p>
                        </div>
                        {entry.amount != null && <b className="text-sm">{formatCurrency(entry.amount)}</b>}
                      </div>
                      <p className="mt-2 text-xs font-semibold text-charcoal">{entry.description}</p>
                      {entry.remaining != null && <p className="mt-1 text-xs font-bold text-muted">Remaining {formatCurrency(entry.remaining)}</p>}
                      {entry.statusChanged && <p className="mt-2 text-xs font-bold text-emerald">Status changed to Settled</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {detailObligation.remainingAmount > 0 && detailObligation.status !== "CANCELLED" && (
            <button
              onClick={() => startDirectSettlement(detailObligation)}
              className="mt-4 w-full rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white"
            >
              {detailObligation.direction === "PAYABLE" ? "Pay Now" : "Receive"}
            </button>
          )}
        </section>
      )}

      <section>
        <SectionTitle title="History" />
        {loading && <ResourceState loading error="" empty={false} />}
        {error && <ResourceState loading={false} error={error} empty={false} />}
        {ledger?.transactions?.length ? (
          <div className="mt-3 space-y-3">
            {ledger.transactions.map((transaction) => (
              <TransactionRow key={transaction._id} transaction={transaction} />
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-3xl bg-cream p-4 text-sm font-semibold text-muted shadow-card">
            No transaction history yet.
          </p>
        )}
      </section>

      <SettleSheet
        open={settleOpen}
        obligations={settleObligations}
        initialObligationId={initialSettleObligationId}
        title={settleTitle}
        exactObligation={settleExactObligation}
        exactDescription={settleAgainstLabel}
        onClose={() => setSettleOpen(false)}
        onSettled={async () => {
          setSettleOpen(false);
          setInitialSettleObligationId("");
          setSettleObligations([]);
          setOpenObligationVersion((version) => version + 1);
          onFinancialChange?.();
        }}
      />
    </ScreenShell>
  );
}

function SettlementCenter({ refreshKey, onSettled, onOpenObligation }) {
  const resource = useResource("obligations", { history: "true" }, refreshKey);
  const people = useResource("people");
  const accounts = useResource("accounts");
  const categories = useResource("categories");
  const tags = useResource("tags");
  const now = new Date();
  const currentMonth = String(now.getMonth() + 1);
  const currentYear = String(now.getFullYear());
  const emptyFilters = { person: "", direction: "", status: "", dateState: "", source: "", account: "", category: "", tag: "", month: "", year: "", startDate: "", endDate: "", allTime: "" };
  const settlementRoute = new URLSearchParams(window.location.search);
  const initialView = settlementRoute.get("view") || "all";
  const routeMonth = settlementRoute.get("month") || "";
  const routeYear = settlementRoute.get("year") || "";
  const initialTab = ({
    "to-pay": "To Pay",
    "to-receive": "To Receive",
    "due-today": "Due Today",
    "upcoming-payments": "Upcoming",
    "upcoming-receivables": "Upcoming",
    upcoming: "Upcoming",
    overdue: "Overdue",
    "overdue-payments": "Overdue",
    "overdue-receivables": "Overdue",
    open: "Open",
    partial: "Partial",
    settled: "Settled",
    expenses: "Expenses"
  })[initialView] || "All";
  const [tab, setTab] = useState(initialTab);
  const [filters, setFilters] = useState(() => ({
    ...emptyFilters,
    person: settlementRoute.get("person") || "",
    direction: settlementRoute.get("direction") || ({ "upcoming-payments": "PAYABLE", "upcoming-receivables": "RECEIVABLE", "overdue-payments": "PAYABLE", "overdue-receivables": "RECEIVABLE" })[initialView] || "",
    status: settlementRoute.get("status") || (initialView === "partial" ? "PARTIAL" : ""),
    dateState: settlementRoute.get("dateState") || "",
    source: settlementRoute.get("source") || "",
    account: settlementRoute.get("account") || "",
    category: settlementRoute.get("category") || "",
    tag: settlementRoute.get("tag") || "",
    month: settlementRoute.get("allTime") === "true" ? "" : routeMonth,
    year: settlementRoute.get("allTime") === "true" ? "" : routeYear,
    startDate: settlementRoute.get("startDate") || "",
    endDate: settlementRoute.get("endDate") || "",
    allTime: settlementRoute.get("allTime") === "true" ? "true" : ""
  }));
  const [draftFilters, setDraftFilters] = useState(emptyFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [settlementSort, setSettlementSort] = useState("latest");
  const filterButtonRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const [settleOpen, setSettleOpen] = useState(false);
  const tabs = ["All", "To Pay", "To Receive", "Open", "Partial", "Settled", "Expenses", "Overdue", "Upcoming", "Due Today"];
  const viewByTab = { "To Pay": "to-pay", "To Receive": "to-receive", Open: "open", Partial: "partial", Settled: "settled", Expenses: "expenses", Overdue: "overdue", Upcoming: "upcoming", "Due Today": "due-today" };
  useEffect(() => {
    if (window.location.pathname !== "/settlements") return;
    const params = new URLSearchParams();
    const view = viewByTab[tab];
    if (view) params.set("view", view);
    ["person", "direction", "status", "dateState", "source", "account", "category", "tag", "month", "year", "startDate", "endDate", "allTime"].forEach((key) => {
      if (filters[key]) params.set(key, filters[key]);
    });
    const queryString = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}`);
  }, [filters, tab]);
  const selectTab = (nextTab) => {
    if (nextTab === tab) return;
    const params = new URLSearchParams(window.location.search);
    const view = viewByTab[nextTab];
    if (view) params.set("view", view);
    else params.delete("view");
    const queryString = params.toString();
    window.history.pushState({}, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}`);
    setTab(nextTab);
  };
  useEffect(() => {
    const viewToTab = { "to-pay": "To Pay", "to-receive": "To Receive", open: "Open", partial: "Partial", settled: "Settled", expenses: "Expenses", overdue: "Overdue", "overdue-payments": "Overdue", "overdue-receivables": "Overdue", upcoming: "Upcoming", "upcoming-payments": "Upcoming", "upcoming-receivables": "Upcoming", "due-today": "Due Today" };
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      setTab(viewToTab[params.get("view")] || "All");
      setFilters((current) => ({
        ...current,
        person: params.get("person") || "",
        direction: params.get("direction") || "",
        status: params.get("status") || "",
        dateState: params.get("dateState") || "",
        source: params.get("source") || "",
        account: params.get("account") || "",
        category: params.get("category") || "",
        tag: params.get("tag") || "",
        month: params.get("allTime") === "true" ? "" : params.get("month") || "",
        year: params.get("allTime") === "true" ? "" : params.get("year") || "",
        startDate: params.get("startDate") || "",
        endDate: params.get("endDate") || "",
        allTime: params.get("allTime") === "true" ? "true" : ""
      }));
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);
  const expenseQuery = useMemo(() => {
    const query = { type: "EXPENSE", sort: "newest", status: "ACTIVE" };
    const dateRange = settlementFilterDateRange(filters);
    if (dateRange.startDate) query.startDate = dateRange.startDate;
    if (dateRange.endDate) query.endDate = dateRange.endDate;
    if (filters.account) query.account = filters.account;
    if (filters.category) query.category = filters.category;
    if (filters.tag) query.tag = filters.tag;
    return query;
  }, [filters]);
  const expenseResource = useResource("transactions", expenseQuery, refreshKey);
  const filteredByFilters = resource.items.filter((item) => {
    const remaining = Number(item.remainingAmount || 0);
    const isPartial = item.settlementState === "PARTIAL" || (Number(item.settledAmount || 0) > 0 && remaining > 0);
    const isOpen = remaining > 0 && !["SETTLED", "CANCELLED"].includes(item.status);
    const dateState = item.dateState || "NO_DATE";
    if (item.status === "CANCELLED") return false;
    if (filters.person && String(item.person?._id) !== filters.person) return false;
    if (filters.direction && item.direction !== filters.direction) return false;
    if (filters.status === "PENDING" && (!isOpen || isPartial)) return false;
    if (filters.status === "PARTIAL" && !isPartial) return false;
    if (filters.status === "SETTLED" && (item.status === "CANCELLED" || (item.status !== "SETTLED" && remaining > 0))) return false;
    if (filters.status === "OVERDUE" && (!isOpen || dateState !== "OVERDUE")) return false;
    if (filters.status === "PARTIAL" && !isPartial) return false;
    if (filters.dateState === "PARTIAL" && !isPartial) return false;
    if (filters.dateState === "SETTLED" && item.settlementState !== "SETTLED") return false;
    if (filters.dateState && !["PARTIAL", "SETTLED"].includes(filters.dateState) && dateState !== filters.dateState) return false;
    if (["TODAY", "UPCOMING", "OVERDUE", "NO_DATE"].includes(filters.dateState) && !isOpen) return false;
    if (filters.account && String(item.sourceTransaction?.account?._id || item.sourceTransaction?.account) !== filters.account) return false;
    if (filters.category && String(item.sourceTransaction?.category?._id || item.sourceTransaction?.category) !== filters.category) return false;
    if (filters.tag && !(item.sourceTransaction?.tags || []).some((tag) => String(tag?._id || tag) === filters.tag)) return false;
    const selectedSources = filters.source === "PAID_FOR_SOMEONE_AND_SPLIT"
      ? ["PAID_FOR_SOMEONE", "SPLIT_SHARE"]
      : filters.source.split(",");
    if (filters.source && !selectedSources.includes(item.sourceType)) return false;
    const filterDate = tab === "Settled" ? new Date(item.settledAt || item.createdAt) : new Date(item.dueDate || item.createdAt);
    const dateRange = settlementFilterDateRange(filters);
    if (dateRange.startDate && filterDate < new Date(`${dateRange.startDate}T00:00:00`)) return false;
    if (dateRange.endDate && filterDate > new Date(`${dateRange.endDate}T23:59:59.999`)) return false;
    if (tab === "To Pay") return isOpen && item.direction === "PAYABLE";
    if (tab === "To Receive") return isOpen && item.direction === "RECEIVABLE";
    if (tab === "Open") return isOpen;
    if (tab === "Due Today") return isOpen && dateState === "TODAY";
    if (tab === "Upcoming") return isOpen && dateState === "UPCOMING";
    if (tab === "Overdue") return isOpen && dateState === "OVERDUE";
    if (tab === "Partial") return isPartial;
    if (tab === "Settled") return item.status !== "CANCELLED" && (item.status === "SETTLED" || remaining <= 0);
    return true;
  });
  const normalizedSearch = searchText.trim().toLocaleLowerCase();
  const filtered = filteredByFilters
    .filter((item) => !normalizedSearch || [item.person?.name, sourceTypeLabel(item.sourceType), item.sourceTransaction?.note]
      .some((value) => String(value || "").toLocaleLowerCase().includes(normalizedSearch)))
    .sort((left, right) => {
      const difference = new Date(left.createdAt || 0) - new Date(right.createdAt || 0);
      return settlementSort === "oldest" ? difference : -difference;
    });
  const filteredExpenses = expenseResource.items
    .filter((item) => !normalizedSearch || [item.note, item.category?.name, item.account?.name]
      .some((value) => String(value || "").toLocaleLowerCase().includes(normalizedSearch)))
    .sort((left, right) => {
      const difference = new Date(left.transactionDate || left.createdAt || 0) - new Date(right.transactionDate || right.createdAt || 0);
      return settlementSort === "oldest" ? difference : -difference;
    });
  const sourceFilterOptions = [...new Set(resource.items.map((item) => item.sourceType).filter(Boolean))];
  const filterChips = [
    searchText && { key: "_search", label: `Search: ${searchText}` },
    filters.person && { key: "person", label: people.items.find((item) => item._id === filters.person)?.name || "Person" },
    filters.direction && { key: "direction", label: filters.direction === "PAYABLE" ? "To Pay" : "To Receive" },
    filters.status && { key: "status", label: { PENDING: "Pending", PARTIAL: "Partial", SETTLED: "Settled", OVERDUE: "Overdue" }[filters.status] },
    filters.dateState && { key: "dateState", label: ({ TODAY: "Due Today", UPCOMING: "Upcoming", OVERDUE: "Overdue", NO_DATE: "No Due Date", PARTIAL: "Partial", SETTLED: "Settled" })[filters.dateState] || filters.dateState },
    filters.source && { key: "source", label: filters.source === "PAID_FOR_SOMEONE_AND_SPLIT" ? "Paid for Someone" : sourceTypeLabel(filters.source) },
    filters.account && { key: "account", label: accounts.items.find((item) => item._id === filters.account)?.name || "Account" },
    filters.category && { key: "category", label: categories.items.find((item) => item._id === filters.category)?.name || "Category" },
    filters.tag && { key: "tag", label: tags.items.find((item) => item._id === filters.tag)?.name || "Tag" },
    !filters.allTime && !filters.startDate && !filters.endDate && filters.month && { key: "month", label: monthOptions.find((item) => item.value === filters.month)?.label || "Month" },
    !filters.allTime && !filters.startDate && !filters.endDate && filters.year && { key: "year", label: filters.year },
    filters.startDate && { key: "startDate", label: `From ${formatShortDate(filters.startDate)}` },
    filters.endDate && { key: "endDate", label: `To ${formatShortDate(filters.endDate)}` }
  ].filter(Boolean);
  const clearFilters = () => { setFilters(emptyFilters); setDraftFilters(emptyFilters); setTab("All"); setSearchText(""); setSettlementSort("latest"); };
  const summary = summarizeObligations(resource.items);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const settledThisMonth = resource.items.filter((item) => {
    const date = item.settledAt ? new Date(item.settledAt) : null;
    return item.status === "SETTLED" && date && date >= monthStart && date < nextMonthStart;
  });
  const settledThisMonthTotal = settledThisMonth.reduce((total, item) => total + Number(item.settledAmount || item.originalAmount || 0), 0);
  const removeFilter = (chip) => {
    if (chip.key === "_search") {
      setSearchText("");
      return;
    }
    const next = chip.key === "month" || chip.key === "year"
      ? { ...filters, month: "", year: "", allTime: "true", startDate: "", endDate: "" }
      : chip.key === "allTime"
        ? { ...filters, allTime: "", month: "", year: "", startDate: "", endDate: "" }
        : { ...filters, [chip.key]: "" };
    setFilters(next);
    setDraftFilters(next);
  };

  return (
    <ScreenShell className="space-y-3">
      <div className="md:hidden">
        <h1 className="text-2xl font-bold tracking-tight text-charcoal">Settlements</h1>
        <p className="mt-0.5 text-xs font-medium text-muted">Track what you need to pay and receive</p>
      </div>
      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[
          { label: "Total To Pay", value: formatCurrency(summary.toPay), detail: `Across ${summary.toPayCount} ${summary.toPayCount === 1 ? "item" : "items"}`, icon: ArrowUpRight, style: "border-rose-100 bg-rose-50/80", iconStyle: "bg-rose-100 text-rose-600" },
          { label: "Total To Receive", value: formatCurrency(summary.toReceive), detail: `Across ${summary.toReceiveCount} ${summary.toReceiveCount === 1 ? "item" : "items"}`, icon: ArrowDownLeft, style: "border-emerald-100 bg-emerald-50/80", iconStyle: "bg-emerald-100 text-emerald-600" },
          { label: "Open Items", value: String(summary.openCount), detail: "Need attention", icon: Receipt, style: "border-sky-100 bg-sky-50/80", iconStyle: "bg-sky-100 text-sky-600" },
          { label: "Settled This Month", value: String(settledThisMonth.length), detail: `Total ${formatCurrency(settledThisMonthTotal)}`, icon: CheckCircle2, style: "border-violet-100 bg-violet-50/80", iconStyle: "bg-violet-100 text-violet-600" }
        ].map((card) => {
          const Icon = card.icon;
          return <article key={card.label} className={`flex min-h-[84px] items-center gap-3 rounded-xl border px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:px-4 ${card.style}`}>
            <span className={`grid size-9 shrink-0 place-items-center rounded-full ${card.iconStyle}`}><Icon size={17} strokeWidth={2.2} /></span>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold text-slate-600">{card.label}</p>
              <p className="mt-0.5 truncate text-lg font-bold leading-5 text-slate-900">{card.value}</p>
              <p className="mt-0.5 truncate text-[10px] font-medium text-slate-500">{card.detail}</p>
            </div>
          </article>;
        })}
      </section>
      <section className="relative space-y-3">
      <div className="flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-white p-2 shadow-[0_1px_3px_rgba(15,23,42,0.04)] lg:flex-row lg:items-center">
        <label className="flex h-9 min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-slate-400 lg:w-[260px] lg:shrink-0">
          <Search size={15} />
          <input aria-label="Search settlements" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search people, type, or notes..." className="min-w-0 flex-1 bg-transparent text-xs font-medium text-slate-700 outline-none placeholder:text-slate-400" />
          {searchText && <button type="button" onClick={() => setSearchText("")} aria-label="Clear search" className="text-slate-400"><X size={14} /></button>}
        </label>
        <div className="no-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
          {tabs.map((item) => <button key={item} type="button" onClick={() => selectTab(item)} className={`shrink-0 rounded-lg px-3 py-2 text-[11px] font-semibold transition ${tab === item ? "bg-blue-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{item}</button>)}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-1.5">
          <button type="button" onClick={() => { setDraftFilters(filters); setFilterOpen((open) => !open); }} aria-label="Advanced filters" className={`grid size-9 place-items-center rounded-lg border text-slate-600 ${filterOpen ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white hover:bg-slate-50"}`}><SlidersHorizontal size={15} />{filterChips.length > 0 && <span className="sr-only">{filterChips.length} filters active</span>}</button>
          <label className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 text-slate-500">
            <TrendingDown size={14} className="rotate-180" />
            <select aria-label="Sort settlements" value={settlementSort} onChange={(event) => setSettlementSort(event.target.value)} className="max-w-[120px] bg-transparent text-[11px] font-semibold text-slate-700 outline-none">
              <option value="latest">Latest First</option><option value="oldest">Oldest First</option>
            </select>
          </label>
        </div>
      </div>
      <div className="flex items-center justify-between px-1 text-[11px] font-medium text-slate-500"><span>{tab === "Expenses" ? filteredExpenses.length : filtered.length} {tab === "Expenses" ? "expenses" : "records"}</span><span>{tab}</span></div>
      <ActiveFilterChips chips={filterChips} onRemove={removeFilter} onClear={clearFilters} />
      <CompactPopover
        open={filterOpen}
        title="Payment Filters"
        triggerRef={filterButtonRef}
        onClose={() => setFilterOpen(false)}
        footer={<FilterActions onReset={() => setDraftFilters(emptyFilters)} onApply={() => { setFilters(draftFilters); setFilterOpen(false); }} />}
      >
        <FilterSelect label="View" value={tab} onChange={selectTab} options={tabs.map((view) => ({ value: view, label: view === "Expenses" ? "Expense History" : view }))} />
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDraftFilters({ ...draftFilters, allTime: "", startDate: "", endDate: "", month: currentMonth, year: currentYear })}
            className={`rounded-2xl px-3 py-2 text-sm font-bold ${!draftFilters.allTime && draftFilters.month === currentMonth && draftFilters.year === currentYear && !draftFilters.startDate && !draftFilters.endDate ? "bg-primary text-white" : "bg-paper text-charcoal"}`}
          >
            This Month
          </button>
          <button
            type="button"
            onClick={() => setDraftFilters({ ...draftFilters, allTime: "true", month: "", year: "", startDate: "", endDate: "" })}
            className={`rounded-2xl px-3 py-2 text-sm font-bold ${draftFilters.allTime ? "bg-primary text-white" : "bg-paper text-charcoal"}`}
          >
            All Time
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["today", "Today"], ["this_week", "This Week"], ["last_month", "Last Month"]
          ].map(([period, label]) => (
            <button
              key={period}
              type="button"
              onClick={() => {
                const range = activityPeriodRange(period);
                setDraftFilters({ ...draftFilters, allTime: "", month: "", year: "", startDate: range.startDate || "", endDate: range.endDate || "" });
              }}
              className="rounded-2xl bg-paper px-3 py-2 text-sm font-bold text-charcoal"
            >{label}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FilterSelect label="Month" value={draftFilters.month} onChange={(value) => setDraftFilters({ ...draftFilters, allTime: "", month: value, startDate: "", endDate: "" })} options={[{ value: "", label: "Any Month" }, ...monthOptions]} />
          <FilterSelect label="Year" value={draftFilters.year} onChange={(value) => setDraftFilters({ ...draftFilters, allTime: "", year: value, startDate: "", endDate: "" })} options={yearFilterOptions()} />
        </div>
        <FilterSelect label="Person" value={draftFilters.person} onChange={(value) => setDraftFilters({ ...draftFilters, person: value })} options={resourceOptions(people.items, "All People")} />
        <FilterSelect label="Account" value={draftFilters.account} onChange={(value) => setDraftFilters({ ...draftFilters, account: value })} options={resourceOptions(accounts.items, "All Accounts")} />
        <FilterSelect label="Direction" value={draftFilters.direction} onChange={(value) => setDraftFilters({ ...draftFilters, direction: value })} options={[{ value: "", label: "Payable / Receivable" }, { value: "PAYABLE", label: "To Pay" }, { value: "RECEIVABLE", label: "To Receive" }]} />
        <FilterSelect label="Status" value={draftFilters.status} onChange={(value) => setDraftFilters({ ...draftFilters, status: value })} options={[{ value: "", label: "Any Status" }, { value: "PENDING", label: "Pending" }, { value: "PARTIAL", label: "Partial" }, { value: "SETTLED", label: "Settled" }, { value: "OVERDUE", label: "Overdue" }]} />
        <FilterSelect label="Due State" value={draftFilters.dateState} onChange={(value) => setDraftFilters({ ...draftFilters, dateState: value })} options={[{ value: "", label: "Any Due State" }, { value: "TODAY", label: "Today" }, { value: "UPCOMING", label: "Upcoming" }, { value: "OVERDUE", label: "Overdue" }, { value: "NO_DATE", label: "No Due Date" }, { value: "PARTIAL", label: "Partial Settlement" }, { value: "SETTLED", label: "Settled" }]} />
        <FilterSelect label="Source Type" value={draftFilters.source} onChange={(value) => setDraftFilters({ ...draftFilters, source: value })} options={[{ value: "", label: "All Source Types" }, { value: "PAID_FOR_SOMEONE_AND_SPLIT", label: "Paid for Someone" }, ...sourceFilterOptions.map((value) => ({ value, label: sourceTypeLabel(value) }))]} />
        <FilterSelect label="Category" value={draftFilters.category} onChange={(value) => setDraftFilters({ ...draftFilters, category: value })} options={resourceOptions(categories.items, "All Categories")} />
        <FilterSelect label="Tag" value={draftFilters.tag} onChange={(value) => setDraftFilters({ ...draftFilters, tag: value })} options={resourceOptions(tags.items, "All Tags")} />
        <div className="grid grid-cols-2 gap-3">
          <FormInput label="From Date" type="date" value={draftFilters.startDate} onChange={(value) => setDraftFilters({ ...draftFilters, allTime: "", month: "", year: "", startDate: value })} />
          <FormInput label="To Date" type="date" value={draftFilters.endDate} onChange={(value) => setDraftFilters({ ...draftFilters, allTime: "", month: "", year: "", endDate: value })} />
        </div>
      </CompactPopover>
      </section>
      {tab === "Expenses" ? (
        <>
          <ResourceState loading={expenseResource.loading} error={expenseResource.error} empty={!filteredExpenses.length} onRetry={expenseResource.refresh} emptyMessage="No expenses match these filters." />
          <div className="space-y-2">
            {filteredExpenses.map((transaction) => <ExpenseHistoryCard key={transaction._id} transaction={transaction} />)}
          </div>
        </>
      ) : (
        <>
          <ResourceState loading={resource.loading} error={resource.error} empty={!filtered.length} onRetry={resource.refresh} emptyMessage="No payment records match these filters." />
          <div className="space-y-2">
            {filtered.map((item) => {
              const payable = item.direction === "PAYABLE";
              const settled = item.settlementState === "SETTLED" || item.status === "SETTLED" || Number(item.remainingAmount || 0) <= 0;
              const isPartial = item.settlementState === "PARTIAL" || (Number(item.settledAmount || 0) > 0 && !settled);
              const isOverdue = item.dateState === "OVERDUE";
              const statusLabel = settled ? "Settled" : isOverdue ? "Overdue" : isPartial ? payable ? "Partially Paid" : "Partially Received" : "Pending";
              const personName = item.person?.name || "Unknown person";
              const initials = item.person?.initials || personName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
              const statusTone = settled ? "bg-emerald-50 text-emerald-700" : isOverdue ? "bg-rose-50 text-rose-700" : isPartial ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700";
              const createdDate = item.sourceTransaction?.transactionDate || item.createdAt;
              return <article key={item._id} className="rounded-xl border border-slate-200/80 bg-white px-3 py-3 shadow-[0_1px_3px_rgba(15,23,42,0.045)] sm:px-4">
                <div className="flex items-center gap-2.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-blue-50 text-[11px] font-bold text-blue-700">{initials}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold leading-4 text-slate-900">{personName}</p>
                    <p className="mt-0.5 truncate text-[10px] font-medium text-slate-500">{sourceTypeLabel(item.sourceType)}</p>
                  </div>
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold ${statusTone}`}>
                    {settled && <CheckCircle2 size={11} />}{statusLabel}
                  </span>
                  <MoreHorizontal aria-hidden="true" size={17} className="shrink-0 text-slate-400" />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-y-1 rounded-lg border border-slate-100 bg-slate-50/80 py-2 sm:grid-cols-3 sm:divide-x sm:divide-slate-200/80 sm:gap-y-0">
                  {[
                    { label: "Original Amount", amount: item.originalAmount, icon: Receipt, color: "text-slate-500", bg: "bg-slate-200/70" },
                    { label: payable ? "Paid" : "Received", amount: item.settledAmount, icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-100" },
                    { label: "Remaining", amount: item.remainingAmount, icon: CircleDollarSign, color: settled ? "text-emerald-600" : "text-rose-600", bg: settled ? "bg-emerald-100" : "bg-rose-100" }
                  ].map((metric) => {
                    const Icon = metric.icon;
                    return <div key={metric.label} className="flex min-w-0 items-center gap-1.5 px-2 sm:gap-2 sm:px-3">
                      <span className={`grid size-6 shrink-0 place-items-center rounded-md ${metric.bg} ${metric.color}`}><Icon size={12} /></span>
                      <div className="min-w-0">
                        <p className="truncate text-[8px] font-semibold uppercase tracking-wide text-slate-500 sm:text-[9px]">{metric.label}</p>
                        <p className={`mt-0.5 truncate text-[11px] font-bold leading-4 text-slate-900 sm:text-xs ${metric.label === "Remaining" && !settled ? "text-rose-700" : ""}`}>{formatCurrency(metric.amount)}</p>
                      </div>
                    </div>;
                  })}
                </div>
                <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-[9px] font-medium text-slate-500">
                    <span className="inline-flex items-center gap-1"><CalendarDays size={11} />Created {formatShortDate(createdDate)}</span>
                    <span className="inline-flex items-center gap-1"><CalendarDays size={11} />{item.dueDate ? `Due ${formatShortDate(item.dueDate)}` : "No due date"}</span>
                  </div>
                  <div className="flex shrink-0 gap-1.5 sm:justify-end">
                    {!settled && <button type="button" onClick={() => { setSelected(item); setSettleOpen(true); }} className="rounded-md bg-blue-600 px-3 py-1.5 text-[10px] font-semibold text-white shadow-sm hover:bg-blue-700">{payable ? "Pay Now" : "Receive Now"}</button>}
                    <button type="button" onClick={() => onOpenObligation(item._id)} className="rounded-md border border-blue-100 bg-blue-50 px-3 py-1.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100">View History</button>
                  </div>
                </div>
              </article>;
            })}
          </div>
        </>
      )}
      <SettleSheet
        open={settleOpen}
        obligations={selected ? [selected] : []}
        initialObligationId={selected?._id || ""}
        title={selected?.direction === "PAYABLE" ? `Pay ${selected.person?.name || "person"}` : `Receive from ${selected?.person?.name || "person"}`}
        exactObligation
        onClose={() => setSettleOpen(false)}
        onSettled={async () => {
          setSettleOpen(false);
          setSelected(null);
          await resource.refresh();
          onSettled();
        }}
      />
    </ScreenShell>
  );
}

function LedgerMetric({ label, value, tone, onClick, active = false }) {
  const className = `rounded-3xl bg-cream p-4 text-left shadow-card ${onClick ? "w-full transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" : ""} ${active ? "ring-2 ring-primary/40" : ""}`;
  const contents = <>
    <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
    <h3 className={`mt-2 text-xl font-bold ${tone === "emerald" ? "text-emerald" : tone === "coral" ? "text-coral" : tone === "amber" ? "text-amber" : "text-charcoal"}`}>
      {formatCurrency(value)}
    </h3>
  </>;
  return onClick
    ? <button type="button" onClick={onClick} aria-pressed={active} className={className}>{contents}</button>
    : <article className={className}>{contents}</article>;
}

function settlementFilterDateRange(filters) {
  if (filters.allTime) return {};
  if (filters.startDate || filters.endDate) return { startDate: filters.startDate, endDate: filters.endDate };
  if (filters.month) {
    const year = filters.year || String(new Date().getFullYear());
    const month = String(filters.month).padStart(2, "0");
    const lastDay = String(new Date(Number(year), Number(filters.month), 0).getDate()).padStart(2, "0");
    return { startDate: `${year}-${month}-01`, endDate: `${year}-${month}-${lastDay}` };
  }
  if (filters.year) return { startDate: `${filters.year}-01-01`, endDate: `${filters.year}-12-31` };
  return {};
}

function ExpenseHistoryCard({ transaction }) {
  const tags = transaction.tags?.map((tag) => tag.name).filter(Boolean).join(", ");
  return (
    <article className="rounded-3xl bg-cream p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-charcoal">{transaction.note || transaction.category?.name || "Expense"}</p>
          <p className="mt-1 truncate text-sm font-semibold text-muted">{transaction.category?.name || "Uncategorized"} · {transaction.account?.name || "Account unavailable"}</p>
        </div>
        <p className="shrink-0 text-base font-bold text-coral">-{formatCurrency(transaction.myShare ?? transaction.amount)}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold text-muted">
        <span className="rounded-full bg-paper px-2 py-1">{formatDateTime(transaction)}</span>
        {tags && <span className="rounded-full bg-paper px-2 py-1">{tags}</span>}
      </div>
    </article>
  );
}

function SettleSheet({ open, obligations, initialObligationId, onClose, onSettled, title = "Settle Up", submitLabel, exactObligation = false, exactDescription = "" }) {
  const accounts = useResource("accounts", {}, open ? 1 : 0);
  const now = new Date();
  const [form, setForm] = useState({
    allocations: {},
    account: "",
    settlementDate: dateInputValue(now),
    settlementTime: now.toTimeString().slice(0, 5),
    note: ""
  });

  useEffect(() => {
    if (open) {
      setForm({
        allocations: initialObligationId
          ? { [initialObligationId]: String(obligations.find((item) => item._id === initialObligationId)?.remainingAmount || "") }
          : {},
        account: initialObligationId ? obligations.find((item) => item._id === initialObligationId)?.sourceTransaction?.account?._id || "" : "",
        settlementDate: dateInputValue(new Date()),
        settlementTime: new Date().toTimeString().slice(0, 5),
        note: ""
      });
    }
  }, [open, initialObligationId, obligations.length]);

  const allocationRows = obligations
    .filter((item) => Number(form.allocations[item._id] || 0) > 0)
    .map((item) => ({ obligationId: item._id, amount: Number(form.allocations[item._id]) }));
  const proposedTotal = allocationRows.reduce((sum, item) => sum + item.amount, 0);
  const selectedDirection = obligations.find((item) => Number(form.allocations[item._id] || 0) > 0)?.direction;
  const validAmounts = allocationRows.length > 0 && allocationRows.every((allocation) => {
    const obligation = obligations.find((item) => item._id === allocation.obligationId);
    return obligation
      && allocation.amount > 0
      && Math.round(allocation.amount * 100) <= Math.round(Number(obligation.remainingAmount || 0) * 100)
      && Math.abs(allocation.amount * 100 - Math.round(allocation.amount * 100)) <= 0.00001;
  });
  const canSubmit = validAmounts && Number.isFinite(proposedTotal) && proposedTotal > 0 && Boolean(form.account);

  return (
    <FormSheet
      open={open}
      title={title}
      submitLabel={submitLabel || (selectedDirection === "PAYABLE" ? `Pay ${formatCurrency(proposedTotal)}` : selectedDirection === "RECEIVABLE" ? `Receive ${formatCurrency(proposedTotal)}` : "Save")}
      canSubmit={canSubmit}
      onClose={onClose}
      onSubmit={async () => {
        if (!validAmounts || proposedTotal <= 0) throw new Error("Enter a positive amount within the open balance.");
        if (!form.account) throw new Error("Choose an account before saving.");
        await api.settleObligations({
          allocations: allocationRows,
          account: form.account,
          settlementDate: form.settlementDate,
          settlementTime: form.settlementTime,
          note: form.note
        });
        await onSettled();
      }}
    >
      {exactObligation && obligations[0] && (
        <div className="rounded-2xl bg-violetSoft p-4">
          <p className="text-[10px] font-bold uppercase text-muted">Against</p>
          <p className="mt-1 text-sm font-bold text-charcoal">{exactDescription || personObligationHeading(obligations[0], obligations[0].person?.name || "person")}</p>
          <p className="mt-3 text-[10px] font-bold uppercase text-muted">Outstanding</p>
          <p className="mt-1 text-lg font-bold text-primary">{formatCurrency(obligations[0].remainingAmount)}</p>
        </div>
      )}
      <div className="max-h-64 space-y-2 overflow-y-auto">
        {obligations.map((item) => {
          const value = form.allocations[item._id] ?? "";
          const source = item.sourceTransaction;
          if (exactObligation) return <FormInput key={item._id} label="Amount" type="number" value={String(value)} onChange={(next) => setForm({ ...form, allocations: { ...form.allocations, [item._id]: next } })} />;
          return (
            <div key={item._id} className="rounded-2xl bg-paper p-3">
              <label className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 text-sm font-bold">
                  <input
                    type="checkbox"
                    checked={Number(value) > 0}
                    disabled={Number(value) <= 0 && selectedDirection && selectedDirection !== item.direction}
                    onChange={(event) => setForm({
                      ...form,
                      allocations: { ...form.allocations, [item._id]: event.target.checked ? String(item.remainingAmount) : "" }
                    })}
                  />
                  <span className="truncate">{source?.note || item.sourceType.replaceAll("_", " ")}</span>
                </span>
                <span className="shrink-0 text-xs font-semibold text-muted">{formatCurrency(item.remainingAmount)} left</span>
              </label>
              {Number(value) > 0 && (
                <FormInput label="Allocate" type="number" value={String(value)} onChange={(next) => setForm({ ...form, allocations: { ...form.allocations, [item._id]: next } })} />
              )}
            </div>
          );
        })}
      </div>
      <ResourceSelect label={selectedDirection === "PAYABLE" ? "Pay From" : selectedDirection === "RECEIVABLE" ? "Receive In" : "Account"} value={form.account} onChange={(value) => setForm({ ...form, account: value })} items={accounts.items} placeholder="Select account" />
      <p className="rounded-2xl bg-violetSoft p-3 text-sm font-bold text-primary">{proposedTotal > 0 ? `Settlement total: ${formatCurrency(proposedTotal)}` : "Choose an open payment record to see the total."}</p>
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Date" type="date" value={form.settlementDate} onChange={(value) => setForm({ ...form, settlementDate: value })} />
        <FormInput label="Time" type="time" value={form.settlementTime} onChange={(value) => setForm({ ...form, settlementTime: value })} />
      </div>
      <FormInput label="Note" value={form.note} onChange={(value) => setForm({ ...form, note: value })} />
    </FormSheet>
  );
}

function AccountsScreen({ refreshKey = 0, onBack }) {
  const resource = useResource("accounts", {}, refreshKey);
  const [editing, setEditing] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const totalBalance = resource.items.reduce((sum, item) => sum + Number(item.currentBalance || 0), 0);

  return (
    <MasterScreenShell
      title="Accounts"
      subtitle="Cash, banks, wallets and cards"
      icon={CreditCard}
      onBack={onBack}
      actionLabel="Add Account"
      onAction={() => {
        setEditing(null);
        setFormOpen(true);
      }}
    >
      <section className="rounded-3xl bg-cream p-5 shadow-card">
        <p className="text-sm font-semibold text-muted">Total account balance</p>
        <h2 className="mt-2 text-4xl font-bold tracking-tight text-primary">{formatCurrency(totalBalance)}</h2>
      </section>
      <ResourceState loading={resource.loading} error={resource.error} empty={!resource.items.length} onRetry={resource.refresh} />
      <div className="space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0 xl:grid-cols-3">
        {resource.items.map((account) => (
          <MasterCard
            key={account._id}
            icon={Wallet}
            tone={account.type === "CREDIT_CARD" ? "coral" : account.type === "WALLET" ? "income" : "primary"}
            title={account.name}
            subtitle={account.type.replace("_", " ")}
            value={formatCurrency(account.currentBalance)}
            onEdit={() => {
              setEditing(account);
              setFormOpen(true);
            }}
            onDelete={() => resource.remove(account._id)}
          />
        ))}
      </div>
      <AccountFormSheet
        open={formOpen}
        account={editing}
        onClose={() => setFormOpen(false)}
        onSave={async (payload) => {
          await resource.save(payload, editing?._id);
          setFormOpen(false);
        }}
      />
    </MasterScreenShell>
  );
}

function CategoriesScreen({ onBack }) {
  const resource = useResource("categories");
  const [editing, setEditing] = useState(null);
  const [formOpen, setFormOpen] = useState(false);

  return (
    <MasterScreenShell
      title="Categories"
      subtitle="Income and expense buckets"
      icon={FolderTree}
      onBack={onBack}
      actionLabel="Add Category"
      onAction={() => {
        setEditing(null);
        setFormOpen(true);
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <MiniSummary label="Expense" value={resource.items.filter((item) => item.type === "EXPENSE").length} tone="coral" />
        <MiniSummary label="Income" value={resource.items.filter((item) => item.type === "INCOME").length} tone="income" />
      </div>
      <ResourceState loading={resource.loading} error={resource.error} empty={!resource.items.length} onRetry={resource.refresh} />
      <div className="space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0 xl:grid-cols-3">
        {resource.items.map((category) => (
          <MasterCard
            key={category._id}
            icon={FolderTree}
            tone={category.type === "INCOME" ? "income" : "coral"}
            title={category.name}
            subtitle={`${category.type.toLowerCase()}${category.isDefault ? " · default" : ""}`}
            value={category.icon}
            onEdit={() => {
              setEditing(category);
              setFormOpen(true);
            }}
            onDelete={() => resource.remove(category._id)}
          />
        ))}
      </div>
      <CategoryFormSheet
        open={formOpen}
        category={editing}
        onClose={() => setFormOpen(false)}
        onSave={async (payload) => {
          await resource.save(payload, editing?._id);
          setFormOpen(false);
        }}
      />
    </MasterScreenShell>
  );
}

function TagsScreen({ onBack }) {
  const resource = useResource("tags");
  const [editing, setEditing] = useState(null);
  const [formOpen, setFormOpen] = useState(false);

  return (
    <MasterScreenShell
      title="Tags"
      subtitle="Labels for future transactions"
      icon={Tag}
      onBack={onBack}
      actionLabel="Add Tag"
      onAction={() => {
        setEditing(null);
        setFormOpen(true);
      }}
    >
      <section className="rounded-3xl bg-cream p-5 shadow-card">
        <p className="text-sm font-semibold text-muted">Available tags</p>
        <h2 className="mt-2 text-4xl font-bold tracking-tight text-primary">{resource.items.length}</h2>
      </section>
      <ResourceState loading={resource.loading} error={resource.error} empty={!resource.items.length} onRetry={resource.refresh} />
      <div className="space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0 xl:grid-cols-3">
        {resource.items.map((tagItem) => (
          <MasterCard
            key={tagItem._id}
            icon={Tag}
            tone={tagItem.color || "primary"}
            title={tagItem.name}
            subtitle="Reusable label"
            value={tagItem.color || "primary"}
            onEdit={() => {
              setEditing(tagItem);
              setFormOpen(true);
            }}
            onDelete={() => resource.remove(tagItem._id)}
          />
        ))}
      </div>
      <TagFormSheet
        open={formOpen}
        tag={editing}
        onClose={() => setFormOpen(false)}
        onSave={async (payload) => {
          await resource.save(payload, editing?._id);
          setFormOpen(false);
        }}
      />
    </MasterScreenShell>
  );
}

function BudgetsScreen({ onBack }) {
  const now = new Date();
  const defaultPeriod = { month: String(now.getMonth() + 1), year: String(now.getFullYear()) };
  const [period, setPeriod] = useState(defaultPeriod);
  const [draftPeriod, setDraftPeriod] = useState(defaultPeriod);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterButtonRef = useRef(null);
  const resource = useResource("budgets", period);
  const categoriesResource = useResource("categories");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ category: "", limitAmount: "", warningAtPercent: 80 });
  const expenseCategories = categoriesResource.items.filter((item) => item.type === "EXPENSE");

  return (
    <MasterScreenShell
      title="Budgets"
      subtitle="Monthly category guardrails"
      icon={ChartNoAxesColumn}
      onBack={onBack}
      actionLabel="Add Budget"
      onAction={() => setFormOpen(true)}
    >
      <section className="relative space-y-3">
        <FilterButton refProp={filterButtonRef} active={filterOpen} count={Number(period.month !== defaultPeriod.month) + Number(period.year !== defaultPeriod.year)} onClick={() => { setDraftPeriod(period); setFilterOpen((open) => !open); }}>
          <SlidersHorizontal size={16} /> Filter
        </FilterButton>
        <ActiveFilterChips
          chips={[
            period.month !== defaultPeriod.month && { key: "month", label: monthOptions.find((item) => item.value === period.month)?.label || "Month" },
            period.year !== defaultPeriod.year && { key: "year", label: period.year }
          ].filter(Boolean)}
          onRemove={(chip) => { const next = { ...period, [chip.key]: defaultPeriod[chip.key] }; setPeriod(next); setDraftPeriod(next); }}
          onClear={() => { setPeriod(defaultPeriod); setDraftPeriod(defaultPeriod); }}
        />
        <CompactPopover open={filterOpen} title="Budget Filters" triggerRef={filterButtonRef} onClose={() => setFilterOpen(false)} footer={<FilterActions onReset={() => setDraftPeriod(defaultPeriod)} onApply={() => { setPeriod(draftPeriod); setFilterOpen(false); }} />}>
          <FilterSelect label="Month" value={draftPeriod.month} onChange={(value) => setDraftPeriod({ ...draftPeriod, month: value || defaultPeriod.month })} options={monthOptions} />
          <FilterSelect label="Year" value={draftPeriod.year} onChange={(value) => setDraftPeriod({ ...draftPeriod, year: value || defaultPeriod.year })} options={yearFilterOptions().filter((item) => item.value)} />
        </CompactPopover>
      </section>
      <ResourceState loading={resource.loading} error={resource.error} empty={!resource.items.length} onRetry={resource.refresh} />
      <div className="space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0 xl:grid-cols-3">
        {resource.items.map((budget) => (
          <article key={budget._id} className="rounded-3xl bg-cream p-4 shadow-card">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-bold">{budget.category?.name || "Category"}</h3>
                <p className="mt-1 text-sm font-semibold text-muted">
                  {formatCurrency(budget.spent)} / {formatCurrency(budget.limitAmount)}
                </p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${budget.state === "EXCEEDED" ? "bg-coralSoft text-coral" : budget.state === "WARNING" ? "bg-amberSoft text-amber" : "bg-emeraldSoft text-emerald"}`}>
                {budget.usedPercent}%
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper">
              <div className={`h-full rounded-full ${budget.state === "EXCEEDED" ? "bg-coral" : budget.state === "WARNING" ? "bg-amber" : "bg-emerald"}`} style={{ width: `${Math.min(100, budget.usedPercent)}%` }} />
            </div>
            <p className="mt-3 text-sm font-semibold text-muted">Remaining {formatCurrency(budget.remaining)}</p>
          </article>
        ))}
      </div>
      <FormSheet
        open={formOpen}
        title="Add Budget"
        onClose={() => setFormOpen(false)}
        onSubmit={async () => {
          await api.create("budgets", { ...form, ...period, limitAmount: Number(form.limitAmount), warningAtPercent: Number(form.warningAtPercent || 80) });
          setForm({ category: "", limitAmount: "", warningAtPercent: 80 });
          setFormOpen(false);
          await resource.refresh();
        }}
      >
        <ResourceSelect label="Category" value={form.category} onChange={(value) => setForm({ ...form, category: value })} items={expenseCategories} placeholder="Select category" />
        <FormInput label="Monthly Limit" type="number" value={form.limitAmount} onChange={(value) => setForm({ ...form, limitAmount: value })} />
        <FormInput label="Warn At %" type="number" value={form.warningAtPercent} onChange={(value) => setForm({ ...form, warningAtPercent: value })} />
      </FormSheet>
    </MasterScreenShell>
  );
}

function useRecurringRules(refreshKey = 0) {
  const [items, setItems] = useState([]);
  const [generated, setGenerated] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.list("recurring");
      setItems(data?.rules || []);
      setGenerated(data?.generated || 0);
    } catch (err) {
      setError(err.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [refreshKey]);
  return { items, generated, loading, error, refresh: load };
}

function RecurringScreen({ onBack }) {
  const recurring = useRecurringRules();
  const accounts = useResource("accounts");
  const categories = useResource("categories");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(recurringFormDefaults());
  const categoryOptions = categories.items.filter((item) => item.type === form.type);

  return (
    <MasterScreenShell
      title="Recurring"
      subtitle="Salary, rent, EMI and bills"
      icon={CalendarDays}
      onBack={onBack}
      actionLabel="Add Recurring"
      onAction={() => setFormOpen(true)}
    >
      {recurring.generated > 0 && (
        <p className="rounded-3xl bg-emeraldSoft p-4 text-sm font-bold text-emerald shadow-card">{recurring.generated} recurring transaction{recurring.generated === 1 ? "" : "s"} generated.</p>
      )}
      <ResourceState loading={recurring.loading} error={recurring.error} empty={!recurring.items.length} onRetry={recurring.refresh} />
      <div className="space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0 xl:grid-cols-3">
        {recurring.items.map((rule) => (
          <article key={rule._id} className="rounded-3xl bg-cream p-4 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold">{rule.name}</h3>
                <p className="mt-1 text-sm font-semibold text-muted">{rule.frequency.toLowerCase()} · next {formatShortDate(rule.nextRunDate)}</p>
              </div>
              <p className={`font-bold ${rule.type === "INCOME" ? "text-emerald" : "text-coral"}`}>{formatCurrency(rule.amount)}</p>
            </div>
            <p className="mt-3 text-sm font-semibold text-muted">{rule.account?.name || "Account"}{rule.category?.name ? ` · ${rule.category.name}` : ""}</p>
          </article>
        ))}
      </div>
      <FormSheet
        open={formOpen}
        title="Add Recurring"
        onClose={() => setFormOpen(false)}
        onSubmit={async () => {
          await api.create("recurring", {
            ...form,
            amount: Number(form.amount),
            interval: Number(form.interval || 1),
            reminderStartDaysBefore: Number(form.reminderStartDaysBefore || 3),
            reminderTimes: [form.reminderTime1, form.reminderTime2, form.reminderTime3].filter(Boolean)
          });
          setForm(recurringFormDefaults());
          setFormOpen(false);
          await recurring.refresh();
        }}
      >
        <FormInput label="Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
        <FormSelect label="Type" value={form.type} onChange={(value) => setForm({ ...form, type: value, category: "" })} options={["EXPENSE", "INCOME"]} />
        <FormInput label="Amount" type="number" value={form.amount} onChange={(value) => setForm({ ...form, amount: value })} />
        <ResourceSelect label="Account" value={form.account} onChange={(value) => setForm({ ...form, account: value })} items={accounts.items} placeholder="Select account" />
        <ResourceSelect label="Category" value={form.category} onChange={(value) => setForm({ ...form, category: value })} items={categoryOptions} placeholder="Optional category" optional />
        <div className="grid grid-cols-2 gap-3">
          <FormSelect label="Frequency" value={form.frequency} onChange={(value) => setForm({ ...form, frequency: value })} options={["DAILY", "WEEKLY", "MONTHLY", "YEARLY", "CUSTOM"]} />
          <FormInput label="Interval" type="number" value={form.interval} onChange={(value) => setForm({ ...form, interval: value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormInput label="Start Date" type="date" value={form.startDate} onChange={(value) => setForm({ ...form, startDate: value, nextRunDate: value })} />
          <FormInput label="Time" type="time" value={form.transactionTime} onChange={(value) => setForm({ ...form, transactionTime: value })} />
        </div>
        <label className="flex items-center justify-between rounded-3xl bg-paper p-4 text-sm font-bold">
          Reminder
          <input type="checkbox" checked={form.reminderEnabled} onChange={(event) => setForm({ ...form, reminderEnabled: event.target.checked })} className="size-5 accent-primary" />
        </label>
        {form.reminderEnabled && (
          <div className="space-y-3 rounded-3xl bg-paper p-4">
            <FormInput label="Start Days Before" type="number" value={form.reminderStartDaysBefore} onChange={(value) => setForm({ ...form, reminderStartDaysBefore: value })} />
            <div className="grid grid-cols-3 gap-2">
              <FormInput label="Time 1" type="time" value={form.reminderTime1} onChange={(value) => setForm({ ...form, reminderTime1: value })} />
              <FormInput label="Time 2" type="time" value={form.reminderTime2} onChange={(value) => setForm({ ...form, reminderTime2: value })} />
              <FormInput label="Time 3" type="time" value={form.reminderTime3} onChange={(value) => setForm({ ...form, reminderTime3: value })} />
            </div>
          </div>
        )}
        <FormInput label="Note" value={form.note} onChange={(value) => setForm({ ...form, note: value })} />
      </FormSheet>
    </MasterScreenShell>
  );
}

function downloadText(filename, text, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function BackupScreen({ onBack }) {
  const now = new Date();
  const emptyCsvFilters = { startDate: "", endDate: "" };
  const [filters, setFilters] = useState(emptyCsvFilters);
  const [draftFilters, setDraftFilters] = useState(emptyCsvFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterButtonRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [backupData, setBackupData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const exportJson = async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const backup = await api.exportBackup();
      downloadText(`expense-backup-${now.toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2));
      setSuccess("JSON backup downloaded.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const csv = await api.exportTransactionsCsv(filters);
      downloadText(`transactions-${now.toISOString().slice(0, 10)}.csv`, csv, "text/csv");
      setSuccess("CSV export downloaded.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const previewFile = async (file) => {
    if (!file) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const result = await api.previewImport(parsed);
      setBackupData(parsed);
      setPreview(result);
    } catch (err) {
      setPreview(null);
      setBackupData(null);
      setError(err.message || "Invalid backup file");
    } finally {
      setLoading(false);
    }
  };

  const restore = async () => {
    if (!backupData) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      await api.restoreImport(backupData);
      setSuccess("Backup imported. Existing duplicates were skipped.");
      setPreview(null);
      setBackupData(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <MasterScreenShell
      title="Backup"
      subtitle="Export and restore your own data"
      icon={Send}
      onBack={onBack}
      actionLabel="Download JSON Backup"
      onAction={exportJson}
    >
      <section className="rounded-3xl bg-cream p-4 shadow-card">
        <SectionTitle title="Transactions CSV" />
        <div className="relative mt-3 space-y-3">
          <FilterButton refProp={filterButtonRef} active={filterOpen} count={Number(Boolean(filters.startDate)) + Number(Boolean(filters.endDate))} onClick={() => { setDraftFilters(filters); setFilterOpen((open) => !open); }}>
            <SlidersHorizontal size={16} /> Filter
          </FilterButton>
          <ActiveFilterChips chips={[filters.startDate && { key: "startDate", label: `From ${formatShortDate(filters.startDate)}` }, filters.endDate && { key: "endDate", label: `To ${formatShortDate(filters.endDate)}` }].filter(Boolean)} onRemove={(chip) => { const next = { ...filters, [chip.key]: "" }; setFilters(next); setDraftFilters(next); }} onClear={() => { setFilters(emptyCsvFilters); setDraftFilters(emptyCsvFilters); }} />
          <CompactPopover open={filterOpen} title="Export Filters" triggerRef={filterButtonRef} onClose={() => setFilterOpen(false)} footer={<FilterActions onReset={() => setDraftFilters(emptyCsvFilters)} onApply={() => { setFilters(draftFilters); setFilterOpen(false); }} />}>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormInput label="Start Date" type="date" value={draftFilters.startDate} onChange={(value) => setDraftFilters({ ...draftFilters, startDate: value })} />
              <FormInput label="End Date" type="date" value={draftFilters.endDate} onChange={(value) => setDraftFilters({ ...draftFilters, endDate: value })} />
            </div>
          </CompactPopover>
        </div>
        <button disabled={loading} onClick={exportCsv} className="mt-4 w-full rounded-3xl bg-primary px-4 py-4 text-sm font-bold text-white disabled:opacity-60">
          Export Filtered CSV
        </button>
      </section>

      <section className="rounded-3xl bg-cream p-4 shadow-card">
        <SectionTitle title="Restore JSON Backup" />
        <label className="mt-3 block rounded-3xl bg-paper p-4 text-sm font-bold text-muted">
          Select backup file
          <input type="file" accept="application/json,.json" onChange={(event) => previewFile(event.target.files?.[0])} className="mt-3 block w-full text-sm" />
        </label>
        {preview && (
          <div className="mt-4 rounded-3xl bg-paper p-4">
            <p className="text-sm font-bold text-charcoal">Import preview</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-muted md:grid-cols-3">
              {Object.entries(preview.summary || {}).map(([key, value]) => (
                <span key={key} className="rounded-2xl bg-cream px-3 py-2">{key}: {value}</span>
              ))}
            </div>
            <button disabled={loading} onClick={restore} className="mt-4 w-full rounded-3xl bg-emeraldSoft px-4 py-4 text-sm font-bold text-emerald disabled:opacity-60">
              Confirm Import
            </button>
          </div>
        )}
      </section>
      {loading && <ResourceState loading error="" empty={false} />}
      {error && <ResourceState loading={false} error={error} empty={false} />}
      {success && <p className="rounded-3xl bg-emeraldSoft p-4 text-sm font-bold text-emerald shadow-card">{success}</p>}
    </MasterScreenShell>
  );
}

function MasterScreenShell({ title, subtitle, icon: Icon, actionLabel, onAction, onBack, children }) {
  return (
    <ScreenShell className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="grid size-11 place-items-center rounded-2xl bg-cream shadow-card">
          <ChevronLeft size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-sm font-semibold text-muted">{subtitle}</p>
        </div>
        <div className="grid size-11 place-items-center rounded-2xl bg-cream text-primary shadow-card">
          <Icon size={21} />
        </div>
      </div>
      <button onClick={onAction} className="flex w-full items-center justify-center gap-2 rounded-3xl bg-primary px-4 py-4 text-sm font-bold text-white shadow-card">
        <Plus size={18} />
        {actionLabel}
      </button>
      {children}
    </ScreenShell>
  );
}

function MiniSummary({ label, value, tone }) {
  return (
    <article className="rounded-3xl bg-cream p-4 shadow-card">
      <span className={`grid size-10 place-items-center rounded-2xl ${formatTone(tone)}`}>
        <FolderTree size={19} />
      </span>
      <p className="mt-3 text-sm font-semibold text-muted">{label}</p>
      <h3 className="mt-1 text-3xl font-bold">{value}</h3>
    </article>
  );
}

function MasterCard({ icon: Icon, tone, title, subtitle, value, onEdit, onDelete }) {
  return (
    <article className="flex items-center gap-3 rounded-3xl bg-cream p-4 shadow-card">
      <span className={`grid size-12 shrink-0 place-items-center rounded-2xl ${formatTone(tone)}`}>
        <Icon size={21} />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-bold">{title}</h3>
        <p className="truncate text-sm font-semibold capitalize text-muted">{subtitle}</p>
      </div>
      <p className="max-w-24 truncate text-right text-sm font-bold text-charcoal">{value}</p>
      <button onClick={onEdit} className="grid size-9 place-items-center rounded-2xl bg-violetSoft text-primary">
        <Edit3 size={17} />
      </button>
      <button onClick={onDelete} className="grid size-9 place-items-center rounded-2xl bg-coralSoft text-coral">
        <Trash2 size={17} />
      </button>
    </article>
  );
}

function ResourceState({ loading, error, empty, onRetry, emptyMessage = "No records yet. Add the first one." }) {
  if (loading) {
    return (
      <div className="space-y-3">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-3xl bg-coralSoft p-4 shadow-card">
        <p className="whitespace-pre-line text-sm font-bold text-coral">{friendlyDataError(error)}</p>
        {onRetry && (
          <button onClick={onRetry} className="mt-3 rounded-2xl bg-cream px-4 py-2 text-sm font-bold text-coral">
            Retry
          </button>
        )}
      </div>
    );
  }

  if (empty) {
    return <p className="rounded-3xl bg-cream p-4 text-sm font-semibold text-muted shadow-card">{emptyMessage}</p>;
  }

  return null;
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border-0 bg-paper px-3 py-3 text-sm font-bold text-charcoal outline-none ring-1 ring-transparent transition focus:ring-primary/30"
      >
        {options.map((option) => (
          <option key={`${label}-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function resourceOptions(items, emptyLabel) {
  return [
    { value: "", label: emptyLabel },
    ...items.map((item) => ({ value: item._id, label: item.name }))
  ];
}

function insufficientBalanceMessage(account, required) {
  return `Insufficient balance\nAvailable: ${formatCurrency(account?.currentBalance || 0)}\nRequired: ${formatCurrency(required)}`;
}

function hasEnoughBalance(account, required) {
  if (!account || account.type === "CREDIT_CARD") return true;
  return Number(account.currentBalance || 0) >= Number(required || 0) && Number(required || 0) > 0;
}

function outgoingAmountForForm(type, form) {
  if (["EXPENSE", "LEND", "PAID_FOR_SOMEONE", "TRANSFER"].includes(type)) return Number(form.amount || 0);
  if (type === "SPLIT_EXPENSE") return Number(form.amount || 0);
  return 0;
}

function yearFilterOptions() {
  const currentYear = new Date().getFullYear();
  return [
    { value: "", label: "Any Year" },
    ...Array.from({ length: 7 }, (_, index) => {
      const year = currentYear + 1 - index;
      return { value: String(year), label: String(year) };
    })
  ];
}

function buildTransactionQuery(filters) {
  const query = { sort: filters.sort || "newest" };
  Object.entries(filters).forEach(([key, value]) => {
    if (!value || key === "sort") return;
    if (key === "period" && value === "custom") return;
    query[key] = value;
  });
  if (filters.month && !filters.year) query.year = String(new Date().getFullYear());
  if (filters.period === "custom") {
    delete query.period;
    if (filters.startDate) query.startDate = filters.startDate;
    if (filters.endDate) query.endDate = filters.endDate;
  }
  return query;
}

function buildActivityEventQuery(filters) {
  const query = { sort: filters.sort || "newest" };
  ["q", "period", "startDate", "endDate", "month", "year", "type", "account", "person", "category", "tag", "direction", "status"].forEach((key) => {
    if (!filters[key]) return;
    if (key === "period" && filters[key] === "custom") return;
    query[key] = filters[key];
  });
  if (filters.balanceStatus) {
    query.status = ({ pending: "PENDING", partial: "PARTIALLY_SETTLED", settled: "SETTLED", overdue: "OVERDUE" })[filters.balanceStatus] || filters.balanceStatus;
  }
  if (filters.month && !filters.year) query.year = String(new Date().getFullYear());
  if (filters.period === "custom") {
    delete query.period;
    if (filters.startDate) query.startDate = filters.startDate;
    if (filters.endDate) query.endDate = filters.endDate;
  }
  return query;
}

function settlementActivityQuery(filters) {
  const query = {};
  ["person", "account", "status", "direction"].forEach((key) => {
    if (filters[key]) query[key] = filters[key];
  });
  if (filters.period === "custom") {
    if (filters.startDate) query.startDate = filters.startDate;
    if (filters.endDate) query.endDate = filters.endDate;
  } else if (filters.month || filters.year) {
    if (filters.month) query.month = filters.month;
    if (filters.year) query.year = filters.year;
  } else if (filters.period) {
    const range = activityPeriodRange(filters.period);
    if (range.startDate) query.startDate = range.startDate;
    if (range.endDate) query.endDate = range.endDate;
    if (range.month) query.month = range.month;
    if (range.year) query.year = range.year;
  }
  return query;
}

function activityPeriodRange(period) {
  const now = new Date();
  if (period === "today") return { startDate: dateInputValue(now), endDate: dateInputValue(now) };
  if (period === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    return { startDate: dateInputValue(yesterday), endDate: dateInputValue(yesterday) };
  }
  if (period === "this_week") {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    return { startDate: dateInputValue(start), endDate: dateInputValue(now) };
  }
  if (period === "this_month") return { month: String(now.getMonth() + 1), year: String(now.getFullYear()) };
  if (period === "last_month") {
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { month: String(last.getMonth() + 1), year: String(last.getFullYear()) };
  }
  return {};
}

function normalizeFilterPatch(current, key, value) {
  const next = { ...current, [key]: value };
  if (key === "period" && value !== "custom") {
    next.startDate = "";
    next.endDate = "";
  }
  if (["period", "startDate", "endDate"].includes(key)) {
    next.month = "";
    next.year = "";
  }
  if (["month", "year"].includes(key)) {
    next.period = "";
    next.startDate = "";
    next.endDate = "";
  }
  return next;
}

function filterPeriodTitle(filters) {
  if (filters.period === "custom") {
    if (filters.startDate && filters.endDate) return `${formatShortDate(filters.startDate)} - ${formatShortDate(filters.endDate)}`;
    return "Custom Range";
  }
  const month = monthOptions.find((item) => item.value === filters.month)?.label;
  if (month && filters.year) return `${month} ${filters.year}`;
  if (month) return month;
  if (filters.year) return filters.year;
  return "All Reports";
}

function buildPersonLedgerQuery(filters) {
  return Object.entries(filters).reduce((query, [key, value]) => {
    if (value) query[key] = value;
    return query;
  }, {});
}

function activeFilterChips(filters, resources = {}) {
  const lookupName = (key, id) => resources[key]?.find((item) => item._id === id)?.name || "Selected";
  const labelMaps = {
    period: Object.fromEntries(periodOptions.map((item) => [item.value, item.label])),
    type: Object.fromEntries(transactionTypeOptions.map((item) => [item.value, item.label])),
    balanceStatus: { pending: "Pending", partial: "Partial", settled: "Settled", overdue: "Overdue", overdue_payable: "Overdue Payments", overdue_receivable: "Overdue Receivables" },
    sort: Object.fromEntries(sortOptions.map((item) => [item.value, item.label])),
    month: Object.fromEntries(monthOptions.map((item) => [item.value, item.label])),
    status: { ACTIVE: "Active", CANCELLED: "Cancelled" },
    dashboardFilter: {
      account_history: "Account History",
      income: "Income",
      personal_expense: "Personal Expense",
      to_receive: "To Receive · Outstanding",
      to_pay: "To Pay · Outstanding",
      lent_outstanding: "Lent Outstanding",
      paid_for_someone_outstanding: "Paid for Someone · Outstanding",
      borrowed_outstanding: "Borrowed · Outstanding",
      someone_paid_for_me_outstanding: "Someone Paid for Me · Outstanding",
      received_back: "Received Back",
      paid_back: "Paid Back"
    },
    direction: { PAYABLE: "Payable", RECEIVABLE: "Receivable" },
    due: { TODAY: "Today", UPCOMING: "Upcoming", OVERDUE: "Overdue" }
  };
  return Object.entries(filters)
    .filter(([key, value]) => value && !(key === "sort" && value === "newest"))
    .map(([key, value]) => {
      const label =
        ["account", "person", "category", "tag"].includes(key)
          ? lookupName(key, value)
          : labelMaps[key]?.[value] || value;
      return {
        key,
        label: ["startDate", "endDate"].includes(key) ? `${filterLabel(key)} ${label}` : label,
        reset: key === "sort" ? "newest" : ""
      };
    });
}

function filterLabel(key) {
  return {
    q: "Search",
    period: "Date",
    startDate: "From",
    endDate: "To",
    month: "Month",
    year: "Year",
    type: "Type",
    account: "Account",
    person: "Person",
    category: "Category",
    tag: "Tag",
    status: "Status",
    balanceStatus: "State",
    dashboardFilter: "View",
    direction: "Direction",
    due: "When",
    sort: "Sort"
  }[key] || key;
}

function formatCurrency(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

function dateInputValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatTimeValue(value) {
  if (!value) return "";
  const [hour, minute] = String(value).split(":").map(Number);
  const date = new Date();
  date.setHours(hour || 0, minute || 0, 0, 0);
  return date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

function formatSettlementDateTime(settlement) {
  const date = new Date(settlement.settlementDate);
  const [hour, minute] = String(settlement.settlementTime || "00:00").split(":").map(Number);
  date.setHours(hour || 0, minute || 0, 0, 0);
  return date.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function friendlyDataError(message) {
  if (!message) return "Something went wrong. Please retry.";
  if (message.includes("Unable to connect")) return "Unable to connect to server. Try again.";
  if (message.includes("Internal server")) return "Something went wrong. Please retry.";
  return message;
}

function transactionLabel(type) {
  return {
    EXPENSE: "Expense",
    INCOME: "Income",
    BORROW: "Borrowed",
    LEND: "Lent",
    PAID_FOR_SOMEONE: "To Receive",
    PAID_BY_SOMEONE: "To Pay",
    TRANSFER: "Transfer",
    REPAYMENT_RECEIVED: "Repayment received",
    REPAYMENT_PAID: "Repayment paid",
    SPLIT_EXPENSE: "Split Expense",
    BALANCE_ADJUSTMENT: "Balance adjustment"
  }[type] || type;
}

function transactionMeta(transaction) {
  const accountName = transaction.account?.name || "Account";
  const destinationName = transaction.destinationAccount?.name;
  const personName = transaction.person?.name;
  const amount = formatCurrency(transaction.amount);
  const personalAmount = formatCurrency(transaction.myShare ?? transaction.amount);
  const meta = {
    EXPENSE: {
      icon: Receipt,
      state: "spent",
      label: "Expense",
      title: transaction.note || transaction.category?.name || "Expense",
      subtitle: accountName,
      amount: `-${personalAmount}`,
      amountClass: "text-coral"
    },
    INCOME: {
      icon: Banknote,
      state: "receive",
      label: "Income",
      title: transaction.note || transaction.category?.name || "Income",
      subtitle: accountName,
      amount: `+${amount}`,
      amountClass: "text-emerald"
    },
    BORROW: {
      icon: ArrowDownLeft,
      state: "borrowed",
      label: "Loan Taken",
      title: `Borrowed from ${personName || "person"}`,
      subtitle: accountName,
      amount: amount,
      amountClass: "text-amber"
    },
    LEND: {
      icon: ArrowUpRight,
      state: "owed",
      label: "Lent Money",
      title: `Lent to ${personName || "person"}`,
      subtitle: accountName,
      amount: amount,
      amountClass: "text-emerald"
    },
    PAID_FOR_SOMEONE: {
      icon: HandCoins,
      state: "owed",
      label: "Paid for Someone",
      title: `Paid for ${personName || "person"}`,
      subtitle: accountName,
      amount: amount,
      amountClass: "text-emerald"
    },
    PAID_BY_SOMEONE: {
      icon: CircleDollarSign,
      state: "pay",
      label: "Someone Paid for Me",
      title: transaction.note || `${personName || "Someone"} paid`,
      subtitle: "Personal expense",
      amount: personalAmount,
      amountClass: "text-coral"
    },
    TRANSFER: {
      icon: Landmark,
      state: "income",
      label: "Transfer",
      title: "Account transfer",
      subtitle: `${accountName} to ${destinationName || "account"}`,
      amount: amount,
      amountClass: "text-primary"
    },
    REPAYMENT_RECEIVED: {
      icon: CheckCircle2,
      state: "receive",
      label: "Payment Received",
      title: `Received from ${personName || "person"}`,
      subtitle: accountName,
      amount: `+${amount}`,
      amountClass: "text-emerald"
    },
    REPAYMENT_PAID: {
      icon: CheckCircle2,
      state: "pay",
      label: "Payment Made",
      title: `Paid to ${personName || "person"}`,
      subtitle: accountName,
      amount: `-${amount}`,
      amountClass: "text-coral"
    },
    SPLIT_EXPENSE: {
      icon: Receipt,
      state: "spent",
      label: "Split Expense",
      title: transaction.note || "Split expense",
      subtitle: accountName,
      amount: `-${personalAmount}`,
      amountClass: "text-coral"
    },
    BALANCE_ADJUSTMENT: {
      icon: Wallet,
      state: transaction.adjustmentDirection === "INCREASE" ? "income" : "spent",
      label: "Balance adjustment",
      title: transaction.note || "Balance adjustment",
      subtitle: accountName,
      amount: `${transaction.adjustmentDirection === "INCREASE" ? "+" : "-"}${amount}`,
      amountClass: transaction.adjustmentDirection === "INCREASE" ? "text-emerald" : "text-coral"
    }
  };
  return meta[transaction.type] || meta.EXPENSE;
}

function transactionSystemTag(transaction, meta = transactionMeta(transaction)) {
  if (!["LEND", "PAID_FOR_SOMEONE", "BORROW", "PAID_BY_SOMEONE"].includes(transaction.type)) {
    return { label: meta.label, state: meta.state };
  }
  const original = Number(transaction.originalAmount ?? transaction.amount ?? 0);
  const remaining = Number(transaction.remainingAmount ?? original);
  const settled = transaction.repaymentStatus === "PAID" || remaining <= 0;
  if (settled) return { label: "Settled", state: "settled" };
  const partial = transaction.repaymentStatus === "PARTIAL" || remaining < original;
  const overdue = transaction.repaymentStatus === "OVERDUE"
    || Boolean(transaction.dueDate && new Date(transaction.dueDate) < new Date(new Date().setHours(0, 0, 0, 0)));
  const payable = transaction.type === "BORROW" || transaction.type === "PAID_BY_SOMEONE";
  if (overdue) return { label: partial ? `Overdue · Partially ${payable ? "Paid" : "Received"}` : "Overdue", state: "overdue" };
  if (partial) return { label: `Partially ${payable ? "Paid" : "Received"}`, state: "partial" };
  return { label: "Pending", state: payable ? "pay" : "owed" };
}

function formatDateTime(transaction) {
  const date = new Date(transaction.transactionDate);
  const dateText = date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return `${dateText} · ${formatTimeValue(transaction.transactionTime)}`;
}

function formatEventDateTime(value) {
  const date = new Date(value);
  return `${date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} · ${date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`;
}

function formatActivityDateTime(transaction) {
  const date = new Date(transaction.transactionDate);
  const dateText = date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return `${dateText} · ${formatTimeValue(transaction.transactionTime)}`;
}

function activitySubtitle(transaction, meta = transactionMeta(transaction)) {
  const accountName = transaction.account?.name || meta.subtitle;
  const personName = transaction.person?.name;
  if (transaction.type === "BORROW") return `Received in ${accountName}`;
  if (transaction.type === "LEND") return `From ${accountName}`;
  if (transaction.type === "PAID_FOR_SOMEONE") return accountName;
  if (transaction.type === "PAID_BY_SOMEONE") return personName ? `Paid by ${personName}` : "To Pay";
  if (transaction.type === "TRANSFER") return meta.subtitle;
  if (transaction.type === "REPAYMENT_PAID") return `From ${accountName}`;
  if (transaction.type === "REPAYMENT_RECEIVED") return `In ${accountName}`;
  return [transaction.category?.name, accountName].filter(Boolean).join(" · ") || meta.subtitle;
}

function groupTransactions(items) {
  return items.reduce((groups, item) => {
    const label = transactionGroupLabel(item.transactionDate);
    return { ...groups, [label]: [...(groups[label] || []), item] };
  }, {});
}

function groupActivityItems(items) {
  return items
    .sort((a, b) => activitySortValue(b) - activitySortValue(a))
    .reduce((groups, item) => {
      const label = transactionGroupLabel(item.date);
      return { ...groups, [label]: [...(groups[label] || []), item] };
    }, {});
}

function activitySortValue(item) {
  const date = new Date(item.date);
  if (item.time) {
    const [hour, minute] = String(item.time).split(":").map(Number);
    date.setHours(hour || 0, minute || 0, 0, 0);
  }
  return date.getTime();
}

function activityGroupEntries(groups) {
  const preferred = ["Today", "Yesterday", "This Week", "Earlier This Month", "Older"];
  const entries = Object.entries(groups);
  return entries.sort(([a], [b]) => {
    const aIndex = preferred.indexOf(a);
    const bIndex = preferred.indexOf(b);
    if (aIndex === -1 && bIndex === -1) return 0;
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
}

function transactionGroupLabel(dateValue) {
  const date = new Date(dateValue);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const weekStart = new Date(today);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(today.getDate() - today.getDay());

  if (isSameDay(date, today)) return "Today";
  if (isSameDay(date, yesterday)) return "Yesterday";
  if (date >= weekStart && date <= today) return "This Week";
  if (date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear()) {
    return "Earlier This Month";
  }
  return "Older";
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function CategoryRow({ category }) {
  const Icon = category.icon;
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className={`grid size-11 place-items-center rounded-2xl ${formatTone(category.color)}`}>
          <Icon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h3 className="truncate font-bold">{category.name}</h3>
            <p className="font-bold">{category.amount}</p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#ECE5D9]">
            <div className={`h-full rounded-full ${barColor(category.color)}`} style={{ width: category.width }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function barColor(color) {
  return {
    coral: "bg-coral",
    income: "bg-income",
    amber: "bg-amber",
    primary: "bg-primary",
    emerald: "bg-emerald"
  }[color] || "bg-coral";
}

function TransactionRow({ transaction }) {
  const meta = transactionMeta(transaction);
  const Icon = meta.icon;
  const systemTag = transactionSystemTag(transaction, meta);
  const obligationTransaction = ["LEND", "PAID_FOR_SOMEONE", "BORROW", "PAID_BY_SOMEONE"].includes(transaction.type);
  return (
    <article className="flex items-start gap-3 rounded-3xl bg-cream p-4 shadow-card">
      <div className={`grid size-11 shrink-0 place-items-center rounded-2xl ${stateStyles[systemTag.state] || stateStyles[meta.state]}`}>
        <Icon size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="truncate font-bold">{meta.title}</h3>
          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase ${stateStyles[systemTag.state] || stateStyles.neutral}`}>{systemTag.label}</span>
        </div>
        <p className="mt-1 truncate text-xs font-semibold text-muted">{meta.subtitle} · {formatDateTime(transaction)}</p>
        {obligationTransaction && (
          <p className="mt-2 text-xs font-semibold text-muted">
            Original {formatCurrency(transaction.originalAmount ?? transaction.amount)} · {transaction.type === "BORROW" || transaction.type === "PAID_BY_SOMEONE" ? "Paid" : "Received"} {formatCurrency(Number(transaction.originalAmount ?? transaction.amount) - Number(transaction.remainingAmount ?? transaction.amount))} · Remaining {formatCurrency(transaction.remainingAmount)}
          </p>
        )}
      </div>
      <p className={`font-bold ${meta.amountClass}`}>
        {meta.amount}
      </p>
    </article>
  );
}

function PageHeader({ icon: Icon, title, subtitle, className = "" }) {
  return (
    <header className={`flex items-center justify-between ${className}`}>
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm font-semibold text-muted">{subtitle}</p>
      </div>
      <div className="grid size-12 place-items-center rounded-2xl bg-cream text-primary shadow-card">
        <Icon size={23} />
      </div>
    </header>
  );
}

function Avatar({ person, large = false }) {
  const initials = person.initials || person.name?.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "P";
  return (
    <div
      className={`${large ? "mx-auto size-20 text-xl" : "size-12 text-sm"} grid shrink-0 place-items-center rounded-3xl ${formatTone(person.avatarColor || person.tone)} font-bold`}
    >
      {initials}
    </div>
  );
}

function AccountFormSheet({ open, account, onClose, onSave }) {
  const [form, setForm] = useState(accountFormDefaults(account));

  useEffect(() => {
    setForm(accountFormDefaults(account));
  }, [account, open]);

  return (
    <FormSheet
      open={open}
      title={account ? "Edit Account" : "Add Account"}
      onClose={onClose}
      onSubmit={() => onSave({ ...form, currentBalance: Number(form.currentBalance), openingBalance: Number(form.openingBalance) })}
    >
      <FormInput label="Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
      <FormSelect
        label="Type"
        value={form.type}
        onChange={(value) => setForm({ ...form, type: value })}
        options={["CASH", "BANK", "WALLET", "CREDIT_CARD"]}
      />
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Opening" type="number" value={form.openingBalance} onChange={(value) => setForm({ ...form, openingBalance: value })} />
        <FormInput label="Current" type="number" value={form.currentBalance} onChange={(value) => setForm({ ...form, currentBalance: value })} />
      </div>
      <FormInput label="Icon" value={form.icon} onChange={(value) => setForm({ ...form, icon: value })} />
    </FormSheet>
  );
}

function PersonFormSheet({ open, person, onClose, onSave }) {
  const [form, setForm] = useState(personFormDefaults(person));

  useEffect(() => {
    setForm(personFormDefaults(person));
  }, [person, open]);

  return (
    <FormSheet open={open} title={person ? "Edit Person" : "Add Person"} onClose={onClose} onSubmit={() => onSave(form)}>
      <FormInput label="Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
      <FormInput label="Phone" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} />
      <FormInput label="Email" type="email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} />
      <FormInput label="Note" value={form.note} onChange={(value) => setForm({ ...form, note: value })} />
      <FormSelect
        label="Avatar Color"
        value={form.avatarColor}
        onChange={(value) => setForm({ ...form, avatarColor: value })}
        options={["emerald", "income", "amber", "coral", "primary"]}
      />
    </FormSheet>
  );
}

function CategoryFormSheet({ open, category, onClose, onSave }) {
  const [form, setForm] = useState(categoryFormDefaults(category));

  useEffect(() => {
    setForm(categoryFormDefaults(category));
  }, [category, open]);

  return (
    <FormSheet open={open} title={category ? "Edit Category" : "Add Category"} onClose={onClose} onSubmit={() => onSave(form)}>
      <FormInput label="Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
      <FormSelect
        label="Type"
        value={form.type}
        onChange={(value) => setForm({ ...form, type: value })}
        options={["EXPENSE", "INCOME"]}
      />
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Icon" value={form.icon} onChange={(value) => setForm({ ...form, icon: value })} />
        <FormSelect
          label="Color"
          value={form.color}
          onChange={(value) => setForm({ ...form, color: value })}
          options={["coral", "income", "amber", "emerald", "primary"]}
        />
      </div>
      <label className="flex items-center justify-between rounded-3xl bg-paper p-4 text-sm font-bold">
        Default category
        <input
          type="checkbox"
          checked={form.isDefault}
          onChange={(event) => setForm({ ...form, isDefault: event.target.checked })}
          className="size-5 accent-primary"
        />
      </label>
    </FormSheet>
  );
}

function TagFormSheet({ open, tag: tagItem, onClose, onSave }) {
  const [form, setForm] = useState(tagFormDefaults(tagItem));

  useEffect(() => {
    setForm(tagFormDefaults(tagItem));
  }, [tagItem, open]);

  return (
    <FormSheet open={open} title={tagItem ? "Edit Tag" : "Add Tag"} onClose={onClose} onSubmit={() => onSave(form)}>
      <FormInput label="Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
      <FormSelect
        label="Color"
        value={form.color}
        onChange={(value) => setForm({ ...form, color: value })}
        options={["primary", "emerald", "income", "amber", "coral"]}
      />
    </FormSheet>
  );
}

function FormSheet({ open, title, children, onClose, onSubmit, submitLabel = "Save", canSubmit = true }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submittingRef = useRef(false);

  useEffect(() => {
    if (open) setError("");
  }, [open]);

  const submit = async (event) => {
    event.preventDefault();
    if (submittingRef.current || !canSubmit) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit();
    } catch (err) {
      setError(err.message);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className={`fixed inset-0 z-50 transition ${open ? "pointer-events-auto" : "pointer-events-none"}`}>
      <button
        className={`absolute inset-0 bg-charcoal/30 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
        aria-label="Close form"
      />
      <form
        onSubmit={submit}
        className={`absolute inset-x-0 bottom-0 mx-auto max-w-md rounded-t-[2rem] bg-cream px-5 pb-7 pt-4 shadow-soft transition-transform duration-300 md:bottom-auto md:top-1/2 md:max-w-xl md:rounded-3xl md:px-6 md:pb-6 ${
          open ? "translate-y-0 md:-translate-y-1/2" : "translate-y-full md:translate-y-full"
        }`}
      >
        <div className="mx-auto h-1.5 w-12 rounded-full bg-[#D8D0C4]" />
        <div className="mt-5 flex items-center justify-between">
          <h2 className="text-xl font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-2xl bg-paper text-muted">
            <X size={20} />
          </button>
        </div>
        <div className="mt-5 max-h-[65vh] space-y-3 overflow-y-auto pb-2">
          {children}
          {error && <p className="whitespace-pre-line rounded-2xl bg-coralSoft p-3 text-sm font-bold text-coral">{error}</p>}
        </div>
        <button disabled={submitting || !canSubmit} className="mt-4 w-full rounded-3xl bg-primary px-4 py-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">
          {submitting ? "Saving..." : submitLabel}
        </button>
      </form>
    </div>
  );
}

function FormInput({ label, value, onChange, type = "text", error }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-muted">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-3xl border-0 bg-paper px-4 py-4 text-sm font-bold text-charcoal outline-none ring-1 ring-transparent transition focus:ring-primary/30"
      />
      {error && <span className="mt-2 block text-xs font-bold text-coral">{error}</span>}
    </label>
  );
}

function FormSelect({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-3xl border-0 bg-paper px-4 py-4 text-sm font-bold text-charcoal outline-none ring-1 ring-transparent transition focus:ring-primary/30"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option.replace("_", " ")}
          </option>
        ))}
      </select>
    </label>
  );
}

function ResourceSelect({ label, value, onChange, items, placeholder, optional = false }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-3xl border-0 bg-paper px-4 py-4 text-sm font-bold text-charcoal outline-none ring-1 ring-transparent transition focus:ring-primary/30"
      >
        <option value="">{placeholder}</option>
        {items.map((item) => (
          <option key={item._id} value={item._id}>
            {item.name}
          </option>
        ))}
      </select>
      {!optional && !items.length && (
        <span className="mt-2 block text-xs font-semibold text-coral">Add this master data first.</span>
      )}
    </label>
  );
}

function optionToTransactionType(option) {
  return {
    Expense: "EXPENSE",
    Income: "INCOME",
    "Paid for Someone": "PAID_FOR_SOMEONE",
    "Someone Paid for Me": "PAID_BY_SOMEONE",
    "Lend Money": "LEND",
    "Borrow Money": "BORROW",
    Transfer: "TRANSFER",
    "Split Expense": "SPLIT_EXPENSE"
  }[option];
}

function transactionFormDefaults(type = "EXPENSE") {
  const now = new Date();
  return {
    type,
    amount: "",
    account: "",
    destinationAccount: "",
    person: "",
    category: "",
    tag: "",
    note: "",
    transactionDate: now.toISOString().slice(0, 10),
    transactionTime: now.toTimeString().slice(0, 5),
    dueDate: "",
    reminderEnabled: false,
    reminderStartDaysBefore: 3,
    reminderTime1: "09:00",
    reminderTime2: "14:00",
    reminderTime3: "20:00",
    myShare: "",
    splitPerson: "",
    splitAmount: ""
  };
}

function buildTransactionPayload(type, form) {
  if (type === "SPLIT_EXPENSE") {
    return {
      amount: Number(form.amount),
      myShare: Number(form.myShare),
      account: form.account,
      category: form.category || undefined,
      tags: form.tag ? [form.tag] : [],
      note: form.note,
      transactionDate: form.transactionDate,
      transactionTime: form.transactionTime,
    dueDate: form.dueDate || undefined,
    reminderEnabled: form.reminderEnabled,
    reminderStartDaysBefore: Number(form.reminderStartDaysBefore || 3),
    reminderTimes: [form.reminderTime1, form.reminderTime2, form.reminderTime3].filter(Boolean),
    participants: form.splitPerson && form.splitAmount ? [{ person: form.splitPerson, amount: Number(form.splitAmount) }] : []
    };
  }

  return {
    type,
    amount: Number(form.amount),
    account: type === "PAID_BY_SOMEONE" ? undefined : form.account,
    destinationAccount: form.destinationAccount || undefined,
    person: form.person || undefined,
    category: form.category || undefined,
    tags: form.tag ? [form.tag] : [],
    note: form.note,
    transactionDate: form.transactionDate,
    transactionTime: form.transactionTime,
    dueDate: form.dueDate || undefined,
    reminderEnabled: form.reminderEnabled,
    reminderStartDaysBefore: Number(form.reminderStartDaysBefore || 3),
    reminderTimes: [form.reminderTime1, form.reminderTime2, form.reminderTime3].filter(Boolean)
  };
}

function accountFormDefaults(account) {
  return {
    name: account?.name || "",
    type: account?.type || "BANK",
    openingBalance: account?.openingBalance ?? 0,
    currentBalance: account?.currentBalance ?? 0,
    icon: account?.icon || "Wallet",
    isActive: true
  };
}

function personFormDefaults(person) {
  return {
    name: person?.name || "",
    phone: person?.phone || "",
    email: person?.email || "",
    note: person?.note || "",
    avatarColor: person?.avatarColor || "emerald",
    isActive: true
  };
}

function categoryFormDefaults(category) {
  return {
    name: category?.name || "",
    type: category?.type || "EXPENSE",
    icon: category?.icon || "Receipt",
    color: category?.color || "coral",
    isDefault: category?.isDefault || false,
    isActive: true
  };
}

function tagFormDefaults(tagItem) {
  return {
    name: tagItem?.name || "",
    color: tagItem?.color || "primary"
  };
}

function recurringFormDefaults() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  return {
    name: "",
    type: "EXPENSE",
    amount: "",
    account: "",
    category: "",
    note: "",
    frequency: "MONTHLY",
    interval: 1,
    startDate: date,
    nextRunDate: date,
    transactionTime: "09:00",
    reminderEnabled: false,
    reminderStartDaysBefore: 3,
    reminderTime1: "09:00",
    reminderTime2: "14:00",
    reminderTime3: "20:00"
  };
}

function formatShortDate(value) {
  if (!value) return "not set";
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function BottomNav({ activeTab, onChange, onAdd }) {
  const items = navigationItems.filter((item) => ["home", "activity", "people", "settlements"].includes(item.id));

  return (
    <nav className="safe-area-bottom-nav fixed inset-x-0 z-40 mx-auto max-w-md px-5 pb-4 md:hidden">
      <div className="relative grid grid-cols-5 items-center rounded-[1.6rem] bg-cream px-2 py-3 shadow-soft">
        {items.slice(0, 2).map((item) => (
          <NavItem key={item.id} item={item} active={activeTab === item.id} onClick={() => onChange(item.id)} />
        ))}
        <button
          onClick={onAdd}
          className="mx-auto -mt-8 grid size-16 place-items-center rounded-full bg-primary text-white shadow-soft ring-8 ring-paper"
          aria-label="Add transaction"
        >
          <Plus size={30} />
        </button>
        {items.slice(2).map((item) => (
          <NavItem key={item.id} item={item} active={activeTab === item.id} onClick={() => onChange(item.id)} />
        ))}
      </div>
    </nav>
  );
}

function NavItem({ item, active, onClick }) {
  const Icon = item.icon;
  return (
    <button onClick={onClick} className={`flex flex-col items-center gap-1 text-[11px] font-bold ${active ? "text-primary" : "text-muted"}`}>
      <Icon size={21} strokeWidth={active ? 2.8 : 2.2} />
      <span>{item.label}</span>
    </button>
  );
}

function AddTransactionSheet({ open, onClose, onCreated }) {
  const icons = [Receipt, Banknote, HandCoins, CircleDollarSign, Send, ArrowDownLeft, CheckCircle2, Landmark, Receipt];
  const accounts = useResource("accounts", {}, open ? 1 : 0);
  const peopleResource = useResource("people", {}, open ? 1 : 0);
  const categoriesResource = useResource("categories", {}, open ? 1 : 0);
  const tagsResource = useResource("tags", {}, open ? 1 : 0);
  const quickAddResource = useResource("quick-add", {}, open ? 1 : 0);
  const [selectedType, setSelectedType] = useState("");
  const [form, setForm] = useState(transactionFormDefaults());
  const [presetName, setPresetName] = useState("");
  const [presetIcon, setPresetIcon] = useState("Receipt");
  const [presetFavorite, setPresetFavorite] = useState(false);
  const [editingPresetId, setEditingPresetId] = useState("");
  const [presetsExpanded, setPresetsExpanded] = useState(false);
  const [presetSearch, setPresetSearch] = useState("");
  const [presetCategory, setPresetCategory] = useState("Recent");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const scrollY = window.scrollY;
    const previousBody = {
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      width: document.body.style.width,
      overflow: document.body.style.overflow
    };
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      Object.assign(document.body.style, previousBody);
      document.documentElement.style.overflow = previousHtmlOverflow;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSelectedType("");
      setForm(transactionFormDefaults());
      setPresetName("");
      setPresetIcon("Receipt");
      setPresetFavorite(false);
      setEditingPresetId("");
      setPresetsExpanded(false);
      setPresetSearch("");
      setPresetCategory("Recent");
      setError("");
    }
  }, [open]);

  const begin = (option) => {
    const type = optionToTransactionType(option);
    if (!type) return;
    setSelectedType(type);
    setForm(transactionFormDefaults(type));
    setPresetName("");
    setPresetIcon("Receipt");
    setPresetFavorite(false);
    setEditingPresetId("");
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const selectedAccount = accounts.items.find((item) => item._id === form.account);
      const required = outgoingAmountForForm(selectedType, form);
      if (required > 0 && !hasEnoughBalance(selectedAccount, required)) {
        setError(`${insufficientBalanceMessage(selectedAccount, required)}\nActions: Add Money · Change Account · Transfer Funds`);
        setSaving(false);
        return;
      }
      if (selectedType === "SPLIT_EXPENSE") {
        await api.create("transactions/split", buildTransactionPayload(selectedType, form));
      } else {
        await api.create("transactions", buildTransactionPayload(selectedType, form));
      }
      onCreated?.();
      onClose();
    } catch (err) {
      setError(err.kind === "offline"
        ? "No internet. Your entry has not been saved. Retry when connected."
        : err.kind === "network" || err.status >= 500
          ? "Unable to save. Your entry has not been lost. Retry."
          : err.message);
    } finally {
      setSaving(false);
    }
  };

  const personRequired = ["BORROW", "LEND", "PAID_FOR_SOMEONE", "PAID_BY_SOMEONE"].includes(selectedType);
  const loanFields = personRequired;
  const transfer = selectedType === "TRANSFER";
  const someonePaidForMe = selectedType === "PAID_BY_SOMEONE";
  const splitExpense = selectedType === "SPLIT_EXPENSE";
  const canSavePreset = ["EXPENSE", "INCOME"].includes(selectedType);
  const categoryOptions = categoriesResource.items.filter((item) =>
    selectedType === "INCOME" ? item.type === "INCOME" : item.type === "EXPENSE"
  );
  const quickExpensePresets = useMemo(
    () => [...new Map(quickAddResource.items.filter((preset) => preset.type === "EXPENSE").map((preset) => [String(preset._id), preset])).values()],
    [quickAddResource.items]
  );
  const recentlyUsedPresets = useMemo(
    () => quickExpensePresets
      .filter((preset) => preset.lastUsedAt || Number(preset.usageCount || 0) > 0)
      .sort((a, b) => {
        const lastUsedDelta = new Date(b.lastUsedAt || 0).getTime() - new Date(a.lastUsedAt || 0).getTime();
        return lastUsedDelta || Number(b.usageCount || 0) - Number(a.usageCount || 0);
      })
      .slice(0, 4),
    [quickExpensePresets]
  );
  const presetCategoryOptions = ["Recent", "Food", "Bills", "Travel", "Daily", "Entertainment", "All", "Other Presets"];
  const visibleQuickPresets = useMemo(() => {
    const search = presetSearch.trim().toLowerCase();
    const source = presetCategory === "Recent" ? recentlyUsedPresets : quickExpensePresets;
    return source.filter((preset) => {
      const group = String(preset.presetGroup || "").trim().toLowerCase();
      const categoryName = String(preset.category?.name || "").trim().toLowerCase();
      const matchesCategory = presetCategory === "All" || presetCategory === "Recent"
        || (presetCategory === "Other Presets"
          ? !["food", "bills", "travel", "daily", "entertainment"].includes(group)
          : group === presetCategory.toLowerCase() || categoryName === presetCategory.toLowerCase());
      const searchable = [preset.name, preset.note, preset.presetGroup, preset.category?.name]
        .filter(Boolean).join(" ").toLowerCase();
      return matchesCategory && (!search || searchable.includes(search));
    });
  }, [presetSearch, presetCategory, recentlyUsedPresets, quickExpensePresets]);

  const applyPreset = (preset, trackUsage = true) => {
    const type = preset.type || "EXPENSE";
    setSelectedType(type);
    setForm({
      ...transactionFormDefaults(type),
      amount: preset.amount || "",
      account: preset.account?._id || preset.account || "",
      category: preset.category?._id || preset.category || "",
      tag: preset.tags?.[0]?._id || preset.tags?.[0] || "",
      note: preset.note || preset.name
    });
    setPresetName(preset.name || "");
    setPresetIcon(preset.icon || "Receipt");
    setPresetFavorite(Boolean(preset.favorite));
    setEditingPresetId("");
    if (trackUsage) {
      api.create(`quick-add/${preset._id}/use`, {}).then(() => quickAddResource.refresh()).catch(() => {});
    }
  };

  const editPreset = (preset) => {
    applyPreset(preset, false);
    setEditingPresetId(preset._id);
  };

  const togglePresetFavorite = async (preset) => {
    setError("");
    try {
      await api.update("quick-add", preset._id, { favorite: !preset.favorite });
      await quickAddResource.refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const deletePreset = async (preset) => {
    setError("");
    try {
      await api.remove("quick-add", preset._id);
      if (editingPresetId === preset._id) {
        setEditingPresetId("");
        setPresetName("");
      }
      await quickAddResource.refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const savePreset = async () => {
    if (!canSavePreset) return;
    setError("");
    try {
      const payload = {
        name: presetName || form.note || transactionLabel(selectedType),
        type: selectedType,
        amount: form.amount ? Number(form.amount) : undefined,
        account: form.account || undefined,
        category: form.category || undefined,
        tags: form.tag ? [form.tag] : [],
        note: form.note || presetName,
        presetGroup: "Custom",
        icon: presetIcon || "Receipt",
        favorite: presetFavorite
      };
      if (editingPresetId) {
        await api.update("quick-add", editingPresetId, payload);
      } else {
        await api.create("quick-add", payload);
      }
      setPresetName("");
      setPresetIcon("Receipt");
      setPresetFavorite(false);
      setEditingPresetId("");
      await quickAddResource.refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const renderPresetCard = (preset) => (
    <div key={preset._id} className="min-w-0 rounded-2xl bg-cream p-2">
      <button type="button" onClick={() => applyPreset(preset)} className="w-full min-w-0 text-left">
        <span className="block truncate text-xs font-bold text-charcoal">{preset.name}</span>
        <span className="mt-1 block truncate text-[11px] font-bold text-muted">
          {preset.category?.name || preset.presetGroup || "Expense"}
          {preset.amount ? ` · ${formatCurrency(preset.amount)}` : ""}
        </span>
      </button>
      <div className="mt-2 flex items-center gap-1">
        <button type="button" onClick={() => togglePresetFavorite(preset)} className={`grid size-7 place-items-center rounded-xl ${preset.favorite ? "bg-amberSoft text-amber" : "bg-paper text-muted"}`} aria-label={preset.favorite ? "Remove favorite" : "Mark favorite"}>
          <Star size={14} fill={preset.favorite ? "currentColor" : "none"} />
        </button>
        <button type="button" onClick={() => editPreset(preset)} className="grid size-7 place-items-center rounded-xl bg-violetSoft text-primary" aria-label="Edit quick expense">
          <Edit3 size={14} />
        </button>
        <button type="button" onClick={() => deletePreset(preset)} className="grid size-7 place-items-center rounded-xl bg-coralSoft text-coral" aria-label="Delete quick expense">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );

  return (
    <div className={`fixed inset-0 z-50 transition ${open ? "pointer-events-auto" : "pointer-events-none"}`}>
      <button
        className={`absolute inset-0 touch-manipulation bg-charcoal/30 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
        aria-label="Close add transaction"
      />
      <section
        className={`transaction-sheet absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-md flex-col rounded-t-[2rem] bg-cream px-5 pt-3 shadow-soft transition-transform duration-300 md:bottom-auto md:top-1/2 md:max-w-2xl md:rounded-3xl md:px-6 ${
          open ? "translate-y-0 md:-translate-y-1/2" : "translate-y-full md:translate-y-full"
        }`}
      >
        <div className="transaction-sheet-header -mx-5 -mt-3 px-5 pb-3 pt-3 md:-mx-6 md:px-6">
          <div className="mx-auto h-1.5 w-12 rounded-full bg-[#D8D0C4]" />
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {selectedType && <button type="button" onClick={() => setSelectedType("")} aria-label="Back to transaction types" className="grid size-11 shrink-0 place-items-center rounded-2xl bg-paper text-muted"><ChevronLeft size={20} /></button>}
              <div className="min-w-0">
                <h2 className="text-xl font-bold">{selectedType ? transactionLabel(selectedType) : "Add Transaction"}</h2>
                <p className="mt-1 text-sm font-semibold text-muted">
                  {selectedType ? "Details stay editable until saved" : "Choose the entry type"}
                </p>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close add transaction" className="grid size-11 min-h-11 min-w-11 shrink-0 place-items-center rounded-2xl bg-paper text-muted">
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="transaction-sheet-content">
        {!selectedType ? (
          <div className="transaction-type-content mt-3 space-y-3">
            <div className="transaction-type-grid grid grid-cols-2 gap-3">
              {addOptions.map((option, index) => {
                const Icon = icons[index];
                const tone = ["coral", "income", "emerald", "amber", "emerald", "amber", "primary", "income", "coral"][index];
                const enabled = Boolean(optionToTransactionType(option));
                return (
                  <button
                    key={option}
                    onClick={() => begin(option)}
                    disabled={!enabled}
                    className="flex min-h-20 min-w-0 items-center gap-3 rounded-3xl bg-paper p-3 text-left disabled:opacity-50"
                  >
                    <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${formatTone(tone)}`}>
                      <Icon size={20} />
                    </span>
                    <span className="min-w-0 text-sm font-bold leading-tight">{option}</span>
                  </button>
                );
              })}
            </div>
            {error && <p className="whitespace-pre-line rounded-2xl bg-coralSoft p-3 text-sm font-bold text-coral">{error}</p>}

            <section className="quick-expense-card rounded-3xl bg-paper p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-muted">Quick Expense</h3>
                  <p className="mt-1 text-[11px] font-semibold text-muted">Recently Used</p>
                </div>
                {!presetsExpanded && <span className="text-[11px] font-semibold text-muted">Up to 4 presets</span>}
              </div>
              {!presetsExpanded ? (
                <>
                  {recentlyUsedPresets.length ? (
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {recentlyUsedPresets.map(renderPresetCard)}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted">Your recently used presets will appear here.</p>
                  )}
                  <button type="button" onClick={() => { setPresetCategory("All"); setPresetsExpanded(true); }} className="mt-3 w-full rounded-xl bg-white px-3 py-2 text-xs font-bold text-primary">
                    View All Presets
                  </button>
                </>
              ) : (
                <div className="mt-3 space-y-3">
                  <input
                    type="search"
                    aria-label="Search presets"
                    placeholder="Search presets..."
                    value={presetSearch}
                    onChange={(event) => setPresetSearch(event.target.value)}
                    className="w-full rounded-xl border border-[#E5EAF0] bg-white px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                  <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
                    {presetCategoryOptions.map((category) => (
                      <button
                        key={category}
                        type="button"
                        onClick={() => setPresetCategory(category)}
                        className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${presetCategory === category ? "bg-primary text-white" : "bg-white text-muted"}`}
                      >
                        {category}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] font-bold text-muted">{presetCategory === "Recent" ? "Recently Used" : presetCategory}</p>
                  {visibleQuickPresets.length ? (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {visibleQuickPresets.map(renderPresetCard)}
                    </div>
                  ) : (
                    <p className="rounded-xl bg-white p-3 text-xs text-muted">No presets found.</p>
                  )}
                  <button type="button" onClick={() => { setPresetsExpanded(false); setPresetSearch(""); setPresetCategory("Recent"); }} className="w-full rounded-xl bg-white px-3 py-2 text-xs font-bold text-primary">
                    Show Less
                  </button>
                </div>
              )}
            </section>
          </div>
        ) : (
          <form onSubmit={submit} className="transaction-type-content mt-4 space-y-3 pb-2">
            <FormInput label="Amount" type="number" value={form.amount} onChange={(value) => setForm({ ...form, amount: value })} />
            {!someonePaidForMe && (
              <ResourceSelect
                label={transfer ? "From Account" : "Account"}
                value={form.account}
                onChange={(value) => setForm({ ...form, account: value })}
                items={accounts.items}
                placeholder="Select account"
              />
            )}
            {transfer && (
              <ResourceSelect
                label="To Account"
                value={form.destinationAccount}
                onChange={(value) => setForm({ ...form, destinationAccount: value })}
                items={accounts.items.filter((item) => item._id !== form.account)}
                placeholder="Select destination"
              />
            )}
            {personRequired && (
              <ResourceSelect
                label="Person"
                value={form.person}
                onChange={(value) => setForm({ ...form, person: value })}
                items={peopleResource.items}
                placeholder="Select person"
              />
            )}
            {splitExpense && (
              <>
                <FormInput label="My Share" type="number" value={form.myShare} onChange={(value) => setForm({ ...form, myShare: value })} />
                <ResourceSelect
                  label="Split Person"
                  value={form.splitPerson}
                  onChange={(value) => setForm({ ...form, splitPerson: value })}
                  items={peopleResource.items}
                  placeholder="Select person"
                />
                <FormInput label="Their Share" type="number" value={form.splitAmount} onChange={(value) => setForm({ ...form, splitAmount: value })} />
              </>
            )}
            {!transfer && (
              <ResourceSelect
                label="Category"
                value={form.category}
                onChange={(value) => setForm({ ...form, category: value })}
                items={categoryOptions}
                placeholder="Optional category"
                optional
              />
            )}
            <ResourceSelect
              label="Tag"
              value={form.tag}
              onChange={(value) => setForm({ ...form, tag: value })}
              items={tagsResource.items}
              placeholder="Optional tag"
              optional
            />
            <div className="grid grid-cols-2 gap-3">
              <FormInput label="Date" type="date" value={form.transactionDate} onChange={(value) => setForm({ ...form, transactionDate: value })} />
              <FormInput label="Time" type="time" value={form.transactionTime} onChange={(value) => setForm({ ...form, transactionTime: value })} />
            </div>
            {loanFields && (
              <>
                <FormInput label="Due Date" type="date" value={form.dueDate} onChange={(value) => setForm({ ...form, dueDate: value })} />
                <label className="flex items-center justify-between rounded-3xl bg-paper p-4 text-sm font-bold">
                  Reminder
                  <input
                    type="checkbox"
                    checked={form.reminderEnabled}
                    onChange={(event) => setForm({ ...form, reminderEnabled: event.target.checked })}
                    className="size-5 accent-primary"
                  />
                </label>
                {form.reminderEnabled && (
                  <div className="space-y-3 rounded-3xl bg-paper p-4">
                    <FormInput label="Start Days Before" type="number" value={form.reminderStartDaysBefore} onChange={(value) => setForm({ ...form, reminderStartDaysBefore: value })} />
                    <div className="grid grid-cols-3 gap-2">
                      <FormInput label="Time 1" type="time" value={form.reminderTime1} onChange={(value) => setForm({ ...form, reminderTime1: value })} />
                      <FormInput label="Time 2" type="time" value={form.reminderTime2} onChange={(value) => setForm({ ...form, reminderTime2: value })} />
                      <FormInput label="Time 3" type="time" value={form.reminderTime3} onChange={(value) => setForm({ ...form, reminderTime3: value })} />
                    </div>
                  </div>
                )}
              </>
            )}
            <FormInput label="Note" value={form.note} onChange={(value) => setForm({ ...form, note: value })} />
            {canSavePreset && (
              <div className="rounded-3xl bg-paper p-4">
                <FormInput label="Preset Name" value={presetName} onChange={setPresetName} />
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <FormInput label="Icon" value={presetIcon} onChange={setPresetIcon} />
                  <label className="flex items-center justify-between rounded-2xl bg-cream px-4 py-3 text-sm font-bold">
                    Favorite
                    <input
                      type="checkbox"
                      checked={presetFavorite}
                      onChange={(event) => setPresetFavorite(event.target.checked)}
                      className="size-5 accent-primary"
                    />
                  </label>
                </div>
                <p className="mt-2 text-xs font-semibold text-muted">Amount and account are optional defaults for this quick expense.</p>
                <button type="button" onClick={savePreset} className="mt-3 w-full rounded-2xl bg-violetSoft px-4 py-3 text-sm font-bold text-primary">
                  {editingPresetId ? "Update Quick Expense" : "Save as Quick Expense"}
                </button>
              </div>
            )}
            {error && <p className="whitespace-pre-line rounded-2xl bg-coralSoft p-3 text-sm font-bold text-coral">{error}</p>}
            <button disabled={saving} className="w-full rounded-3xl bg-primary px-4 py-4 text-sm font-bold text-white disabled:opacity-60">
              {saving ? "Saving..." : "Save Transaction"}
            </button>
          </form>
        )}
        </div>
      </section>
    </div>
  );
}

export default App;
