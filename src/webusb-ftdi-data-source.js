/*
Wrapper around webusb-ftdi
 */
import {
    WebUSBSerialDevice
} from "https://cdn.jsdelivr.net/gh/emcee5601/webusb-ftdi@2f671812f65af4c78bf8b19d043a3a15a85cdfe9/webusb-ftdi.js";
import {getReadableStreamFromDataSource, logSource} from "./datasource-helpers.js";

/**
 * make this sort of look like WebSerial.
 */
export class FtdiSerial {
    async requestPort() {
        return new FtdiPortDataSource();
    }
}

export class FtdiPortDataSource {
    /**
     * When there is no data available, wait this amount of time before checking again.
     * @type {number}
     */
    noDataWaitTimeMs = 300;
    readable;
    device;
    devicePort;
    inboundDataQueue = null;
    decoder = new TextDecoder();

    constructor() {
    }

    // must call this from a button
    async open(params) {
        this.device = new WebUSBSerialDevice({
            overridePortSettings: true, // TODO: not supported yet, always overrides baudrate
            // these are the defaults, this config is only used if above is true
            baudrate: params.baudRate,
            bits: 8, // TODO: override not supported yet
            stop: 1, // TODO: override not supported yet
            parity: false, // TODO: override not supported yet
            deviceFilters: [
                // example filtered device; see code for more examples
                {'vendorId': 0x0403, 'productId': 0x6001}, // 0403:6001 Future Technology Devices International, Ltd FT232 Serial (UART) IC
            ]
        });

        this.readable = getReadableStreamFromDataSource(this);

        return new Promise((resolve, reject) => {
            this.device.requestNewPort().then((port) => {
                this.devicePort = port;
                resolve(port);
            }).catch((err) => {
                console.log(`error requesting a port: ${err}`);
                reject(err);
            });
        })
    }

    // called internally
    connectToPort() {
        this.inboundDataQueue = []; // this also flags that we're initialized
        try {
            // try to connect, connect receives two parameters: data callback and error callback
            this.devicePort.connect((chunk) => {
                // chunk is a Uint8Array so we can't just use + or +=
                this.inboundDataQueue.push(chunk);

                // this is data callback, print data to console
                const decodedData = this.decoder.decode(chunk);
                // logData(`${decodedData}`);
                // logSource(`data callback got ${chunk.length} bytes: ${decodedData}\n`)
            }, (error) => {
                // called if error receiving data
                logSource("Error receiving data: " + error)
            });
            logSource('connected (probably)');
        } catch (e) {
            // called if can't get a port
            logSource("Error connecting to port: " + e.error)
            logSource(e)
        }
    }


    // Method returning promise when this push source is readable.
    async dataRequest() {
        const result = {
            bytesRead: 0,
            data: "",
        };

        if (this.inboundDataQueue === null) {
            this.connectToPort();
        }

        if (this.inboundDataQueue.length === 0) {
            // Data not available. We need a way to know if there is no more data or if we're just waiting.
            return new Promise((resolve) => {
                setTimeout(() => {
                    console.log(`no data, waiting a bit...`);
                    this.dataRequest().then((res) => {
                        console.log(`trying to get more data...`);
                        resolve(res)
                    });  // is this the correct way to chain Promises?
                }, this.noDataWaitTimeMs); // wait a little bit
            });
        }

        const chunks = this.inboundDataQueue.splice(0, this.inboundDataQueue.length); // is this thread safe?

        return new Promise((resolve) => {
            let bigChunkSize = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
            const bigChunk = new Uint8Array(bigChunkSize);

            // this has side effects...
            chunks.reduce((chunkIndex, chunk) => {
                bigChunk.set(chunk, chunkIndex);
                return (chunkIndex + chunk.length);
            }, 0);

            result.data = bigChunk;
            result.bytesRead = bigChunkSize;
            resolve(result);
        });
    }

    // Dummy close function
    close() {
        return;
    }
}

