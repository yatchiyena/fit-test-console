import React, {ChangeEvent, RefObject, useEffect, useState} from 'react'
import './App.css'
import {DataFilePushSource, getLines, getReadableStreamFromDataSource} from "./datasource-helper.ts";
import {DataCollector, DataCollectorPanel, DataCollectorStates} from "./data-collector.tsx";
import {SpeechSynthesisPanel} from "./speech-synthesis-panel.tsx";
import {speech} from "./speech.ts"
import {ExternalController, ExternalControlPanel, ExternalControlStates} from "./external-control.tsx";
import {AppSettings, SimpleDB, SimpleResultsDB, useDBSetting} from "./database.ts";
import {downloadData} from "./html-data-downloader.ts";
import {json2csv} from "json-2-csv";
import {UsbSerialDrivers} from "./web-usb-serial-drivers.ts";
import {FitTestProtocolPanel} from "./FitTestProtocolPanel.tsx";
import {convertFitFactorToFiltrationEfficiency, getFitFactorCssClass} from "./utils.ts";
import {SettingsCheckbox, SettingsSelect} from "./Settings.tsx";
import ReactECharts from "echarts-for-react";
import {EChartsOption} from "echarts-for-react/src/types.ts";
import {isNull, isUndefined} from "json-2-csv/lib/utils";

function fitFactorFormatter(value: number) {
    if (isNaN(value) || isUndefined(value) || isNull(value)) {
        return "?";
    }
    if (value < 1) {
        return value.toFixed(2);
    } else if (value < 10) {
        return value.toFixed(1);
    } else {
        return value.toFixed(0);
    }
}

function App() {
    const simulationSpeedsBytesPerSecond: number[] = [300, 1200, 14400, 28800, 56760];
    const [dataSource, setDataSource] = useState<string>("web-serial")
    const [simulationSpeedBytesPerSecond, setSimulationSpeedBytesPerSecond] = useState<number>(simulationSpeedsBytesPerSecond[simulationSpeedsBytesPerSecond.length - 1]);
    const [dataToDownload, setDataToDownload] = useState<string>("all-results")
    const [rawConsoleData, setRawConsoleData] = useState<string>("")
    const rawConsoleDataTextAreaRef = React.useRef<HTMLTextAreaElement>(null)
    const [logData, setLogData] = useState<string>("")
    const [processedData, setProcessedData] = useState<string>("")
    const fitTestDataTableRef = React.useRef<HTMLTableElement>(null)

    const [dataTransmissionMode, setDataTransmissionMode] = useState("Transmitting")
    const [valvePosition, setValvePosition] = useState("Sampling from Ambient")
    const [controlMode, setControlMode] = useState("Internal Control");

    const [baudRate, setBaudRate] = useDBSetting(AppSettings.BAUD_RATE, "1200")
    const [showAdvancedControls, setShowAdvancedControls] = useDBSetting(AppSettings.ADVANCED_MODE, false);
    const [showExternalControl, setShowExternalControl] = useDBSetting(AppSettings.SHOW_EXTERNAL_CONTROL, false);
    const [showProtocolEditor, setShowProtocolEditor] = useDBSetting(AppSettings.SHOW_PROTOCOL_EDITOR, false);
    const [verboseSpeech, setVerboseSpeech] = useDBSetting(AppSettings.VERBOSE, false);
    const [sayParticleCount, setSayParticleCount] = useDBSetting(AppSettings.SAY_PARTICLE_COUNT, false)
    const [sayEstimatedFitFactor, setSayEstimatedFitFactor] = useDBSetting(AppSettings.SAY_ESTIMATED_FIT_FACTOR, true);
    const [autoEstimateFitFactor, setAutoEstimateFitFactor] = useDBSetting(AppSettings.AUTO_ESTIMATE_FIT_FACTOR, false);
    const [defaultToPreviousParticipant, setDefaultToPreviousParticipant] = useDBSetting(AppSettings.DEFAULT_TO_PREVIOUS_PARTICIPANT, false);

    const [resultsDatabase] = useState(() => new SimpleResultsDB());
    const [rawDatabase] = useState(() => new SimpleDB());
    const initialState: ExternalControlStates = {
        dataTransmissionMode: dataTransmissionMode,
        setDataTransmissionMode: setDataTransmissionMode,
        valvePosition: valvePosition,
        setValvePosition: setValvePosition,
        controlMode: controlMode,
        setControlMode: setControlMode
    };
    const [externalControlStates] = useState(initialState);
    const [externalController] = useState(new ExternalController(externalControlStates));

    const [instructions, setInstructions] = useState<string>("")
    const [estimatedFitFactor, setEstimatedFitFactor] = useState<number>(NaN)
    const [ambientConcentration, setAmbientConcentration] = useState<number>(0)
    const [maskConcentration, setMaskConcentration] = useState<number>(-1) // -1 means unknown

    const initialChartOptions: EChartsOption = {
        axisPointer: {
            link: [
                {
                    xAxisIndex: 'all'
                }
            ],
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: {
                type: 'cross',
            },
            valueFormatter: fitFactorFormatter,
            position: function (pos: Array<number>, _params: object | Array<object>, _el: HTMLElement, _elRect: object, size: {
                contentSize: number[],
                viewSize: number[]
            }) {
                // place tooltip on edges, moving it out of the way when cursor is near
                if (pos[0] < size.viewSize[0] / 2) {
                    return {bottom: 10, right: 30}
                } else {
                    return {bottom: 10, left: 30}
                }
            }
        },
        grid: [
            {bottom: '60%'},
            {top: '60%'},
        ],
        xAxis: [
            {
                type: 'time',
                gridIndex: 0,
            },
            {
                type: 'time',
                gridIndex: 1,
            },
        ],
        yAxis: [
            {
                name: 'concentration',
                position: 'left',
                type: 'value',
                gridIndex: 0,
                splitLine: {
                    show: true,
                },
                minorSplitLine: {
                    show: true,
                }
            },
            {
                name: 'estimated fit factor',
                position: 'left',
                type: 'value',
                gridIndex: 1,
            },
        ],
        dataZoom: [
            {
                id: 'dataZoomX',
                type: 'slider',
                xAxisIndex: [0, 1],
                filterMode: 'filter',   // Set as 'filter' so that the modification
                                        // of window of xAxis will effect the
                                        // window of yAxis.
            },
            {
                id: 'dataZoomY0',
                type: 'slider',
                yAxisIndex: [0],
                filterMode: 'empty',
            },
            {
                id: 'dataZoomY1',
                type: 'slider',
                yAxisIndex: [1],
                filterMode: 'empty',
            }
        ],
        series: [
            {
                name: 'concentration',
                type: 'line',
                encode: {
                    x: ['timestamp'],
                    y: ['concentration'],
                },
                yAxisIndex: 0,
                xAxisIndex: 0,
                lineStyle: {
                    type: "dotted",
                    width: 3,
                    opacity: 0, // hide
                },
                markArea: {
                    data: []
                }
            },
            {
                name: 'guestimated ambient level',
                type: 'line',
                encode: {
                    x: ['timestamp'],
                    y: ['guestimatedAmbient'],
                },
                yAxisIndex: 0,
                xAxisIndex: 0,
                lineStyle: {
                    color: "gray",
                    width: 3,
                },
                itemStyle: {
                    color: "gray",
                },
                showSymbol: false, // hides the point until mouseover
            },
            {
                name: 'EMA concentration',
                type: 'line',
                encode: {
                    x: ['timestamp'],
                    y: ['emaConcentration'],
                },
                yAxisIndex: 0,
                xAxisIndex: 0,
                lineStyle: {
                    color: "blue",
                    width: 3,
                },
                itemStyle: {
                    color: "blue",
                },
                showSymbol: false, // hides the point until mouseover
            },
            {
                name: 'EMA concentration in zone',
                type: 'line',
                encode: {
                    x: ['timestamp'],
                    y: ['emaConcentrationInZone'],
                },
                yAxisIndex: 0,
                xAxisIndex: 0,
                lineStyle: {
                    color: "blue",
                    width: 1,
                },
                itemStyle: {
                    color: "blue",
                },
                showSymbol: false, // hides the point until mouseover
            },
            // {
            //     name: 'estimated fit factor',
            //     type: 'line',
            //     encode: {
            //         x: ['timestamp'],
            //         y: ['estimatedFitFactor'],
            //     },
            //     yAxisIndex: 1,
            //     xAxisIndex: 1,
            //     lineStyle: {
            //         width: 3,
            //     },
            //     itemStyle: {
            //         // opacity: 0, // hide
            //     },
            //     showSymbol: false, // hides the point until mouseover
            // },
            // {
            //     name: 'estimatedFF bottom',
            //     type: 'line',
            //     encode: {
            //         x: ['timestamp'],
            //         y: ['estimatedFitFactorBandLower'],
            //     },
            //     yAxisIndex: 1,
            //     xAxisIndex: 1,
            //     lineStyle: {
            //         width: 1,
            //         opacity: 0, // hidden
            //     },
            //     itemStyle: {
            //         opacity: 0, // hidden
            //     },
            //     tooltip: {
            //         show: false,
            //     },
            //     stack: "estimatedFFBand",
            // },
            // {
            //     name: 'FF variance',
            //     type: 'line',
            //     encode: {
            //         x: ['timestamp'],
            //         y: ['estimatedFitFactorBand'],
            //     },
            //     yAxisIndex: 1,
            //     xAxisIndex: 1,
            //     lineStyle: {
            //         width: 1,
            //         opacity: 0, // hidden
            //     },
            //     itemStyle: {
            //         opacity: 0, // hidden
            //     },
            //     areaStyle: {
            //         // since we're stacking, the upper bound series should come after the lower bound series, and should be expressed as the increment over the lower bound.
            //         color: "wheat",
            //     },
            //     stack: "estimatedFFBand",
            // },
            {
                name: 'Zone FF',
                type: 'line',
                encode: {
                    x: ['timestamp'],
                    y: ['zoneFF'],
                },
                yAxisIndex: 1,
                xAxisIndex: 1,
                lineStyle: {
                    width: 1,
                },
                itemStyle: {
                    opacity: 0, // hidden
                },
                showSymbol: false, // hides the point until mouseover
            },
        ],
    };
    const [chartOptions, setChartOptions] = useState(initialChartOptions);
    const initialEstimatedFitFactorGaugeOptions: EChartsOption = {
        series: [
            {
                type: 'gauge',
                radius: '100%',
                min: 0,
                max: 200,
                detail: {
                    valueAnimation: true,
                    formatter: fitFactorFormatter,
                    color: 'auto'
                },
                axisLabel: {
                    color: 'auto',
                    distance: 10,
                },
                axisLine: {
                    lineStyle: {
                        width: 6,
                        color: [
                            [0.0999, 'darkred'],
                            [0.4999, 'darkorange'],
                            [1, 'green'],
                        ]
                    }
                },
                axisTick: {
                    show:false,
                    length: 2,
                    lineStyle: {
                        color: 'auto',
                        width: 2
                    }
                },
                splitLine: {
                    distance: 0,
                    length: 5,
                    lineStyle: {
                        color: 'auto',
                        width: 1
                    },
                },
                pointer: {
                    itemStyle: {
                        color: 'auto',
                    }
                },
                data: [
                    {value: 88},
                ],
            }
        ]
    };
    const [estimatedFitFactorGaugeOptions, setEstimatedFitFactorGaugeOptions] = useState(initialEstimatedFitFactorGaugeOptions)

    const initialDataCollectorState: DataCollectorStates = {
        setInstructions: setInstructions,
        logData: logData,
        setLogData: setLogData,
        rawConsoleData: rawConsoleData,
        setRawConsoleData: setRawConsoleData,
        processedData: processedData,
        setProcessedData: setProcessedData,
        fitTestDataTableRef: fitTestDataTableRef,
        verboseSpeech: verboseSpeech,
        sayParticleCount: sayParticleCount,
        setEstimatedFitFactor: setEstimatedFitFactor,
        setAmbientConcentration: setAmbientConcentration,
        setMaskConcentration: setMaskConcentration,
        autoEstimateFitFactor: autoEstimateFitFactor,
        sayEstimatedFitFactor: sayEstimatedFitFactor,
        defaultToPreviousParticipant: defaultToPreviousParticipant,
        chartOptions: initialChartOptions,
        setChartOptions: setChartOptions,
        gaugeOptions: initialEstimatedFitFactorGaugeOptions,
        setGaugeOptions: setEstimatedFitFactorGaugeOptions,
    };

    const [dataCollectorStates] = useState(initialDataCollectorState);
    const [dataCollector] = useState(() => new DataCollector(dataCollectorStates, logCallback, rawDataCallback,
        processedDataCallback, externalControlStates, resultsDatabase))

    useEffect(() => {
        console.log(`initializing raw logs db`)
        rawDatabase.open();

        return () => rawDatabase.close();
    }, [rawDatabase]);

    useEffect(() => {
    }, [estimatedFitFactor]);

    useEffect(() => {
        // need to propagate these down?
        externalControlStates.valvePosition = valvePosition;
        speech.sayItLater(valvePosition);
    }, [valvePosition, externalControlStates]);
    useEffect(() => {
        externalControlStates.dataTransmissionMode = dataTransmissionMode;
        console.log(`dataTransmissionMode changed: ${dataTransmissionMode}`);
        speech.sayItLater(dataTransmissionMode);
    }, [dataTransmissionMode, externalControlStates]);
    useEffect(() => {
        externalControlStates.controlMode = controlMode;
        console.log(`control mode changed: ${controlMode}`);
        speech.sayItLater(controlMode);
    }, [controlMode, externalControlStates]);
    useEffect(() => {
        dataCollectorStates.sayParticleCount = sayParticleCount;
    }, [sayParticleCount, dataCollectorStates]);
    useEffect(() => {
        dataCollectorStates.sayEstimatedFitFactor = sayEstimatedFitFactor;
    }, [sayEstimatedFitFactor, dataCollectorStates]);
    useEffect(() => {
        dataCollectorStates.defaultToPreviousParticipant = defaultToPreviousParticipant;
    }, [defaultToPreviousParticipant, dataCollectorStates]);

    // propagate states
    useEffect(() => {
        dataCollectorStates.logData = logData;
    }, [logData, dataCollectorStates]);
    useEffect(() => {
        dataCollectorStates.rawConsoleData = rawConsoleData;
    }, [rawConsoleData, dataCollectorStates]);
    useEffect(() => {
        dataCollectorStates.processedData = processedData;
    }, [processedData, dataCollectorStates]);
    useEffect(() => {
        dataCollectorStates.autoEstimateFitFactor = autoEstimateFitFactor;
    }, [autoEstimateFitFactor, dataCollectorStates]);

    useEffect(() => {
        console.log(`baud rate updated to ${baudRate}`)
        speech.sayIt(`baud rate is now ${baudRate}`)
    }, [baudRate])
    useEffect(() => {
        console.log(`datasource is now ${dataSource}`)
    }, [dataSource]);
    useEffect(() => {
        console.log(`Download File Format set to ${dataToDownload}`)
    }, [dataToDownload]);


    function logCallback(message: string) {
        setLogData((prev) => prev + message);
    }

    function rawDataCallback(message: string) {
        // shouldn't call this? since we don't want modified data going here?
        setRawConsoleData((prev) => prev + message);
    }

    function processedDataCallback(message: string) {
        const timestamp = new Date().toISOString(); // todo: want the timestamp to match up, so need to get it externally
        setProcessedData((prev) => prev + `${timestamp} ${message}`);
    }

    function dataSourceChanged(event: ChangeEvent<HTMLSelectElement>) {
        setDataSource(event.target.value);
    }

    function downloadFileFormatChanged(event: ChangeEvent<HTMLSelectElement>) {
        setDataToDownload(event.target.value);
    }

    function logit(message: string) {
        console.log(message);
        // this.dataCollector.appendToLog(message);
    }

    function connectButtonClickHandler() {
        switch (dataSource) {
            case "web-usb-serial":
                connectViaWebUsbSerial();
                break;
            case "web-serial":
                connectViaWebSerial()
                break;
            case "simulator":
                dataCollector.resetChart();
                connectViaSimulator()
                break;
            case "database":
                dataCollector.resetChart();
                connectViaDatabase();
                break;
            default:
                console.log(`unexpected dataSource : ${dataSource}`);
                break
        }
    }

    function downloadButtonClickHandler() {
        switch (dataToDownload) {
            case "all-raw-data":
                // downloadRawData(rawConsoleData, "raw-fit-test-data");
                downloadAllRawDataAsJSON()
                break;
            case "all-results":
                // downloadTableAsCSV(table, "fit-test-results");
                downloadAllResultsAsCSV();
                break;
            default:
                console.log(`unsupported data to download: ${dataToDownload}`);
        }
    }

    function downloadAllRawDataAsJSON() {
        // grab all data from the database and download it
        rawDatabase.getAllData().then(data => {
            downloadData(JSON.stringify(data), "fit-test-all-raw-data", "json");
        })
    }

    function downloadAllResultsAsCSV() {
        // TODO: use the same column order as results table instead of hardcoding
        // "ID":39,"Time":"11/19/2024, 11:18:52 PM","Ex 1":"983","Ex 2":"425","Ex 3":"24","Ex 4":"832","Final":"89"}
        resultsDatabase.getAllData().then(data => {
            const csv = json2csv(data, {
                keys: ['ID', 'Time', 'Participant', 'Mask', 'Notes', 'Ex 1', 'Ex 2', 'Ex 3', 'Ex 4', 'Final'],
                emptyFieldValue: "",
            })
            downloadData(csv, "fit-test-all-results", "csv");
        });
    }


    function connectViaWebUsbSerial() {
        const serial = new UsbSerialDrivers()
        serial.requestPort().then((port) => {
            port.open({baudRate: Number(baudRate)}).then(() => {
                if (port.readable) {
                    monitor(port.readable.getReader());
                }
                if (port.writable) {
                    externalController.setWriter(port.writable.getWriter());
                }
            })
        })

    }

    function connectViaWebSerial() {
        if ("serial" in navigator) {
            logit("serial supported!")
            navigator.serial.requestPort().then((port) => {
                logit(`got serial port ${port.toLocaleString()}, using baud rate ${baudRate}`)
                port.open({baudRate: Number(baudRate)}).then((event) => {
                    logit(`opened ${event}`)
                    if (port.readable) {
                        monitor(port.readable.getReader());
                    }
                    if (port.writable) {
                        externalController.setWriter(port.writable.getWriter());
                    }
                })
            })
        } else {
            logit("no serial support. As of this writing, web serial is only supported on desktop chrome.")
        }
    }

    function connectViaDatabase() {
        throw new Error("implement me!")
    }

    function connectViaSimulator() {
        if ("showOpenFilePicker" in window) {
            // @ts-expect-error showOpenFilePicker is sometimes supported
            window.showOpenFilePicker({id: "simulator-files"}).then((fileHandles: FileSystemFileHandle[]) => {
                fileHandles[0].getFile().then((filehandle: File) => {
                    const fakeReader = getReadableStreamFromDataSource(new DataFilePushSource(filehandle, simulationSpeedBytesPerSecond)).getReader();
                    monitor(fakeReader, false); // don't save these to db since we already know the db save works and we don't need to pollute the db with simulated data.
                })
            })
        } else {
            const fakeReader = getReadableStreamFromDataSource(new DataFilePushSource("./fit-test-console/simulator-data/test-data.txt", simulationSpeedBytesPerSecond)).getReader();
            monitor(fakeReader, false); // don't save these to db since we already know the db save works and we don't need to pollute the db with simulated data.
        }
    }

    async function monitor(reader: ReadableStreamDefaultReader<Uint8Array>, saveToDb: boolean = true) {
        for await (const line of getLines(reader)) {
            const timestamp = new Date().toISOString();
            if (line.trim().length > 0) {
                // we only care about non-empty lines
                appendRaw(`${timestamp} ${line}\n`); // not really raw anymore since we've re-chunked into lines.
                if (saveToDb) {
                    rawDatabase?.addLine(line);
                }
            }
            dataCollector?.processLine(line);
        }
        console.log("monitor reached end of reader");
    }


    function scrollToBottom(textAreaRef: RefObject<HTMLTextAreaElement>) {
        if (textAreaRef.current) {
            textAreaRef.current.scrollTop = textAreaRef.current.scrollHeight;
        }
    }

    function appendRaw(message: string) {
        setRawConsoleData((prev) => prev + message);
        scrollToBottom(rawConsoleDataTextAreaRef);
    }


    return (
        <>
            <section id="data-source-baud-rate" style={{display: 'flex', width: '100%'}}>
                <fieldset style={{maxWidth: "fit-content", float: "left"}}>
                    {`mftc v${__APP_VERSION__}`}&nbsp;
                    <SettingsSelect label={"Baud"} value={baudRate} setValue={setBaudRate}
                                    options={[
                                        {"300": "300"},
                                        {"600": "600"},
                                        {"1200": "1200"},
                                        {"2400": "2400"},
                                        {"9600": "9600"}
                                    ]}/>
                    &nbsp; &nbsp;
                    Data Source: &nbsp;
                    <select id="data-source-selector" defaultValue={dataSource} onChange={dataSourceChanged}>
                        <option value="web-serial">WebSerial</option>
                        <option value="web-usb-serial">Web USB Serial</option>
                        <option value="simulator">Simulator</option>
                        <option value="database">Database</option>
                    </select> &nbsp;
                    {dataSource === "simulator" ?
                        <select id="simulator-data-file"
                                value={simulationSpeedBytesPerSecond}
                                onChange={(event) => setSimulationSpeedBytesPerSecond(Number(event.target.value))}>
                            {simulationSpeedsBytesPerSecond.map((bytesPerSecond: number) => <option key={bytesPerSecond}
                                                                                                    value={bytesPerSecond}>{bytesPerSecond}</option>)}
                        </select> : null}
                    <input type="button" value="Connect" id="connect-button" onClick={connectButtonClickHandler}/>
                </fieldset>
                <fieldset style={{maxWidth: "fit-content", float: "left"}}>
                    <select id="download-file-format-selector" defaultValue={dataToDownload}
                            onChange={downloadFileFormatChanged}>
                        <option value="all-results">All Results as CSV</option>
                        <option value="all-raw-data">All Raw data as json</option>
                    </select>
                    <input type="button" value="Download!" id="download-button" onClick={downloadButtonClickHandler}/>
                </fieldset>
            </section>
            <section id="speech-synth" style={{display: 'flex', width: '100%'}}>
                <fieldset style={{width: "100%", textAlign: "left"}}>
                    <SpeechSynthesisPanel/>
                    <SettingsCheckbox label="Verbose"
                                      value={verboseSpeech}
                                      setValue={setVerboseSpeech}></SettingsCheckbox>
                    <SettingsCheckbox label="Say particle count"
                                      value={sayParticleCount}
                                      setValue={setSayParticleCount}></SettingsCheckbox>
                    <SettingsCheckbox label="Advanced"
                                      value={showAdvancedControls}
                                      setValue={setShowAdvancedControls}></SettingsCheckbox>
                </fieldset>
            </section>
            {showAdvancedControls ?
                <section id="advanced-settings" style={{display: "flex", width: "100%"}}>
                    <fieldset style={{width: "100%", textAlign: "left"}}>
                        <SettingsCheckbox label="Auto-estimate FF"
                                          value={autoEstimateFitFactor}
                                          setValue={setAutoEstimateFitFactor}></SettingsCheckbox>
                        <SettingsCheckbox label="Say estimated FF"
                                          value={sayEstimatedFitFactor}
                                          setValue={setSayEstimatedFitFactor}></SettingsCheckbox>
                        <SettingsCheckbox label="Default to previous participant"
                                          value={defaultToPreviousParticipant}
                                          setValue={setDefaultToPreviousParticipant}></SettingsCheckbox>
                        <SettingsCheckbox label="External Control"
                                          value={showExternalControl}
                                          setValue={setShowExternalControl}></SettingsCheckbox>
                        <SettingsCheckbox label="Protocol Editor"
                                          value={showProtocolEditor}
                                          setValue={setShowProtocolEditor}></SettingsCheckbox>
                    </fieldset>
                </section> : null}
            {showExternalControl ? <div style={{display: "flex", width: "100%"}}>
                <ExternalControlPanel control={externalController}/>
            </div> : null}
            {showProtocolEditor ? <section style={{display: "flex", width: "100%"}}>
                <fieldset style={{width: "100%"}}>
                    <legend>fit test protocols</legend>
                    <FitTestProtocolPanel></FitTestProtocolPanel>
                </fieldset>
            </section> : null}
            {autoEstimateFitFactor ?
                <section style={{display: "inline-flex", width: "100%"}}>
                    <fieldset style={{display: "inline-block", float: "left"}}>
                        <legend>Estimated Fit Factor</legend>
                        <div style={{width: "100%"}}>
                            <fieldset style={{display: "inline-block"}}>
                                <legend>Ambient</legend>
                                <span>{Number(ambientConcentration).toFixed(0)}</span>
                            </fieldset>
                            <fieldset style={{display: "inline-block"}}>
                                <legend>Mask</legend>
                                <span>{maskConcentration < 0 ? "?" : Number(maskConcentration).toFixed(maskConcentration < 10 ? 1 : 0)}</span>
                            </fieldset>
                        </div>
                        <div className={getFitFactorCssClass(estimatedFitFactor)}
                             style={{
                                 boxSizing: "border-box",
                                 width: '100%',
                                 height: 'max-content',
                                 alignContent: 'center',
                                 fontSize: "1.7rem"
                             }}>
                            <span>{Number(estimatedFitFactor).toFixed(estimatedFitFactor < 10 ? 1 : 0)}</span>
                            <br/>
                            <span
                                style={{fontSize: "smaller"}}>({convertFitFactorToFiltrationEfficiency(estimatedFitFactor)}%)</span>
                        </div>
                        <ReactECharts option={estimatedFitFactorGaugeOptions}/>
                    </fieldset>
                    <div style={{display: "inline-block", flexGrow: 1}}>
                        <ReactECharts style={{height: "70vh"}}
                                      option={chartOptions}
                            // notMerge={false}
                            // lazyUpdate={true}
                        />
                    </div>
                </section> : null}
            <section style={{display: "inline-flex", width: "100%"}}>
                <fieldset style={{display: "inline-block", flexGrow: 1}}>
                    <legend>Instructions</legend>
                    <textarea id="instructions" readOnly={true} style={{
                        width: "100%",
                        minHeight: "3rem",
                        height: "fit-content",
                        fontSize: "xxx-large",
                        overflow: "auto",
                        resize: "vertical",
                        border: "none"
                    }} value={instructions}></textarea>
                </fieldset>
            </section>
            <DataCollectorPanel dataCollector={dataCollector}></DataCollectorPanel>
        </>
    )
}

export default App
