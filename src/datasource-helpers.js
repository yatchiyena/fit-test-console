/*
  mock data source idea from https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Using_readable_streams
 */

const utf8Decoder = new TextDecoder("utf-8");

/**
 * from https://developer.mozilla.org/en-US/docs/Web/API/ReadableStreamDefaultReader/read#example_2_-_handling_text_line_by_line
 * @param reader
 * @returns an iterator that returns data from the reader broken up into lines
 */

export async function* getLines(reader) {
    async function readFromReader() {
        const result = await reader.read();
        if (!result.done && result.value) {
            // appendRaw(utf8Decoder.decode(result.value));
        }
        return result;
    }

    let {value: chunk, done: readerDone} = await readFromReader();
    chunk = chunk ? utf8Decoder.decode(chunk, {stream: true}) : "";


    let re = /\r\n|\n|\r/gm;
    let startIndex = 0;

    for (; ;) {
        let result = re.exec(chunk);
        if (!result) {
            if (readerDone) {
                break;
            }
            let remainder = chunk.substring(startIndex);
            ({value: chunk, done: readerDone} = await readFromReader());
            chunk =
                remainder + (chunk ? utf8Decoder.decode(chunk, {stream: true}) : "");
            startIndex = re.lastIndex = 0;
            continue;
        }
        yield chunk.substring(startIndex, result.index);
        startIndex = re.lastIndex;
    }
    if (startIndex < chunk.length) {
        // last line didn't end in a newline char
        yield chunk.substring(startIndex);
    }
}



export function getReadableStreamFromDataSource(pushSource) {
    return new ReadableStream({
        start(controller) {
            readRepeatedly().catch((e) => controller.error(e));

            function readRepeatedly() {
                return pushSource.dataRequest().then((result) => {
                    if (result.data.length === 0) {
                        logSource(`No data from source: closing`);
                        controller.close();
                        return;
                    }

                    // logSource(`Enqueue data: ${result.data}`);
                    controller.enqueue(result.data);
                    return readRepeatedly();
                });
            }
        },

        cancel() {
            logSource(`cancel() called on underlying source`);
            pushSource.close();
        },
    });
}


export class DataFilePushSource {
    static delayMs = 10;
    static encoder = new TextEncoder();
    reader = null;
    buffer = null;
    bufferIndex = 0;
    fileOrUrl;

    constructor(fileOrUrl) {
        this.fileOrUrl = fileOrUrl;
    }

    // Method returning promise when this push source is readable.
    async dataRequest() {
        const result = {
            bytesRead: 0,
            data: "",
        };

        if (this.buffer === null || this.bufferIndex >= this.buffer.length) {
            // need (more) data
            if (this.reader === null) {
                this.reader = await fetch(this.fileOrUrl).then((result) => {
                    if (result.ok) {
                        return result.body.getReader();
                    } else {
                        throw new Error(`Failed to load protocol definitions. error: ${result.status}`);
                    }
                })
            }

            const result = await this.reader.read();
            this.bufferIndex = 0;
            if (result.done) {
                // no more data
                this.buffer = []
            } else {
                this.buffer = result.value;
            }
        }

        if (this.buffer.length === 0) {
            // no more data
            return new Promise((resolve) => resolve(result));
        }

        // some data not sent
        const end = this.bufferIndex + (this.bufferIndex + 3 < this.buffer.length ? 3 : this.buffer.length);
        const chunk = this.buffer.slice(this.bufferIndex, end);
        this.bufferIndex += chunk.length;
        return new Promise((resolve) => {
            // Emulate slow read of data
            setTimeout(() => {
                result.data = chunk;
                result.bytesRead = chunk.length;
                resolve(result);
            }, DataFilePushSource.delayMs);
        });
    }

    // Dummy close function
    close() {
        return;
    }
}



export function logSource(result) {
    console.log(`source: ${result}`);
}

export function logData(result) {
    // console.log(`data: ${result}`);
}
