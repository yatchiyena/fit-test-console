import {Segment, SegmentSource, SegmentState, StageDefinition} from "./simple-protocol.ts";

interface ProtocolListener {
    segmentChanged(segment:Segment):void;
    cancelled():void;
    completed():void;
    tick(timeLeft:number):void;
}

export class ProtocolExecutor {
    private abortController: AbortController | undefined;
    private timerId?: NodeJS.Timeout = undefined;
    private segments: Segment[] = [];
    private currentSegmentIndex: number | null = null;
    private currentSegmentEndTime: number = 0;
    private nextSegmentStartTime: number = 0;
    private nextSegmentIndex: number | null = 0;
    private readonly tickIntervalMs: number = 1000;
    private readonly listeners: ProtocolListener[] = []

    constructor() {
    }

    public addListener(listener: ProtocolListener): void {
        this.listeners.push(listener);
    }

    public removeListener(listener: ProtocolListener): void {
        this.listeners.filter((value, index, array) => {
            if(value === listener) {
                array.splice(index, 1);
                return true
            }
            return false;
        })
    }

    public setStages(stages: StageDefinition[]) {
        this.segments = this.convertStagesToSegments(stages);
    }

    public async executeProtocol() {
        if (this.timerId) {
            // in progress
            console.log("protocol execution in progress");
            return;
        }
        this.abortController = new AbortController();
        this.scheduleNextSegment(0);
        return this.tick(this.abortController.signal);
    }

    private convertStagesToSegments(stages: StageDefinition[]):Segment[] {
        const segments:Segment[] = []
        stages.forEach((stage) => {
            // todo: add ambient sampling
            // for now, stages only describe mask sampling stages. so insert ambient sampling stages before each of these mask stages

            // ambient segments
            segments.push({
                state: SegmentState.PURGE,
                source: SegmentSource.AMBIENT,
                duration: 4, // todo: read this from config
            });
            segments.push({
                state: SegmentState.SAMPLE,
                source: SegmentSource.AMBIENT,
                duration: 5,
            });

            // mask segments
            segments.push({
                state: SegmentState.PURGE,
                source: SegmentSource.MASK,
                duration: stage.purge_duration || 4
            });
            segments.push({
                state: SegmentState.SAMPLE,
                source: SegmentSource.MASK,
                duration: stage.sample_duration || 40 // todo: read this from config
            });
        });
        // console.log(`created segments: ${JSON.stringify(segments)}`);
        return segments;
    }

    public cancel() {
        this.abortController?.abort()
        this.timerId = undefined; // reset
        this.currentSegmentEndTime = 0
        this.currentSegmentIndex = null;
        this.scheduleNextSegment(0) // reset
        this.listeners.forEach((listener: ProtocolListener) => {listener.cancelled()})
    }

    private scheduleNextSegment(time:number) {
        // console.log("schedule next segment")
        if (this.currentSegmentIndex === null) {
            // first time scheduling
            this.nextSegmentStartTime = time
            this.nextSegmentIndex = 0
            return;
        }
        const nextSegmentIndex = this.currentSegmentIndex + 1;
        if (nextSegmentIndex < this.segments.length) {
            // there are more segments
            this.nextSegmentStartTime = time
            this.nextSegmentIndex = nextSegmentIndex;
        } else {
            // no more segments
            this.nextSegmentIndex = null;
        }
    }

    /**
     * Updates state.
     * @param abortSignal
     * @private
     */
    private async tick(abortSignal: AbortSignal) {
        if (abortSignal.aborted) {
            console.log("protocol aborted")
            return
        }
        const now = Date.now();
        if (now > this.currentSegmentEndTime) {
            // segment completed
            console.log(`segment ${this.currentSegmentIndex} completed`)
            if (this.nextSegmentIndex === null) {
                // no more segments. done.
                console.log("protocol completed")
                this.timerId = undefined // reset
                return;
            }

            // this is redundant. but we'll leave support here for starting a segment sometime after the previous segment ended
            if( now > this.nextSegmentStartTime) {
                // set up new current segment
                this.currentSegmentIndex = this.nextSegmentIndex;
                const currentSegment = this.segments[this.currentSegmentIndex];
                this.currentSegmentEndTime = now + currentSegment.duration * 1000; // convert to ms

                console.log(`protocol. segment index ${this.currentSegmentIndex},  ${this.currentSegmentEndTime - now} remain in stage ${currentSegment.source} ${currentSegment.state}`)

                this.scheduleNextSegment(this.currentSegmentEndTime);

                // execute
                // switch sampling source as needed
                this.updateSegment(currentSegment)
            }
        }

        this.listeners.forEach((listener: ProtocolListener) => {listener.tick(Math.ceil((this.currentSegmentEndTime - now)/1000))})
        // schedule next check
        this.timerId = setTimeout(() => this.tick(abortSignal), this.tickIntervalMs);
    }

    private updateSegment(segment: Segment) {
        this.listeners.forEach((listener) => {listener.segmentChanged(segment)})
    }
}
