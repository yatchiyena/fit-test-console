import {getLines} from "./datasource-helper.ts";
import {SampleSource} from "./fit-test-protocol.ts";
import {ReadableStreamDefaultReader} from "node:stream/web";


class Patterns {
    static PORTACOUNT_VERSION = /^PORTACOUNT\s+PLUS\S+PROM\S+(?<version>.+)/i; // PORTACOUNT PLUS PROM V1.7
    static COPYRIGHT = /^COPYRIGHT.+/i; // COPYRIGHT(c)1992 TSI INC
    static LICENSE = /^ALL\s+RIGHTS\s+RESERVED/i; // ALL RIGHTS RESERVED
    static SERIAL_NUMBER = /^Serial\s+Number\s+(?<serialNumber>\d+)/i; // Serial Number 17754
    static PASS_LEVEL = /^FF\s+pass\s+level\s+(?<passLevel>\d+)/i; // FF pass level = 100
    static NUM_EXERCISES = /^No\.\s+of\s+exers\s*=\s*(?<numExercises>\d+)/i; // No. of exers  = 4
    static AMBIENT_PURGE = /^Ambt\s+purge\s*=\s*(?<ambientPurgeTime>\d+)/i; // Ambt purge   = 4 sec.
    static AMBIENT_SAMPLE = /^Ambt\s+sample\s*=\s*(?<ambientSampleTime>\d+)/i; // Ambt sample  = 5 sec.
    static MASK_PURGE = /^Mask\s+purge\s*=\s*(?<maskPurgeTime>\d+)/i; // Mask purge  = 11 sec.
    static MASK_SAMPLE = /^Mask\s+sample\s+(?<exerciseNumber>\d+)\s*=\s*(?<maskSampleTime>\d+)/i; // Mask sample 1 = 40 sec.
    static DIP_SWITCH = /^DIP\s+switch\s+=\s+(?<dipSwitchBits>\d+)/i; // DIP switch  = 10111111
    static COUNT_READING = /^(?<timestamp>\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d.\d{3}Z)?\s*Conc\.\s+(?<concentration>[\d.]+)/i; // Conc.      0.00 #/cc
    static NEW_TEST = /^NEW\s+TEST\s+PASS\s*=\s*(?<passLevel>\d+)/i; // NEW TEST PASS =  100
    static AMBIENT_READING = /^Ambient\s+(?<concentration>[\d.]+)/i; // Ambient   2290 #/cc
    static MASK_READING = /^Mask\s+(?<concentration>[\d+.]+)/i; // Mask    5.62 #/cc
    static FIT_FACTOR = /^FF\s+(?<exerciseNumber>\d+)\s+(?<fitFactor>[\d.]+)\s+(?<result>.+)/; // FF  1    352 PASS
    static TEST_TERMINATED = /^Test\s+Terminated/i; // Test Terminated
    static OVERALL_FIT_FACTOR = /^Overall\s+FF\s+(?<fitFactor>[\d.]+)\s+(?<result>.+)/i; // Overall FF    89 FAIL
    static LOW_PARTICLE_COUNT = /^(?<concentration>\d+)\/cc\s+Low\s+Particle\s+Count/i; // 970/cc Low Particle Count
}

class ExternalControlPatterns {
    // external control response patterns
    // 2024-10-24T17:38:02.876Z 005138.88
    static PARTICLE_COUNT = /^(?<timestamp>\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d.\d{3}Z)?\s*(?<concentration>\d+\.\d+)\s*/; // 006408.45
    static SAMPLING_FROM_MASK = /^VF$/;  // VF
    static SAMPLING_FROM_AMBIENT = /^VN$/;  // VN
    static DATA_TRANSMISSION_DISABLED = /^ZD$/; // ZD
    static DATA_TRANSMISSION_ENABLED = /^ZE$/; // ZE
    static EXTERNAL_CONTROL = /^(OK|EJ)$/; // OK.  EJ seems to be if it's already in external control mode
    static INTERNAL_CONTROL = /^G$/; // G
}

class PortaCountEvent {
    protected type: string
    protected timestamp: number
    constructor(type: string) {
        this.type = type;
        this.timestamp = Date.now()
    }
    getTimestamp(): number {
        return this.timestamp;
    }
    asOf(timestamp: number) {
        this.timestamp = timestamp
        return this;
    }
}
class LineReceivedEvent extends PortaCountEvent {
    readonly line: string
    constructor(line: string) {
        super('LineReceivedEvent');
        this.line = line;
    }
}
class SampleSourceChangedEvent extends PortaCountEvent {
    readonly sampleSource: SampleSource;
    constructor(sampleSource: SampleSource) {
        super('SampleSourceChangedEvent');
        this.sampleSource = sampleSource
    }
}
class DataTransmissionStateChangedEvent extends PortaCountEvent {
    readonly dataTransmissionState: DataTransmissionState;
    constructor(state: DataTransmissionState) {
        super('DataTransmissionStateChangedEvent');
        this.dataTransmissionState = state;
    }
}
class ControlSourceChangedEvent extends PortaCountEvent {
    readonly source: ControlSource;
    constructor(source: ControlSource) {
        super('ControlSourceChangedEvent');
        this.source = source;
    }
}

class TestStartedEvent extends PortaCountEvent {
    constructor() {
        super('TestStartedEvent');
    }
}
export class ParticleConcentrationEvent extends PortaCountEvent {
    readonly source: SampleSource
    readonly concentration: number
    constructor(concentration: number, source: SampleSource) {
        super('ParticleConcentrationReceivedEvent');
        this.concentration = concentration;
        this.source = source
    }

}
export class FitFactorResultsEvent extends PortaCountEvent {
    public readonly ff: number;
    public readonly exerciseNum: number|"Final";
    public readonly result: string;
    constructor(ff: number, exerciseNum: number|"Final", result: string) {
        super('FitFactorResultsEvent');
        this.ff = ff;
        this.exerciseNum = exerciseNum;
        this.result = result;
    }
}
class TestTerminatedEvent extends PortaCountEvent {
    constructor() {
        super('TestTerminatedEvent');
    }
}

export enum DataTransmissionState {
    Paused = "Paused",
    Transmitting = "Transmitting",
}

export enum ControlSource {
    External = "External",
    Internal = "Internal"
}
export enum Activity {
    Idle = "Idle",
    Testing = "Testing",
    Counting = "Counting",
    Disconnected = "Disconnected",
}

export interface PortaCountListener {
    lineReceived?(line: string): void;
    sampleSourceChanged?(source: SampleSource): void;
    dataTransmissionStateChanged?(dataTransmissionState: DataTransmissionState): void;
    controlSourceChanged?(source: ControlSource): void;
    testStarted?(timestamp: number): void;
    fitFactorResultsReceived?(results: FitFactorResultsEvent): void;
    testTerminated?(): void;
    particleConcentrationReceived?(concentrationEvent: ParticleConcentrationEvent): void;
}

export class PortaCountClient8020 {
    private readonly listeners: PortaCountListener[] = [];
    private _sampleSource: SampleSource = SampleSource.Mask;
    private _controlSource: ControlSource = ControlSource.Internal;
    private _activity: Activity = Activity.Idle;
    private _dataTransmissionState: DataTransmissionState = DataTransmissionState.Transmitting;

    get controlSource(): ControlSource {
        return this._controlSource;
    }

    get sampleSource(): SampleSource {
        return this._sampleSource;
    }

    get dataTransmissionState(): DataTransmissionState {
        return this._dataTransmissionState;
    }

    get activity(): Activity {
        return this._activity;
    }

    public async monitor(reader: ReadableStreamDefaultReader<Uint8Array>) {
        for await (const line of getLines(reader)) {
            if (line.trim().length > 0) {
                // we only care about non-empty lines
                this.dispatch(new LineReceivedEvent(line));
                this.processLine(line);
            }
        }
        console.log("monitor reached end of reader");
    }

    public addListener(listener: PortaCountListener): void {
        this.listeners.push(listener);
    }

    public removeListener(listener: PortaCountListener): void {
        this.listeners.filter((value, index, array) => {
            if (value === listener) {
                array.splice(index, 1);
                return true
            }
            return false;
        })
    }

    private dispatch(event: PortaCountEvent) {
        this.listeners.forEach((listener) => {
            // console.log(`dispatch event ${event.constructor.name}`)
            switch (event.constructor.name) {
                case ParticleConcentrationEvent.name: {
                    if(listener.particleConcentrationReceived) {
                        listener.particleConcentrationReceived((event as ParticleConcentrationEvent))
                    }
                    break;
                }
                case TestTerminatedEvent.name: {
                    if(listener.testTerminated) {
                        this._activity = Activity.Idle
                        listener.testTerminated();
                    }
                    break;
                }
                case FitFactorResultsEvent.name: {
                    if(listener.fitFactorResultsReceived) {
                        listener.fitFactorResultsReceived(event as FitFactorResultsEvent);
                    }
                    break;
                }
                case TestStartedEvent.name: {
                    if(listener.testStarted) {
                        this._activity = Activity.Testing;
                        listener.testStarted(event.getTimestamp())
                    }
                    break;
                }
                case ControlSourceChangedEvent.name: {
                    if(listener.controlSourceChanged) {
                        const csce = event as ControlSourceChangedEvent
                        this._controlSource = csce.source
                        listener.controlSourceChanged(this._controlSource);
                    }
                    break;
                }
                case DataTransmissionStateChangedEvent.name: {
                    if(listener.dataTransmissionStateChanged) {
                        const dtsce = event as DataTransmissionStateChangedEvent;
                        this._dataTransmissionState = dtsce.dataTransmissionState;
                        listener.dataTransmissionStateChanged(this._dataTransmissionState);
                    }
                    break;
                }
                case LineReceivedEvent.name: {
                    if(listener.lineReceived) {
                        listener.lineReceived((event as LineReceivedEvent).line);
                    }
                    break;
                }
                case SampleSourceChangedEvent.name: {
                    if(listener.sampleSourceChanged) {
                        const sse = event as SampleSourceChangedEvent;
                        this._sampleSource = sse.sampleSource
                        listener.sampleSourceChanged(this._sampleSource);
                    }
                    break;
                }
                default: {
                    console.log(`unsupported event: ${JSON.stringify(event)}`)
                }
            }
        })
    }
    // visible-for-testing
    public processLine(line: string) {
        if (line.length === 0) {
            return;
        }

        let match;
        if (line.match(ExternalControlPatterns.SAMPLING_FROM_MASK)) {
            this.dispatch(new SampleSourceChangedEvent(SampleSource.Mask));
        } else if (line.match(ExternalControlPatterns.SAMPLING_FROM_AMBIENT)) {
            this.dispatch(new SampleSourceChangedEvent(SampleSource.Ambient));
        } else if (line.match(ExternalControlPatterns.DATA_TRANSMISSION_DISABLED)) {
            this.dispatch(new DataTransmissionStateChangedEvent(DataTransmissionState.Paused))
        } else if (line.match(ExternalControlPatterns.DATA_TRANSMISSION_ENABLED)) {
            this.dispatch(new DataTransmissionStateChangedEvent(DataTransmissionState.Transmitting));
        } else if (line.match(ExternalControlPatterns.EXTERNAL_CONTROL)) {
            this.dispatch(new ControlSourceChangedEvent(ControlSource.External))
        } else if (line.match(ExternalControlPatterns.INTERNAL_CONTROL)) {
            this.dispatch(new ControlSourceChangedEvent(ControlSource.Internal))
        } else if ((match = line.match(Patterns.NEW_TEST))) {
            this.dispatch(new TestStartedEvent());
        } else if ((match = line.match(Patterns.AMBIENT_READING))) {
            const concentration = match.groups?.concentration;
            if(concentration) {
                this.dispatch(new ParticleConcentrationEvent(Number(concentration), SampleSource.Ambient));
            }
        } else if ((match = line.match(Patterns.MASK_READING))) {
            const concentration = match.groups?.concentration;
            if(concentration) {
                this.dispatch(new ParticleConcentrationEvent(Number(concentration), SampleSource.Mask));
            }
        } else if ((match = line.match(Patterns.FIT_FACTOR))) {
            const ff = Number(match.groups?.fitFactor);
            const exerciseNum = Number(match.groups?.exerciseNumber || -1);
            const result = match.groups?.result || "unknown";
            this.dispatch(new FitFactorResultsEvent(ff, exerciseNum, result));
        } else if ((match = line.match(Patterns.OVERALL_FIT_FACTOR))) {
            const ff = Number(match.groups?.fitFactor);
            const result: string = match.groups?.result || "";
            this.dispatch(new FitFactorResultsEvent(ff, "Final", result))
        } else if ((match = line.match(Patterns.TEST_TERMINATED))) {
            this.dispatch(new TestTerminatedEvent());
        } else if ((match = line.match(Patterns.COUNT_READING) || line.match(ExternalControlPatterns.PARTICLE_COUNT))) {
            const concentration = Number(match.groups?.concentration);
            const source = this._sampleSource
            const event = new ParticleConcentrationEvent(concentration, source);
            const timestamp = match.groups?.timestamp;
            if(timestamp) {
                event.asOf(Date.parse(timestamp))
            }
            this.dispatch(event);
        }
    }
}
