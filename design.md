# Linux Overlay - Design Documentation

## Overview

A transparent overlay application for Linux built with Electron, designed to display real-time comments/chat over fullscreen content (e.g., movies, streams). The app features two modes: passive (click-through) and active (interactive).

---

## Design Philosophy

- **Minimal & Unobtrusive**: In passive mode, only message bubbles are visible with transparent background
- **Glass Morphism**: Frosted glass aesthetic with blur effects and subtle transparency
- **Dark Theme**: Deep navy/charcoal base to blend with video content
- **Accent-Driven**: Teal accent color for highlights and interactive elements

---

## Color Palette

| Variable | Value | Usage |
|----------|-------|-------|
| `--bg` | `rgba(15, 15, 25, 0.85)` | Main background (active mode) |
| `--accent` | `#00d4aa` | Primary accent (teal) - highlights, usernames, borders |
| `--accent2` | `#7c3aed` | Secondary accent (purple) - gradient endpoints |
| `--text` | `#f0f0f5` | Primary text |
| `--text-dim` | `#a0a0b0` | Secondary/muted text |
| `--border` | `rgba(255, 255, 255, 0.08)` | Subtle borders |
| `--danger` | `#ff4757` | Destructive actions (close, delete) |

---

## Typography

### Fonts
- **Primary**: `Outfit` (400, 500, 600) - Body text, buttons
- **Monospace**: `JetBrains Mono` (400, 600) - Usernames, labels, mode indicators

### Sizes
| Element | Size | Weight |
|---------|------|--------|
| Message text | 14px | 400 |
| Username | 12px | 600 |
| Labels | 11px | 400 |
| Mode indicator | 10px | 400 |
| Settings title | 14px | 600 |

---

## Component Styles

### Message Bubbles (`.msg`)
```css
background: rgba(15, 15, 25, 0.9);
backdrop-filter: blur(10px);
border-radius: 10px;
padding: 10px 14px;
border: 1px solid var(--border);
box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
width: fit-content;
max-width: 90%;
```

**Features:**
- Left accent bar with gradient (`--accent` → `--accent2`)
- Dynamic width based on content
- Gentle opacity fade for older messages (cosine ease-out curve)
- Slide-up animation on entry
- Delete button appears on hover (active mode only)

### Drag Bar
```css
background: linear-gradient(180deg, rgba(0, 212, 170, 0.2), rgba(0, 212, 170, 0.05));
border-bottom: 1px solid rgba(0, 212, 170, 0.6);
padding: 10px 14px;
```

**Features:**
- Grip dots indicator (3 circular dots)
- Settings (⚙) and Close (✕) buttons
- Only visible in active mode

### Buttons
```css
/* Base */
padding: 6px 12px;
border-radius: 6px;
font: 500 12px 'Outfit', sans-serif;

/* Close button */
background: var(--danger);  /* #ff4757 */
:hover → #ff6b7a

/* Settings button */
background: rgba(255,255,255,0.15);
:hover → rgba(255,255,255,0.25)
```

### Settings Modal
```css
background: rgba(15, 15, 25, 0.98);
backdrop-filter: blur(16px);
border-radius: 14px;
border: 1px solid rgba(0, 212, 170, 0.3);
box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
padding: 20px 24px;
```

**Features:**
- Centered positioning with backdrop overlay
- Accent-colored header
- Range slider with accent color
- Closes on backdrop click or ✕ button

### Mode Indicator
```css
background: rgba(15, 15, 25, 0.9);
backdrop-filter: blur(10px);
padding: 5px 10px;
border-radius: 6px;
font: 10px 'JetBrains Mono', monospace;
```

**Features:**
- Bottom-left positioning
- Fades in/out on mode change
- Auto-hides after 2 seconds in passive mode

---

## Layout & Spacing

### Border Radius Scale
| Element | Radius |
|---------|--------|
| App container | 12px |
| Message bubbles | 10px |
| Settings modal | 14px |
| Buttons | 6px |
| Mode indicator | 6px |
| Images | 6px |

### Spacing
- Container padding: 12px
- Message gap: 8px
- Button padding: 6px 12px
- Settings internal padding: 20px 24px

---

## Animations

### Slide Up (Messages)
```css
@keyframes slideUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
duration: 0.3s ease
```

### Opacity Transitions
```css
transition: opacity 0.3s ease;
```

### Delete Animation
```javascript
opacity: 0;
transform: translateX(-20px);
transition: all 0.2s;
```

---

## Opacity Decay Algorithm

Messages fade based on age using a cosine ease-out curve:

```javascript
const normalizedAge = age / (maxMessages - 1);  // 0 to 1
const opacity = Math.cos(Math.pow(normalizedAge, 1.3) * Math.PI / 2);
// Minimum: 0.1
```

**Result for 7 messages:**
| Position | Opacity |
|----------|---------|
| Newest | 100% |
| 2nd | 97% |
| 3rd | 90% |
| 4th | 78% |
| 5th | 59% |
| 6th | 35% |
| Oldest | 10% |

---

## Modes

### Passive Mode (Default)
- Transparent background
- Click-through enabled (mouse events pass to underlying windows)
- No interactive elements visible
- Only message bubbles displayed
- Window not focusable

### Active Mode (Hotkey: F9 or Ctrl+Shift+O)
- Background becomes visible with accent border
- Drag bar appears for window movement
- Resize edges enabled on all sides
- Delete buttons appear on message hover
- Settings accessible
- Window becomes focusable and interactive

---

## Window Management

### Resize Zones
- **Edges**: 8px hit area
- **Corners**: 14px × 14px hit area
- Invisible but functional
- System cursors (n-resize, e-resize, nw-resize, etc.)

### Window Properties
```javascript
{
  transparent: true,
  frame: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  hasShadow: false,
  resizable: false  // Handled manually via IPC
}
```

---

## Scrollbar Styling
```css
::-webkit-scrollbar { width: 5px; }
::-webkit-scrollbar-thumb { 
  background: rgba(255,255,255,0.2); 
  border-radius: 3px; 
}
```

---

## Z-Index Hierarchy
| Element | Z-Index |
|---------|---------|
| Resize edges | 100 |
| Settings backdrop | 150 |
| Settings modal | 200 |

---

## Future Considerations

- Additional settings (opacity decay rate, font size)
- Theme customization (accent colors)
- Position memory (save window position)
- WebSocket integration for real-time messages
- Image support in messages

