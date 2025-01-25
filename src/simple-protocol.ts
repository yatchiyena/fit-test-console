
export type ExerciseInstructions = string
export type StageDefinition = {
    instructions: ExerciseInstructions,
    purge_duration?: number,
    sample_duration?: number,
}
export type ShortStageDefinition = {
    i: ExerciseInstructions,
    p?: number,
    s?: number,
}
export type ProtocolDefinition = {
    [protocol_name: string]: [
            ExerciseInstructions | StageDefinition | ShortStageDefinition
    ]
}

export enum SegmentState {
    SAMPLE = "sample",
    PURGE = "purge",
    IDLE = "idle", // basically means we're not executing a protocol at the moment
}

export enum SegmentSource {
    MASK = "mask",
    AMBIENT = "ambient"
}

export type Segment = {
    state: SegmentState,
    source: SegmentSource,
    duration: number,
}

