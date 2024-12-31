/*
Collect data from PortaCount 8020a
 */

// data output patterns
import {speech} from "./speech.ts";
import {ExternalControlStates} from "./external-control.tsx";
import {SETTINGS_DB, SimpleResultsDB, SimpleResultsDBRecord} from "./database.ts";
import React, {RefObject, useEffect, useState} from "react";
import {ResultsTable} from "./ResultsTable.tsx";
import {EChartsOption} from "echarts-for-react/src/types.ts";
import {deepCopy} from "json-2-csv/lib/utils";
import MovingAverage from "moving-average"

const FIVE_SECONDS_IN_MS: number = 5 * 1000;
const TWENTY_SECONDS_IN_MS: number = 20 * 1000;

enum SampleZone {
    MASK = "mask",
    AMBIENT = "ambient",
    UNKNOWN = "unknown",
}

/**
 * timestamp, concentration, estimated fit factor, guessed ambient level, EMA concentration, stddev
 */
type TimeseriesEntry = {
    // only timestamp and concentration are measured. everything else is derived from these.
    timestamp: Date, // timestamp from the clock
    concentration: number, // the particle count concentration reading from the device
    emaConcentration: number | undefined, // exponential moving average of the concentration
    emaConcentrationStdDev: number | undefined, // std dev
    guestimatedAmbient: number | undefined, // based on ema concentration and stddev, try to guess the ambient level
    sampleZone: SampleZone, // based on guestimatedAmbient, etc, classify which zone we're in (ambient, mask, unknown)
    emaConcentrationInZone: number | undefined, // based on guestimatedAmbient, only using data points in current zone
    estimatedFitFactor: number | undefined, // based on emaConcentrationInZone and guestimatedAmbient
    estimatedFitFactorBand: number | undefined, // +/- band calculated from applying stddev to emaConcentrationInZone
    estimatedFitFactorBandLower: number | undefined,
    zoneFF: number | undefined,
};

const timeSeriesEntryDerivedFields = {
    emaConcentration: undefined,
    emaConcentrationStdDev: undefined,
    guestimatedAmbient: undefined,
    sampleZone: SampleZone.UNKNOWN,
    emaConcentrationInZone: undefined,
    estimatedFitFactor: undefined,
    estimatedFitFactorBand: undefined,
    estimatedFitFactorBandLower: undefined,
    zoneFF: undefined,
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
    static COUNT_READING_PATTERN = /^(?<timestamp>\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d.\d{3}Z)?\s*Conc\.\s+(?<concentration>[\d.]+)/i; // Conc.      0.00 #/cc
    static NEW_TEST_PATTERN = /^NEW\s+TEST\s+PASS\s*=\s*(?<passLevel>\d+)/i; // NEW TEST PASS =  100
    static AMBIENT_READING_PATTERN = /^Ambient\s+(?<concentration>[\d.]+)/i; // Ambient   2290 #/cc
    static MASK_READING_PATTERN = /^Mask\s+(?<concentration>[\d+.]+)/i; // Mask    5.62 #/cc
    static FIT_FACTOR_PATTERN = /^FF\s+(?<exerciseNumber>\d+)\s+(?<fitFactor>[\d.]+)\s+(?<result>.+)/; // FF  1    352 PASS
    static TEST_TERMINATED_PATTERN = /^Test\s+Terminated/i; // Test Terminated
    static OVERALL_FIT_FACTOR_PATTERN = /^Overall\s+FF\s+(?<fitFactor>[\d.]+)\s+(?<result>.+)/i; // Overall FF    89 FAIL
    static LOW_PARTICLE_COUNT_PATTERN = /^(?<concentration>\d+)\/cc\s+Low\s+Particle\s+Count/i; // 970/cc Low Particle Count

    // external control response patterns
    // 2024-10-24T17:38:02.876Z 005138.88
    static EXTERNAL_CONTROL_PARTICLE_COUNT_PATTERN = /^(?<timestamp>\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d.\d{3}Z)?\s*(?<concentration>\d+\.\d+)\s*/; // 006408.45
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
    previousTestData: SimpleResultsDBRecord | null = null;
    currentTestData: SimpleResultsDBRecord | null = null;
    lastExerciseNum: number = 0;
    sampleSource: string = "undefined";
    private control: ExternalControlStates;
    states: DataCollectorStates;
    private setResults: React.Dispatch<React.SetStateAction<SimpleResultsDBRecord[]>> | undefined;

    private fullConcentrationHistory: TimeseriesEntry[] = []; // this is used far graphing
    private guestimatedAmbientConcentration: number = 0;
    // exponential moving average of the concentration
    private maCount5s: MovingAverage = MovingAverage(FIVE_SECONDS_IN_MS);
    private maZoneConcentration20s: MovingAverage = MovingAverage(TWENTY_SECONDS_IN_MS); // TODO: use arithmetic average within the zone so all particles count the same?
    private nextChartUpdateTime: number = 0; // next time (epoch time) that we should update the chart

    constructor(states: DataCollectorStates,
                logCallback: (message: string) => void,
                dataCallback: (message: string) => void,
                processedDataCallback: (message: string) => void,
                externalControlStates: ExternalControlStates,
                resultsDatabase: SimpleResultsDB,
    ) {
        this.logCallback = logCallback;
        this.dataCallback = dataCallback;
        this.processedDataCallback = processedDataCallback;
        this.resultsDatabase = resultsDatabase;
        this.settingsDatabase = SETTINGS_DB;
        this.control = externalControlStates;
        this.states = states;
        console.log("DataCollector constructor called")
        this.resetChart();
    }

    resetChart() {
        this.fullConcentrationHistory = [];
        this.guestimatedAmbientConcentration = 0;
        this.maCount5s = MovingAverage(FIVE_SECONDS_IN_MS);
        this.maZoneConcentration20s = MovingAverage(TWENTY_SECONDS_IN_MS);
        this.nextChartUpdateTime = 0;
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
            return;
        }

        match = line.match(DataCollector.MASK_READING_PATTERN);
        if (match) {
            const concentration = match.groups?.concentration;
            this.appendToProcessedData(`mask concentration: ${concentration}\n`);
            this.setInstructions("Breathe normally");
            return;
        }

        match = line.match(DataCollector.FIT_FACTOR_PATTERN);
        if (match) {
            const ff = Number(match.groups?.fitFactor);
            const exerciseNum = Number(match.groups?.exerciseNumber || -1);
            const result = match.groups?.result || "unknown";
            this.appendToProcessedData(`Exercise ${exerciseNum}: Fit factor is ${ff}. Result: ${result}\n`)
            this.setInstructionsForExercise(exerciseNum + 1);
            speech.sayItLater(`Score was ${ff}`)
            this.recordExerciseResult(exerciseNum, ff);
            return;
        }

        match = line.match(DataCollector.OVERALL_FIT_FACTOR_PATTERN);
        if (match) {
            const ff = Number(match.groups?.fitFactor);
            const result: string = match.groups?.result || "";
            this.appendToProcessedData(`\nTest complete. ${result} with FF of ${ff}\n`);
            this.setInstructions(`Test complete. Score: ${ff}`);
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
            const timestamp = match.groups?.timestamp;
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

            if (this.states.autoEstimateFitFactor) {
                this.processConcentration(concentration, timestamp ? new Date(timestamp) : new Date())
            }
        }
    }

    recordTestComplete(ff: number) {
        this.recordExerciseResult("Final", ff);
        this.previousTestData = this.currentTestData
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

            if (this.states.defaultToPreviousParticipant) {
                // copy the string fields over from prev test data if present
                if (this.previousTestData) {
                    for (const key in this.previousTestData) {
                        if (key in newTestData) {
                            // don't copy fields that were assigned
                            continue;
                        }
                        if (typeof this.previousTestData[key] === "string") {
                            this.currentTestData[key] = this.previousTestData[key];
                        }
                    }
                }
            }

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
            } else if (record.ID === this.previousTestData?.ID) {
                /*
                We're updating the previous record. If we don't have a current record, we must be updating the latest
                record. In this case, we should update the local copy of the previous record so if we're propagating
                the text fields over, we pick up these changes.
                 */
                this.previousTestData = record;
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
     * @param concentration
     */
    processConcentration(concentration: number, timestamp: Date = new Date()) {
        if (isNaN(concentration)) {
            // try to avoid problems
            return;
        }
        // todo: consider moving median, see https://en.wikipedia.org/wiki/Moving_average#Moving_median
        const msSinceEpoch = timestamp.getTime();
        const prevRecord = this.fullConcentrationHistory.length > 0 ? this.fullConcentrationHistory[this.fullConcentrationHistory.length - 1] : undefined;
        let sampleZone: SampleZone;

        /**
         * todo: revisit this
         * Assumptions:
         * - Ambient levels are relatively stable. Assume stddev is within 10% of moving average
         * - Mask levels are at most half of ambient. ie. FF of at least 2.
         * - Whenever stddev is within 10% of moving average, and we're above 50% of previous ambient guess, update the ambient guess.
         * - Assume we're fully in the mask when concentration is within 50% of moving average concentration AND we're below 50% of ambient.
         * - Assume we're in the mask when stddev is > 10% of moving average concentration?
         */
        if (!this.guestimatedAmbientConcentration) {
            // we don't have an estimate yet.
            sampleZone = SampleZone.AMBIENT
        } else if (concentration > this.guestimatedAmbientConcentration) {
            // found a higher moving average, must be a new ambient
            sampleZone = SampleZone.AMBIENT
        } else if (this.maCount5s.movingAverage() < 0.5 * this.guestimatedAmbientConcentration) {
            // average count is less than half of ambient guess. probably mask
            sampleZone = SampleZone.MASK;

        } else if (this.maCount5s.deviation() < 0.3 * this.guestimatedAmbientConcentration) {
            // stddev is "near" guestimate, assume we're still in ambient
            sampleZone = SampleZone.AMBIENT
        } else {
            sampleZone = SampleZone.UNKNOWN;
        }

        if (sampleZone === SampleZone.AMBIENT) {
            // if we're in the ambient zone, update the ambient guess
            this.guestimatedAmbientConcentration = this.maCount5s.movingAverage();
        }


        let zoneFF: number = NaN;
        // backfill to the beginning of the zone if we're in the mask zone
        if (prevRecord && prevRecord.sampleZone === SampleZone.MASK) {
            // todo: figure out how to determine purge zones. maybe look for first and last data points within stddev of the data in the zone?
            // or first leftmost/rightmost datapoint outside of stddev moving from midpoint? must be within 10% of the end?

            // if the previous zone was a mask zone, go back and fill in the FF data based on the full zone
            let concentrationSum = 0;
            // TODO: calculate purge segments. remove some leading and trailing data points within the zone
            let ii = this.fullConcentrationHistory.length - 1;
            let numRecords = 0;
            for (; ii >= 0 && this.fullConcentrationHistory[ii].sampleZone === SampleZone.MASK; ii--) {
                if (this.fullConcentrationHistory.length - ii > 5) {
                    // skip the last 5 data points (seconds)
                    concentrationSum += this.fullConcentrationHistory[ii].concentration;
                    numRecords++;
                }
            }
            // trim 5 data points from the front
            // for(let kk = 0; kk < 5; kk++ ) {
            //     concentrationSum -= this.fullConcentrationHistory[ii].concentration;
            //     ii++;
            // }
            if (concentrationSum) {
                zoneFF = numRecords * this.guestimatedAmbientConcentration / concentrationSum;
                // for( ; ii < this.fullConcentrationHistory.length; ii++) {
                //     this.fullConcentrationHistory[ii].zoneFF = zoneFF;
                // }
                if (prevRecord) {
                    prevRecord.zoneFF = zoneFF;
                    if (this.states.sayEstimatedFitFactor) {
                        speech.sayItPolitely(`Estimated Fit Factor is ${Number(zoneFF).toFixed(0)}`)
                    }
                }
            }
        }

        // update values
        this.states.setAmbientConcentration(this.guestimatedAmbientConcentration);
        if (sampleZone === SampleZone.MASK) {
            this.states.setMaskConcentration(concentration);
            // we're not in the mask, so there's no data to record for the mask.
            // this.maEstimatedFF.push(msSinceEpoch, 1)
            this.states.setEstimatedFitFactor(zoneFF)
            const newGaugeOptions = deepCopy(this.states.gaugeOptions)
            newGaugeOptions.series[0].data[0].value = zoneFF
            this.states.setGaugeOptions(newGaugeOptions)

        } else {
            // we're not in the mask, so there's no data to record for the mask.
            this.states.setMaskConcentration(-1)
            this.states.setEstimatedFitFactor(NaN)
        }

        // update the chart
        const record: TimeseriesEntry = {
            ...timeSeriesEntryDerivedFields,
            timestamp: timestamp,
            concentration: concentration,
            guestimatedAmbient: this.guestimatedAmbientConcentration,
            emaConcentration: this.maCount5s.movingAverage(),
            emaConcentrationStdDev: this.maCount5s.deviation(),
            sampleZone: sampleZone,
            zoneFF: zoneFF,
        };


        if (sampleZone === SampleZone.MASK) {
            if (prevRecord && prevRecord.sampleZone === sampleZone) {
                // have previous records (and we're in the same zone type)
                record.emaConcentrationInZone = this.maZoneConcentration20s.movingAverage();
                // cap stddev at some value
                const emaZoneConcentrationStdDev = Math.min(0.3 * record.emaConcentrationInZone, this.maZoneConcentration20s.deviation());
                const guestimatedAmbient = record.guestimatedAmbient || 0;
                record.estimatedFitFactor = guestimatedAmbient / record.emaConcentrationInZone;
                record.estimatedFitFactorBand = (guestimatedAmbient / (record.emaConcentrationInZone - emaZoneConcentrationStdDev)) - (guestimatedAmbient / (record.emaConcentrationInZone + emaZoneConcentrationStdDev))
                record.estimatedFitFactorBandLower = guestimatedAmbient / (record.emaConcentrationInZone + emaZoneConcentrationStdDev);

            } else {
                // first record in the zone. no data is fine.
                this.maZoneConcentration20s = MovingAverage(TWENTY_SECONDS_IN_MS); // reset
            }
        }
        // append after we look backwards through history
        this.fullConcentrationHistory.push(record);

        // update moving averages after we've taken their snapshot
        this.maCount5s.push(msSinceEpoch, concentration);
        this.maZoneConcentration20s.push(msSinceEpoch, concentration);

        // TODO: try to merge in new data instead of rebuilding it every time data point? esp for simulator data
        const oldChartOptions: EChartsOption = this.states.chartOptions; //deepCopy(this.states.chartOptions)
        oldChartOptions.dataset = {
            dimensions: [
                'timestamp',
                'concentration',
                'guestimatedAmbient',
                'emaConcentration',
                'emaConcentrationStdDev',
                'sampleZone',
                'emaConcentrationInZone',
                'estimatedFitFactor',
                'estimatedFitFactorBand',
                'estimatedFitFactorBandLower',
                'zoneFF'
            ],

            source: this.fullConcentrationHistory
        }

        // need to manually calculate min and max for log scale when using line charts https://github.com/apache/echarts/issues/19818
        oldChartOptions.yAxis[0].type = 'log'
        oldChartOptions.yAxis[0].min = Math.min(...oldChartOptions.dataset.source.map((v: TimeseriesEntry) => v.concentration));
        oldChartOptions.yAxis[0].max = Math.max(...oldChartOptions.dataset.source.map((v: TimeseriesEntry) => v.concentration));

        oldChartOptions.yAxis[1].type = 'value'
        // oldChartOptions.yAxis[1].min = Math.min(...oldChartOptions.series[1].data.map(v => v[1]));
        // oldChartOptions.yAxis[1].max = Math.max(...oldChartOptions.series[1].data.map(v => v[1]));

        // update the zoom window
        oldChartOptions.dataZoom[0].endValue = record.timestamp
        oldChartOptions.dataZoom[0].startValue = record.timestamp.getTime() - 15 * 60 * 1000; // 15 minutes back


        if (this.guestimatedAmbientConcentration > 0) {
            // only map visually if we have an ambient candidate

            const concentrationVisualMapConfig = {
                type: "piecewise",
                show: false,
                seriesIndex: [0], // placeholder
                dimension: '', // placeholder
                pieces: [
                    {
                        // note: these ranges must be closed, eg. both upper and lower bounds must be specified
                        gte: 100,
                        lt: 100000,
                        color: 'green',
                    },
                    {
                        gte: 20,
                        lt: 100,
                        color: 'darkorange',
                    },
                    {
                        gte: 0,
                        lt: 20,
                        color: 'darkred',
                    },
                ],
                outOfRange: {
                    color: '#999'
                }
            };
            const estimatedFF = deepCopy(concentrationVisualMapConfig);
            estimatedFF.dimension = 'estimatedFitFactor';
            estimatedFF.seriesIndex = oldChartOptions.series.findIndex((series: {
                name: string
            }) => series.name === "estimated fit factor");
            const zoneFF = deepCopy(concentrationVisualMapConfig);
            zoneFF.dimension = 'zoneFF';
            zoneFF.seriesIndex = oldChartOptions.series.findIndex((series: {
                name: string
            }) => series.name === "Zone FF");

            oldChartOptions.visualMap = [
                estimatedFF,
                zoneFF,
            ]
        }

        this.updateMarkArea(oldChartOptions, record);

        // todo use a ref to get access to the underlying echart and call setOptions on it directly with only data
        if (Date.now() > this.nextChartUpdateTime) {
            // simple debounce
            this.nextChartUpdateTime = Date.now() + 1000; // 1 second later
            const newChartOptions = deepCopy(oldChartOptions); // make a new one so things that need to can see it's been updated
            this.states.setChartOptions(newChartOptions); // propagate this to the chart
            this.states.chartOptions = newChartOptions; // save state local to this class
        }

    }

    updateMarkArea(chartOptions: EChartsOption, datum: TimeseriesEntry) {
        const datumAreaName = datum.sampleZone
        const markAreaData = chartOptions.series[0].markArea.data
        const [start, end] = markAreaData.length > 0 ? markAreaData[markAreaData.length - 1] : [{}, {}]
        if (start.name === datumAreaName) {
            // still in the same block, extend it
            end.xAxis = datum.timestamp
        } else {
            // changed, or new. create new area
            const newArea = [
                {
                    xAxis: datum.timestamp,
                    name: datumAreaName,
                    itemStyle: {
                        color: (datum.sampleZone === SampleZone.MASK)
                            ? "wheat"
                            : (datum.sampleZone === SampleZone.AMBIENT)
                                ? "powderblue"
                                : "black",
                        opacity: 0.2,
                    }
                },
                {
                    xAxis: datum.timestamp
                },
            ];
            markAreaData.push(newArea)
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
    autoEstimateFitFactor: boolean,
    defaultToPreviousParticipant: boolean,
    chartOptions: EChartsOption,
    setChartOptions: React.Dispatch<React.SetStateAction<EChartsOption>>
    gaugeOptions: EChartsOption,
    setGaugeOptions: React.Dispatch<React.SetStateAction<EChartsOption>>
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
