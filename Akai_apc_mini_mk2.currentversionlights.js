var midiremote_api = require('midiremote_api_v1');

var deviceDriver = midiremote_api.makeDeviceDriver('Akai', 'APC MINI MK2', 'Steinberg Media Technologies GmbH');
var midiInputControl = deviceDriver.mPorts.makeMidiInput('Control');
var midiOutputControl = deviceDriver.mPorts.makeMidiOutput('Control');
var midiInputNotes = deviceDriver.mPorts.makeMidiInput('Notes');
var midiOutputNotes = deviceDriver.mPorts.makeMidiOutput('Notes');

deviceDriver.makeDetectionUnit().detectPortPair(midiInputControl, midiOutputControl)
    .expectSysexIdentityResponse('47', '2800', '1902');
deviceDriver.makeDetectionUnit().detectPortPair(midiInputNotes, midiOutputNotes)
    .expectSysexIdentityResponse('47', '2800', '1902');

var surface = deviceDriver.mSurface;
var midiChannel = 0;

// Keep backward compatibility aliases
var midiInput = midiInputNotes;
var midiOutput = midiOutputNotes;

// LED color codes (Akai spec - velocity values)
var LED_OFF = 0;
var LED_RED = 127;
var LED_GREEN = 126;
var LED_BLUE = 125;
var LED_YELLOW = 124;
var LED_CYAN = 123;
var LED_ORANGE = 122;
var LED_PURPLE = 121;
var LED_BROWN = 120;
var LED_WHITE = 127;
var LED_PINK = 119;
var LED_AMBER = 118;
var LED_GREEN_BLINK = 2;
var LED_RED_BLINK = 2; // Flash on channel 1

// Dimensions
var wPad = 2, hPad = 1, buttonSize = hPad;

// Send LED update for matrix pads (via CONTROL output port, channel 7 for max brightness)
function setLed(context, note, color) {
    midiOutputControl.sendMidi(context, [0x90 | 6, note, color]); // Channel 7 (0-indexed as 6) for max brightness
}

// Send LED update for buttons (via CONTROL output port, channel 1)
function setButtonLed(context, note, velocity) {
    midiOutputControl.sendMidi(context, [0x90 | 0, note, velocity]); // Channel 1 via CONTROL port
}

// Clip grid (8x8)
function makeMatrixPad(note) {
    var row = Math.floor(note / 8);
    var col = note % 8;
    var pad = surface.makeTriggerPad(col * wPad, (7 - row) * hPad, wPad, hPad);
    pad.mSurfaceValue.mMidiBinding
        .setInputPort(midiInputControl)
        .bindToNote(midiChannel, note);

    pad.mSurfaceValue.mOnProcessValueChange = function(context, value) {
        var color = LED_OFF;
        if (value > 0) {
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
        }
        setLed(context, note, color);
    };

    return pad;
}

// Bottom row buttons (mute buttons, notes 100-107)
function makeRowButton(index) {
    var note = 100 + index;
    var btn = surface.makeButton(wPad * index, 8 * hPad, buttonSize, buttonSize);
    btn.setTypePush();
    btn.mSurfaceValue.mMidiBinding
        .setInputPort(midiInputControl)
        .setOutputPort(midiOutputControl)
        .bindToNote(midiChannel, note);
    btn.mNote = note;
    btn.mIsButtonLED = true;
    return btn;
}

// Column buttons (notes 112-119 for navigation, 122 for shift)
function makeColumnButton(index) {
    var note = 112 + index;
    var btn = surface.makeButton(wPad * 8, index * hPad, buttonSize, buttonSize);
    btn.setTypePush();
    btn.mSurfaceValue.mMidiBinding
        .setInputPort(midiInputControl)
        .setOutputPort(midiOutputControl)
        .bindToNote(midiChannel, note);
    btn.mNote = note;
    btn.mIsButtonLED = true;
    return btn;
}

// Faders
var wFader = wPad - 0.2, hFader = 3 * hPad;
function makeFader(index) {
    var fader = surface.makeFader(wPad * index, 9 * hPad, wFader, hFader);
    fader.mSurfaceValue.mMidiBinding
        .setInputPort(midiInputControl)
        .setOutputPort(midiOutputControl)
        .bindToControlChange(midiChannel, 0x30 + index);
    return fader;
}

// Build surface
var pads = [], rowButtons = [], colButtons = [], faders = [];
for (var i = 0; i < 64; i++) pads.push(makeMatrixPad(i));
for (var r = 0; r < 8; r++) rowButtons.push(makeRowButton(r));
for (var c = 0; c < 9; c++) colButtons.push(makeColumnButton(c));
for (var f = 0; f < 9; f++) faders.push(makeFader(f));

// Mapping
var page = deviceDriver.mMapping.makePage('Ableton Style');
var hostMixerBankZone = page.mHostAccess.mMixConsole.makeMixerBankZone().excludeInputChannels().excludeOutputChannels();
var mainOutputChannel = page.mHostAccess.mMixConsole.makeMixerBankZone('Stereo Out').includeOutputChannels().makeMixerBankChannel();

// Subpages
var subPageAreaFunctionMode = page.makeSubPageArea('Function Mode');
var subPageVolume = subPageAreaFunctionMode.makeSubPage('Volume');
var subPagePan = subPageAreaFunctionMode.makeSubPage('Pan');
var subPageSend = subPageAreaFunctionMode.makeSubPage('Send');
var subPageQC = subPageAreaFunctionMode.makeSubPage('Device');
var subPageFuncShift = subPageAreaFunctionMode.makeSubPage('Shift');

// Track active mode button for LED updates
var activeModeButtonIndex = 0;
var modeButtons = [subPageVolume, subPagePan, subPageSend, subPageQC];

// Add activation handlers to update LEDs when subpage activates
for (var mi = 0; mi < modeButtons.length; mi++) {
    (function(modeIdx, subPage) {
        subPage.mOnActivate = function(context, activeMapping) {
            activeModeButtonIndex = modeIdx;
            // Turn off all mode button LEDs first
            for (var j = 0; j < 4; j++) {
                setButtonLed(context, rowButtons[j].mNote, LED_OFF);
            }
            // Turn on the active mode button
            setButtonLed(context, rowButtons[modeIdx].mNote, LED_RED);

            // Clear all pad LEDs when switching modes
            for (var p = 0; p < 64; p++) {
                setLed(context, p, LED_OFF);
            }
            // reset pad column state so updatePadColumn recognizes changes
            for (var si = 0; si < 8; si++) {
                faderSteps[si] = -1;  // force mismatch on next update
                padColumnState[si] = [0,0,0,0,0,0,0,0];
            }

            // If Volume mode activated, read current DAW state for all channels
            if (modeIdx === 0) {
                for (var di = 0; di < mixerChannels.length; di++) {
                    var hv = mixerChannels[di].mValue.mVolume;
                    var val = 0;
                    try {
                        if (hv) {
                            if (typeof hv.get === 'function') val = hv.get();
                            else if (typeof hv.getValue === 'function') val = hv.getValue();
                            else if (typeof hv.mValue === 'number') val = hv.mValue;
                        }
                    } catch (e) {}
                    faderValues[di] = val;
                    updatePadColumn(context, di, val);
                }
            }
        };
    })(mi, modeButtons[mi]);
}

// Keep last-known fader values (0..1) so we can render pad column meters
var faderValues = [0,0,0,0,0,0,0,0];
// Also track last DAW-read values separately (updated by host listener even if debounced)
var dawFaderValues = [0,0,0,0,0,0,0,0];
// Track step count per column to detect actual changes (not just value jitter)
var faderSteps = [0,0,0,0,0,0,0,0];
// Track visible pad state per column: array of 8 colors (or LED_OFF) for each col
var padColumnState = [
    [0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0]
];
// Track last fader callback time per column to debounce host updates
var faderLastUpdateTime = [0,0,0,0,0,0,0,0];
var FADER_DEBOUNCE_MS = 100; // wait 100ms after last fader move before allowing host listener

// Update LEDs for one column. Only send MIDI when step count actually changes.
function updatePadColumn(context, colIndex, value) {
    // If value not provided, read it directly from the host mixer channel
    if (typeof value === 'undefined' && colIndex < mixerChannels.length) {
        var hostVal = mixerChannels[colIndex].mValue.mVolume;
        if (hostVal) {
            // Try multiple methods to read the current host value
            if (typeof hostVal.get === 'function') {
                value = hostVal.get();
            } else if (typeof hostVal.getValue === 'function') {
                value = hostVal.getValue();
            } else if (typeof hostVal.mValue === 'number') {
                value = hostVal.mValue;
            }
        }
    }
    
    // Fallback: use cached faderValues
    if (typeof value === 'undefined') {
        value = faderValues[colIndex] || 0;
    }
    
    var steps = Math.max(0, Math.min(8, Math.floor(value * 8)));
    // Skip if step count hasn't changed (ignore jitter from continuous CC values)
    if (steps === faderSteps[colIndex]) return;
    faderSteps[colIndex] = steps;

    var prevState = padColumnState[colIndex];

    // Compute new state
    var newState = [];
    for (var r = 0; r < 8; r++) {
        if (r < steps) {
            var color = LED_GREEN;
            if (r >= 7) color = LED_RED;
            else if (r >= 5) color = LED_YELLOW;
            else if (r >= 3) color = LED_CYAN;
            newState[r] = color;
        } else {
            newState[r] = LED_OFF;
        }
    }

    // Send MIDI only for changed rows
    for (var r = 0; r < 8; r++) {
        if (newState[r] !== prevState[r]) {
            var note = r * 8 + colIndex;
            setLed(context, note, newState[r]);
        }
    }

    // Update stored state
    padColumnState[colIndex] = newState;
}

// Mode buttons (bottom row 0-3) with LED feedback on channel 1
function bindModeButton(button, subPage, colorOnVelocity) {
    page.makeActionBinding(button.mSurfaceValue, subPage.mAction.mActivate);
    var note = button.mNote;
    button.mSurfaceValue.mOnProcessValueChange = function(context, value) {
        var velocity = value > 0 ? colorOnVelocity : LED_OFF;
        setButtonLed(context, note, velocity);
    };
}

bindModeButton(rowButtons[0], subPageVolume, LED_RED);
bindModeButton(rowButtons[1], subPagePan, LED_RED);
bindModeButton(rowButtons[2], subPageSend, LED_RED);
bindModeButton(rowButtons[3], subPageQC, LED_RED);

// Navigation buttons (bottom row 4-7): up, down, left, right arrows - GREEN LED on channel 1
var navActions = [
    hostMixerBankZone.mAction.mShiftLeft,    // Left arrow
    hostMixerBankZone.mAction.mShiftRight,   // Right arrow
    hostMixerBankZone.mAction.mPrevBank,     // Up arrow
    hostMixerBankZone.mAction.mNextBank      // Down arrow
];
// Map: rowButtons[4]=UP, [5]=DOWN, [6]=LEFT, [7]=RIGHT
var navButtonIndices = [6, 7, 4, 5]; // LEFT, RIGHT, UP, DOWN order to match actions
for (var i = 0; i < 4; i++) {
    (function(navIdx, rowIdx, navAction) {
        var button = rowButtons[rowIdx];
        page.makeActionBinding(button.mSurfaceValue, navAction);
        var note = button.mNote;
        button.mSurfaceValue.mOnProcessValueChange = function(context, value) {
            var velocity = value > 0 ? LED_GREEN : LED_OFF;
            setButtonLed(context, note, velocity);
        };
    })(i, navButtonIndices[i], navActions[i]);
}

// Column buttons (0-7) - turn green when pressed
for (var i = 0; i < 8; i++) {
    (function(index, button) {
        var note = button.mNote;
        button.mSurfaceValue.mOnProcessValueChange = function(context, value) {
            var velocity = value > 0 ? LED_GREEN : LED_OFF;
            setButtonLed(context, note, velocity);
        };
    })(i, colButtons[i]);
}

// Shift button (note 122) - no LED available but still map the action
page.makeActionBinding(colButtons[8].mSurfaceValue, subPageFuncShift.mAction.mActivate);
// No LED feedback needed for shift button (it doesn't have one)

// Shift button (note 122) - no LED available but still map the action
page.makeActionBinding(colButtons[8].mSurfaceValue, subPageFuncShift.mAction.mActivate);
// No LED feedback needed for shift button (it doesn't have one)

// Fader bindings (explicit mixerChannels array for clarity)
var mixerChannels = [];
for (var i = 0; i < 8; i++) {
    mixerChannels[i] = hostMixerBankZone.makeMixerBankChannel();
    page.makeValueBinding(faders[i].mSurfaceValue, mixerChannels[i].mValue.mVolume)
        .setValueTakeOverModeScaled()
        .setSubPage(subPageVolume);
    page.makeValueBinding(faders[i].mSurfaceValue, mixerChannels[i].mValue.mPan)
        .setValueTakeOverModeScaled()
        .setSubPage(subPagePan);
    page.makeValueBinding(faders[i].mSurfaceValue, mixerChannels[i].mSends.getByIndex(0).mLevel)
        .setValueTakeOverModeScaled()
        .setSubPage(subPageSend);
    page.makeValueBinding(faders[i].mSurfaceValue, page.mHostAccess.mFocusedQuickControls.getByIndex(i))
        .setValueTakeOverModeScaled()
        .setSubPage(subPageQC);
}

// Bind the 9th fader (index 8) to the main output/master channel volume
if (faders.length > 8) {
    page.makeValueBinding(faders[8].mSurfaceValue, mainOutputChannel.mValue.mVolume)
        .setValueTakeOverModeScaled()
        .setSubPage(subPageVolume);
}

// Listen to host mixer channel volume changes so pad meters reflect DAW state
// Always update faderValues; render only when Volume page is active
for (var hc = 0; hc < mixerChannels.length; hc++) {
    (function(idx) {
        var hostVal = mixerChannels[idx].mValue.mVolume;
        hostVal.mOnProcessValueChange = function(context, value) {
            // Always store the DAW value
            faderValues[idx] = value;
            dawFaderValues[idx] = value;
            // Render to pads if Volume mode is active
            if (activeModeButtonIndex === 0) updatePadColumn(context, idx, value);
        };
    })(hc);
}

// Update pad columns when faders move (show meters only on Volume subpage)
for (var fi = 0; fi < 8; fi++) {
    (function(index) {
        faders[index].mSurfaceValue.mOnProcessValueChange = function(context, value) {
            // Store and display the physical fader value for this column only
            faderValues[index] = value;
            // Only render this column when Volume subpage is active
            if (activeModeButtonIndex === 0) {
                updatePadColumn(context, index, value);
            }
        };
    })(fi);
}

// (subPageVolume rendering is handled in the generic subPage activation above)
// Reset all LEDs on initialization
deviceDriver.mOnActivate = function(context) {
    // Turn off all pads (use matrix LED channel 7)
    for (var i = 0; i < 64; i++) setLed(context, i, LED_OFF);
    // Turn off all row buttons (use button LED channel 1)
    for (var r = 0; r < rowButtons.length; r++) setButtonLed(context, rowButtons[r].mNote, LED_OFF);
    // Turn off all column buttons (use button LED channel 1)
    for (var c = 0; c < colButtons.length; c++) setButtonLed(context, colButtons[c].mNote, LED_OFF);
    
    // Light up the first mode button (Volume) on startup
    setButtonLed(context, rowButtons[0].mNote, LED_RED);
    // Initialize pad columns from host mixer current values
    try {
        for (var ci = 0; ci < mixerChannels.length; ci++) {
            var hostVal = mixerChannels[ci].mValue.mVolume;
            var cur = null;
            if (hostVal && typeof hostVal.get === 'function') cur = hostVal.get();
            else if (hostVal && typeof hostVal.getValue === 'function') cur = hostVal.getValue();
            else if (hostVal && typeof hostVal.mValue === 'number') cur = hostVal.mValue;
            if (typeof cur === 'number') {
                faderValues[ci] = cur;
                dawFaderValues[ci] = cur;
                if (activeModeButtonIndex === 0) updatePadColumn(context, ci, cur);
            }
        }
    } catch (e) {
        // ignore if host doesn't provide sync getters
    }
};