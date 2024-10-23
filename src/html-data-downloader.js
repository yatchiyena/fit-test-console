/*
Download data from an HTML elements in various formats.
Not all combination of elements and formats are supported.
*/


function getFilenamePrefix(htmlElement, filenamePrefixHint = "data") {
    return (htmlElement.id || htmlElement.nodeName || filenamePrefixHint) + "_";
}

/**
 * Download the terminal's contents to a file. from https://github.com/GoogleChromeLabs/serial-terminal/blob/main/src/index.ts
 */
function createFauxLink(fileName, contents) {
    const linkContent = URL.createObjectURL(
        new Blob([new TextEncoder().encode(contents).buffer],
            {type: 'text/plain'}));
    const fauxLink = document.createElement('a');
    fauxLink.download = fileName;
    fauxLink.href = linkContent;
    return fauxLink;
}

/**
 * @param htmlElement must have a value property (for now)
 * @param filenameHint
 */
export function downloadRawData(htmlElement, filenameHint = "data") {
    const fauxLink = createFauxLink(`${getFilenamePrefix(htmlElement, filenameHint)}${new Date().getTime()}.txt`, htmlElement.value);
    fauxLink.click();
}

export function downloadTableAsCSV(tableElement, filenameHint = "table") {
    const tableData = [];
    const rowElements = tableElement.getElementsByTagName("tr");
    for (let row = 0; row < rowElements.length; row++) {
        const rowData = [];
        let cells = rowElements[row].getElementsByTagName("td");
        if (cells.length === 0) {
            cells = rowElements[row].getElementsByTagName("th");
        }
        for (let i = 0; i < cells.length; i++) {
            rowData.push(cells[i].innerText);
        }
        tableData.push(rowData.map((value) => `"${value.replaceAll("\"", "\"\"")}"`).join(","));
    }

    const fauxLink = createFauxLink(`${getFilenamePrefix(tableElement, filenameHint)}${new Date().getTime()}.csv`, tableData.join("\n"));
    fauxLink.click();
}

export function downloadTableAsJSON(tableElement, filenameHint = "table") {
    const columnHeadingElements = tableElement.getElementsByTagName("th");
    const columnNames = [];
    for (let i = 0; i < columnHeadingElements.length; i++) {
        columnNames.push(columnHeadingElements[i].innerText);
    }

    const tableData = [];
    const rowElements = tableElement.getElementsByTagName("tr");
    for (let row = 0; row < rowElements.length; row++) {
        const rowData = {};
        const cells = rowElements[row].getElementsByTagName("td");
        for (let i = 0; i < columnNames.length; i++) {
            if (cells.length <= i) {
                break; // no more cells (aborted)
            }
            rowData[columnNames[i]] = cells[i].innerText; // todo: convert line breaks
        }
        tableData.push(rowData);
    }

    const fauxLink = createFauxLink(`${getFilenamePrefix(tableElement, filenameHint)}${new Date().getTime()}.json`, JSON.stringify(tableData));
    fauxLink.click();
}


