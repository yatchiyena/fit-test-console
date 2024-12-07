// @ts-expect-error no types defined
import ftdi from 'ftdi-js'
import {getReadableStreamFromDataSource, PushSource} from "./datasource-helper.ts";
import ProlificUsbSerial from "pl2303"


export class UsbSerialPort {
    readonly device: USBDevice;
    private driver: UsbSerialDriver;
    readable: ReadableStream | undefined;
    writable: WritableStream | undefined;

    constructor(device: USBDevice, driver: UsbSerialDriver) {
        this.device = device;
        this.driver = driver
    }

    async open(opts: { baudRate: number }) {
        return new Promise((resolve, reject) => {
            this.driver.open(this.device, opts).then((serial) => {
                this.driver.addEventListener();

                this.readable = getReadableStreamFromDataSource(serial); // this starts reading immediately  :(
                this.writable = this.driver.getWritableStreamFromDataSink();
                resolve(serial);
            }).catch(reject)
        })
    }
}

export class UsbSerialDrivers {
    async requestPort(): Promise<UsbSerialPort> {
        const drivers: UsbSerialDriver[] = [new FtdiSerialDriver(), new ProlificSerialDriver()];

        return new Promise((resolve, reject) => {
            const supportedDevices = drivers.flatMap(driver => driver.options.flatMap(t => t.filters))

            navigator.usb.requestDevice({filters: supportedDevices}).then(device => {
                const driver = drivers.find((driver) => {
                    const driverDevices = driver.options.flatMap(t => t.filters)
                    const driverDevice = driverDevices.find(driverDevice => {
                        return driverDevice.vendorId == device.vendorId
                            && driverDevice.productId === device.productId
                    })
                    return driverDevice
                })

                if(driver) {
                    resolve(new UsbSerialPort(device, driver));
                } else {
                    reject(`could not find driver for device ${JSON.stringify(device)}`)
                }
            })
        })
    }
}

abstract class UsbSerialDriver implements PushSource {
    readonly options: USBDeviceRequestOptions[];

    /**
     * When there is no data available, wait this amount of time before checking again.
     * @type {number}
     */
    noDataWaitTimeMs = 300;
    readable: ReadableStream | undefined;
    writable: WritableStream | undefined;
    inboundDataQueue: Uint8Array[] = [];

    abstract open(device: USBDevice, opts: {baudRate: number}) : Promise<UsbSerialDriver>;
    abstract close() : Promise<void>;
    abstract write(chunk: Uint8Array): Promise<USBOutTransferResult>;
    abstract addEventListener(): void

    protected constructor(options: USBDeviceRequestOptions[]) {
        this.options = options;
    }

    getWritableStreamFromDataSink() {
        const queuingStrategy = new CountQueuingStrategy({highWaterMark: 1});
        const decoder = new TextDecoder();
        const driver = this as UsbSerialDriver;
        return new WritableStream(
            {
                // Implement the sink
                write(chunk) {
                    const data = decoder.decode(chunk);
                    console.log(`sending to ftdi: ${data}`);
                    return new Promise<void>((resolve, reject) => {
                        driver.write(chunk).then((res: USBOutTransferResult) => {
                            console.log(`successfully sent to ftdi: ${res.status}, bytesWritten: ${res.bytesWritten}`);
                            resolve()
                        }).catch((err: string) => {
                            console.log(`error sending to ftdi: ${err.toString()}`);
                            reject(err)
                        });
                    });
                },
                close() {
                    console.log("ftdi sink closed")
                },
                abort(err) {
                    console.log("ftdi Sink error:", err);
                },
            },
            queuingStrategy
        );
    }

    // Method returning promise when this push source is readable.
    async dataRequest(): Promise<Uint8Array> {
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
            const bigChunkSize = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
            const bigChunk = new Uint8Array(bigChunkSize);

            // this has side effects...
            chunks.reduce((chunkIndex, chunk) => {
                bigChunk.set(chunk, chunkIndex);
                return (chunkIndex + chunk.length);
            }, 0);

            console.log(`big chunk size is ${bigChunkSize}`)
            resolve(bigChunk);
        });
    }

}



class ProlificSerialDriver extends UsbSerialDriver {
    private delegate: ProlificUsbSerial|undefined;
    constructor() {
        super([{filters: [{vendorId: 1659, productId: 9123}]}]);
    }

    async open(device: USBDevice, opts: {baudRate: number}) {
        return new Promise<UsbSerialDriver>((resolve, reject) => {
            this.delegate = new ProlificUsbSerial(device, opts)
            this.delegate.open().then(() => resolve(this)).catch(reject);
        })
    }

    override async close() {
        return this.delegate?.close();
    }

    override async write(chunk: Uint8Array) {
        if(this.delegate) {
            return this.delegate.write(chunk);
        }
        return new Promise<USBOutTransferResult>((_resolve, reject) => {
            reject("not yet initialized")
        })
    }

    override addEventListener() {
        if(!this.delegate) {
            return;
        }
        this.delegate.addEventListener('data', (event) => {
            const chunk: Uint8Array = (event as CustomEvent).detail;
            // chunk is a Uint8Array so we can't just use + or +=
            this.inboundDataQueue.push(chunk);
        })

    }
}



class FtdiSerialDriver extends UsbSerialDriver {
    private delegate: ftdi;
    constructor() {
        super([{filters: [{vendorId: 1027, productId: 24577}]}])
    }

    override async open(device: USBDevice, opts: {baudRate: number}) {
        this.delegate = new ftdi(device, opts)
        return new Promise<UsbSerialDriver>((resolve) => {
            resolve(this);
        })
    }

    override async close() {
        return this.delegate.closeAsync();
    }

    override async write(chunk: Uint8Array) {
        return this.delegate.writeAsync(chunk);
    }

    override addEventListener() {
        this.delegate.addEventListener('data', (event: CustomEvent) => {
            const chunk = event.detail;
            this.inboundDataQueue.push(chunk);
        })
    }

}

/**
 * make this sort of look like WebSerial.
 */
export class FTDISerial {
    async requestPort() {
        return new FTDIPortDataSource();
    }
}

export class FTDIPortDataSource implements PushSource {
    /**
     * When there is no data available, wait this amount of time before checking again.
     * @type {number}
     */
    noDataWaitTimeMs = 300;
    readable: ReadableStream | undefined;
    writable: WritableStream | undefined;
    device: ftdi;
    inboundDataQueue: Uint8Array[] = [];
    decoder = new TextDecoder();

    constructor() {
    }

    // must call this from a button
    async open(opts: { baudRate: string }) {
        return new Promise((resolve) => {
            navigator.usb.requestDevice({filters: [{vendorId: 1027, productId: 24577}]}).then(device => {
                const serial = new ftdi(device, opts);
                this.device = serial;
                serial.addEventListener('data', (event: CustomEvent) => {
                    const chunk = event.detail;
                    const decodedData = this.decoder.decode(chunk);
                    console.log(`got data: ${decodedData}`)
                    // logData(`${decodedData}`);
                    // logSource(`data callback got ${chunk.length} bytes: ${decodedData}\n`)

                    // chunk is a Uint8Array so we can't just use + or +=
                    this.inboundDataQueue.push(chunk);
                })

                this.readable = getReadableStreamFromDataSource(this); // this starts reading immediately  :(
                this.writable = this.getWritableStreamFromDataSink(this);
                resolve(this);
            })
        })
    }

    getWritableStreamFromDataSink(dataSink: FTDIPortDataSource) {
        const queuingStrategy = new CountQueuingStrategy({highWaterMark: 1});
        const decoder = new TextDecoder();
        return new WritableStream(
            {
                // Implement the sink
                write(chunk) {
                    const data = decoder.decode(chunk);
                    console.log(`sending to ftdi: ${data}`);
                    return new Promise<void>((resolve, reject) => {
                        dataSink.device.writeAsync(chunk).then((res: USBOutTransferResult) => {
                            console.log(`successfully sent to ftdi: ${res.status}, bytesWritten: ${res.bytesWritten}`);
                            resolve()
                        }).catch((err: string) => {
                            console.log(`error sending to ftdi: ${err.toString()}`);
                            reject(err)
                        });
                    });
                },
                close() {
                    console.log("ftdi sink closed")
                },
                abort(err) {
                    console.log("ftdi Sink error:", err);
                },
            },
            queuingStrategy
        );
    }


    // Method returning promise when this push source is readable.
    async dataRequest(): Promise<Uint8Array> {
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
            const bigChunkSize = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
            const bigChunk = new Uint8Array(bigChunkSize);

            // this has side effects...
            chunks.reduce((chunkIndex, chunk) => {
                bigChunk.set(chunk, chunkIndex);
                return (chunkIndex + chunk.length);
            }, 0);

            console.log(`big chunk size is ${bigChunkSize}`)
            resolve(bigChunk);
        });
    }

    // Dummy close function
    close() {
        return;
    }
}


/**
 * make this sort of look like WebSerial.
 */
export class ProlificSerial {
    async requestPort() {
        return new ProlificPortDataSource();
    }
}



export class ProlificPortDataSource implements PushSource {
    /**
     * When there is no data available, wait this amount of time before checking again.
     * @type {number}
     */
    noDataWaitTimeMs = 300;
    readable: ReadableStream | undefined;
    writable: WritableStream | undefined;
    device: ProlificUsbSerial | undefined;
    inboundDataQueue: Uint8Array[] = [];

    constructor() {
    }

    // must call this from a button
    async open(opts: { baudRate: number; }) {
        return new Promise((resolve) => {
            navigator.usb.requestDevice({filters: [{vendorId: 1659, productId: 9123}]}).then(device => {
                const serial = new ProlificUsbSerial(device, opts);
                this.device = serial;
                serial.addEventListener('data', (event) => {
                    const chunk: Uint8Array = (event as CustomEvent).detail;
                    // chunk is a Uint8Array so we can't just use + or +=
                    this.inboundDataQueue.push(chunk);
                })

                this.readable = getReadableStreamFromDataSource(this); // this starts reading immediately  :(
                this.writable = this.getWritableStreamFromDataSink();
                resolve(this);
            })
        })
    }

    getWritableStreamFromDataSink() {
        const queuingStrategy = new CountQueuingStrategy({highWaterMark: 1});
        const decoder = new TextDecoder();
        const device = this.device;
        return new WritableStream(
            {
                // Implement the sink
                write(chunk) {
                    const data = decoder.decode(chunk);
                    console.log(`sending to prolific: ${data}`);
                    return new Promise<void>((resolve, reject) => {
                        // TODO: do we need to wrap chunk in a Buffer? or wrap data in a Buffer and send that instead?
                        device?.write(chunk).then((res) => {
                            console.log(`successfully sent to prolific: ${res.status}, bytesWritten: ${res.bytesWritten}`);
                            resolve()
                        }).catch((err) => {
                            console.log(`error sending to prolific: ${err.toString()}`);
                            reject(err)
                        });
                    });
                },
                close() {
                    console.log("prolific sink closed")
                },
                abort(err) {
                    console.log("prolific Sink error:", err);
                },
            },
            queuingStrategy
        );
    }


    // Method returning promise when this push source is readable.
    async dataRequest(): Promise<Uint8Array> {
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
            const bigChunkSize = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
            const bigChunk = new Uint8Array(bigChunkSize);

            // this has side effects...
            chunks.reduce((chunkIndex, chunk) => {
                bigChunk.set(chunk, chunkIndex);
                return (chunkIndex + chunk.length);
            }, 0);

            resolve(bigChunk);
        });
    }

    // Dummy close function
    close() {
        return;
    }
}


