# 08-FRONTEND-REACT — Migration, Bridge, Components

## Migration Strategy (Strangler Fig)

**Status**: ~90% migrated (8 of 10 views).

| View | Status | File | Notes |
|------|--------|------|-------|
| Dashboard | ✅ Live | `DashboardView.tsx` | KPIs, anomalies, recent items |
| Projetos | ✅ Live | `ProjetosView.tsx` | CRUD complete |
| Ações FinOps | ✅ Live | `AcoesView.tsx` | 24 monthly columns (MonthGrid) |
| Estimativas | ✅ Live | `EstimativasView.tsx` | Read/manage, PDF via bridge |
| Coleta Azure | ✅ Live | `ColetaView.tsx` | Coleta + Import + Inventário tabs |
| Calculadora | ✅ Live | `CalculadoraView.tsx` | Cost motor, pico, overlay |
| Portal Público | ✅ Live | `PublicCalculadoraView.tsx` | Unauthenticated calculator |
| Databricks Dashboard | ✅ Live | `DatabricksDashboardView.tsx` | Budgets, anomalies, job runs |
| Reservas | ⏳ Legacy | `index.html #view-reservas` | Functional, not ported yet |
| Admin Settings | ⏳ Legacy | `index.html #view-settings` | Functional, not ported yet |

## Bridge Pattern (`window.__reactBridge`)

**Purpose**: Allow legacy `app.js` to mount React components.

**Interface** (in `frontend/src/bridge.ts`):
```typescript
interface ReactBridge {
  mount(viewName: string): void;
  setViewListener(callback: (view: string | null) => void): void;
  setDashboardTab(tab: string): void;
  refresh(): void;
  logout(): void;
}
```

**Entry points**:
- `showView('projetos')` → `window.__reactBridge.mount('projetos')` (legacy `showView()` in app.js)
- `showDashTab('acoes')` → `window.__reactBridge.setDashboardTab('acoes')`
- `manualRefresh()` → `window.__reactBridge.refresh()`

**Auth share**: React reads same `sessionStorage 'finops_token'` as legacy; calls `window.logout()` on 401.

## Build Pipeline

**Frontend** (separate project):
```bash
npm run frontend:install   # npm install --prefix frontend
npm run frontend:build     # vite build
# Output: frontend/dist/react-app.js + .css + portal-app.js
```

**Two bundles**:
- `react-app.js` — authenticated app (8 views)
- `portal-app.js` — public portal (no auth)

**Integration**:
- `index.html` loads `react-app.js` via `<script type="module">`
- `portal.html` loads `portal-app.js` via `<script type="module">`

## Shared Components

| Component | Used by | Purpose |
|-----------|---------|---------|
| `CmsSelect.tsx` | Reservas, Calculadora | Dropdown with pending→commit UX |
| `CmsMultiSelect.tsx` | Calculadora | Checkboxes + "Select All", cascading hierarchy |
| `CheckboxSearchList.tsx` | Coleta wizard, Portal | Filterable checkbox list (subscriptions) |
| `MonthGrid.tsx` | Ações | 12-month dual grid (atual + próximo) |
| `StatusBadge.tsx` | Estimativas, Ações | Color-coded status rendering |
| `RecursoDetalheModal.tsx` | Calculadora, Inventário | Detailed resource view |

## State Management

**Client-side only** (no Redux/Zustand yet):
- `useQuery` (TanStack Query) — server data caching
- `useState` — local UI state (modal open, tab active, etc.)
- `localStorage` / `sessionStorage` — persist across sessions (theme, tax rates, dismissed alerts)

**No global app state** — each view owns its data.

## CSS Strategy

React components reuse existing `styles.css` (Vivo purple theme, dark/light modes):
- `.btn-primary`, `.data-table`, `.modal`, `.form-group`, etc.
- Classes prefixed with `.c` in legacy (`.cbtn`, `.cth`) added to `styles.css` when needed
- **No separate CSS-in-JS library** (avoids bundle bloat)

## Key Fixes Applied

| Issue | Fix | File |
|-------|-----|------|
| Dashboard not mounting on login | Queue system before bridge ready | `bridge.ts` |
| Checkbox drift in multi-selects | `width: auto; flex-shrink: 0` on inputs | `CmsMultiSelect.tsx` |
| Toolbar styling missing | Port `.c*` classes verbatim to `styles.css` | `styles.css` |
| Page jank on drill-down | `placeholderData: keepPreviousData` in queries | `DatabricksDashboardView.tsx` |
| Modal cutoff by parent `overflow` | `createPortal(..., document.body)` | Multiple modals |
| Dropdown outside viewport | Portal + `getBoundingClientRect()` positioning | `useCmsDropdownPosition.ts` |

---

See **02-ARCHITECTURE.md** for SPA topology; **10-DEPLOYMENT.md** for build checklist.
