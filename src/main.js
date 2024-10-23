import {DataCollector} from "./data-collector.js";
import {quickSetupSpeechSynthesis} from "./speech.js";
import {downloadRawData, downloadTableAsCSV, downloadTableAsJSON} from "./html-data-downloader.js";
import {FtdiSerial} from "./webusb-ftdi-data-source.js";
import {DataFilePushSource, getLines, getReadableStreamFromDataSource} from "./datasource-helpers.js";

const baudRateSelector = document.getElementById("baud-rate-selector")
const logTextArea = document.getElementById("log-text-area")
const rawDataTextArea = document.getElementById("raw-data")
const dataTextArea = document.getElementById("interpreted-data")
const instructionsTextArea = document.getElementById("instructions");


let connectedPort;
let reader;
let readableStreamClosed;
let writer;
let writableStreamClosed;
const dataCollector = new DataCollector(logTextArea, dataTextArea, instructionsTextArea);

function logit(message) {
    console.log(message);
    dataCollector.appendToLog(message);
}


function serialProbe() {
    console.log("serialProbe...");
    if ("serial" in navigator) {
        logit("serial supported!")
    } else {
        logit("no serial support :(")
    }
    let promise = navigator.serial.getPorts().then((ports) => {
        let message = `got serial ports: ${ports.toString()}`;
        logit(message)
    })
}

function serialRequest() {
    const baudRate = baudRateSelector.value;

    if ("serial" in navigator) {
        logit("serial supported!")
    } else {
        logit("no serial support. As of this writing, web serial is only supported on desktop chrome.")
    }

    let promise = navigator.serial.requestPort().then((port) => {
        logit(`got serial port ${port.toLocaleString()}, using baud rate ${baudRate}`)
        port.open({baudRate: baudRate}).then((event) => {
            logit(`opened ${event}`)
            monitor(port.readable.getReader());
        })
    })
}

function ftdiRequest() {
    const baudRate = baudRateSelector.value;
    const serial = new FtdiSerial();
    serial.requestPort().then((port) => {
        port.open({baudRate: baudRate}).then((event) => {
            logit(`ftdi opened ${event}`)
            monitor(port.readable.getReader());
        })
    })
}

function autodetectBaudRate() {
    // according to the 8020 technical manual, everything is N81
    // factory setting is 1200
    // supported values are 300, 600, 1200, 2400, 9600

}


// use simulator as data source
function simulatorRequest() {
    const fakeReader = getReadableStreamFromDataSource(new DataFilePushSource("/src/test-data.txt")).getReader();
    monitor(fakeReader);
}

function setupButtons() {

    const connectButton = document.getElementById("connect-button");
    connectButton.onclick = (event) => {
        const selectedDataSource = document.getElementById("data-source-selector").value
        switch( selectedDataSource) {
            case "ftdi":
                ftdiRequest();
                break;
            case "web-serial":
                serialRequest();
                break;
            case "simulator":
                simulatorRequest();
                break;
            default:
                logit(`Unsupported data source: ${selectedDataSource}`);
        }
    }

    const downloadButton = document.getElementById("download-button");
    downloadButton.onclick = (event) => {
        const table = document.getElementById("fit-test-data-table");
        const selector = document.getElementById("download-file-format-selector");
        switch (selector.value) {
            case "raw":
                downloadRawData(rawDataTextArea);
                break;
            case "csv":
                downloadTableAsCSV(table);
                break;
            case "json":
                downloadTableAsJSON(table);
                break;
            default:
                console.log(`unsupported download file format: ${selector.value}`);
        }
    }


    // const stop_monitor_button = document.getElementById("stop-monitor-button");
    // stop_monitor_button.onclick = (event) => {
    //     stopMonitor();
    // }
}

function appendRaw(message) {
    rawDataTextArea.value += message;
    DataCollector.scrollToBottom(rawDataTextArea);
}



async function monitor(reader) {
    for await (let line of getLines(reader)) {
        appendRaw(`${line}\n`); // not really raw anymore since we've re-chunked into lines.
        dataCollector.processLine(line);
    }
}


const onConnect = function (event) {
    console.log(`connected ${event}`)
    connectedPort = event.target;
    monitor(connectedPort);
};


function setupMonitor() {
    navigator.serial.addEventListener('connect', onConnect)
}


async function stopMonitor() {
    logit("stopping monitor")
    const textEncoder = new TextEncoderStream();
    writer = textEncoder.writable.getWriter();
    writableStreamClosed = textEncoder.readable.pipeTo(connectedPort.writable);

    reader.cancel();
    await readableStreamClosed.catch(() => { /* Ignore */
    });

    await writer.close();
    await writableStreamClosed;

    await connectedPort.close();
}

function maybeAutoConnect() {
    let promise = navigator.serial.getPorts().then((ports) => {
        let message = `got serial ports: ${ports.toString()}`;
        if (ports.length === 1) {
            logit("found 1 serial port, attempting to auto-connect...")
            const baudRate = baudRateSelector.value;
            const port = ports[0];
            port.open({baudRate: baudRate}).then((event) => {
                logit(`opened ${event}`)
                monitor(port.readable.getReader());
            })
        }
    })

}


quickSetupSpeechSynthesis();
setupButtons();
setupMonitor();

// maybeAutoConnect();
// protect against un/reload most of the time
window.addEventListener("beforeunload", (event) => {
    event.preventDefault();
});
