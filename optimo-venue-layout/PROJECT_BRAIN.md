# Optimo Venue Spatial Inventory & Layout Platform — Project Brain

> **Source documents:** Jon folder (2 Word docs + 1 infographic image)  
> **Stack:** New Angular application (Optimo-integrated)  
> **Last updated:** 2026-06-23

---

## 1. What We're Building (One-Liner)

A **unified venue spatial inventory & layout platform** — design, manage, and optimize every bookable space (seats, suites, tables, parking, GA zones) as the **single source of truth** for venue configurations, integrated with existing Optimo modules.

---

## 2. Strategic Vision (From Infographic)

| Pillar | Goal |
|--------|------|
| **One source of truth** | All venue inventory in one platform |
| **Smarter venues** | AI-assisted creation, optimization, insights |
| **Better experiences** | Interactive maps, 3D digital twin (future) |
| **Operational excellence** | Real-time visibility, reduced manual effort |

### Key benefits
- Increased revenue through optimized inventory
- Reduced manual effort via AI
- Improved customer experience with interactive maps
- Real-time visibility for sales and operations

---

## 3. Implementation Strategy (Critical for Angular)

### Front-end
- **Brand new Angular application from scratch**
- Must align with Optimo front-end architecture:
  - Optimo authentication
  - Optimo user rights
  - Optimo navigation patterns
  - Shared styling and UI standards
  - Existing API integration patterns
- Behaves as a **native Optimo module** but **separate from Setup app** (independent dev, deploy, licensing)

### Backend / API
- **Reuse existing Optimo APIs** wherever functionally correct
- Do NOT replace old APIs just because they're slow — improve via owning team
- **New APIs only** for genuinely new spatial capabilities (owned by this platform team)

### Database
- Extend existing Optimo DB — do NOT replace
- Add: spatial layout entities, geometry, versioning, 3D refs, temp-to-real allocation mapping

### Integrations (must connect with)
Setup · Booking · Diary · Fulfilment · Inventory Management · Event Management · Attendance/Scanning

---

## 4. Separation of Concerns

```
┌─────────────────────────────────────────────────────────────┐
│  SETUP APP (existing)          │  SPATIAL LAYOUT APP (new)  │
│  ─────────────────────         │  ────────────────────────  │
│  Venues, Assets, Facilities    │  Layout design              │
│  Resources, Accommodation      │  Venue map visualization    │
│  Event sessions / timeslots    │  Spatial configuration      │
│  Facility types & categories   │  Layout versioning          │
│  Core master data CRUD         │  Layout validation          │
│                                │  2D/3D representation       │
│                                │  Event-specific overrides   │
└─────────────────────────────────────────────────────────────┘
         Master data owner              Spatial data owner
                    ↕ API-led integration ↕
         Booking · Diary · Fulfilment · Allocation · External ticketing
```

### Master data editing boundary

**Editable in Layout App (layout-dependent only):**
- Facility width / depth
- Spatial orientation
- Map position
- Layout-specific display name
- Layout-specific visual attributes

**Must stay in Setup:**
- Creating facilities
- Core facility identity / type
- Ownership / asset hierarchy
- Event/session definitions

**If master data missing:** guided link/launch into Setup — never duplicate full setup.

---

## 5. Business Objectives by Stakeholder

| Stakeholder | Needs |
|-------------|-------|
| **Product / Inventory Managers** | Design layouts, configure inventory, multiple configs, commercial packaging, utilization optimization, event-specific variations |
| **Customers** (foundation for future) | Interactive seat/hospitality/space selection, self-service navigation |
| **Sales Teams** | Visual bookings, available inventory, occupancy, package availability |
| **Operations** | Seating optimization, table planning, dynamic capacity, reconfiguration, event layout adjustments |
| **Venue Management** | Occupancy, attendance, check-in, hospitality usage, real-time utilization |

### Operating models

**Venue Operators** — fixed estate, stable layouts, reusable configs, long-lived maintenance focus.

**Event Organisers** — sell before allocation exists (Olympics, tours, festivals); need inventory abstraction + deferred allocation workflows.

---

## 6. Supported Inventory Types

### 6.1 Reserved Seating
Blocks → Sections → Rows → Seats  
Stadiums, arenas, theatres, grandstands.

Features: seat/row numbering, price bands, accessibility, restricted view, seat attributes, event-specific mods.

### 6.2 Dining Areas
- **Fixed table plans** — restaurants, lounges, clubs
- **Dynamic table plans** — hospitality lounges, banquets, event dining

Features: variable sizes, merge/split, shared/private dining, categories, service zones, waiter routes, stages, exclusion zones, capacity rules (modular tables, min spacing, max occupancy).

### 6.3 Private Suites
GA inventory, table-based, or mixed. Capacity (comfort/max), event overrides, shared/private modes, internal table plans, linked external seating.

**Suite seat linking:** suite booking auto-consumes linked seating blocks.

Event variations: cocktail, standing, overflow, temporary seats/price bands.

### 6.4 General Admission
Standing, lounges, fan zones, viewing platforms, terraces.  
Capacity limits, zones, occupancy tracking, entry controls.

### 6.5 Parking
- **Capacity-based** — total count only
- **Space-based** — individual/reserved/VIP/accessible spaces

Features: zone layouts, numbering, categories, event allocations.

### 6.6 Temporary Seating Plans ⭐ (Critical)
For selling inventory **before** real seat locations exist.

| Phase | Model | Details |
|-------|-------|---------|
| **Phase 1 — Temporary** | Category-based | No real seats; capacity only (e.g. Cat A: 200, Cat B: 350) |
| **Phase 2 — Real** | Seat assignment | Convert temp → real seats, reassign bookings, apply optimization |

Real assignment may be owned by: Optimo allocation engine, venue operator, or external provider (Eventim, Ticketmaster, rights-holder platforms).

---

## 7. Venue Hierarchy

```
Venue
 └── Building (optional)     e.g. Main Stadium, Hospitality Centre, Hotel
      └── Level (optional)   e.g. Ground Floor, Level 1, Roof Terrace
           └── Facility
                └── Facility Type (system)   Seating Block | Restaurant | Lounge | Suite | Parking | GA
                     └── Facility Category (user)   Stands | Hospitality | F&B | Parking | Premium
                          └── Configuration
                               └── Configuration Version
                                    └── Layout Elements
```

---

## 8. Configuration Management

### General configurations
Multiple reusable configs per facility (football, concert, hospitality, reduced capacity). One **default** config.

### Event session configurations
Applied to **DateFacilityConfiguration (DFC)** and **EventDateFacilityTimeslot (EDFT)** — existing Optimo concepts.

Per event session:
- Use standard config
- Use copied config
- Override config
- Create one-off config  
→ **Without impacting original**

### Versioning
Version history, effective dates, change history, audit trail for all configs.

---

## 9. Layout Designer (Core Angular Feature)

### Design elements
| Category | Elements |
|----------|----------|
| Seating | Blocks, rows, seats |
| Dining | Tables, chairs, dining zones |
| Hospitality | Lounges, bars, service stations |
| General Admission | Zones, areas |
| Parking | Bays, lanes |
| Infrastructure | Walls, doors, exclusion areas, stages, screens, service/emergency routes |

### Zone-based inventory (composite zones)
Virtual zones = logical bookable areas.  
Example: Tennis Court T1 = B1A + B1B + B1C + B1D — booking T1 blocks all sub-zones and vice versa.

### Designer tools
- Drag & drop, snap to grid, alignment, layers, grouping
- Templates: seating, table, suite, parking
- Bulk ops: duplicate, move, rotate, resize, delete

### Status overlays (separate operational layers — NOT part of physical layout)
| Layer | States |
|-------|--------|
| Inventory | Available, Reserved, Sold, Held, Blocked |
| Operational | Checked In, Seated, Occupied, Released |
| Attendance | Ticket Scanned, Hospitality Checked In, Not Arrived |

---

## 10. AI Features (Phased — Phase 4+)

### AI-Assisted Venue Creation
- Upload venue maps / stadium plans / architectural drawings
- Auto-identify blocks, rows, stands, hospitality, GA zones
- Auto-create facilities, hierarchy, suggest naming, initial layouts → review screen
- Public data discovery (venue websites, Ticketmaster, stadium sites)
- Confidence scores, preview, manual correction, approval workflow

### AI-Assisted Layout Enhancement
- Capacity analysis (unused space, oversized circulation)
- Table layout suggestions (banquet, classroom, theatre, cocktail)
- Hospitality optimization recommendations

---

## 11. 3D Venue Mapping (Phase 5 — design for now)

- **Shared underlying model** — 2D and 3D are alternate views of same inventory
- 2D = primary operational view
- 3D = immersive (seat selection, view-from-seat, hospitality preview, navigation, sales)
- Future: 2D-only, 3D-only, or hybrid customer journeys

---

## 12. Dynamic Table Planning

Auto-generate table layouts from:
- Room dimensions, obstacles, service routes
- Table catalogue, capacity targets, booking patterns

Optimization: table combinations, placement, spacing, max occupancy within constraints.

---

## 13. Public vs Private Events

| Type | Characteristics | Examples |
|------|-----------------|----------|
| **Public** | Fixed date/time, multiple bookings, capacity/seat/table allocation, occupancy | Football, concerts, racing, festivals |
| **Private** | On-demand, single primary booking, entire facility, config-focused | Conferences, weddings, corporate, training |

Room configs: classroom, boardroom, theatre, banquet, cocktail, custom (templates or one-offs).

Shared event support: public/public, private/private, public/private sharing with facility-level rules.

---

## 14. Future Inventory Types (Architecture must support)

Accommodation (hotels, cabins), exhibition booths, market stalls, desk hire, berths/marina, transport seating, temporary structures — **without redesigning core architecture**.

Use **configuration-driven + inventory-type plug-in model**.

---

## 15. Integration Requirements

Layout engine provides common model for:
- Optimo inventory management
- Booking Manager
- Allocation Engine
- Fulfilment Manager
- Venue occupancy tracking
- External ticketing (Eventim, future providers)

Must support **external identifiers** for integration mapping.

Integration model: **API-led, not database-led**.

---

## 16. Non-Functional Requirements

| Area | Requirement |
|------|-------------|
| **Performance** | 100,000+ seats, large mixed-use facilities, concurrent editing |
| **Security** | RBAC, audit logging, version rollback |
| **Usability** | Browser-based designer, responsive UI, multi-level zoom, layer visibility |
| **Extensibility** | Config-driven architecture, inventory-type plug-in model |

---

## 17. Out of Scope (This Module)

These **consume** venue map data but are separate workstreams:

- Customer-facing seat selection UI
- Allocation optimization engine
- Dynamic seat assignment engine
- Real-time occupancy dashboards
- Fulfilment workflows
- External ticket reservation workflows
- Eventim integration workflows
- Revenue optimization algorithms

Also out of scope per requirements doc: booking workflows, allocation engines, optimization engines, customer seat selection experiences.

---

## 18. Delivery Roadmap (Phased)

| Phase | Focus | Angular deliverables |
|-------|-------|---------------------|
| **Phase 1 — Core Platform** | Spatial model, layouts, basic configs | App shell, Optimo auth integration, venue hierarchy browser, 2D canvas foundation, config CRUD, versioning UI |
| **Phase 2 — Enhanced Designer** | Advanced tools, templates, dynamic table planning | Full designer tools, templates, snap/grid/layers, bulk ops, table planning UI |
| **Phase 3 — Temp & Real Plans** | Deferred allocation workflows | Temporary plan UI, category inventory, temp→real conversion workflow |
| **Phase 4 — AI & Automation** | AI creation, optimization | Image upload + review, confidence/approval UI, layout suggestions |
| **Phase 5 — 3D & Digital Twin** | 3D views, navigation | 3D viewer (shared model), view switching 2D↔3D |

---

## 19. New APIs Required (Spatial Platform Owns)

Only where existing Optimo APIs are insufficient:

- Spatial layout definitions
- Layout versioning
- 2D geometry data
- 3D model data
- Navigation paths
- Visual layers
- Temporary seating plans
- Real seating plan mapping
- AI-assisted layout generation
- Layout validation
- Layout import/export

---

## 20. Existing Optimo Config Types (Extend, Don't Replace)

- General Admission Configuration
- Seating Chart Configuration
- Dining Configuration
- Private Suite Configuration
- Parking Space Configuration
- Accommodation Configuration

Asset hierarchy: Asset → Facility → Resource → Branding Area → Accommodation

---

## 21. Angular Architecture Plan

### Tech choices
| Layer | Choice |
|-------|--------|
| Framework | Angular 19+ standalone |
| State | Signals + services (NgRx only if complexity grows) |
| Styling | Optimo shared UI standards + SCSS/CSS variables |
| Canvas/2D | Canvas/SVG or Konva.js / PixiJS for designer (evaluate in Phase 1 spike) |
| HTTP | HttpClient + Optimo auth interceptors |
| Change detection | OnPush everywhere |

### Folder structure

```
src/app/
├── core/
│   ├── auth/              # Optimo auth integration
│   ├── guards/            # Role-based route guards
│   ├── interceptors/      # Token, error handling
│   └── services/          # API base, config
├── shared/
│   ├── components/        # Buttons, modals, badges, zoom controls
│   ├── pipes/
│   └── directives/
├── features/
│   ├── venue-browser/     # Hierarchy tree: Venue → Facility → Config
│   ├── layout-designer/   # 2D canvas, tools, layers, templates
│   ├── configurations/    # Config CRUD, versioning, event overrides
│   ├── temporary-plans/   # Category-based temp inventory (Phase 3)
│   └── settings/
├── layout/                # Optimo-aligned shell (nav, header, sidebar)
├── models/                # Domain interfaces & enums
└── app.config.ts
```

### Key routes (planned)

| Route | Purpose |
|-------|---------|
| `/venues` | Venue list / search |
| `/venues/:id` | Venue detail + facility tree |
| `/venues/:id/facilities/:fid/configs` | Configuration list |
| `/venues/:id/facilities/:fid/designer/:configId` | Layout designer |
| `/venues/:id/facilities/:fid/configs/:id/versions` | Version history |
| `/temporary-plans` | Temp seating plans (Phase 3) |

---

## 22. Core Domain Models (TypeScript — Draft)

```typescript
interface VenueHierarchy {
  venue: Venue;
  buildings?: Building[];
  levels?: Level[];
  facilities: Facility[];
}

interface Facility {
  id: string;
  name: string;
  facilityType: FacilityType;      // system-defined
  facilityCategory: string;        // user-defined
  spatialAttributes?: {
    width?: number;
    depth?: number;
    orientation?: number;
    mapPosition?: { x: number; y: number };
  };
  configurations: Configuration[];
  defaultConfigurationId: string;
}

interface Configuration {
  id: string;
  name: string;
  version: number;
  inventoryType: InventoryType;
  isDefault: boolean;
  effectiveFrom?: Date;
  layoutElements: LayoutElement[];
  versions: ConfigurationVersion[];
}

type InventoryType =
  | 'reserved_seating'
  | 'dining_fixed'
  | 'dining_dynamic'
  | 'private_suite'
  | 'general_admission'
  | 'parking_capacity'
  | 'parking_space';

interface LayoutElement {
  id: string;
  type: LayoutElementType;
  geometry: Geometry2D;
  properties: Record<string, unknown>;
  layer: string;
  children?: LayoutElement[];
}

interface TemporarySeatingPlan {
  id: string;
  eventId: string;
  categories: { name: string; capacity: number }[];
  status: 'temporary' | 'converting' | 'real';
  realConfigurationId?: string;
}
```

---

## 23. Performance Strategy (100k+ seats)

- Virtual rendering on canvas (only render viewport)
- Spatial indexing (quadtree/R-tree) for hit testing
- Web Workers for heavy geometry calculations
- Incremental layout loading (load visible facility/level first)
- Debounced auto-save
- OnPush + signals for UI state
- Lazy-loaded feature modules

---

## 24. Licensing & Deployment

- May be licensed **separately** from standard Optimo Setup
- Clients without advanced venue visuals continue using Setup-only workflows
- Independent deployment from Setup app
- Static/container deploy aligned with Optimo front-end patterns

---

## 25. KeyInfo / Decisions Needed Before Build

- [ ] Optimo API base URL & auth mechanism (OAuth? session token?)
- [ ] Existing Optimo UI component library available?
- [ ] Canvas library preference (Konva vs custom SVG vs PixiJS)?
- [ ] Phase 1 scope confirmation — which inventory types first?
- [ ] Mock API vs real Optimo dev environment access?
- [ ] Branding / Optimo design tokens documentation?

---

## 26. Progress Tracker

| Task | Status |
|------|--------|
| Project brain MD | ✅ Done |
| Angular scaffold | ⏳ Next |
| Optimo auth integration | ⏳ Pending |
| Venue hierarchy browser | ⏳ Pending |
| 2D layout designer foundation | ⏳ Pending |
| Configuration management | ⏳ Pending |

---

## 27. Source Files Reference

| File | Content |
|------|---------|
| `Jon/Optimo Venue Spatial Inventory Layout Platform - Product Scope and Requirements Document (2).docx` | Full functional requirements |
| `Jon/Optimo Venue Spatial Inventory Layout Platform - Implementation Strategy (2).docx` | Angular/API/DB strategy |
| `Jon/WhatsApp Image 2026-06-08 at 5.00.27 AM (1).jpeg` | Visual roadmap & platform overview |

---

*This document is the single source of truth for the Optimo Venue Spatial Inventory & Layout Platform Angular project.*
