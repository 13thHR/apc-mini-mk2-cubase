var midiremote_api = require('midiremote_api_v1');

var deviceDriver = midiremote_api.makeDeviceDriver('Akai', 'APC MINI MK2', '13thHouR v2');
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

// LED color codes (Akai spec - velocity values for pads on channel 7)
var LED_OFF = 0;
var LED_RED = 72;          // Bright red (0x48)
var LED_GREEN = 87;        // Bright green
var LED_BLUE = 41;         // Blue
var LED_YELLOW = 74;       // Bright yellow
var LED_CYAN = 78;         // Cyan
var LED_ORANGE = 61;       // Orange
var LED_PURPLE = 67;       // Purple
var LED_BROWN = 83;        // Brown
var LED_WHITE = 3;         // White
var LED_PINK = 95;         // Pink
var LED_AMBER = 96;        // Amber
var LED_TURQUOISE = 33;    // Turquoise
var LED_BLINK = 2;         // Flash (for channel 1 buttons)

// Dimensions
var wPad = 2, hPad = 1, buttonSize = hPad;

// Send LED update for matrix pads (via CONTROL output port, channel 7 for max brightness)
function setLed(context, note, color) {
    // Validate inputs to prevent crashes
    if (typeof note !== 'number' || note < 0 || note > 127) return;
    if (typeof color !== 'number' || color < 0 || color > 127) return;
    midiOutputControl.sendMidi(context, [0x90 | 6, note, color]); // Channel 7 (0-indexed as 6) for max brightness
}

// Send LED update for buttons (via CONTROL output port, channel 1)
function setButtonLed(context, note, velocity) {
    // Validate inputs to prevent crashes
    if (typeof note !== 'number' || note < 0 || note > 127) return;
    if (typeof velocity !== 'number' || velocity < 0 || velocity > 127) return;
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

    // This handler applies to all pages - different behavior for main vs drum page
    pad.mSurfaceValue.mOnProcessValueChange = function(context, value) {
        // Check if we're on the drum page
        if (isDrumPageActive) {
            // Drum page: show 4x4 block colors, change when pressed
            var drumInfo = drumMap[note];
            if (value > 0) {
                setLed(context, note, drumInfo.pressColor); // Trigger color
            } else {
                setLed(context, note, drumInfo.color); // Base block color
            }
        } else {
            // Main page: row-based colors for testing
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
                    case 7: color = LED_AMBER; break;
                }
            }
            setLed(context, note, color);
        }
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

// Column buttons (notes 112-119 for track selection, 122 for shift)
function makeColumnButton(index) {
    var note = (index < 8) ? (112 + index) : 122;  // Shift button is note 122, not 120
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
var page = deviceDriver.mMapping.makePage('VOLUME');
var hostMixerBankZone = page.mHostAccess.mMixConsole.makeMixerBankZone().excludeInputChannels().excludeOutputChannels();
var mainOutputChannel = page.mHostAccess.mMixConsole.makeMixerBankZone('Stereo Out').includeOutputChannels().makeMixerBankChannel();

// Declare drum page variable (will be created after main page setup)
var pageDrums;

// Subpages
var subPageAreaFunctionMode = page.makeSubPageArea('Function Mode');
var subPageVolume = subPageAreaFunctionMode.makeSubPage('Volume');
var subPageVU = subPageAreaFunctionMode.makeSubPage('VU Meters');
var subPagePan = subPageAreaFunctionMode.makeSubPage('Pan');
var subPageSend = subPageAreaFunctionMode.makeSubPage('Send');
var subPageQC = subPageAreaFunctionMode.makeSubPage('Device');
var subPageFuncShift = subPageAreaFunctionMode.makeSubPage('Shift');

// Track active mode button for LED updates
var activeModeButtonIndex = 0;
var modeButtons = [subPageVolume, subPagePan, subPageSend, subPageQC];

// Keep last-known fader values (0..1) so we can render pad column meters
var faderValues = [0,0,0,0,0,0,0,0];
// Track VU meter values and steps
var vuMeterValues = [0,0,0,0,0,0,0,0];
var vuMeterSteps = [0,0,0,0,0,0,0,0];
// Track step count per column to detect actual changes (not just value jitter)
var faderSteps = [0,0,0,0,0,0,0,0];
// Track pan values (0..1, where 0.5 is center)
var panValues = [0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5];
var panPositions = [4,4,4,4,4,4,4,4];  // Track actual pad positions
// Track send values (0..1)
var sendValues = [0,0,0,0,0,0,0,0];
var sendPositions = [0,0,0,0,0,0,0,0];  // Track actual pad positions
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
            if (r >= 7) color = LED_RED;           // 8th row: red
            else if (r >= 5) color = LED_ORANGE;   // 6th-7th rows: orange
            else if (r >= 3) color = LED_GREEN;    // 4th-5th rows: green
            else if (r >= 2) color = LED_YELLOW;   // 3rd row: yellow
            else color = LED_AMBER;                // 1st-2nd rows: dark yellow (amber)
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

// Update pan row display: dim white background with blue indicator
// rowIndex: which row (0-7) to update for this channel
// panValue: 0..1 where 0.5 is center
function updatePanRow(context, rowIndex, panValue) {
    if (typeof panValue === 'undefined') {
        panValue = panValues[rowIndex] || 0.5;
    }
    
    // Calculate pan position (0-7 pads)
    var panPos = Math.max(0, Math.min(7, Math.floor(panValue * 8)));
    
    // Skip if position hasn't changed
    if (panPos === panPositions[rowIndex]) return;
    panPositions[rowIndex] = panPos;
    
    var prevState = padColumnState[rowIndex];
    var newState = [];
    
    // Fill row: dim white background, blue at pan position
    for (var col = 0; col < 8; col++) {
        if (col === panPos) {
            newState[col] = LED_BLUE;  // Blue indicator at pan position
        } else {
            newState[col] = LED_WHITE;  // Dim white background
        }
    }
    
    // Send MIDI only for changed pads
    for (var col = 0; col < 8; col++) {
        if (newState[col] !== prevState[col]) {
            var note = rowIndex * 8 + col;
            setLed(context, note, newState[col]);
        }
    }
    
    // Update stored state
    padColumnState[rowIndex] = newState;
}

// Update send row display: dim yellow background with red indicator
// rowIndex: which row (0-7) to update for this channel
// sendValue: 0..1 where 0 is left, 1 is right
function updateSendRow(context, rowIndex, sendValue) {
    if (typeof sendValue === 'undefined') {
        sendValue = sendValues[rowIndex] || 0;
    }
    
    // Calculate send position (0-7 pads)
    var sendPos = Math.max(0, Math.min(7, Math.floor(sendValue * 8)));
    
    // Skip if position hasn't changed
    if (sendPos === sendPositions[rowIndex]) return;
    sendPositions[rowIndex] = sendPos;
    
    var prevState = padColumnState[rowIndex];
    var newState = [];
    
    // Fill row: dim yellow background, red at send position
    for (var col = 0; col < 8; col++) {
        if (col === sendPos) {
            newState[col] = LED_RED;  // Red indicator at send position
        } else {
            newState[col] = LED_YELLOW;  // Dim yellow background
        }
    }
    
    // Send MIDI only for changed pads
    for (var col = 0; col < 8; col++) {
        if (newState[col] !== prevState[col]) {
            var note = rowIndex * 8 + col;
            setLed(context, note, newState[col]);
        }
    }
    
    // Update stored state
    padColumnState[rowIndex] = newState;
}

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

            // If Volume mode activated, update all pad columns from physical fader positions
            if (modeIdx === 0) {
                for (var di = 0; di < 8; di++) {
                    updatePadColumn(context, di, faderValues[di]);
                }
            }
            
            // If Pan mode activated, update all pan rows
            if (modeIdx === 1) {
                for (var pi = 0; pi < 8; pi++) {
                    panPositions[pi] = -1;  // Force update on first display
                    updatePanRow(context, pi, panValues[pi]);
                }
            }
            
            // If Send mode activated, update all send rows
            if (modeIdx === 2) {
                for (var si = 0; si < 8; si++) {
                    sendPositions[si] = -1;  // Force update on first display
                    updateSendRow(context, si, sendValues[si]);
                }
            }
        };
    })(mi, modeButtons[mi]);
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
        var note = 100 + rowIdx;  // Bottom row buttons are notes 100-107
        
        // Navigation actions
        var navBinding = page.makeActionBinding(button.mSurfaceValue, navAction);
        // LED is managed by page.mOnActivate (stays blue)
    })(i, navButtonIndices[i], navActions[i]);
}

// Fader bindings (explicit mixerChannels array for clarity)
var mixerChannels = [];
for (var i = 0; i < 8; i++) {
    mixerChannels[i] = hostMixerBankZone.makeMixerBankChannel();
    
    var volumeBinding = page.makeValueBinding(faders[i].mSurfaceValue, mixerChannels[i].mValue.mVolume)
        .setValueTakeOverModeScaled()
        .setSubPage(subPageVolume);
    

    
    // Pan binding with visual feedback
    var panBinding = page.makeValueBinding(faders[i].mSurfaceValue, mixerChannels[i].mValue.mPan)
        .setValueTakeOverModeScaled()
        .setSubPage(subPagePan);
    
    // Add pan value change handler to update display
    (function(index, binding) {
        binding.mOnValueChange = function(context, mapping, value) {
            panValues[index] = value;
            // Update the row display if we're on Pan page
            if (!isDrumPageActive && activeModeButtonIndex === 1) {
                updatePanRow(context, index, value);
            }
        };
    })(i, panBinding);
    
    // Send binding with visual feedback
    var sendBinding = page.makeValueBinding(faders[i].mSurfaceValue, mixerChannels[i].mSends.getByIndex(0).mLevel)
        .setValueTakeOverModeScaled()
        .setSubPage(subPageSend);
    
    // Add send value change handler to update display
    (function(index, binding) {
        binding.mOnValueChange = function(context, mapping, value) {
            sendValues[index] = value;
            // Update the row display if we're on Send page
            if (!isDrumPageActive && activeModeButtonIndex === 2) {
                updateSendRow(context, index, value);
            }
        };
    })(i, sendBinding);
    page.makeValueBinding(faders[i].mSurfaceValue, page.mHostAccess.mFocusedQuickControls.getByIndex(i))
        .setValueTakeOverModeScaled()
        .setSubPage(subPageQC);
}

// Column buttons (0-7) - track selection with LED feedback
var lastSelectionUpdate = [0, 0, 0, 0, 0, 0, 0, 0];  // Track last update time
for (var i = 0; i < 8; i++) {
    (function(index, button) {
        // Bind to track selection - LED feedback handled by the binding
        // Set to Volume subpage so it only works on main page, not drum page
        var binding = page.makeValueBinding(button.mSurfaceValue, mixerChannels[index].mValue.mSelected)
            .setSubPage(subPageVolume);
        
        // LED feedback based on host value (track selection state)
        binding.mOnValueChange = function(context, mapping, value) {
            // Debounce: only update if enough time has passed or value actually changed
            var now = Date.now();
            if (now - lastSelectionUpdate[index] < 50) return;  // Ignore rapid updates within 50ms
            lastSelectionUpdate[index] = now;
            
            var note = 112 + index;  // Column buttons are notes 112-119
            var velocity = value > 0 ? 1 : LED_OFF;  // Side buttons: green when track selected
            setButtonLed(context, note, velocity);
        };
    })(i, colButtons[i]);
}

// Shift button (note 122) - create binding but override behavior for momentary action
var shiftBinding = page.makeActionBinding(colButtons[8].mSurfaceValue, subPageFuncShift.mAction.mActivate);
var lastShiftValue = 0;
shiftBinding.mOnValueChange = function(context, mapping, value) {
    // Block shift functionality when on drum page
    if (isDrumPageActive) {
        lastShiftValue = value;
        return;
    }
    
    // On button release, return to the active mode subpage
    if (lastShiftValue > 0 && value === 0) {
        // Shift released - return to the active mode subpage
        modeButtons[activeModeButtonIndex].mAction.mActivate.trigger(mapping);
    }
    lastShiftValue = value;
};
// No LED feedback needed for shift button (it doesn't have one)

// Bind the 9th fader (index 8) to the main output/master channel volume
if (faders.length > 8) {
    page.makeValueBinding(faders[8].mSurfaceValue, mainOutputChannel.mValue.mVolume)
        .setValueTakeOverModeScaled()
        .setSubPage(subPageVolume);
}

// Update pad columns when faders move (show meters only on main page Volume subpage)
for (var fi = 0; fi < 8; fi++) {
    (function(index) {
        faders[index].mSurfaceValue.mOnProcessValueChange = function(context, value, diff) {
            // Store the physical fader value
            var oldValue = faderValues[index] || 0;
            faderValues[index] = value;
            
            // Only update display if on main page Volume subpage AND value changed significantly
            // This prevents fader meters from showing on drum page
            if (!isDrumPageActive && activeModeButtonIndex === 0 && Math.abs(oldValue - value) > 0.005) {
                updatePadColumn(context, index, value);
            }
        };
    })(fi);
}

// (subPageVolume rendering is handled in the generic subPage activation above)

// Main page activation - clean up LEDs when returning from other pages
page.mOnActivate = function(context) {
    isDrumPageActive = false; // Clear drum page flag
    
    // Light up navigation buttons red (LEFT, RIGHT, UP, DOWN = notes 106, 107, 104, 105)
    // Channel 1 buttons: 0=off, 1=green, 2=blink, 3-127=red
    setButtonLed(context, 104, 3);  // UP - red
    setButtonLed(context, 105, 3);  // DOWN - red
    setButtonLed(context, 106, 3);  // LEFT - red
    setButtonLed(context, 107, 3);  // RIGHT - red
    
    // Restore the active mode button LED
    setButtonLed(context, rowButtons[activeModeButtonIndex].mNote, LED_RED);
    
    // Update fader meters to current positions
    for (var i = 0; i < 8; i++) {
        updatePadColumn(context, i, faderValues[i]);
    }
};

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
    
    // Light up navigation buttons red on startup
    setButtonLed(context, 104, 3);  // UP - red
    setButtonLed(context, 105, 3);  // DOWN - red
    setButtonLed(context, 106, 3);  // LEFT - red
    setButtonLed(context, 107, 3);  // RIGHT - red
    
    // Initialize fader values to zero (will update as faders are moved)
    for (var ci = 0; ci < 8; ci++) {
        faderValues[ci] = 0;
    }
};

// ============================================
// END OF MAIN PAGE SETUP
// ============================================

// ============================================
// GROOVE AGENT DRUMS PAGE SETUP
// ============================================
// Create the drum page AFTER main page is fully set up
pageDrums = deviceDriver.mMapping.makePage('DRUMS');

// CUBASE DRUM MAP (General MIDI Standard):
// Pads send MIDI notes 0-63, organized in 4x4 color blocks
// Use MIDI Transpose +36 to map to GM Drum notes 36-99 (C2 to D#6)
//
// 4x4 Color Blocks:
// Bottom-left (RED) = Main drums - Pads 0-3, 8-11, 16-19, 24-27
// Bottom-right (CYAN) = Cymbals/HiHats - Pads 4-7, 12-15, 20-23, 28-31
// Top-left (YELLOW) = Percussion - Pads 32-35, 40-43, 48-51, 56-59
// Top-right (PURPLE) = Effects/808 - Pads 36-39, 44-47, 52-55, 60-63
//
// Setup in Cubase:
// 1. Load any GM-compatible drum VST
// 2. Inspector > MIDI Modifiers > Transpose: +36 semitones
// 3. Pads will trigger standard GM drum sounds

// Add Shift+RIGHT navigation to switch to drum page (done here after pageDrums exists)
var rightButton = rowButtons[7];
var shiftDrumBinding = page.makeActionBinding(rightButton.mSurfaceValue, pageDrums.mAction.mActivate)
    .setSubPage(subPageFuncShift);
// LED is managed by page.mOnActivate (stays blue)

// NOTE: This page sends MIDI notes 0-63 (C-2 to B2)
// To use with Groove Agent SE's default GM map (notes 36-99):
// 
// OPTION 1 - Cubase 15 Input Transformer:
//   1. Select Groove Agent track
//   2. Inspector > MIDI Modifiers section
//   3. Set "Transpose" to +36 semitones (or +3 octaves)
//
// OPTION 2 - Manually assign in Groove Agent:
//   1. In Groove Agent SE, load your kit
//   2. Drag drum sounds to slots C-2 through B2 (pads will match colors)
//
// OPTION 3 - Use hardware Shift+Drum mode instead (sends notes 0-63 naturally)
//
// Color coding: Red=Kicks, Yellow=Snares, Cyan=HiHats, Purple=Toms,
//               White=Cymbals, Orange/Brown/Amber/Pink=Percussion

// Drum page setup complete - no shift subpage needed since LEFT returns directly

// LEFT button returns to main page (no shift required)
var drumLeftToMainBinding = pageDrums.makeActionBinding(rowButtons[6].mSurfaceValue, page.mAction.mActivate);
// LED is managed by pageDrums.mOnActivate (stays green)

// CUBASE DRUM MAP - 4x4 Block MIDI Organization:
// MIDI notes organized in 4x4 blocks (NOT sequential rows)
// Each 4x4 block sends 16 consecutive MIDI notes
//
// Bottom-left RED (pads 0-3,8-11,16-19,24-27) → Notes 0-15 → +36 = 36-51 (C2-D#3)
// Bottom-right CYAN (pads 4-7,12-15,20-23,28-31) → Notes 16-31 → +36 = 52-67 (E3-G4)
// Top-left YELLOW (pads 32-35,40-43,48-51,56-59) → Notes 32-47 → +36 = 68-83 (G#4-B5)
// Top-right PURPLE (pads 36-39,44-47,52-55,60-63) → Notes 48-63 → +36 = 84-99 (C6-D#7)
//
// Map to 8x8 Groove Agent grid (notes 0-63)

var drumMap = [
    // Row 0 (bottom): notes 0-7
    {note: 0, name: 'Note 0', color: LED_RED, pressColor: LED_ORANGE},
    {note: 1, name: 'Note 1', color: LED_RED, pressColor: LED_ORANGE},
    {note: 2, name: 'Note 2', color: LED_RED, pressColor: LED_ORANGE},
    {note: 3, name: 'Note 3', color: LED_RED, pressColor: LED_ORANGE},
    {note: 4, name: 'Note 4', color: LED_CYAN, pressColor: LED_WHITE},
    {note: 5, name: 'Note 5', color: LED_CYAN, pressColor: LED_WHITE},
    {note: 6, name: 'Note 6', color: LED_CYAN, pressColor: LED_WHITE},
    {note: 7, name: 'Note 7', color: LED_CYAN, pressColor: LED_WHITE},
    
    // Row 1: notes 8-15
    {note: 8, name: 'Note 8', color: LED_RED, pressColor: LED_ORANGE},
    {note: 9, name: 'Note 9', color: LED_RED, pressColor: LED_ORANGE},
    {note: 10, name: 'Note 10', color: LED_RED, pressColor: LED_ORANGE},
    {note: 11, name: 'Note 11', color: LED_RED, pressColor: LED_ORANGE},
    {note: 12, name: 'Note 12', color: LED_CYAN, pressColor: LED_WHITE},
    {note: 13, name: 'Note 13', color: LED_CYAN, pressColor: LED_WHITE},
    {note: 14, name: 'Note 14', color: LED_CYAN, pressColor: LED_WHITE},
    {note: 15, name: 'Note 15', color: LED_CYAN, pressColor: LED_WHITE},
    
    // Row 2: notes 16-23
    {note: 16, name: 'Note 16', color: LED_RED, pressColor: LED_ORANGE},
    {note: 17, name: 'Note 17', color: LED_RED, pressColor: LED_ORANGE},
    {note: 18, name: 'Note 18', color: LED_RED, pressColor: LED_ORANGE},
    {note: 19, name: 'Note 19', color: LED_RED, pressColor: LED_ORANGE},
    {note: 20, name: 'Note 20', color: LED_CYAN, pressColor: LED_WHITE},
    {note: 21, name: 'Note 21', color: LED_CYAN, pressColor: LED_WHITE},
    {note: 22, name: 'Note 22', color: LED_CYAN, pressColor: LED_WHITE},
    {note: 23, name: 'Note 23', color: LED_CYAN, pressColor: LED_WHITE},
    
    // Row 3: notes 24-31
    {note: 24, name: 'Note 24', color: LED_RED, pressColor: LED_ORANGE},
    {note: 25, name: 'Note 25', color: LED_RED, pressColor: LED_ORANGE},
    {note: 26, name: 'Note 26', color: LED_RED, pressColor: LED_ORANGE},
    {note: 27, name: 'Note 27', color: LED_RED, pressColor: LED_ORANGE},
    {note: 28, name: 'Note 28', color: LED_CYAN, pressColor: LED_WHITE},
    {note: 29, name: 'Note 29', color: LED_CYAN, pressColor: LED_WHITE},
    {note: 30, name: 'Note 30', color: LED_CYAN, pressColor: LED_WHITE},
    {note: 31, name: 'Note 31', color: LED_CYAN, pressColor: LED_WHITE},
    
    // Row 4: notes 32-39
    {note: 32, name: 'Note 32', color: LED_YELLOW, pressColor: LED_AMBER},
    {note: 33, name: 'Note 33', color: LED_YELLOW, pressColor: LED_AMBER},
    {note: 34, name: 'Note 34', color: LED_YELLOW, pressColor: LED_AMBER},
    {note: 35, name: 'Note 35', color: LED_YELLOW, pressColor: LED_AMBER},
    {note: 36, name: 'Note 36', color: LED_PURPLE, pressColor: LED_PINK},
    {note: 37, name: 'Note 37', color: LED_PURPLE, pressColor: LED_PINK},
    {note: 38, name: 'Note 38', color: LED_PURPLE, pressColor: LED_PINK},
    {note: 39, name: 'Note 39', color: LED_PURPLE, pressColor: LED_PINK},
    
    // Row 5: notes 40-47
    {note: 40, name: 'Note 40', color: LED_YELLOW, pressColor: LED_AMBER},
    {note: 41, name: 'Note 41', color: LED_YELLOW, pressColor: LED_AMBER},
    {note: 42, name: 'Note 42', color: LED_YELLOW, pressColor: LED_AMBER},
    {note: 43, name: 'Note 43', color: LED_YELLOW, pressColor: LED_AMBER},
    {note: 44, name: 'Note 44', color: LED_PURPLE, pressColor: LED_PINK},
    {note: 45, name: 'Note 45', color: LED_PURPLE, pressColor: LED_PINK},
    {note: 46, name: 'Note 46', color: LED_PURPLE, pressColor: LED_PINK},
    {note: 47, name: 'Note 47', color: LED_PURPLE, pressColor: LED_PINK},
    
    // Row 6: notes 48-55
    {note: 48, name: 'Note 48', color: LED_YELLOW, pressColor: LED_AMBER},
    {note: 49, name: 'Note 49', color: LED_YELLOW, pressColor: LED_AMBER},
    {note: 50, name: 'Note 50', color: LED_YELLOW, pressColor: LED_AMBER},
    {note: 51, name: 'Note 51', color: LED_YELLOW, pressColor: LED_AMBER},
    {note: 52, name: 'Note 52', color: LED_PURPLE, pressColor: LED_PINK},
    {note: 53, name: 'Note 53', color: LED_PURPLE, pressColor: LED_PINK},
    {note: 54, name: 'Note 54', color: LED_PURPLE, pressColor: LED_PINK},
    {note: 55, name: 'Note 55', color: LED_PURPLE, pressColor: LED_PINK},
    
    // Row 7 (top): notes 56-63
    {note: 56, name: 'Note 56', color: LED_YELLOW, pressColor: LED_AMBER},
    {note: 57, name: 'Note 57', color: LED_YELLOW, pressColor: LED_AMBER},
    {note: 58, name: 'Note 58', color: LED_YELLOW, pressColor: LED_AMBER},
    {note: 59, name: 'Note 59', color: LED_YELLOW, pressColor: LED_AMBER},
    {note: 60, name: 'Note 60', color: LED_PURPLE, pressColor: LED_PINK},
    {note: 61, name: 'Note 61', color: LED_PURPLE, pressColor: LED_PINK},
    {note: 62, name: 'Note 62', color: LED_PURPLE, pressColor: LED_PINK},
    {note: 63, name: 'Note 63', color: LED_PURPLE, pressColor: LED_PINK}
];

// Keep track of current drum pad states
var drumPadStates = [];
for (var dp = 0; dp < 64; dp++) {
    drumPadStates[dp] = false;
}

// Flag to track which page is active
var isDrumPageActive = false;

// No bindings needed - pads will send MIDI notes via their base midiInputControl binding
// The LED colors will be handled by updating the global mOnProcessValueChange handler

// Page activation - light up all pads with their 4x4 block colors
pageDrums.mOnActivate = function(context) {
    isDrumPageActive = true;
    
    // Turn off bottom row buttons except LEFT
    for (var r = 0; r < 8; r++) {
        if (r === 6) {
            // LEFT button (note 106) - blink to stand out
            setButtonLed(context, 106, 2);  // Blink
        } else {
            setButtonLed(context, 100 + r, LED_OFF);
        }
    }
    
    // Turn off column buttons
    for (var c = 0; c < 8; c++) {
        setButtonLed(context, 112 + c, LED_OFF);
    }
    setButtonLed(context, 122, LED_OFF);  // Shift button
    
    // Light up all drum pads with their 4x4 block base colors
    for (var i = 0; i < 64; i++) {
        setLed(context, i, drumMap[i].color);
    }
};

// Page deactivation - clear flag
pageDrums.mOnDeactivate = function(context) {
    isDrumPageActive = false;
};

// Use hardware Shift+Drum for drum/note mode