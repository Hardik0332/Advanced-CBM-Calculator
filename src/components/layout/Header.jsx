/**
 * Header — Top bar with title, company profile and theme toggle.
 */
import { SunIcon, MoonIcon, MonitorIcon, FileDocIcon } from '../icons/Icons';

/* ── Theme Toggle sub-component ── */
const ThemeToggle = ({ mode, setTheme }) => {
  const options = [
    { key: 'light', icon: <SunIcon />, label: 'Light' },
    { key: 'system', icon: <MonitorIcon />, label: 'System' },
    { key: 'dark', icon: <MoonIcon />, label: 'Dark' },
  ];

  return (
    <div
      id="theme-toggle"
      className="flex items-center bg-surface-100 dark:bg-surface-800 rounded-lg p-0.5 gap-0.5 border border-surface-200 dark:border-surface-700"
      role="group"
      aria-label="Theme selection"
    >
      {options.map((o) => (
        <button
          key={o.key}
          id={`theme-${o.key}`}
          onClick={() => setTheme(o.key)}
          title={o.label}
          aria-pressed={mode === o.key}
          className={`relative flex items-center justify-center w-8 h-7 rounded-md text-xs font-medium transition-all duration-200 ease-out
            ${
              mode === o.key
                ? 'bg-white dark:bg-surface-700 text-accent-600 dark:text-accent-300 shadow-panel'
                : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'
            }`}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
};

/* ── Header component ── */
const Header = ({ mode, setTheme, onOpenProfile }) => (
  <header className="mb-6 sm:mb-8">
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <img
          src="/favicon.svg"
          alt="CBM Calculator logo"
          width="40"
          height="40"
          className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex-shrink-0"
        />
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl lg:text-[1.7rem] font-bold text-surface-900 dark:text-surface-50 tracking-tight truncate">
            CBM Calculator
          </h1>
          <p className="text-surface-600 dark:text-surface-300 text-xs sm:text-sm mt-0.5 hidden sm:block">
            Shipping volume &amp; weight management dashboard
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* The letterhead behind every exported document. Reachable from the header
            because it is set once and then wanted from anywhere, not owned by any
            one panel. */}
        <button
          type="button"
          id="company-profile-btn"
          onClick={onOpenProfile}
          title="Company profile"
          aria-label="Edit company profile"
          className="flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-xs font-medium
                     text-surface-500 dark:text-surface-400 bg-surface-100 dark:bg-surface-800
                     border border-surface-200 dark:border-surface-700
                     hover:text-accent-600 dark:hover:text-accent-300
                     hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
        >
          <FileDocIcon />
          <span className="hidden sm:inline">Profile</span>
        </button>
        <ThemeToggle mode={mode} setTheme={setTheme} />
      </div>
    </div>
  </header>
);

export default Header;
