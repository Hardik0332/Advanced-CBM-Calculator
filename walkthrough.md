# Walkthrough: CBM Calculator — Monolithic → Vite React (MVC)

## Summary

Migrated a **1,937-line monolithic** [index.html](file:///c:/Advanced-CBM-Calculator/public/index.html) (inline Babel + CDN React) into a **production-ready Vite React project** with strict separation of concerns across **18 source files**.

---

## Architecture

```
src/
├── main.jsx                              # Entry point
├── App.jsx                               # ~150 lines — orchestration only
├── index.css                             # Tailwind + all custom CSS
├── utils/                                # Model Layer (pure functions)
│   ├── calculations.js                   # toCm, calcCBM, CONTAINERS
│   ├── fileParser.js                     # CSV/Excel parsing, auto-mapping
│   ├── exporting.js                      # Excel + PDF export
│   └── deduplication.js                  # compositeKey, mergeProducts
├── hooks/                                # Controller Layer (state management)
│   ├── useTheme.js                       # Light/Dark/System theme
│   └── useShipment.js                    # All shipment state + CRUD ops
└── components/                           # View Layer (UI)
    ├── icons/Icons.jsx                   # 20+ SVG icon components
    ├── ui/FormInput.jsx                  # Reusable input component
    ├── layout/Header.jsx                 # Title bar + ThemeToggle
    ├── calculator/CustomCBMForm.jsx      # Left panel
    ├── shipment/ActiveShipment.jsx       # Middle panel
    ├── directory/ProductDirectory.jsx    # Right panel
    └── modals/
        ├── ManualAddModal.jsx            # Manual product entry
        └── ImportWizardModal.jsx         # 3-step CSV/Excel wizard
```

---

## Key Changes

| Aspect | Before | After |
|--------|--------|-------|
| **Build** | CDN scripts, Babel in-browser | Vite, npm modules, tree-shaking |
| **React** | UMD via `<script>` tag | ES modules, `import/export` |
| **Tailwind** | CDN runtime (`cdn.tailwindcss.com`) | PostCSS plugin (v3), JIT compiled |
| **Libraries** | Global `window.XLSX`, `Papa`, `jspdf` | ES imports from npm packages |
| **Architecture** | 1 file, 1937 lines | 18 files, strict MVC separation |
| **App.jsx** | 600+ lines of mixed logic/UI | ~150 lines, hooks + component composition |

---

## Verification

### Build
```
✓ npm run build — 234 modules, 0 errors, built in 1.58s
```

### Dev Server
```
✓ npm run dev — VITE ready in 257ms at http://localhost:5173/
```

### Visual Verification

Light theme — all 3 panels rendering correctly:

![Light theme](C:/Users/User/.gemini/antigravity-ide/brain/ab7406fe-c1d6-48ed-aa48-1b50c32cb273/initial_load_1780730523277.png)

Dark theme — theme toggle working:

![Dark theme](C:/Users/User/.gemini/antigravity-ide/brain/ab7406fe-c1d6-48ed-aa48-1b50c32cb273/dark_theme_active_1780730552834.png)

### Browser Recording

![App verification recording](C:/Users/User/.gemini/antigravity-ide/brain/ab7406fe-c1d6-48ed-aa48-1b50c32cb273/app_verification_1780730495693.webp)

---

## What's Preserved

- ✅ All Tailwind custom theme tokens (colors, shadows, gradients)
- ✅ All CSS animations (shimmer, fadeInUp, pulseGlow, spinner, wizardSlideUp, dragPulse)
- ✅ Glassmorphism card styles
- ✅ localStorage keys (`cbm-theme`, `cbm-products`, `cbm-shipment`) — backward compatible
- ✅ All business logic (CBM calculation, file parsing, deduplication, exports)
- ✅ All UI components and interactions

## What's NOT Changed

- `public/index.html` — the original monolithic file is preserved untouched
- `firebase.json` — still points to `"public": "public"` (update to `"public": "dist"` when ready to deploy)
