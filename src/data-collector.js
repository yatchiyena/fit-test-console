/*
Collect data from PortaCount 8020a
 */
import {isSayingSomething, sayIt, sayItLater} from "./speech.js";

// data output patterns
const PORTACOUNT_VERSION_PATTERN = /^PORTACOUNT\s+PLUS\S+PROM\S+(?<version>.+)/i; // PORTACOUNT PLUS PROM V1.7
const COPYRIGHT_PATTERN = /^COPYRIGHT.+/i; // COPYRIGHT(c)1992 TSI INC
const LICENSE_PATTERN = /^ALL\s+RIGHTS\s+RESERVED/i; // ALL RIGHTS RESERVED
const SERIAL_NUMBER_PATTERN = /^Serial\s+Number\s+(?<serialNumber>\d+)/i; // Serial Number 17754
const PASS_LEVEL_PATTERN = /^FF\s+pass\s+level\s+(?<passLevel>\d+)/i; // FF pass level = 100
const NUM_EXERCISES_PATTERN = /^No\.\s+of\s+exers\s*=\s*(?<numExercises>\d+)/i; // No. of exers  = 4
const AMBIENT_PURGE_PATTERN = /^Ambt\s+purge\s*=\s*(?<ambientPurgeTime>\d+)/i; // Ambt purge   = 4 sec.
const AMBIENT_SAMPLE_PATTERN = /^Ambt\s+sample\s*=\s*(?<ambientSampleTime>\d+)/i; // Ambt sample  = 5 sec.
const MASK_PURGE_PATTERN = /^Mask\s+purge\s*=\s*(?<maskPurgeTime>\d+)/i; // Mask purge  = 11 sec.
const MASK_SAMPLE_PATTERN = /^Mask\s+sample\s+(?<exerciseNumber>\d+)\s*=\s*(?<maskSampleTime>\d+)/i; // Mask sample 1 = 40 sec.
const DIP_SWITCH_PATTERN = /^DIP\s+switch\s+=\s+(?<dipSwitchBits>\d+)/i; // DIP switch  = 10111111
const COUNT_READING_PATTERN = /^Conc\.\s+(?<concentration>[\d\.]+)/i; // Conc.      0.00 #/cc
const NEW_TEST_PATTERN = /^NEW\s+TEST\s+PASS\s*=\s*(?<passLevel>\d+)/i; // NEW TEST PASS =  100
const AMBIENT_READING_PATTERN = /^Ambient\s+(?<concentration>[\d\.]+)/i; // Ambient   2290 #/cc
const MASK_READING_PATTERN = /^Mask\s+(?<concentration>[\d+\.]+)/i; // Mask    5.62 #/cc
const FIT_FACTOR_PATTERN = /^FF\s+(?<exerciseNumber>\d+)\s+(?<fitFactor>[\d\.]+)\s+(?<result>.+)/; // FF  1    352 PASS
const TEST_TERMINATED_PATTERN = /^Test\s+Terminated/i; // Test Terminated
const OVERALL_FIT_FACTOR_PATTERN = /^Overall\s+FF\s+(?<fitFactor>[\d\.]+)\s+(?<result>.+)/i; // Overall FF    89 FAIL
const LOW_PARTICLE_COUNT_PATTERN = /^(?<concentration>\d+)\/cc\s+Low\s+Particle\s+Count/i; // 970/cc Low Particle Count



export class DataCollector {
    static nextTabIndex = 100;
    beginExerciseTimoutId = null;
    logTextArea;
    dataTextArea;
    instructionsTextArea;
    currentTestData;
    testDataHeaderRow;
    testDataBody = null;
    testDataCurrentRow = null;
    headerComplete = false;
    exerciseCount = 0; // we don't know up front how many exercises there are per test
    testCount = 0;

    constructor(logTextArea, dataTextArea, instructionsTextArea) {
        this.logTextArea = logTextArea;
        this.dataTextArea = dataTextArea;
        this.instructionsTextArea = instructionsTextArea;
        this.testDataHeaderRow = document.getElementById("test-data-header-row");
        this.testDataBody = document.getElementById("test-data-body");
        this.tableDiv = document.getElementById("data-table-div");
    }

    static getNextTabIndex() {
        const n = DataCollector.nextTabIndex;
        // advance by 2, so we can put the editor in the middle of adjacent cells and try to get shift-tab navigation to work properly
        // this doesn't seem to fix shift-tab tabindex traversal
        DataCollector.nextTabIndex += 2;
        return n;
    }

    appendToLog(message) {
        this.logTextArea.value += message;
        DataCollector.scrollToBottom(this.logTextArea);
    }
    appendToData(data) {
        this.dataTextArea.value += data;
        DataCollector.scrollToBottom(this.dataTextArea);
    }
    setInstructions(message) {
        this.instructionsTextArea.innerText = message;
        this.maybeSayIt(message);
    }

    speechEnabled() {
        return document.getElementById("enable-speech-checkbox").checked;
    }

    speechVerbose() {
        return this.speechEnabled() && document.getElementById("enable-verbose-speech-checkbox").checked;
    }

    shouldSayParticleCount() {
        return this.speechEnabled() && document.getElementById("speak-concentration-checkbox").checked;
    }

    maybeSayIt(message) {
        if(this.speechEnabled()) {
            sayIt(message);
        }
    }

    maybeSayItLater(message) {
        if(this.speechEnabled()) {
            sayItLater(message);
        }
    }

    static scrollToBottom(theTextArea) {
        theTextArea.scrollTop = theTextArea.scrollHeight;
    }


    processLine(line) {
        // appendOutput(`processLine: ${line} (length: ${line.length})\n`);
        if(line.length === 0) {
            this.appendToLog("processLine() ignoring empty line\n");
            return;
        }
        // this.appendToLog(`${line}\n`);
        let match;

        match = line.match(NEW_TEST_PATTERN)
        if(match) {
            this.appendToData(`\nStarting a new test. ${new Date().toLocaleString()}\n`);
            this.setInstructions("Perform exercise 1");
            this.currentTestData = {
                start_time: new Date().toLocaleString(),
                results: [],
                samples: []
            }
            this.recordTestStart();
            return;
        }

        match = line.match(AMBIENT_READING_PATTERN);
        if(match) {
            let concentration = match.groups.concentration;
            this.appendToData(`ambient concentration: ${concentration}\n`);
            this.currentTestData.samples.push({ambient: concentration});
            return;
        }

        match = line.match(MASK_READING_PATTERN);
        if(match) {
            let concentration = match.groups.concentration;
            this.appendToData(`mask concentration: ${concentration}\n`);
            this.setInstructions("Breathe normally");
            this.currentTestData.samples.push({mask: concentration});
            return;
        }

        match = line.match(FIT_FACTOR_PATTERN);
        if(match) {
            const ff = match.groups.fitFactor;
            const exerciseNum = Number(match.groups.exerciseNumber);
            const result = match.groups.result;
            this.appendToData(`Exercise ${exerciseNum}: Fit factor is ${ff}. Result: ${result}\n`)
            this.setInstructions(`Perform exercise ${exerciseNum+1}`);
            this.maybeSayItLater(`Score was ${ff}`)
            // this.beginExerciseTimoutId = this.scheduleBeginExercisePrompt(exerciseNum+1);
            this.currentTestData.results.push({exercise_num: exerciseNum, fit_factor: ff, result: result});
            this.recordExerciseResult(exerciseNum, ff, result);
            return;
        }

        match = line.match(OVERALL_FIT_FACTOR_PATTERN);
        if(match) {
            const ff = match.groups["fitFactor"];
            const result = match.groups["result"];
            this.appendToData(`\nTest complete. ${result} with FF of ${ff}\n`);
            this.setInstructions(`Test complete. Score: ${ff}`);
            this.currentTestData.results.push({exercise_num: "overall", fit_factor: ff, result: result});
            this.appendToLog(JSON.stringify(this.currentTestData) + "\n");
            this.recordTestComplete(ff, result);
            return;
        }

        if(line.match(TEST_TERMINATED_PATTERN)) {
            this.appendToData(`\nTest aborted\n`);
            this.setInstructions("Breathe normally");
            this.recordTestAborted();
            return;
        }

        match = line.match(COUNT_READING_PATTERN);
        if(match) {
            if(!isSayingSomething()) {
                const concentration = match.groups.concentration;
                if(this.shouldSayParticleCount()) {
                    if (this.speechVerbose()) {
                        this.maybeSayIt(`Particle count is ${concentration}\n`);
                    } else {
                        this.maybeSayIt(`${concentration}\n`);
                    }
                }
            }
        }

    }

    recordTestComplete(ff, result) {
        if(!this.headerComplete) {
            this.addColumnToHeader("Overall");
            this.headerComplete = true;
        }
        this.appendExerciseResult(ff, result);
    }

    recordTestAborted() {
        const cell = document.createElement("td");
        cell.setAttribute("colspan", "100%");
        cell.innerText = `aborted`;
        cell.classList.add("aborted");
        this.testDataCurrentRow.appendChild(cell);
        this.setInstructions("Test cancelled.");
    }

    /**
     * target must be a table cell (td)
     * Use a contentEditable DIV for auto-resizing editing box: https://stackoverflow.com/a/15866077
     * @param target
     */
    static beginEditing(target) {
        const input = document.createElement("div");
        input.setAttribute("contentEditable", "true");

        /** Swap out the tabindex with the input element so shift-tab works properly.
         * Otherwise, shift-tabbing will focus on the target (the td, which will re-enable editing mode).
         * Removing the tabindex on the td means shift-tab will focus on the cell to its left as intended.
         */
        input.setAttribute("tabindex", target.getAttribute("tabindex"));
        target.removeAttribute("tabindex");

        input.classList.add("editable-table-cell")
        input.innerHTML = target.innerHTML;
        target.replaceChildren(input);
        input.focus();

        input.onblur = (event) => {
            target.setAttribute("tabindex", input.getAttribute("tabindex"));
            // target.replaceChildren();
            target.innerHTML = input.innerHTML;
        }
    }


    recordTestStart() {
        // TODO: use databinding
        function createTimestampCell() {
            const cell = document.createElement("td");
            cell.innerText = new Date().toLocaleString();
            return cell;
        }
        function createEditableTableCell() {
            let cell = document.createElement("td");
            cell.classList.add("editable");
            cell.setAttribute("tabindex", "" + DataCollector.getNextTabIndex());
            cell.onfocus = function () {
                DataCollector.beginEditing(cell);
            }
            return cell;
        }

        const row = document.createElement("tr");
        this.testDataCurrentRow = row;

        this.testDataBody.appendChild(this.testDataCurrentRow);
        let testNumCell = document.createElement("td");
        testNumCell.innerText = "" + (++this.testCount);

        row.appendChild(testNumCell);
        row.appendChild(createTimestampCell());

        row.appendChild(createEditableTableCell()); // participant
        row.appendChild(createEditableTableCell()); // mask

        // scroll to bottom
        this.tableDiv.scrollTop = this.tableDiv.scrollHeight;
    }

    recordExerciseResult(exerciseNum, ff, result) {
        if(this.exerciseCount < exerciseNum) {
            this.addColumnToHeader(`Ex ${exerciseNum}`);
            this.exerciseCount++;
        }
        this.appendExerciseResult(ff, result);
    }

    appendExerciseResult(ff, result) {
        const exerciseResultCell = document.createElement("td");
        exerciseResultCell.innerText = `${Math.floor(ff)}`;
        exerciseResultCell.classList.add(result.toLowerCase(), "results");  // todo: parse this out explicitly to pass/fail
        this.testDataCurrentRow.appendChild(exerciseResultCell);
    }

    addColumnToHeader(heading) {
        const columnHeading = document.createElement("th");
        columnHeading.innerText = heading;
        this.testDataHeaderRow.appendChild(columnHeading);
    }

    /**
     * When we get results from the previous exercise, we can prompt the participant to start the next exercise.
     * If we've finished the last exercise of the test, we'll get the overall fit factor result soon. So we should
     * delay prompting for the next exercise in this case.
     * @param nextExerciseNum
     * @returns {number}
     */
    scheduleBeginExercisePrompt(nextExerciseNum) {
        const timeoutMs = 3200;
        const timeoutId = setTimeout(() => {
            this.beginExerciseTimoutId = null;
            this.setInstructions(`Perform exercise ${nextExerciseNum}`);
        }, timeoutMs);
        return timeoutId;
    }

    cancelBeginExercisePrompt() {
        if(this.beginExerciseTimoutId !== null) {
            this.appendToLog("cancelling begin exercise prompt\n");
            clearTimeout(this.beginExerciseTimoutId);
            this.beginExerciseTimoutId = null;
        }
    }
}