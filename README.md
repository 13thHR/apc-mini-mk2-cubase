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

## Requirements

- Steinberg Cubase (tested with MIDI Remote API v1)
- Akai APC mini MK2 controller

## Credits

Created by 13thHouR

## License

MIT License - Feel free to modify and distribute
