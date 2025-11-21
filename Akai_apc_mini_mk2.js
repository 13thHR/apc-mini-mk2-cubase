var midiremote_api = require('midiremote_api_v1');

var deviceDriver = midiremote_api.makeDeviceDriver('Akai', 'APC MINI MK2', '13thHouR v2');
var midiInput = deviceDriver.mPorts.makeMidiInput();
var midiOutput = deviceDriver.mPorts.makeMidiOutput();

deviceDriver.makeDetectionUnit().detectPortPair(midiInput, midiOutput)
    .expectSysexIdentityResponse('47', '2800', '1902');

var surface = deviceDriver.mSurface;
var midiChannel = 0;

// LED color codes (Akai spec - velocity values for pads on channel 7)
var LED_OFF = 0;
var LED_RED = 72;          // Bright red (0x48)
var LED_GREEN = 87;        // Bright green
var LED_BLUE = 41;         // Blue
var LED_YELLOW = 74;       // Bright yellow
var LED_CYAN = 78;         // Cyan
var LED_ORANGE = 61;       // Orange
var LED_PURPLE = 67;       // Purple
var LED_WHITE = 3;         // White
var LED_PINK = 95;         // Pink
var LED_AMBER = 96;        // Amber
var LED_BLINK = 2;         // Flash (for channel 1 buttons)

// Dimensions
var wPad = 2, hPad = 1, buttonSize = hPad;

// Send LED update for matrix pads (channel 7 for max brightness)
function setLed(context, note, color) {
    // Validate inputs to prevent crashes
    if (typeof note !== 'number' || note < 0 || note > 127) return;
    if (typeof color !== 'number' || color < 0 || color > 127) return;
    midiOutput.sendMidi(context, [0x90 | 6, note, color]); // Channel 7 (0-indexed as 6) for max brightness
}

// Send LED update for buttons (channel 1)
function setButtonLed(context, note, velocity) {
    // Validate inputs to prevent crashes
    if (typeof note !== 'number' || note < 0 || note > 127) return;
    if (typeof velocity !== 'number' || velocity < 0 || velocity > 127) return;
    midiOutput.sendMidi(context, [0x90 | 0, note, velocity]); // Channel 1
}

// Clip grid (8x8)
function makeMatrixPad(note) {
    var row = Math.floor(note / 8);
    var col = note % 8;
    var pad = surface.makeTriggerPad(col * wPad, (7 - row) * hPad, wPad, hPad);
    
    // Bind to MIDI input to receive pad events
    pad.mSurfaceValue.mMidiBinding
        .setInputPort(midiInput)
        .bindToNote(midiChannel, note);
    
    // Handle pad press/release for drum page LED feedback
    pad.mSurfaceValue.mOnProcessValueChange = function(context, value) {
        if (isDrumPageActive) {
            var drumInfo = drumMap[note];
            setLed(context, note, value > 0 ? drumInfo.pressColor : drumInfo.color);
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
        .setInputPort(midiInput)
        .setOutputPort(midiOutput)
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
        .setInputPort(midiInput)
        .setOutputPort(midiOutput)
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
        .setInputPort(midiInput)
        .setOutputPort(midiOutput)
        .bindToControlChange(midiChannel, 0x30 + index);
    return fader;
}

// Build surface
var pads = [], rowButtons = [], colButtons = [], faders = [];
for (var i = 0; i < 64; i++) pads.push(makeMatrixPad(i));
for (var r = 0; r < 8; r++) rowButtons.push(makeRowButton(r));
for (var c = 0; c < 9; c++) colButtons.push(makeColumnButton(c));
for (var f = 0; f < 9; f++) faders.push(makeFader(f));

// ============================================
// CHASER PAGE - LED animation page (Default)
// ============================================
var pageChaser = deviceDriver.mMapping.makePage('Chaser');

// LED chaser variables (now scrolling text)
var chaserEnabled = false;
var chaserPosition = 0;
var chaserFrameCounter = 0;
var chaserSpeed = 3; // frames between updates (lower = faster)

// Text scrolling - "Cubase..." in 5x7 font
var scrollText = "Cubase...";
var textBitmap = {
    'C': [0x3E, 0x41, 0x41, 0x41, 0x22],
    'u': [0x3C, 0x40, 0x40, 0x3C, 0x00],
    'b': [0x7F, 0x48, 0x48, 0x30, 0x00],
    'a': [0x20, 0x54, 0x54, 0x78, 0x00],
    's': [0x48, 0x54, 0x54, 0x24, 0x00],
    'e': [0x38, 0x54, 0x54, 0x18, 0x00],
    '.': [0x00, 0x60, 0x60, 0x00, 0x00],
    ' ': [0x00, 0x00, 0x00, 0x00, 0x00]
};
var scrollOffset = 0;

// ============================================
// MAIN PAGE SETUP (VOLUME)
// ============================================

var page = deviceDriver.mMapping.makePage('VOLUME');
var hostMixerBankZone = page.mHostAccess.mMixConsole.makeMixerBankZone().excludeInputChannels().excludeOutputChannels();
var mainOutputChannel = page.mHostAccess.mMixConsole.makeMixerBankZone('Stereo Out').includeOutputChannels().makeMixerBankChannel();

// Declare drum page variable (will be created after main page setup)
var pageDrums;

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

// Track fader positions and states
var faderValues = [0,0,0,0,0,0,0,0];
var faderSteps = [0,0,0,0,0,0,0,0];
// Track pan values (0..1, where 0.5 is center)
var panValues = [0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5];
var panPositions = [4,4,4,4,4,4,4,4];  // Track actual pad positions
// Track send values (0..1)
var sendValues = [0,0,0,0,0,0,0,0];
var sendPositions = [0,0,0,0,0,0,0,0];  // Track actual pad positions
// Track device (Quick Controls) values (0..1)
var deviceValues = [0,0,0,0,0,0,0,0];
var deviceSteps = [0,0,0,0,0,0,0,0];  // Track actual pad steps
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

// Update send row display: yellow background with orange indicator
// rowIndex: which row (0-7) to update for this channel
// sendValue: 0..1 where 0 is left, 1 is right
function updateSendRow(context, rowIndex, sendValue) {
    if (typeof sendValue === 'undefined') {
        sendValue = sendValues[rowIndex] || 0;
    }
    
    var sendPos = Math.max(0, Math.min(7, Math.floor(sendValue * 8)));
    
    if (sendPos === sendPositions[rowIndex]) return;
    sendPositions[rowIndex] = sendPos;
    
    var prevState = padColumnState[rowIndex];
    var newState = [];
    
    for (var col = 0; col < 8; col++) {
        if (col === sendPos) {
            newState[col] = LED_ORANGE;
        } else {
            newState[col] = LED_YELLOW;
        }
    }
    
    for (var col = 0; col < 8; col++) {
        if (newState[col] !== prevState[col]) {
            var note = rowIndex * 8 + col;
            setLed(context, note, newState[col]);
        }
    }
    
    padColumnState[rowIndex] = newState;
}

// Update device (Quick Controls) row display: purple/magenta horizontal bars
function updateDeviceRow(context, rowIndex, value) {
    if (typeof value === 'undefined') {
        value = deviceValues[rowIndex] || 0;
    }
    
    var steps = Math.max(0, Math.min(8, Math.floor(value * 8)));
    if (steps === deviceSteps[rowIndex]) return;
    deviceSteps[rowIndex] = steps;

    var prevState = padColumnState[rowIndex];
    var newState = [];
    
    for (var col = 0; col < 8; col++) {
        if (col < steps) {
            var color = 53;                    // Purple/Magenta
            if (col >= 6) color = LED_PINK;    // Right side: bright pink
            else color = 53;                   // Left side: purple/magenta
            newState[col] = color;
        } else {
            newState[col] = LED_OFF;
        }
    }

    for (var col = 0; col < 8; col++) {
        if (newState[col] !== prevState[col]) {
            var note = rowIndex * 8 + col;
            setLed(context, note, newState[col]);
        }
    }

    padColumnState[rowIndex] = newState;
}

// Add activation handlers to update LEDs when subpage activates
for (var mi = 0; mi < modeButtons.length; mi++) {
    (function(modeIdx, subPage) {
        subPage.mOnActivate = function(context, activeMapping) {
            // Exit chaser if it's running
            if (chaserEnabled) {
                chaserEnabled = false;
                for (var i = 0; i < 64; i++) {
                    setLed(context, i, LED_OFF);
                }
                // Restore navigation buttons to solid
                setButtonLed(context, 104, 3);  // UP
                setButtonLed(context, 105, 3);  // DOWN
                setButtonLed(context, 106, 3);  // LEFT
                setButtonLed(context, 107, 3);  // RIGHT
            }
            
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
                    sendPositions[si] = -1;
                    updateSendRow(context, si, sendValues[si]);
                }
            }
            
            // If Device mode activated, update all device rows
            if (modeIdx === 3) {
                for (var qi = 0; qi < 8; qi++) {
                    deviceSteps[qi] = -1;
                    updateDeviceRow(context, qi, deviceValues[qi]);
                }
            }
        };
    })(mi, modeButtons[mi]);
}

// Mode buttons (bottom row 0-3) - bind actions and add chaser exit
page.makeActionBinding(rowButtons[0].mSurfaceValue, subPageVolume.mAction.mActivate);
page.makeActionBinding(rowButtons[1].mSurfaceValue, subPagePan.mAction.mActivate);
page.makeActionBinding(rowButtons[2].mSurfaceValue, subPageSend.mAction.mActivate);
page.makeActionBinding(rowButtons[3].mSurfaceValue, subPageQC.mAction.mActivate);

// Add handlers to mode buttons that work from chaser page
for (var i = 0; i < 4; i++) {
    (function(buttonIdx, subPage) {
        // Also bind on pageChaser so mode buttons work from chaser page
        pageChaser.makeActionBinding(rowButtons[buttonIdx].mSurfaceValue, page.mAction.mActivate);
        
        rowButtons[buttonIdx].mSurfaceValue.mOnProcessValueChange = function(context, activeMapping, value) {
            if (value > 0) {
                // Exit chaser if running
                if (chaserEnabled) {
                    chaserEnabled = false;
                    for (var j = 0; j < 64; j++) {
                        setLed(context, j, LED_OFF);
                    }
                    setButtonLed(context, 104, 3);  // UP
                    setButtonLed(context, 105, 3);  // DOWN
                    setButtonLed(context, 106, 3);  // LEFT
                    setButtonLed(context, 107, 3);  // RIGHT
                }
                // Activate main page first, then the subpage
                page.mAction.mActivate.trigger(activeMapping);
                subPage.mAction.mActivate.trigger(activeMapping);
            }
        };
    })(i, modeButtons[i]);
}

// Navigation buttons (UP, DOWN, LEFT, RIGHT)
var navActions = [
    hostMixerBankZone.mAction.mShiftLeft,
    hostMixerBankZone.mAction.mShiftRight,
    hostMixerBankZone.mAction.mPrevBank,
    hostMixerBankZone.mAction.mNextBank
];
var navButtonIndices = [6, 7, 4, 5];  // LEFT, RIGHT, UP, DOWN
for (var i = 0; i < 4; i++) {
    (function(navIdx, rowIdx, navAction) {
        page.makeActionBinding(rowButtons[rowIdx].mSurfaceValue, navAction);
        // Add handler to exit chaser when navigation button pressed
        rowButtons[rowIdx].mSurfaceValue.mOnProcessValueChange = function(context, value) {
            if (value > 0 && chaserEnabled) {
                // Exit chaser page when navigation button pressed
                chaserEnabled = false;
                for (var i = 0; i < 64; i++) {
                    setLed(context, i, LED_OFF);
                }
                // Restore all navigation buttons to solid
                setButtonLed(context, 104, 3);  // UP
                setButtonLed(context, 105, 3);  // DOWN
                setButtonLed(context, 106, 3);  // LEFT
                setButtonLed(context, 107, 3);  // RIGHT (stop flashing)
            }
        };
    })(i, navButtonIndices[i], navActions[i]);
}

// Fader bindings for 8 channels + master
var mixerChannels = [];
for (var i = 0; i < 8; i++) {
    mixerChannels[i] = hostMixerBankZone.makeMixerBankChannel();
    
    var volumeBinding = page.makeValueBinding(faders[i].mSurfaceValue, mixerChannels[i].mValue.mVolume)
        .setValueTakeOverModeScaled()
        .setSubPage(subPageVolume);

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
            if (!isDrumPageActive && activeModeButtonIndex === 2) {
                updateSendRow(context, index, value);
            }
        };
    })(i, sendBinding);
    
    var deviceBinding = page.makeValueBinding(faders[i].mSurfaceValue, page.mHostAccess.mFocusedQuickControls.getByIndex(i))
        .setValueTakeOverModeScaled()
        .setSubPage(subPageQC);
    
    // Add device value change handler to update display
    (function(index, binding) {
        binding.mOnValueChange = function(context, mapping, value) {
            deviceValues[index] = value;
            if (!isDrumPageActive && activeModeButtonIndex === 3) {
                updateDeviceRow(context, index, value);
            }
        };
    })(i, deviceBinding);
}

// Track selection buttons with LED feedback
var lastSelectionUpdate = [0, 0, 0, 0, 0, 0, 0, 0];
for (var i = 0; i < 8; i++) {
    (function(index, button) {
        var binding = page.makeValueBinding(button.mSurfaceValue, mixerChannels[index].mValue.mSelected)
            .setSubPage(subPageVolume);
        
        binding.mOnValueChange = function(context, mapping, value) {
            var now = Date.now();
            if (now - lastSelectionUpdate[index] < 50) return;
            lastSelectionUpdate[index] = now;
            
            var velocity = value > 0 ? 1 : LED_OFF;
            setButtonLed(context, 112 + index, velocity);
        };
    })(i, colButtons[i]);
}

// Shift button - momentary activation
var shiftBinding = page.makeActionBinding(colButtons[8].mSurfaceValue, subPageFuncShift.mAction.mActivate);
var lastShiftValue = 0;
shiftBinding.mOnValueChange = function(context, mapping, value) {
    if (isDrumPageActive) {
        lastShiftValue = value;
        return;
    }
    
    if (lastShiftValue > 0 && value === 0) {
        modeButtons[activeModeButtonIndex].mAction.mActivate.trigger(mapping);
    }
    lastShiftValue = value;
};

// Master fader binding
if (faders.length > 8) {
    page.makeValueBinding(faders[8].mSurfaceValue, mainOutputChannel.mValue.mVolume)
        .setValueTakeOverModeScaled()
        .setSubPage(subPageVolume);
}

// Update pad display when faders move
for (var fi = 0; fi < 8; fi++) {
    (function(index) {
        faders[index].mSurfaceValue.mOnProcessValueChange = function(context, value, diff) {
            var oldValue = faderValues[index] || 0;
            faderValues[index] = value;
            
            if (!isDrumPageActive && Math.abs(oldValue - value) > 0.005) {
                if (activeModeButtonIndex === 0) {
                    updatePadColumn(context, index, value);
                } else if (activeModeButtonIndex === 3) {
                    deviceValues[index] = value;
                    updateDeviceRow(context, index, value);
                }
            }
        };
    })(fi);
}

// Main page activation
page.mOnActivate = function(context) {
    isDrumPageActive = false; // Clear drum page flag
    chaserEnabled = false; // Ensure chaser is stopped
    
    // Light up navigation buttons (UP, DOWN, LEFT, RIGHT) - solid, not flashing
    setButtonLed(context, 104, 3);  // UP
    setButtonLed(context, 105, 3);  // DOWN
    setButtonLed(context, 106, 3);  // LEFT
    setButtonLed(context, 107, 3);  // RIGHT
    
    // Restore the active mode button LED
    setButtonLed(context, rowButtons[activeModeButtonIndex].mNote, LED_RED);
    
    // Update all pad displays based on active mode
    for (var i = 0; i < 8; i++) {
        if (activeModeButtonIndex === 0) {
            updatePadColumn(context, i, faderValues[i]);
        } else if (activeModeButtonIndex === 1) {
            updatePanRow(context, i, panValues[i]);
        } else if (activeModeButtonIndex === 2) {
            updateSendRow(context, i, sendValues[i]);
        } else if (activeModeButtonIndex === 3) {
            updateDeviceRow(context, i, deviceValues[i]);
        }
    }
};

// Initialize device on startup
deviceDriver.mOnActivate = function(context) {
    // Turn off all LEDs
    for (var i = 0; i < 64; i++) setLed(context, i, LED_OFF);
    for (var r = 0; r < rowButtons.length; r++) setButtonLed(context, rowButtons[r].mNote, LED_OFF);
    for (var c = 0; c < colButtons.length; c++) setButtonLed(context, colButtons[c].mNote, LED_OFF);
    
    // Activate Volume mode and navigation buttons
    activeModeButtonIndex = 0;
    setButtonLed(context, rowButtons[0].mNote, LED_RED);
    setButtonLed(context, 104, 3);  // UP
    setButtonLed(context, 105, 3);  // DOWN
    setButtonLed(context, 106, 3);  // LEFT
    setButtonLed(context, 107, 3);  // RIGHT
    
    // Initialize all fader displays
    for (var i = 0; i < 8; i++) {
        faderValues[i] = 0;
        updatePadColumn(context, i, 0);
    }
    
    // Initialize fader values to zero (will update as faders are moved)
    for (var ci = 0; ci < 8; ci++) {
        faderValues[ci] = 0;
    }
};

// ============================================
// DRUMS PAGE SETUP
// ============================================
pageDrums = deviceDriver.mMapping.makePage('DRUMS');

// Drum map: 8x8 grid sends MIDI notes 0-63
// Color blocks: RED (bottom-left), CYAN (bottom-right), YELLOW (top-left), PURPLE (top-right)
// For Groove Agent: assign sounds directly to notes 0-63, or use MIDI Transpose +36

// Navigation: Shift+RIGHT to drum page, LEFT to return to main page
var shiftDrumBinding = page.makeActionBinding(rowButtons[7].mSurfaceValue, pageDrums.mAction.mActivate)
    .setSubPage(subPageFuncShift);
var drumLeftToMainBinding = pageDrums.makeActionBinding(rowButtons[6].mSurfaceValue, page.mAction.mActivate);

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

// Flag to track which page is active
var isDrumPageActive = false;

// Drum page activation
pageDrums.mOnActivate = function(context) {
    isDrumPageActive = true;
    
    // Turn off bottom row buttons except LEFT
    for (var r = 0; r < 8; r++) {
        setButtonLed(context, 100 + r, LED_OFF);
    }
    setButtonLed(context, 106, 2);  // LEFT button blinks to indicate drum mode
    
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

pageDrums.mOnDeactivate = function(context) {
    isDrumPageActive = false;
};

// Scrolling text update function
function updateChaser(context) {
    // Clear all pads
    for (var i = 0; i < 64; i++) {
        setLed(context, i, LED_OFF);
    }
    
    // Build the full character array for the text
    var charColumns = [];
    for (var ci = 0; ci < scrollText.length; ci++) {
        var char = scrollText.charAt(ci);
        var bitmap = textBitmap[char] || textBitmap[' '];
        for (var col = 0; col < 5; col++) {
            charColumns.push(bitmap[col]);
        }
        charColumns.push(0); // space between characters
    }
    
    // Display 8 columns starting from scrollOffset
    for (var col = 0; col < 8; col++) {
        var charColIndex = (scrollOffset + col) % charColumns.length;
        var columnData = charColumns[charColIndex];
        
        // Draw column (flip vertically - row 7 is top, row 0 is bottom)
        for (var row = 0; row < 8; row++) {
            if (columnData & (1 << row)) {
                var flippedRow = 7 - row; // Flip the row
                var note = col + flippedRow * 8;
                setLed(context, note, LED_CYAN); // Cyan color for text
            }
        }
    }
    
    // Move scroll position
    scrollOffset = (scrollOffset + 1) % charColumns.length;
}

// Device idle callback for chaser animation
deviceDriver.mOnIdle = function(activeDevice) {
    if (chaserEnabled) {
        chaserFrameCounter++;
        if (chaserFrameCounter >= chaserSpeed) {
            chaserFrameCounter = 0;
            updateChaser(activeDevice);
        }
    }
};

// Chaser page activation (now scrolling text)
pageChaser.mOnActivate = function(context) {
    chaserEnabled = true;
    scrollOffset = 0;
    chaserFrameCounter = 0;
    
    // Turn off all bottom row buttons except RIGHT (blink to indicate chaser mode)
    for (var r = 0; r < 8; r++) {
        setButtonLed(context, 100 + r, LED_OFF);
    }
    setButtonLed(context, 107, 2);  // RIGHT button blinks
    
    // Turn off column buttons
    for (var c = 0; c < 8; c++) {
        setButtonLed(context, 112 + c, LED_OFF);
    }
    setButtonLed(context, 122, LED_OFF);
};

pageChaser.mOnDeactivate = function(context) {
    chaserEnabled = false;
    // Clear all LEDs when leaving chaser page
    for (var i = 0; i < 64; i++) {
        setLed(context, i, LED_OFF);
    }
};