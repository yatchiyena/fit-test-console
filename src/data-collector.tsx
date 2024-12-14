/*
Collect data from PortaCount 8020a
 */

// data output patterns
import {speech} from "./speech.ts";
import {ExternalControlStates} from "./external-control.tsx";
import {SETTINGS_DB, SimpleResultsDB, SimpleResultsDBRecord} from "./database.ts";
import React, {RefObject, useEffect, useState} from "react";
import {ResultsTable} from "./ResultsTable.tsx";

// TODO: move to util, or get a library for this
function sum(theNumbers:number[], startIndex:number=0, endIndex:number=-1) {
    return theNumbers.slice(startIndex, endIndex).reduce((total, theNumber) => total + theNumber, 0)
}
function avg(theNumbers: number[], startIndex: number=0, endIndex: number=-1) {
    if(endIndex<0) {
        endIndex = theNumbers.length;
    }
    return sum(theNumbers, startIndex, endIndex) / (endIndex - startIndex);
}


export class DataCollector {
    static PORTACOUNT_VERSION_PATTERN = /^PORTACOUNT\s+PLUS\S+PROM\S+(?<version>.+)/i; // PORTACOUNT PLUS PROM V1.7
    static COPYRIGHT_PATTERN = /^COPYRIGHT.+/i; // COPYRIGHT(c)1992 TSI INC
    static LICENSE_PATTERN = /^ALL\s+RIGHTS\s+RESERVED/i; // ALL RIGHTS RESERVED
    static SERIAL_NUMBER_PATTERN = /^Serial\s+Number\s+(?<serialNumber>\d+)/i; // Serial Number 17754
    static PASS_LEVEL_PATTERN = /^FF\s+pass\s+level\s+(?<passLevel>\d+)/i; // FF pass level = 100
    static NUM_EXERCISES_PATTERN = /^No\.\s+of\s+exers\s*=\s*(?<numExercises>\d+)/i; // No. of exers  = 4
    static AMBIENT_PURGE_PATTERN = /^Ambt\s+purge\s*=\s*(?<ambientPurgeTime>\d+)/i; // Ambt purge   = 4 sec.
    static AMBIENT_SAMPLE_PATTERN = /^Ambt\s+sample\s*=\s*(?<ambientSampleTime>\d+)/i; // Ambt sample  = 5 sec.
    static MASK_PURGE_PATTERN = /^Mask\s+purge\s*=\s*(?<maskPurgeTime>\d+)/i; // Mask purge  = 11 sec.
    static MASK_SAMPLE_PATTERN = /^Mask\s+sample\s+(?<exerciseNumber>\d+)\s*=\s*(?<maskSampleTime>\d+)/i; // Mask sample 1 = 40 sec.
    static DIP_SWITCH_PATTERN = /^DIP\s+switch\s+=\s+(?<dipSwitchBits>\d+)/i; // DIP switch  = 10111111
    static COUNT_READING_PATTERN = /^Conc\.\s+(?<concentration>[\d.]+)/i; // Conc.      0.00 #/cc
    static NEW_TEST_PATTERN = /^NEW\s+TEST\s+PASS\s*=\s*(?<passLevel>\d+)/i; // NEW TEST PASS =  100
    static AMBIENT_READING_PATTERN = /^Ambient\s+(?<concentration>[\d.]+)/i; // Ambient   2290 #/cc
    static MASK_READING_PATTERN = /^Mask\s+(?<concentration>[\d+.]+)/i; // Mask    5.62 #/cc
    static FIT_FACTOR_PATTERN = /^FF\s+(?<exerciseNumber>\d+)\s+(?<fitFactor>[\d.]+)\s+(?<result>.+)/; // FF  1    352 PASS
    static TEST_TERMINATED_PATTERN = /^Test\s+Terminated/i; // Test Terminated
    static OVERALL_FIT_FACTOR_PATTERN = /^Overall\s+FF\s+(?<fitFactor>[\d.]+)\s+(?<result>.+)/i; // Overall FF    89 FAIL
    static LOW_PARTICLE_COUNT_PATTERN = /^(?<concentration>\d+)\/cc\s+Low\s+Particle\s+Count/i; // 970/cc Low Particle Count

    // external control response patterns
    static EXTERNAL_CONTROL_PARTICLE_COUNT_PATTERN = /^\s*(?<concentration>\d+\.\d+)\s*/; // 006408.45
    static EXTERNAL_CONTROL_SAMPLING_FROM_MASK_PATTERN = /^VF$/;  // VF
    static EXTERNAL_CONTROL_SAMPLING_FROM_AMBIENT_PATTERN = /^VN$/;  // VN
    static EXTERNAL_CONTROL_DATA_TRANSMISSION_DISABLED_PATTERN = /^ZD$/; // ZD
    static EXTERNAL_CONTROL_DATA_TRANSMISSION_ENABLED_PATTERN = /^ZE$/; // ZE
    static EXTERNAL_CONTROL_EXTERNAL_CONTROL_PATTERN = /^(OK|EJ)$/; // OK.  EJ seems to be if it's already in external control mode
    static EXTERNAL_CONTROL_INTERNAL_CONTROL_PATTERN = /^G$/; // G

    static nextTabIndex = 100;
    resultsDatabase: SimpleResultsDB;
    settingsDatabase;
    logCallback;
    dataCallback;
    processedDataCallback;
    currentTestData: SimpleResultsDBRecord | null = null;
    lastExerciseNum: number = 0;
    sampleSource: string = "undefined";
    private control: ExternalControlStates;
    states: DataCollectorStates;
    private setResults: React.Dispatch<React.SetStateAction<SimpleResultsDBRecord[]>> | undefined;
    private concentrationHistory: number[] = [];
    private ambientConcentration:number = 0;

    constructor(states: DataCollectorStates,
                logCallback: (message: string) => void,
                dataCallback: (message: string) => void,
                processedDataCallback: (message: string) => void,
                externalControlStates: ExternalControlStates,
                resultsDatabase: SimpleResultsDB) {
        this.logCallback = logCallback;
        this.dataCallback = dataCallback;
        this.processedDataCallback = processedDataCallback;
        this.resultsDatabase = resultsDatabase;
        this.settingsDatabase = SETTINGS_DB;
        this.control = externalControlStates;
        this.states = states;
        console.log("DataCollector constructor called")
    }

    appendToLog(message: string) {
        this.logCallback(message);
    }

    appendToProcessedData(data: string) {
        this.processedDataCallback(data);
    }

    setInstructions(message: string) {
        if (this.states.setInstructions) {
            this.states.setInstructions(message)
        }
        speech.sayItLater(message); // make sure instructions are queued.
    }

    setInstructionsForExercise(exerciseNum: number) {
        // TODO: don't hardcode this
        const exerciseInstructionsLookup: { [index: number]: string } = {
            1: "Normal breathing. Breathe normally.",
            2: "Heavy breathing. Take deep breaths.",
            3: "Jaw movement. Read a passage, sing a song, talk, or pretend to do so.",
            4: "Head movement. Look up, down, left, and right. Repeat."
        }
        this.setInstructions(`Perform exercise ${exerciseNum}: ${exerciseInstructionsLookup[exerciseNum]}`);
    }

    processLine(line: string) {
        // appendOutput(`processLine: ${line} (length: ${line.length})\n`);
        if (line.length === 0) {
            this.appendToLog("processLine() ignoring empty line\n");
            return;
        }
        // this.appendToLog(`${line}\n`);
        let match;

        if (line.match(DataCollector.EXTERNAL_CONTROL_SAMPLING_FROM_MASK_PATTERN)) {
            this.appendToLog("sampling from MASK\n");
            this.sampleSource = "MASK"
            this.control.setValvePosition("Sampling from Mask")
            return;
        }
        if (line.match(DataCollector.EXTERNAL_CONTROL_SAMPLING_FROM_AMBIENT_PATTERN)) {
            this.appendToLog("sampling from AMBIENT\n");
            this.sampleSource = "AMBIENT"
            this.control.setValvePosition("Sampling from Ambient")
            return;
        }
        if (line.match(DataCollector.EXTERNAL_CONTROL_DATA_TRANSMISSION_DISABLED_PATTERN)) {
            this.control.setDataTransmissionMode("Paused")
            this.appendToLog("transmission disabled")
            return;
        }
        if (line.match(DataCollector.EXTERNAL_CONTROL_DATA_TRANSMISSION_ENABLED_PATTERN)) {
            this.control.setDataTransmissionMode("Transmitting")
            this.appendToLog("transmission enabled")
            return;
        }
        if (line.match(DataCollector.EXTERNAL_CONTROL_EXTERNAL_CONTROL_PATTERN)) {
            this.control.setControlMode("External Control")
            return;
        }
        if (line.match(DataCollector.EXTERNAL_CONTROL_INTERNAL_CONTROL_PATTERN)) {
            this.control.setControlMode("Internal Control")
            return;
        }

        match = line.match(DataCollector.NEW_TEST_PATTERN)
        if (match) {
            this.appendToProcessedData(`\nStarting a new test. ${new Date().toLocaleString()}\n`);
            this.setInstructionsForExercise(1);
            this.recordTestStart();
            return;
        }

        match = line.match(DataCollector.AMBIENT_READING_PATTERN);
        if (match) {
            const concentration = match.groups?.concentration;
            this.appendToProcessedData(`ambient concentration: ${concentration}\n`);
            // this.currentTestData.samples.push({ambient: concentration});
            return;
        }

        match = line.match(DataCollector.MASK_READING_PATTERN);
        if (match) {
            const concentration = match.groups?.concentration;
            this.appendToProcessedData(`mask concentration: ${concentration}\n`);
            this.setInstructions("Breathe normally");
            // this.currentTestData.samples.push({mask: concentration});
            return;
        }

        match = line.match(DataCollector.FIT_FACTOR_PATTERN);
        if (match) {
            const ff = Number(match.groups?.fitFactor);
            const exerciseNum = Number(match.groups?.exerciseNumber || -1);
            const result = match.groups?.result || "unknown";
            // this.appendToData(`Exercise ${exerciseNum}: Fit factor is ${ff}. Result: ${result}\n`)
            this.appendToProcessedData(`Exercise ${exerciseNum}: Fit factor is ${ff}. Result: ${result}\n`)
            this.setInstructionsForExercise(exerciseNum + 1);
            speech.sayItLater(`Score was ${ff}`)
            // this.beginExerciseTimoutId = this.scheduleBeginExercisePrompt(exerciseNum+1);
            // this.currentTestData.results.push({exercise_num: exerciseNum, fit_factor: ff, result: result});
            this.recordExerciseResult(exerciseNum, ff);
            return;
        }

        match = line.match(DataCollector.OVERALL_FIT_FACTOR_PATTERN);
        if (match) {
            const ff = Number(match.groups?.fitFactor);
            const result: string = match.groups?.result || "";
            this.appendToProcessedData(`\nTest complete. ${result} with FF of ${ff}\n`);
            this.setInstructions(`Test complete. Score: ${ff}`);
            // this.currentTestData.results.push({exercise_num: "overall", fit_factor: ff, result: result});
            this.appendToLog(JSON.stringify(this.currentTestData) + "\n");
            this.recordTestComplete(ff);
            return;
        }

        if (line.match(DataCollector.TEST_TERMINATED_PATTERN)) {
            this.appendToProcessedData(`\nTest aborted\n`);
            this.setInstructions("Breathe normally");
            this.recordTestAborted();
            return;
        }

        match = line.match(DataCollector.COUNT_READING_PATTERN) || line.match(DataCollector.EXTERNAL_CONTROL_PARTICLE_COUNT_PATTERN);
        if (match) {
            const concentration = Number(match.groups?.concentration);
            if (!speech.isSayingSomething()) {
                if (this.states.sayParticleCount) {
                    const intConcentration = Math.ceil(concentration);
                    const roundedConcentration = intConcentration < 20 ? (Math.ceil(concentration * 10) / 10).toFixed(1) : intConcentration;
                    const message = this.states.verboseSpeech ? `Particle count is ${roundedConcentration}` : roundedConcentration.toString();
                    speech.sayIt(message);

                }
            }
            if (line.match(DataCollector.EXTERNAL_CONTROL_PARTICLE_COUNT_PATTERN)) {
                this.appendToProcessedData(`${this.sampleSource}: ${concentration}\n`)
            }

            if(this.states.autoEstimateFitFactor) {
                this.processConcentration(concentration)
            }
        }
    }

    recordTestComplete(ff: number) {
        this.recordExerciseResult("Final", ff);
        this.currentTestData = null; // flag done
    }

    recordTestAborted() {
        if (!this.currentTestData) {
            console.log("no current row, ignoring");
            return;
        }
        this.currentTestData[`Ex ${this.lastExerciseNum + 1}`] = "aborted";
        this.setInstructions("Test cancelled.");
        this.updateCurrentRowInDatabase();
    }


    recordTestStart(timestamp = new Date().toLocaleString()) {
        if (!this.resultsDatabase) {
            console.log("database not ready");
            return;
        }

        this.lastExerciseNum = 0;
        this.resultsDatabase.createNewTest(timestamp).then((newTestData) => {
            this.currentTestData = newTestData;
            console.log(`new test added: ${JSON.stringify(this.currentTestData)}`)
            if (this.setResults) {
                // this triggers an update
                this.setResults((prev) => [...prev, newTestData]);
            } else {
                // shouldn't happen, but setResults callback starts off uninitialized
                console.log("have current test data, but setResults callback hasn't been initialized. this shouldn't happen?")
            }
        })
    }

    recordExerciseResult(exerciseNum: number | string, ff: number) {
        if (!this.currentTestData) {
            console.log("no current row! ignoring");
            return
        }
        if (typeof exerciseNum === "number") {
            this.currentTestData[`Ex ${exerciseNum}`] = `${Math.floor(ff)}`
            this.lastExerciseNum = exerciseNum;
        } else {
            this.currentTestData[`${exerciseNum}`] = `${Math.floor(ff)}`; // probably "Final"
        }

        if (this.setResults) {
            // update table data
            this.setResults((prev) => [...prev]) // force an update by changing the ref
        } else {
            // shouldn't happen, but setResults callback starts off uninitialized
            console.log("have current test data, but setResults callback hasn't been initialized. this shouldn't happen?")
        }
        this.updateCurrentRowInDatabase();
    }

    /**
     * This is typically called when the UI is updating the test record.
     * @param record
     */
    updateTest(record: SimpleResultsDBRecord) {
        if (record.ID) {
            if (record.ID === this.currentTestData?.ID) {
                /*
                The record being updated by the UI is currently being populated by the currently running test.
                Point this.currentTestData to the record the UI is updating, and make sure the test results are copied over.
                 */
                const oldCurrentTestData = this.currentTestData
                this.currentTestData = record;
                // just make sure all the number fields have values
                Object.entries(oldCurrentTestData).forEach(([key, value]) => {
                    if (typeof value === "number" && this.currentTestData) {
                        if (this.currentTestData[key] !== value) {
                            this.currentTestData[key] = value;
                            if (this.setResults) {
                                this.setResults((prev) => [...prev]) // force an update by changing the ref
                            }
                        }
                    }
                })
            }
            this.resultsDatabase.updateTest(record);
        } else {
            console.log(`updateTest() unexpected record with no ID: ${record}`)
        }
    }

    updateCurrentRowInDatabase() {
        if (!this.currentTestData) {
            // no current data row
            return;
        }
        this.resultsDatabase.updateTest(this.currentTestData);
    }


    /**
     * Assume mask and ambient concentration values will be at least 1 order of magnitude apart (ie. ambient will be at least 10x mask).
     * Assume ambient will be more stable than mask when well above zero.
     * Assume purge times 4-5 seconds. During this time concentration will sharply rise or fall.
     * Given this new concentration number, maybe update the auto-detected ambient value.
     * Ambient values are assumed to be higher than mask values. We'll assume that ambient numbers are also reasonably
     * stable.  So after 4 seconds or so of stable high values, we'll update the auto-detected ambient value.
     *
     * Margin of error at 95% confidence level is approximately 1/sqrt(sample_size).
     * Sample size here is particle count.
     * Need to understand this calculation more: https://www.qualtrics.com/experience-management/research/margin-of-error/
     *
     * For now, assume ambient concentrations don't vary by more than 15% over 4 seconds, and are over 100 particles.
     * Any time we see an increase of more than 15%, assume we previously incorrectly recorded a mask reading as an ambient reading.
     * In this case, try to get a few more ambient samples and update if the new values are stable.
     * It's possible that ambient numbers are/were temporarily high, so if we find a new stable ambient level, we should update it,
     * even if it's downward and appears to be a mask value.  Maybe require a longer stable time for this case.
     * @param concentration
     */

    processConcentration(concentration: number) {
        this.concentrationHistory.push(concentration);

        // find a plateau to use as ambient level

        // naively find the plateau.
        // look for consecutive data points that are within 15% of each other.
        // if these are within 15% of the previous ambient, assume it's the new ambient.
        // if these are much higher than the previous ambient, assume it's the new ambient.
        let startIndex: number = 0;
        let endIndex: number = 0;
        let average: number = 0;
        let ambientCandidate: number = this.ambientConcentration;
        let unusedConcentration = false

        this.concentrationHistory.forEach((conc, index) => {
            if( average === 0) {
                // just starting out
                average = conc;
                startIndex = index;
                endIndex = index;
                return;
            }

            const plateauWidth = endIndex-startIndex;
            if (Math.abs(conc - average) / average < 0.15) {
                // within 15%, could be within the same plateau
                endIndex = index;
                average = avg(this.concentrationHistory, startIndex, endIndex+1);
                if(plateauWidth >= 4) {
                    // we have more than 4 consecutive samples, probably found a plateau
                    ambientCandidate = average;
                }

                console.log(`conc is ${conc}, average is ${average}, ambientCandidate is ${ambientCandidate}, startIndex: ${startIndex}, endIndex: ${endIndex}`);
            } else {
                // outside 15%. might have a plateau in the previous run.
                if(plateauWidth > 4) {
                    // Assuming samples are 1 second part, we've got 4 seconds of level samples. Let's call it a plateau
                    if( average > ambientCandidate) {
                        // plateau is higher than previous ambient, update it and reset
                        ambientCandidate = average
                        startIndex = index;
                        endIndex = index;
                        average = conc;
                    } else {
                        // new plateau is lower than previous ambient, but we don't know if it's a new ambient or if it's in the mask.
                        unusedConcentration = true;
                    }
                } else {
                    // not enough samples, skip the data points
                    startIndex = index;
                    endIndex = index
                    average = conc;
                }
            }
        })

        console.log(`concentration is ${concentration}, ambientCandidate is ${ambientCandidate}`);
        if(ambientCandidate > 0) {
            this.ambientConcentration = ambientCandidate
            this.states.setAmbientConcentration(ambientCandidate);

            if(unusedConcentration) {
                // the latest concentration number was not used to calculate the ambient candidate
                // the latest concentration is below ambient candidate.
                // If it's above ambient candidate, it means we likely found a new ambient and we're not in the mask,
                // in which case, don't calculate estimated FF since that won't make sense
                this.states.setMaskConcentration(concentration);
                const estimatedFF = ambientCandidate / concentration;
                this.states.setEstimatedFitFactor(estimatedFF)
                if(this.states.sayEstimatedFitFactor) {
                    speech.sayItPolitely(`Estimated Fit Factor is ${Number(estimatedFF).toFixed(0)}`)
                }

            } else {
                // todo, reset mask and estimated ff? since we're in a transition period
                this.states.setMaskConcentration(-1)
                this.states.setEstimatedFitFactor(1)
            }
        } else if(this.ambientConcentration === 0) {
            // we don't have an initial concentration yet, update it with what we have
            this.states.setAmbientConcentration(average);
        }

        // trim old values we no longer need
        this.concentrationHistory.splice(0, startIndex);
        endIndex+= startIndex; // adjust end index

        // if history is too long, trim it
        if(this.concentrationHistory.length > 30) {
            this.concentrationHistory.splice(this.concentrationHistory.length-30);
            endIndex -= Math.max(0, this.concentrationHistory.length-30);
        }
    }

    // todo: use DataCollectorStates instead
    setResultsCallback(callback: React.Dispatch<React.SetStateAction<SimpleResultsDBRecord[]>>) {
        this.setResults = callback
    }
}


export interface DataCollectorStates {
    setInstructions: React.Dispatch<React.SetStateAction<string>> | null,
    logData: string,
    setLogData: React.Dispatch<React.SetStateAction<string>>,
    rawConsoleData: string,
    setRawConsoleData: React.Dispatch<React.SetStateAction<string>>,
    processedData: string,
    setProcessedData: React.Dispatch<React.SetStateAction<string>>,
    fitTestDataTableRef: RefObject<HTMLTableElement>,
    sayParticleCount: boolean,
    sayEstimatedFitFactor: boolean;
    verboseSpeech: boolean,
    setEstimatedFitFactor: React.Dispatch<React.SetStateAction<number>>,
    setAmbientConcentration: React.Dispatch<React.SetStateAction<number>>,
    setMaskConcentration: React.Dispatch<React.SetStateAction<number>>,
    autoEstimateFitFactor: boolean
}

export function DataCollectorPanel({dataCollector}: { dataCollector: DataCollector }) {
    const [rawConsoleData, setRawConsoleData] = useState<string>("")
    const rawConsoleDataTextAreaRef = React.useRef<HTMLTextAreaElement>(null)
    const [logData, setLogData] = useState<string>("")
    const logDataTextAreaRef = React.useRef<HTMLTextAreaElement>(null)
    const [processedData, setProcessedData] = useState<string>("")
    const processedDataTextAreaRef = React.useRef<HTMLTextAreaElement>(null)

    useEffect(() => {
        setRawConsoleData(dataCollector.states.rawConsoleData);
    }, [dataCollector.states.rawConsoleData]);
    useEffect(() => {
        setLogData(dataCollector.states.logData);
    }, [dataCollector.states.logData]);
    useEffect(() => {
        setProcessedData(dataCollector.states.processedData);
    }, [dataCollector.states.processedData]);

    return (
        <>
            <section id="collected-data" style={{display: "inline-block", width: "100%"}}>
                <fieldset>
                    <legend>Fit Test Info</legend>
                    <ResultsTable dataCollector={dataCollector}/>
                </fieldset>
            </section>
            <section style={{width: "100%", display: "flex"}}>
                <fieldset style={{flexGrow: 1}}>
                    <legend>Raw Data</legend>
                    <textarea id="raw-data" ref={rawConsoleDataTextAreaRef} readOnly
                              style={{width: "100%", height: "200px", border: "none", resize: "vertical"}}
                              tabIndex={1000}
                              value={rawConsoleData}/>
                </fieldset>
                <fieldset style={{flexGrow: 1}}>
                    <legend>Processed Data</legend>
                    <textarea id="interpreted-data" ref={processedDataTextAreaRef} readOnly
                              style={{width: "100%", height: "200px", border: "none", resize: "vertical"}}
                              tabIndex={1001}
                              value={processedData}/>
                </fieldset>
            </section>
            <section style={{width: "100%"}}>
                <fieldset>
                    <legend>Log</legend>
                    <textarea id="log-text-area" ref={logDataTextAreaRef} readOnly
                              style={{width: "100%", height: "200px", border: "none", resize: "vertical"}}
                              tabIndex={1002}
                              value={logData}
                    />
                </fieldset>
            </section>
        </>
    )
}
