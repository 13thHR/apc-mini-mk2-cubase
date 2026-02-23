# Akai APC mini MK2 - Cubase MIDI Remote Script

A custom MIDI Remote script for the Akai APC mini MK2 controller in Steinberg Cubase.

## Features

### VOLUME Page
- **Volume Mode**: Vertical LED meters showing channel volume levels
- **Pan Mode**: Horizontal LED meters showing pan positions
- **Send Mode**: Horizontal LED meters showing send levels
- **Device Mode**: Control Quick Controls with visual feedback

### DRUMS Page
- Full 8x8 pad grid (64 pads)
- Mapped to MIDI notes 0-63
- Color-coded layout:
  - RED pads (bottom-left 4x4)
  - CYAN pads (bottom-right 4x4)
  - YELLOW pads (top-left 4x4)
  - PURPLE pads (top-right 4x4)
- Direct mapping for Groove Agent and other drum plugins

## Navigation
- **Shift + RIGHT**: Switch to DRUMS page
- **LEFT**: Return to VOLUME page
- **Volume/Pan/Send/Device buttons**: Switch between mixer modes on VOLUME page

## Installation

1. Download `Akai_apc_mini_mk2.js`
2. Copy to your Cubase MIDI Remote scripts folder:
   - Windows: `Documents\Steinberg\Cubase\MIDI Remote\Driver Scripts\Local\Akai\APC_mini_mk2\`
   - macOS: `~/Documents/Steinberg/Cubase/MIDI Remote/Driver Scripts/Local/Akai/APC_mini_mk2/`
3. Open Cubase
4. Go to **Studio → Studio Setup → MIDI Remote**
5. Click **+** and select the APC mini MK2 script
6. Configure your MIDI ports (Control and Notes)

## Groove Agent Setup (Cubase 12+)

The purple quadrant on the DRUMS page sends notes from a 4x4 grid pattern (36-39, 44-47, 52-55, 60-63), but Groove Agent expects 16 consecutive notes per pad bank (C1-D#2 = 36-51). Use the **Track Input Transformer** to remap the notes.

> **Why not use the APC mini MK2's built-in Drum Mode?** The hardware Drum Mode (Shift+Scene Launch 6) is Ableton-specific — it sends notes in different octave ranges per quadrant (e.g., E3/E6) that match neither the MIDI Remote surface bindings (0-63) nor Groove Agent's layout. The Note Mode (Shift+Scene Launch 7) only sends whole tones. Therefore this script uses the default hardware mode with Input Transformer remapping.

### Track Input Transformer Configuration

Open the Input Transformer on the Groove Agent track (location varies by Cubase version — in Cubase 12 it's in the Inspector under MIDI Modifiers). Configure 3 modules:

**Module 1 — Notes 44-47 → 40-43:**
- Filter: `Type is Equal Note` AND `Value 1 (Pitch) is in Range 44 to 48`
- Action: `Value 1` → `Subtract` → `4`
- Function: **Transform**

**Module 2 — Notes 52-55 → 44-47:**
- Filter: `Type is Equal Note` AND `Value 1 (Pitch) is in Range 52 to 56`
- Action: `Value 1` → `Subtract` → `8`
- Function: **Transform**

**Module 3 — Notes 60-63 → 48-51:**
- Filter: `Type is Equal Note` AND `Value 1 (Pitch) is in Range 60 to 64`
- Action: `Value 1` → `Subtract` → `12`
- Function: **Transform**

Notes 36-39 (C1-D#1) pass through unchanged. After remapping, the purple quadrant sends consecutive notes C1-D#2 (36-51) = Groove Agent Pad Bank 1.

> **Note:** The Track Input Transformer has 4 modules. With 3 used for the purple quadrant, module 4 is available for another quadrant. Be aware of note collisions with the yellow quadrant (notes 40-43, 48-51) if both areas are played simultaneously.

## Requirements

- Steinberg Cubase (tested with MIDI Remote API v1)
- Akai APC mini MK2 controller

## Credits

Created by 13thHouR

## License

MIT License - Feel free to modify and distribute
