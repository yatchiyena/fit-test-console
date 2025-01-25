import {
    Activity,
    ControlSource,
    DataTransmissionState,
    PortaCountClient8020,
    PortaCountListener
} from "./portacount-client-8020.ts";
import {useEffect, useState} from "react";
import {SampleSource} from "./fit-test-protocol.ts";

export function PortaCountState({client}: {client:PortaCountClient8020}) {
    const [controlSource, setControlSource] = useState<ControlSource>(client.controlSource)
    const [sampleSource, setSampleSource] = useState<SampleSource>(client.sampleSource)
    const [dataTransmissionState, setDataTransmissionState] = useState<DataTransmissionState>(client.dataTransmissionState)
    const [activity, setActivity] = useState<Activity>(client.activity)
    useEffect(() => {
        const listener: PortaCountListener = {
            controlSourceChanged(source: ControlSource) {
                setControlSource(source)
            },
            sampleSourceChanged(source: SampleSource) {
                setSampleSource(source)
            },
            testTerminated() {
                setActivity(Activity.Idle)
            },
            dataTransmissionStateChanged(dataTransmissionState: DataTransmissionState) {
                setDataTransmissionState(dataTransmissionState)
            },
            testStarted() {
                setActivity(Activity.Testing)
            }
        }
        return () => {client.removeListener(listener)}
    }, []);
    return (
        <div>
            <span style={{float: "left"}}>Activity: {activity}</span><br/>
            <span style={{float: "left"}}>Control Mode: {controlSource}</span><br/>
            <span style={{float: "left"}}>Sample Source: {sampleSource}</span><br/>
            <span style={{float: "left"}}>Data Transmission: {dataTransmissionState}</span><br/>
        </div>)
}
