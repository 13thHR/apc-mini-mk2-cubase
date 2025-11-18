# Akai APC MINI MK2 MIDI Remote Driver - AI Coding Guide

## Project Overview
This is a Cubase MIDI Remote driver script for the Akai APC MINI MK2 controller. It maps the device's 8x8 pad grid, 8 faders, control buttons, and navigation buttons to Cubase mixer controls and transport functions using the Steinberg MIDI Remote API (`midiremote_api_v1`).

## Architecture & Core Concepts

### MIDI Remote API Structure
- **Device Driver Setup**: Use `midiremote_api.makeDeviceDriver()` to initialize, then register MIDI input/output ports
- **Device Detection**: Requires `expectSysexIdentityResponse('47', '2800', '1902')` to correctly identify the APC MINI MK2
- **Surface Elements**: All UI controls (pads, buttons, faders) are created via `surface.makeTriggerPad()`, `surface.makeButton()`, and `surface.makeFader()`
- **MIDI Bindings**: Each surface element requires `.mMidiBinding` with input/output ports and note or CC binding

### Hardware Layout
- **8x8 Clip Grid**: Pads 0-63 mapped to MIDI notes 0x00-0x3F (row calculated as `Math.floor(note / 8)`, col as `note % 8`)
- **Bottom Row Buttons**: 8 buttons for mode selection (notes 0x40-0x47)
- **Right Column Buttons**: 9 buttons for shift/nav (notes 0x70-0x78)
- **9 Faders**: CC 0x30-0x37 (faders 0-7) and CC 0x38 (fader 8 = master output)
- **Dimension Constants**: `wPad = 2`, `hPad = 1`, `buttonSize = hPad` (used for surface coordinate calculation)

### Control Modes & Subpages
The driver implements mode buttons that switch subpages to change fader assignments:
- **Volume Mode** (button 0, LED_GREEN): Faders 0-7 → Mixer channel volumes
- **Pan Mode** (button 1, LED_YELLOW): Faders 0-7 → Mixer channel pan
- **Send Mode** (button 2, LED_RED): Faders 0-7 → Mixer channel send levels
- **Device Mode** (button 3, LED_BLUE): Faders 0-7 → Focused quick controls
- **Navigation Buttons** (buttons 4-7, LED_GREEN_BLINK): Up/Down/Left/Right in mixer
- **Shift Button** (column button 8, LED_RED): Function modifier

Mode buttons use `setSubPage()` to attach value bindings to specific pages.

### LED Feedback System
- **Color Palette**: LED_OFF=0, LED_GREEN=1, LED_RED=3, LED_YELLOW=5, LED_BLUE=9, LED_PURPLE=11, LED_WHITE=13, LED_CYAN=15, LED_GREEN_BLINK=2, LED_RED_BLINK=4
- **LED Updates**: Call `setLed(context, note, color)` with MIDI channel 0, using `0x90 | midiChannel` status byte
- **Feedback Pattern**: Mode buttons provide active feedback; navigation buttons blink when pressed
- **Initialization**: `deviceDriver.mOnActivate` clears all LEDs when driver loads

### Key Patterns

**Pad Color Mapping by Row**
```javascript
// In makeMatrixPad(): rows 0-7 map to specific colors when triggered
switch (row) {
    case 0: color = LED_GREEN; break;
    case 1: color = LED_YELLOW; break;
    case 2: color = LED_RED; break;
    case 3: color = LED_BLUE; break;
    case 4: color = LED_PURPLE; break;
    case 5: color = LED_WHITE; break;
    case 6: color = LED_CYAN; break;
    case 7: color = LED_GREEN_BLINK; break;
}
```

**Fader Binding to Multiple Subpages**
Each fader binds to the same physical control but maps to different host parameters per subpage using `.setSubPage()`. Use `.setValueTakeOverModeScaled()` for smooth takeover.

## Development Patterns

### Adding New Mode Buttons
1. Create a new subpage in `subPageAreaFunctionMode`
2. Call `bindModeButton(rowButtons[index], subPageName, LED_COLOR)`
3. The function automatically sets up activation and LED feedback

### Adding New Fader Bindings
1. For mode-specific binding: Use `page.makeValueBinding(fader, parameter).setSubPage(subPage)`
2. For mode-independent binding: Omit `.setSubPage()`
3. Always chain `.setValueTakeOverModeScaled()` to avoid jumps when switching modes

### Modifying Pad Grid Behavior
- Adjust row-to-color mapping in the `switch` statement within `makeMatrixPad()`
- To change pad coordinates or size: Modify `wPad`, `hPad`, or coordinate calculations in `makeMatrixPad()`, `makeRowButton()`, `makeColumnButton()`
- Pad events trigger `mOnProcessValueChange`, which sends LED feedback via `setLed()`

## File Organization
- **Akai_apc_mini_mk2.js** / **Akai_apc_mini_mk2.currentversionlights.js**: Active production drivers with identical structure
- **Akai_apc_mini_mk2.working** / **Akai_apc_mini_mk2.workingversion**: Backup/reference versions; compare against active versions for history
- **.bak files**: Legacy backups; typically ignored unless reverting

## Testing & Validation
- Test all mode buttons to verify subpage switching and LED color feedback
- Test fader takeover across all subpages (switch modes while moving faders to ensure no jumps)
- Test pad feedback by pressing each row to verify row-to-color mapping
- Verify navigation buttons blink and advance mixer selection correctly
